import React, { useState } from 'react';
import { normalizePair, getPairMeta, getSupportedPairs } from '../priceService';

const POPULAR_PAIRS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF', 'EUR/GBP', 'GBP/JPY', 'EUR/JPY'];

export default function TradeForm({ onOpen, onCancel }) {
  const [pair, setPair] = useState('');
  const [side, setSide] = useState('buy');
  const [entry, setEntry] = useState('');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [lotSize, setLotSize] = useState('100000');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    const key = normalizePair(pair);
    const meta = getPairMeta(key);
    if (!meta) { setError(`Unsupported pair "${pair.toUpperCase()}".`); return; }
    const entryN = parseFloat(entry), slN = parseFloat(sl), tpN = parseFloat(tp), lotN = parseFloat(lotSize);
    if ([entryN, slN, tpN, lotN].some(isNaN)) { setError('All price fields are required.'); return; }
    if (lotN <= 0) { setError('Lot size must be > 0.'); return; }
    if (side === 'buy' && slN >= entryN) { setError('BUY: Stop Loss must be below Entry.'); return; }
    if (side === 'buy' && tpN <= entryN) { setError('BUY: Take Profit must be above Entry.'); return; }
    if (side === 'sell' && slN <= entryN) { setError('SELL: Stop Loss must be above Entry.'); return; }
    if (side === 'sell' && tpN >= entryN) { setError('SELL: Take Profit must be below Entry.'); return; }
    onOpen({ key, meta, side, entry: entryN, sl: slN, tp: tpN, lotSize: lotN });
  };

  return (
    <div className="form-wrap">
      <div className="form-card">
        <div className="form-header">
          <span className="form-title">NEW TRADE</span>
          {onCancel && (
            <button className="form-cancel" onClick={onCancel}>✕ CANCEL</button>
          )}
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="field-group">
            <label className="field-label">CURRENCY PAIR</label>
            <input className="field-input" type="text" value={pair}
              onChange={e => setPair(e.target.value)} placeholder="e.g. EUR/USD"
              autoComplete="off" spellCheck={false} />
            <div className="quick-pairs">
              {POPULAR_PAIRS.map(p => (
                <button key={p} type="button"
                  className={`pair-chip ${normalizePair(pair) === normalizePair(p) ? 'active' : ''}`}
                  onClick={() => setPair(p)}>{p}</button>
              ))}
            </div>
          </div>

          <div className="field-group">
            <label className="field-label">DIRECTION</label>
            <div className="side-toggle">
              <button type="button" className={`side-btn buy ${side==='buy'?'active':''}`} onClick={()=>setSide('buy')}>▲ BUY / LONG</button>
              <button type="button" className={`side-btn sell ${side==='sell'?'active':''}`} onClick={()=>setSide('sell')}>▼ SELL / SHORT</button>
            </div>
          </div>

          <div className="fields-row">
            <div className="field-group">
              <label className="field-label">ENTRY PRICE</label>
              <input className="field-input" type="number" step="any" value={entry} onChange={e=>setEntry(e.target.value)} placeholder="1.08500" />
            </div>
            <div className="field-group">
              <label className="field-label">STOP LOSS</label>
              <input className="field-input sl" type="number" step="any" value={sl} onChange={e=>setSl(e.target.value)} placeholder="1.08000" />
            </div>
            <div className="field-group">
              <label className="field-label">TAKE PROFIT</label>
              <input className="field-input tp" type="number" step="any" value={tp} onChange={e=>setTp(e.target.value)} placeholder="1.09000" />
            </div>
          </div>

          <div className="field-group">
            <label className="field-label">LOT SIZE <span className="label-hint">(100,000 = 1 standard lot)</span></label>
            <div className="lot-row">
              <input className="field-input" type="number" step="1" value={lotSize} onChange={e=>setLotSize(e.target.value)} placeholder="100000" />
              <div className="lot-presets">
                {[['0.01','1000'],['0.05','5000'],['0.1','10000'],['1','100000']].map(([l,v])=>(
                  <button key={l} type="button" className={`lot-chip ${lotSize===v?'active':''}`} onClick={()=>setLotSize(v)}>{l}L</button>
                ))}
              </div>
            </div>
          </div>

          {error && <div className="form-error">⚠ {error}</div>}
          <button type="submit" className="open-btn">OPEN TRADE →</button>
        </form>

        <div className="supported-pairs">
          <span className="sp-label">Supported: </span>
          <span className="sp-list">{getSupportedPairs().join('  ·  ')}</span>
        </div>
      </div>
    </div>
  );
}
