import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  normalizePair, getPairMeta, fetchLivePrice,
  calcPnL, calcRR, calcPipValue, formatPL, getCurrencySymbol,
} from '../priceService';

const POPULAR = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF', 'EUR/GBP', 'GBP/JPY', 'EUR/JPY'];
const DEFAULT_SL_PIPS = 50;
const DEFAULT_TP_PIPS = 100;

function autoSlTp(entry, side, pipSize) {
  const dec = pipSize <= 0.001 ? 3 : 5;
  const sl = side === 'buy'
    ? (entry - DEFAULT_SL_PIPS * pipSize).toFixed(dec)
    : (entry + DEFAULT_SL_PIPS * pipSize).toFixed(dec);
  const tp = side === 'buy'
    ? (entry + DEFAULT_TP_PIPS * pipSize).toFixed(dec)
    : (entry - DEFAULT_TP_PIPS * pipSize).toFixed(dec);
  return { sl, tp };
}

export default function PLCalculator({ trades = [], onOpen, accountCurrency = 'USD', accountSize = 0, usdRate = 1 }) {
  const [pair, setPair]         = useState('EUR/USD');
  const [side, setSide]         = useState('buy');
  const [entry, setEntry]       = useState('');
  const [sl, setSl]             = useState('');
  const [tp, setTp]             = useState('');
  const [lotSize, setLotSize]   = useState('100000');
  const [selectedTrade, setSelectedTrade] = useState('');
  const [priceLoading, setPriceLoading]   = useState(false);
  const [openError, setOpenError] = useState('');
  const slTpManual = useRef(false);

  const pairKey  = normalizePair(pair);
  const pairMeta = getPairMeta(pairKey);
  const dec      = pairMeta ? (pairMeta.pipSize <= 0.001 ? 3 : 5) : 5;

  // Auto-fetch live price on pair change
  useEffect(() => {
    if (!pairMeta) return;
    let cancelled = false;
    setPriceLoading(true);
    fetchLivePrice(pairKey)
      .then(result => {
        if (cancelled) return;
        const entryStr = result.price.toFixed(dec);
        setEntry(entryStr);
        slTpManual.current = false;
        const auto = autoSlTp(result.price, side, pairMeta.pipSize);
        setSl(auto.sl); setTp(auto.tp);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setPriceLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairKey]);

  const handleSideChange = (newSide) => {
    setSide(newSide);
    const entryN = parseFloat(entry);
    if (!isNaN(entryN) && pairMeta && !slTpManual.current) {
      const auto = autoSlTp(entryN, newSide, pairMeta.pipSize);
      setSl(auto.sl); setTp(auto.tp);
    }
  };

  const handleEntryChange = (val) => {
    setEntry(val);
    slTpManual.current = false;
    const entryN = parseFloat(val);
    if (!isNaN(entryN) && pairMeta) {
      const auto = autoSlTp(entryN, side, pairMeta.pipSize);
      setSl(auto.sl); setTp(auto.tp);
    }
  };

  const handleLoadTrade = (tradeId) => {
    setSelectedTrade(tradeId);
    if (!tradeId) return;
    const trade = trades.find(t => String(t.id) === String(tradeId));
    if (!trade) return;
    setPair(trade.meta.display);
    setSide(trade.side);
    setEntry(String(trade.entry));
    setSl(String(trade.sl));
    setTp(String(trade.tp));
    setLotSize(String(trade.lotSize));
    slTpManual.current = true;
  };

  // Build 5 scenario price points: SL, midSL-entry, entry, midEntry-TP, TP
  const results = useMemo(() => {
    const entryN = parseFloat(entry);
    const slN    = parseFloat(sl);
    const tpN    = parseFloat(tp);
    const lotN   = parseFloat(lotSize);
    if (!pairMeta || [entryN, slN, tpN, lotN].some(isNaN)) return null;

    const atSL  = calcPnL({ entry: entryN, currentPrice: slN,    side, lotSize: lotN, pipSize: pairMeta.pipSize });
    const atTP  = calcPnL({ entry: entryN, currentPrice: tpN,    side, lotSize: lotN, pipSize: pairMeta.pipSize });
    const rr    = calcRR({ entry: entryN, sl: slN, tp: tpN, side });
    const pipVal = calcPipValue({ pairKey, lotSize: lotN });

    // 5 meaningful price points
    const midLoss   = (slN    + entryN) / 2;
    const midProfit = (entryN + tpN)    / 2;
    const pricePoints = [slN, midLoss, entryN, midProfit, tpN]
      .map(p => parseFloat(p.toFixed(dec)));

    const scenarios = pricePoints.map((price, i) => ({
      price,
      isSL: i === 0,
      isTP: i === 4,
      isEntry: i === 2,
      ...calcPnL({ entry: entryN, currentPrice: price, side, lotSize: lotN, pipSize: pairMeta.pipSize }),
    }));

    return { atSL, atTP, rr, pipVal, scenarios };
  }, [entry, sl, tp, lotSize, side, pairKey, pairMeta, dec]);

  const fmtAcc = (usdAmt) => {
    const val = usdAmt * usdRate;
    return (val >= 0 ? '+' : '-') + formatPL(val, accountCurrency);
  };

  const handleOpenTrade = () => {
    setOpenError('');
    const entryN = parseFloat(entry);
    const slN    = parseFloat(sl);
    const tpN    = parseFloat(tp);
    const lotN   = parseFloat(lotSize);
    if (!pairMeta) { setOpenError('Unsupported pair.'); return; }
    if ([entryN, slN, tpN, lotN].some(isNaN)) { setOpenError('Fill in all price fields first.'); return; }
    if (lotN <= 0) { setOpenError('Lot size must be > 0.'); return; }
    if (side === 'buy'  && slN >= entryN) { setOpenError('BUY: Stop Loss must be below Entry.'); return; }
    if (side === 'buy'  && tpN <= entryN) { setOpenError('BUY: Take Profit must be above Entry.'); return; }
    if (side === 'sell' && slN <= entryN) { setOpenError('SELL: Stop Loss must be above Entry.'); return; }
    if (side === 'sell' && tpN >= entryN) { setOpenError('SELL: Take Profit must be below Entry.'); return; }
    onOpen({
      key: pairKey, meta: pairMeta, side,
      entry: entryN, sl: slN, tp: tpN, lotSize: lotN,
      notes: '',
      openDate: new Date().toISOString().slice(0, 10),
    });
  };

  return (
    <div className="plc-wrap">
      <div className="plc-card">
        <div className="plc-header">
          <span className="plc-title">P/L ESTIMATOR</span>
        </div>

        {/* Load from open trade */}
        {trades.length > 0 && (
          <div className="plc-section">
            <label className="plc-label">LOAD FROM OPEN TRADE <span className="plc-label-hint">optional</span></label>
            <select
              className="plc-select"
              value={selectedTrade}
              onChange={e => handleLoadTrade(e.target.value)}
            >
              <option value="">— select a trade to autofill —</option>
              {trades.map(t => (
                <option key={t.id} value={t.id}>
                  {t.meta.display} · {t.side.toUpperCase()} · Entry {t.entry}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Pair */}
        <div className="plc-section">
          <label className="plc-label">CURRENCY PAIR</label>
          <input
            className="plc-input"
            value={pair}
            onChange={e => { setPair(e.target.value); setSelectedTrade(''); }}
            placeholder="EUR/USD"
          />
          {!pairMeta && pair && <div className="plc-error">Unsupported pair</div>}
          <div className="plc-chips">
            {POPULAR.map(p => (
              <button
                key={p}
                className={`plc-chip ${pairKey === normalizePair(p) ? 'active' : ''}`}
                onClick={() => { setPair(p); setSelectedTrade(''); }}
              >{p}</button>
            ))}
          </div>
        </div>

        {/* Side */}
        <div className="plc-section">
          <label className="plc-label">DIRECTION</label>
          <div className="plc-side-toggle">
            <button className={`plc-side buy ${side === 'buy' ? 'active' : ''}`} onClick={() => handleSideChange('buy')}>▲ BUY / LONG</button>
            <button className={`plc-side sell ${side === 'sell' ? 'active' : ''}`} onClick={() => handleSideChange('sell')}>▼ SELL / SHORT</button>
          </div>
        </div>

        {/* Entry / SL / TP row */}
        <div className="plc-row3">
          <div className="plc-field">
            <label className="plc-label">
              ENTRY PRICE
              {priceLoading && <span className="plc-hint"> · fetching…</span>}
              {!priceLoading && pairMeta && entry && <span className="plc-hint"> · live</span>}
            </label>
            <input className="plc-input" type="number" step="any" value={entry}
              onChange={e => { handleEntryChange(e.target.value); setSelectedTrade(''); }} placeholder="1.08500" />
          </div>
          <div className="plc-field">
            <label className="plc-label">STOP LOSS</label>
            <input className="plc-input plc-sl" type="number" step="any" value={sl}
              onChange={e => { slTpManual.current = true; setSl(e.target.value); setSelectedTrade(''); }} placeholder="1.08000" />
          </div>
          <div className="plc-field">
            <label className="plc-label">TAKE PROFIT</label>
            <input className="plc-input plc-tp" type="number" step="any" value={tp}
              onChange={e => { slTpManual.current = true; setTp(e.target.value); setSelectedTrade(''); }} placeholder="1.09000" />
          </div>
        </div>

        {/* Lot size */}
        <div className="plc-section">
          <label className="plc-label">LOT SIZE</label>
          <div className="plc-lot-row">
            <div className="plc-chips">
              {[['0.01','1000'],['0.05','5000'],['0.1','10000'],['1','100000']].map(([l, v]) => (
                <button key={l} className={`plc-chip ${lotSize === v ? 'active' : ''}`} onClick={() => setLotSize(v)}>{l}L</button>
              ))}
            </div>
            <input className="plc-input plc-lot-input" type="number" step="1" min="1"
              value={lotSize} onChange={e => setLotSize(e.target.value)} placeholder="100000" />
          </div>
        </div>

        {/* Results */}
        {results && (
          <div className="plc-results">

            {/* Summary cards */}
            <div className="plc-summary-grid">
              <div className="plc-sum-card loss">
                <div className="plc-sum-label">AT STOP LOSS</div>
                <div className="plc-sum-pl">{fmtAcc(results.atSL.plUsd)}</div>
                <div className="plc-sum-sub">{results.atSL.pips.toFixed(1)} pips</div>
              </div>
              <div className="plc-sum-card neutral">
                <div className="plc-sum-label">RISK : REWARD</div>
                <div className="plc-sum-pl plc-rr">1 : {results.rr ?? '—'}</div>
                <div className="plc-sum-sub">{results.pipVal?.toFixed(4)} USD / pip</div>
              </div>
              <div className="plc-sum-card profit">
                <div className="plc-sum-label">AT TAKE PROFIT</div>
                <div className="plc-sum-pl">{fmtAcc(results.atTP.plUsd)}</div>
                <div className="plc-sum-sub">{results.atTP.pips.toFixed(1)} pips</div>
              </div>
            </div>

            {/* Scenario table */}
            <div className="plc-scenarios">
              <div className="plc-sc-title">SCENARIO TABLE</div>
              <div className="plc-sc-head">
                <span>PRICE</span>
                <span>PIPS</span>
                <span>P/L ({accountCurrency})</span>
                <span>% OF ACCOUNT</span>
              </div>
              {results.scenarios.map((s, i) => {
                const plAcc = s.plUsd * usdRate;
                const pct   = accountSize > 0 ? (plAcc / accountSize * 100) : null;
                const rowCls = s.isSL ? 'sl-row' : s.isTP ? 'tp-row' : s.isEntry ? 'entry-row' : '';
                return (
                  <div key={i} className={`plc-sc-row ${s.plUsd >= 0 ? 'profit' : 'loss'} ${rowCls}`}>
                    <span className="plc-sc-price">
                      {s.price.toFixed(dec)}
                      {s.isSL    && <span className="plc-tag plc-tag-sl">SL</span>}
                      {s.isTP    && <span className="plc-tag plc-tag-tp">TP</span>}
                      {s.isEntry && <span className="plc-tag plc-tag-entry">ENTRY</span>}
                    </span>
                    <span className={s.pips >= 0 ? 'profit' : 'loss'}>
                      {s.pips >= 0 ? '+' : ''}{s.pips.toFixed(1)}
                    </span>
                    <span className={plAcc >= 0 ? 'profit' : 'loss'}>
                      {plAcc >= 0 ? '+' : '-'}{formatPL(plAcc, accountCurrency)}
                    </span>
                    <span className={pct != null ? (pct >= 0 ? 'profit' : 'loss') : ''}>
                      {pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '—'}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Open Trade */}
            <div className="plc-actions">
              {openError && <div className="plc-open-error">⚠ {openError}</div>}
              <button className="plc-open-btn" onClick={handleOpenTrade}>
                OPEN TRADE WITH THESE INPUTS →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
