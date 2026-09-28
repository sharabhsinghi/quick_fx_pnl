import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { runBacktest, tradesToCsv } from '../../orb/backtest';
import { getAllMeta, saveRun, pruneRuns } from '../../orb/store';
import {
  FILTER_KEYS, FILTER_LABELS, DEFAULT_TRADE_CONFIG, OPTIONS_TRADE_DEFAULTS,
} from '../../orb/constants';
import { fmtNum, fmtMoney, fmtPct } from '../../orb/format';
import { formatEtTime } from '../../orb/time';

function Metric({ k, v, sub, tone }) {
  return (
    <div className="orb-metric">
      <div className="k">{k}</div>
      <div className={`v ${tone || ''}`}>{v}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

function StatsTable({ title, stats, keyLabel }) {
  const rows = Object.entries(stats || {}).filter(([, s]) => s.trades > 0);
  if (rows.length === 0) return null;
  rows.sort((a, b) => b[1].pnl - a[1].pnl);
  const cols = '1fr 60px 64px 84px 70px 70px';
  return (
    <div style={{ marginTop: 16 }}>
      <div className="orb-title">{title}</div>
      <div className="orb-scroll">
        <div className="orb-table">
          <div className="r head" style={{ gridTemplateColumns: cols }}>
            <span>{keyLabel}</span><span className="rt">TRADES</span><span className="rt">WIN %</span>
            <span className="rt">P&amp;L</span><span className="rt">PF</span><span className="rt">AVG R</span>
          </div>
          {rows.map(([k, s]) => (
            <div key={k} className="r" style={{ gridTemplateColumns: cols }}>
              <span className="tk">{k}</span>
              <span className="rt dim">{s.trades}</span>
              <span className="rt dim">{fmtNum(s.winRate, 0)}%</span>
              <span className="rt" style={{ color: s.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {fmtMoney(s.pnl)}
              </span>
              <span className="rt dim">{isFinite(s.profitFactor) ? fmtNum(s.profitFactor, 2) : '∞'}</span>
              <span className="rt dim">{fmtNum(s.avgR, 2)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ORBBacktest({ cfg, tradeCfg, onTradeCfgChange }) {
  const [meta, setMeta] = useState({});
  const [selected, setSelected] = useState([]);
  const [range, setRange] = useState({ from: '', to: '' });
  const [overrides, setOverrides] = useState(null);   // null = use live screener config
  const [enabled, setEnabled] = useState(() =>
    Object.fromEntries(FILTER_KEYS.map(k => [k, true])));
  const [local, setLocal] = useState(tradeCfg);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showTrades, setShowTrades] = useState(50);
  const cancelRef = useRef(false);

  useEffect(() => { setLocal(tradeCfg); }, [tradeCfg]);

  useEffect(() => {
    getAllMeta().then((m) => {
      setMeta(m);
      const cached = (cfg.tickers || []).filter(t => m[t] && m[t].dayCount > 0);
      setSelected(cached);
      const firsts = cached.map(t => m[t].firstDate).filter(Boolean).sort();
      const lasts = cached.map(t => m[t].lastDate).filter(Boolean).sort();
      if (firsts.length) {
        // Default to the widest window every selected ticker actually covers.
        setRange({ from: firsts[firsts.length - 1], to: lasts[0] });
      }
    }).catch(e => setError((e && e.message) || 'Could not read the local store'));
  }, [cfg.tickers]);

  const effectiveCfg = useMemo(() => ({
    ...cfg,
    ...(overrides || {}),
    enabledFilters: enabled,
  }), [cfg, overrides, enabled]);

  const setOverride = (k, v) => setOverrides(o => ({ ...(o || {}), [k]: v }));
  const setTrade = (k, v) => setLocal(t => ({ ...t, [k]: v }));

  const run = useCallback(async () => {
    if (selected.length === 0) { setError('No cached tickers selected. Fetch history on the DATA tab first.'); return; }
    setError(null); setResult(null); setRunning(true); cancelRef.current = false;
    try {
      const out = await runBacktest({
        tickers: selected,
        fromDate: range.from,
        toDate: range.to,
        screenerCfg: effectiveCfg,
        tradeCfg: local,
        onProgress: setProgress,
        shouldCancel: () => cancelRef.current,
      });
      if (!out.cancelled) {
        setResult(out);
        // Persist so the CHART tab can overlay these trades on the price action,
        // and so a run survives switching tabs.
        try {
          await saveRun({
            finishedAt: out.meta.finishedAt,
            label: `${out.meta.instrument} · ${selected.length} tickers · ${range.from} → ${range.to}`,
            meta: out.meta,
            stats: out.stats,
            dayStats: out.dayStats,
            trades: out.trades,
            equityCurve: out.equityCurve,
            skips: out.skips,
          });
          await pruneRuns(10);
        } catch (_) { /* a full disk should not lose the on-screen result */ }
      }
    } catch (e) {
      setError((e && e.message) || 'Backtest failed');
    }
    setRunning(false); setProgress(null);
  }, [selected, range, effectiveCfg, local]);

  const exportCsv = useCallback(() => {
    if (!result) return;
    const blob = new Blob([tradesToCsv(result.trades)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orb-backtest-${range.from}_${range.to}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result, range]);

  const cachedTickers = (cfg.tickers || []).filter(t => meta[t] && meta[t].dayCount > 0);
  const s = result && result.stats;

  const logIsOptions = !!(result && result.meta && result.meta.instrument === 'options');
  const logCols = logIsOptions
    ? '86px 58px 40px 92px 52px 62px 62px 62px 62px 96px 52px 74px'
    : '86px 58px 46px 60px 66px 66px 66px 100px 56px 74px';

  const isOptions = local.instrument === 'options';
  const o = { ...OPTIONS_TRADE_DEFAULTS, ...(local.options || {}) };
  const setOpt = (k, v) => setLocal(t => ({ ...t, options: { ...o, [k]: v } }));

  // Only meaningful on the underlying: a 20% stop on an option premium is normal.
  const noStopWillFire = !isOptions && local.slType === 'trailing'
    && local.slMode === 'percent' && local.slValue >= 5;

  return (
    <div className="orb-section">
      {/* ── universe ── */}
      <div className="orb-card">
        <div className="orb-card-head"><h3>UNIVERSE &amp; RANGE</h3></div>
        {cachedTickers.length === 0 ? (
          <div className="orb-banner warn" style={{ marginBottom: 0 }}>
            No cached history yet. Go to the DATA tab and fetch it — the backtester never hits the
            network.
          </div>
        ) : (
          <>
            <div className="orb-chips">
              {cachedTickers.map(t => (
                <span key={t} className={`orb-chip ${selected.includes(t) ? '' : 'off'}`}>
                  <button onClick={() => setSelected(sel =>
                    sel.includes(t) ? sel.filter(x => x !== t) : [...sel, t])}>
                    {selected.includes(t) ? '✓' : '○'}
                  </button>
                  {t}
                  <span className="orb-mono-sm">{meta[t].dayCount}d</span>
                </span>
              ))}
            </div>
            <div className="orb-grid" style={{ marginTop: 14 }}>
              <div className="orb-field">
                <label>FROM</label>
                <input type="date" value={range.from}
                  onChange={e => setRange({ ...range, from: e.target.value })} />
              </div>
              <div className="orb-field">
                <label>TO</label>
                <input type="date" value={range.to}
                  onChange={e => setRange({ ...range, to: e.target.value })} />
              </div>
              <div className="orb-field">
                <label>STARTING CAPITAL</label>
                <input type="number" value={local.startingCapital}
                  onChange={e => setTrade('startingCapital', Number(e.target.value))} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── filters for this run ── */}
      <div className="orb-card">
        <div className="orb-card-head">
          <h3>FILTERS FOR THIS RUN</h3>
          <span className="orb-mono-sm">
            {overrides ? 'overriding live config' : 'using live screener config'}
          </span>
          {overrides && (
            <button className="orb-btn small" onClick={() => setOverrides(null)}>RESET TO LIVE</button>
          )}
        </div>

        <div className="orb-grid">
          {FILTER_KEYS.map(k => (
            <label key={k} className="orb-check">
              <input type="checkbox" checked={enabled[k]}
                onChange={e => setEnabled({ ...enabled, [k]: e.target.checked })} />
              {FILTER_LABELS[k]}
            </label>
          ))}
        </div>

        <div className="orb-grid" style={{ marginTop: 14 }}>
          <div className="orb-field">
            <label>RVOL THRESHOLD</label>
            <input type="number" step="0.1" value={effectiveCfg.rvolThreshold}
              onChange={e => setOverride('rvolThreshold', Number(e.target.value))} />
          </div>
          <div className="orb-field">
            <label>RVOL LOOKBACK (DAYS)</label>
            <input type="number" value={effectiveCfg.rvolLookbackDays}
              onChange={e => setOverride('rvolLookbackDays', Number(e.target.value))} />
          </div>
          <div className="orb-field">
            <label>RSI OVERBOUGHT / OVERSOLD</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" value={effectiveCfg.rsiOverbought}
                onChange={e => setOverride('rsiOverbought', Number(e.target.value))} />
              <input type="number" value={effectiveCfg.rsiOversold}
                onChange={e => setOverride('rsiOversold', Number(e.target.value))} />
            </div>
          </div>
          <div className="orb-field">
            <label>GAP % MIN / MAX</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" step="0.1" value={effectiveCfg.gapMinPct}
                onChange={e => setOverride('gapMinPct', Number(e.target.value))} />
              <input type="number" step="0.1" value={effectiveCfg.gapMaxPct}
                onChange={e => setOverride('gapMaxPct', Number(e.target.value))} />
            </div>
          </div>
          <div className="orb-field">
            <label>ORB/ATR RATIO MIN / MAX</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" step="0.05" value={effectiveCfg.atrRangeMinRatio}
                onChange={e => setOverride('atrRangeMinRatio', Number(e.target.value))} />
              <input type="number" step="0.05" value={effectiveCfg.atrRangeMaxRatio}
                onChange={e => setOverride('atrRangeMaxRatio', Number(e.target.value))} />
            </div>
          </div>
          <div className="orb-field">
            <label>BREAKOUT SELECTION</label>
            <select value={effectiveCfg.singleShot ? 'single' : 'first'}
              onChange={e => setOverride('singleShot', e.target.value === 'single')}>
              <option value="first">First candle that passes every filter</option>
              <option value="single">Single-shot: first candle out of range</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── trade management ── */}
      <div className="orb-card">
        <div className="orb-card-head">
          <h3>TRADE MANAGEMENT</h3>
          <button className="orb-btn small" onClick={() => onTradeCfgChange(local)}>
            SAVE AS DEFAULT
          </button>
          <button className="orb-btn small" onClick={() => setLocal(DEFAULT_TRADE_CONFIG)}>
            RESET
          </button>
        </div>

        <div className="orb-grid">
          <div className="orb-field">
            <label>INSTRUMENT</label>
            <select value={local.instrument || 'equity'}
              onChange={(e) => {
                const next = e.target.value;
                // Each instrument carries its own sensible stop: 0.75% of the
                // share price, or 20% of the option premium.
                setLocal(t => ({ ...t, instrument: next }));
              }}>
              <option value="equity">Shares of the underlying</option>
              <option value="options">Options — long call / long put</option>
            </select>
            <span className="hint">
              Options mode expresses the same ORB signal as a long call on a long
              breakout and a long put on a short breakout.
            </span>
          </div>

          <div className="orb-field">
            <label>ENTRY</label>
            <select value={local.entryMode} onChange={e => setTrade('entryMode', e.target.value)}>
              <option value="breakout_close">At the breakout candle&apos;s close</option>
              <option value="next_open">At the next candle&apos;s open</option>
            </select>
            <span className="hint">
              Filling at the signal candle&apos;s close is optimistic — you cannot transact at a
              price that has already printed. Next-open is the honest version.
            </span>
          </div>

          {!isOptions && (
            <>
              <div className="orb-field">
                <label>STOP LOSS — BASIS</label>
                <select value={local.slMode} onChange={e => setTrade('slMode', e.target.value)}>
                  <option value="percent">Percent of entry price</option>
                  <option value="dollar">Dollars per share</option>
                  <option value="r">Multiple of ORB distance</option>
                  <option value="orb">Opposite side of the ORB range</option>
                </select>
              </div>
              <div className="orb-field">
                <label>STOP LOSS — VALUE</label>
                <input type="number" step="0.05" value={local.slValue} disabled={local.slMode === 'orb'}
                  onChange={e => setTrade('slValue', Number(e.target.value))} />
                <span className="hint">
                  A 5-min ORB stop on a liquid large cap normally sits in the 0.3–1% band.
                </span>
              </div>
              <div className="orb-field">
                <label>STOP LOSS — TYPE</label>
                <select value={local.slType} onChange={e => setTrade('slType', e.target.value)}>
                  <option value="strict">Strict (fixed)</option>
                  <option value="trailing">Trailing the price</option>
                  <option value="giveback">Trailing the profit (giveback)</option>
                </select>
                <span className="hint">
                  {local.slType === 'giveback'
                    ? 'Rides the move and exits only after handing back a share of the best gain.'
                    : local.slType === 'trailing'
                      ? 'Follows the price by the stop distance above. A wide percentage here (say 20%) will never be reached intraday, so trades run to the close.'
                      : 'The stop never moves.'}
                </span>
              </div>
              {local.slType === 'giveback' && (
                <>
                  <div className="orb-field">
                    <label>GIVEBACK (% OF PEAK PROFIT)</label>
                    <input type="number" step="1" value={local.givebackPct}
                      onChange={e => setTrade('givebackPct', Number(e.target.value))} />
                    <span className="hint">
                      Exit once the trade returns this much of its best gain. 20% keeps 80% of the peak.
                    </span>
                  </div>
                  <div className="orb-field">
                    <label>ARM AFTER (% IN PROFIT)</label>
                    <input type="number" step="0.1" value={local.givebackActivatePct}
                      onChange={e => setTrade('givebackActivatePct', Number(e.target.value))} />
                    <span className="hint">
                      The trail stays off until the trade is this far in front. At 0 the first tick
                      of profit pulls the stop to breakeven and noise stops you out.
                    </span>
                  </div>
                </>
              )}

              <div className="orb-field">
                <label>TAKE PROFIT</label>
                <select value={local.tpEnabled ? 'on' : 'off'}
                  onChange={e => setTrade('tpEnabled', e.target.value === 'on')}>
                  <option value="off">None — ride to the stop or the bell</option>
                  <option value="on">Enabled</option>
                </select>
              </div>
              <div className="orb-field">
                <label>TAKE PROFIT — BASIS</label>
                <select value={local.tpMode} disabled={!local.tpEnabled}
                  onChange={e => setTrade('tpMode', e.target.value)}>
                  <option value="r">R multiple</option>
                  <option value="percent">Percent of entry price</option>
                  <option value="dollar">Dollars per share</option>
                </select>
              </div>
              <div className="orb-field">
                <label>TAKE PROFIT — VALUE</label>
                <input type="number" step="0.1" value={local.tpValue} disabled={!local.tpEnabled}
                  onChange={e => setTrade('tpValue', Number(e.target.value))} />
              </div>

              <div className="orb-field">
                <label>SLIPPAGE (BPS PER SIDE)</label>
                <input type="number" step="0.5" value={local.slippageBps}
                  onChange={e => setTrade('slippageBps', Number(e.target.value))} />
              </div>
              <div className="orb-field">
                <label>COMMISSION ($ PER TRADE)</label>
                <input type="number" step="0.1" value={local.commissionPerTrade}
                  onChange={e => setTrade('commissionPerTrade', Number(e.target.value))} />
              </div>
              <div className="orb-field">
                <label>FRACTIONAL SHARES</label>
                <select value={local.allowFractionalShares ? 'on' : 'off'}
                  onChange={e => setTrade('allowFractionalShares', e.target.value === 'on')}>
                  <option value="off">No — round down to whole shares</option>
                  <option value="on">Yes</option>
                </select>
              </div>
            </>
          )}

          {isOptions && (
            <>
              <div className="orb-field">
                <label>DAYS TO EXPIRY</label>
                <input type="number" min="0" value={o.dteDays}
                  onChange={e => setOpt('dteDays', Number(e.target.value))} />
                <span className="hint">0 = same-day expiry (0DTE).</span>
              </div>
              <div className="orb-field">
                <label>EXPIRY SELECTION</label>
                <select value={o.expiryMode} onChange={e => setOpt('expiryMode', e.target.value)}>
                  <option value="exact_days">Exactly N calendar days out</option>
                  <option value="next_friday">Next Friday at least N days out</option>
                </select>
              </div>
              <div className="orb-field">
                <label>STRIKE FROM</label>
                <select value={o.strikeBasis} onChange={e => setOpt('strikeBasis', e.target.value)}>
                  <option value="session_open">The session open price</option>
                  <option value="signal_price">The price at the signal</option>
                </select>
              </div>
              <div className="orb-field">
                <label>STRIKE OFFSET (LADDER STEPS)</label>
                <input type="number" step="1" value={o.strikeOffsetSteps}
                  onChange={e => setOpt('strikeOffsetSteps', Number(e.target.value))} />
                <span className="hint">0 = ATM, +1 = one strike further OTM, −1 = one ITM.</span>
              </div>

              <div className="orb-field">
                <label>VOLATILITY INPUT</label>
                <select value={o.sigmaSource} onChange={e => setOpt('sigmaSource', e.target.value)}>
                  <option value="captured_else_rv">Captured IV if available, else realised vol</option>
                  <option value="realized_vol">Realised vol only</option>
                  <option value="flat">Flat IV for every name</option>
                </select>
                <span className="hint">
                  There is no historical IV to replay, so most days are priced from a model input,
                  not a market quote. Every trade records which source priced it.
                </span>
              </div>
              <div className="orb-field">
                <label>REALISED VOL PERIOD (DAYS)</label>
                <input type="number" value={o.rvPeriod} disabled={o.sigmaSource === 'flat'}
                  onChange={e => setOpt('rvPeriod', Number(e.target.value))} />
              </div>
              <div className="orb-field">
                <label>IV / RV MULTIPLIER</label>
                <input type="number" step="0.05" value={o.ivMultiplier} disabled={o.sigmaSource === 'flat'}
                  onChange={e => setOpt('ivMultiplier', Number(e.target.value))} />
                <span className="hint">Implied vol usually trades above realised.</span>
              </div>
              <div className="orb-field">
                <label>FLAT IV (%)</label>
                <input type="number" step="1" value={o.flatIv} disabled={o.sigmaSource !== 'flat'}
                  onChange={e => setOpt('flatIv', Number(e.target.value))} />
              </div>
              <div className="orb-field">
                <label>RISK-FREE RATE (%)</label>
                <input type="number" step="0.25" value={o.riskFreeRate}
                  onChange={e => setOpt('riskFreeRate', Number(e.target.value))} />
              </div>
              <div className="orb-field">
                <label>DIVIDEND YIELD (%)</label>
                <input type="number" step="0.25" value={o.dividendYield}
                  onChange={e => setOpt('dividendYield', Number(e.target.value))} />
              </div>

              <div className="orb-field">
                <label>STOP LOSS — BASIS (ON PREMIUM)</label>
                <select value={o.slMode} onChange={e => setOpt('slMode', e.target.value)}>
                  <option value="percent">Percent of premium paid</option>
                  <option value="dollar">Dollars of premium</option>
                  <option value="orb">Premium left if the underlying hits the ORB stop</option>
                </select>
              </div>
              <div className="orb-field">
                <label>STOP LOSS — VALUE</label>
                <input type="number" step="1" value={o.slValue} disabled={o.slMode === 'orb'}
                  onChange={e => setOpt('slValue', Number(e.target.value))} />
                <span className="hint">
                  20% of premium is ordinary here — the contract&apos;s leverage turns a small
                  underlying move into a large premium move. A long option can never lose more
                  than the premium paid, so the stop is capped there.
                </span>
              </div>
              <div className="orb-field">
                <label>STOP LOSS — TYPE</label>
                <select value={o.slType} onChange={e => setOpt('slType', e.target.value)}>
                  <option value="strict">Strict (fixed)</option>
                  <option value="trailing">Trailing the premium</option>
                  <option value="giveback">Trailing the profit (giveback)</option>
                </select>
              </div>
              {o.slType === 'giveback' && (
                <>
                  <div className="orb-field">
                    <label>GIVEBACK (% OF PEAK PROFIT)</label>
                    <input type="number" step="1" value={o.givebackPct}
                      onChange={e => setOpt('givebackPct', Number(e.target.value))} />
                  </div>
                  <div className="orb-field">
                    <label>ARM AFTER (% PREMIUM GAIN)</label>
                    <input type="number" step="1" value={o.givebackActivatePct}
                      onChange={e => setOpt('givebackActivatePct', Number(e.target.value))} />
                  </div>
                </>
              )}

              <div className="orb-field">
                <label>TAKE PROFIT</label>
                <select value={o.tpEnabled ? 'on' : 'off'}
                  onChange={e => setOpt('tpEnabled', e.target.value === 'on')}>
                  <option value="off">None — ride to the stop or the bell</option>
                  <option value="on">Enabled</option>
                </select>
              </div>
              <div className="orb-field">
                <label>TAKE PROFIT — VALUE (% OF PREMIUM)</label>
                <input type="number" step="5" value={o.tpValue} disabled={!o.tpEnabled}
                  onChange={e => setOpt('tpValue', Number(e.target.value))} />
              </div>

              <div className="orb-field">
                <label>HALF-SPREAD (% OF PREMIUM, PER SIDE)</label>
                <input type="number" step="0.5" value={o.optionSpreadPct}
                  onChange={e => setOpt('optionSpreadPct', Number(e.target.value))} />
                <span className="hint">
                  0 = fills at the model mid. Clean read on the signal, but not a tradeable result.
                </span>
              </div>
              <div className="orb-field">
                <label>COMMISSION ($ PER CONTRACT, PER LEG)</label>
                <input type="number" step="0.05" value={o.commissionPerContract}
                  onChange={e => setOpt('commissionPerContract', Number(e.target.value))} />
              </div>
            </>
          )}

          <div className="orb-field">
            <label>AMBIGUOUS CANDLE</label>
            <select value={local.ambiguity} onChange={e => setTrade('ambiguity', e.target.value)}>
              <option value="stop_first">Assume the stop hit first (conservative)</option>
              <option value="target_first">Assume the target hit first (optimistic)</option>
            </select>
            <span className="hint">
              Applies when one 5-min candle contains both levels and there is no tick data to
              order them.
            </span>
          </div>

          <div className="orb-field">
            <label>POSITION SIZING</label>
            <select value={local.sizing} onChange={e => setTrade('sizing', e.target.value)}>
              <option value="risk_pct">Risk % of equity, sized by stop distance</option>
              <option value="fixed_dollar">Fixed notional per trade</option>
              <option value="fixed_shares">{isOptions ? 'Fixed contract count' : 'Fixed share count'}</option>
            </select>
          </div>
          <div className="orb-field">
            <label>
              {local.sizing === 'risk_pct' ? 'RISK % PER TRADE'
                : local.sizing === 'fixed_dollar' ? 'NOTIONAL PER TRADE ($)'
                  : isOptions ? 'CONTRACTS PER TRADE' : 'SHARES PER TRADE'}
            </label>
            <input type="number" step="0.1"
              value={local.sizing === 'risk_pct' ? local.riskPct
                : local.sizing === 'fixed_dollar' ? local.fixedDollar : local.fixedShares}
              onChange={(e) => {
                const v = Number(e.target.value);
                setTrade(local.sizing === 'risk_pct' ? 'riskPct'
                  : local.sizing === 'fixed_dollar' ? 'fixedDollar' : 'fixedShares', v);
              }} />
          </div>
          <div className="orb-field">
            <label>MAX POSITION (% OF EQUITY)</label>
            <input type="number" value={local.maxPositionPctOfEquity}
              onChange={e => setTrade('maxPositionPctOfEquity', Number(e.target.value))} />
          </div>
        </div>

        {isOptions && (
          <div className="orb-banner warn" style={{ marginTop: 14, marginBottom: 0 }}>
            Option prices here are <b>modelled with Black-Scholes, not replayed from market
            quotes</b> — no historical option data exists to replay. The model assumes European
            exercise, one volatility held constant for the life of each trade (so no intraday IV
            crush or expansion) and no skew.
            {o.optionSpreadPct === 0 && ' Fills are at the model mid with no bid-ask spread, which is a clean read on the signal but not a tradeable result.'}
            {o.dteDays === 0 && ' At 0 DTE these limits bite hardest: real same-day contracts carry pin risk and steep skew that a flat-sigma model does not reproduce.'}
          </div>
        )}

        {noStopWillFire && (
          <div className="orb-banner warn" style={{ marginTop: 14, marginBottom: 0 }}>
            A {local.slValue}% trailing stop is far wider than a normal intraday range on large-cap
            US equities, so it will almost never trigger inside one session. With no take profit,
            expect nearly every trade to exit at the 16:00 ET forced close — you are measuring
            &ldquo;hold the breakout to the bell&rdquo; rather than testing a stop. If you meant
            &ldquo;let it run, then exit once it hands back 20% of the profit&rdquo;, choose
            <b> Trailing the profit (giveback)</b> above instead: that trails the gain, not the price.
          </div>
        )}
      </div>

      <div className="orb-controls">
        <button className={`orb-btn ${running ? 'danger' : 'primary'}`}
          onClick={running ? () => { cancelRef.current = true; } : run}
          disabled={!running && selected.length === 0}>
          {running ? 'STOP' : 'RUN BACKTEST'}
        </button>
        {progress && (
          <span className="orb-status">
            {progress.phase} {progress.ticker} · {progress.done}/{progress.total} ·
            {' '}{progress.signals} signals
          </span>
        )}
        {result && (
          <button className="orb-btn orb-spacer" onClick={exportCsv}>EXPORT TRADES CSV</button>
        )}
      </div>

      {running && progress && (
        <div className="orb-progress">
          <div style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
        </div>
      )}

      {error && <div className="orb-banner error">{error}</div>}

      {/* ── report ── */}
      {result && s && (
        <>
          {result.warnings.length > 0 && (
            <div className="orb-banner warn">{result.warnings.join(' · ')}</div>
          )}

          <div className="orb-metrics">
            <Metric k="TRADES" v={s.trades} sub={`${s.wins}W / ${s.losses}L`} />
            <Metric k="WIN RATE" v={`${fmtNum(s.winRate, 1)}%`} />
            <Metric k="NET P&L" v={fmtMoney(s.pnl)} tone={s.pnl >= 0 ? 'pos' : 'neg'}
              sub={fmtPct(s.totalReturnPct)} />
            <Metric k="PROFIT FACTOR" v={isFinite(s.profitFactor) ? fmtNum(s.profitFactor, 2) : '∞'}
              tone={s.profitFactor >= 1 ? 'pos' : 'neg'} />
            <Metric k="AVG R / TRADE" v={fmtNum(s.avgR, 3)} tone={s.avgR >= 0 ? 'pos' : 'neg'} />
            <Metric k="EXPECTANCY" v={fmtMoney(s.expectancy)} tone={s.expectancy >= 0 ? 'pos' : 'neg'} />
            <Metric k="MAX DRAWDOWN" v={fmtMoney(-s.maxDrawdown)} tone="neg"
              sub={`${fmtNum(s.maxDrawdownPct, 1)}% of peak`} />
            <Metric k="SHARPE (ANN.)" v={fmtNum(s.sharpe, 2)}
              sub={`${s.tradingDays} trading days`} />
            <Metric k="COSTS PAID" v={fmtMoney(-(s.totalCosts || 0))} tone="neg"
              sub={s.costsVsGross !== null && s.costsVsGross !== undefined
                ? `${fmtNum(s.costsVsGross, 1)}% of gross profit` : 'commissions + spread'} />
          </div>

          <div className="orb-card">
            <div className="orb-card-head"><h3>EQUITY CURVE</h3>
              <span className="orb-mono-sm">
                {fmtMoney(s.startingCapital, 0)} → {fmtMoney(s.finalEquity, 0)}
              </span>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={result.equityCurve} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="orbEq" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--amber)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--amber)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-dim)' }}
                  tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-dim)' }}
                  tickLine={false} axisLine={false} width={60}
                  domain={['auto', 'auto']} tickFormatter={v => fmtMoney(v, 0)} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-2)', border: '1px solid var(--border)',
                    borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 11,
                  }}
                  formatter={v => fmtMoney(v)} />
                <Area type="monotone" dataKey="equity" stroke="var(--amber)"
                  strokeWidth={1.5} fill="url(#orbEq)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="orb-card">
            <div className="orb-card-head"><h3>BREAKDOWNS</h3></div>
            <StatsTable title="BY TICKER" stats={s.byTicker} keyLabel="TICKER" />
            <StatsTable title="BY DIRECTION" stats={s.byDirection} keyLabel="SIDE" />
            <StatsTable title="BY EXIT REASON" stats={s.byExitReason} keyLabel="EXIT" />
            <StatsTable title="BY FILTER PASSED" stats={s.byFilter} keyLabel="FILTER" />
            <StatsTable title="BY VOLATILITY SOURCE" stats={s.bySigmaSource} keyLabel="SIGMA FROM" />
            <p className="orb-note" style={{ marginTop: 14 }}>
              &ldquo;By filter passed&rdquo; slices the trades that actually satisfied each filter.
              To measure a filter&apos;s real contribution, untick it above and rerun — removing a
              filter can change <em>which</em> candle triggers, so a post-hoc slice alone would
              overstate it.
            </p>
          </div>

          <div className="orb-card">
            <div className="orb-card-head">
              <h3>SESSION COVERAGE</h3>
              <span className="orb-mono-sm">
                {result.dayStats.sessions} ticker-sessions replayed ·
                {' '}{result.dayStats.triggered} triggered ·
                {' '}{result.dayStats.weak} weak ·
                {' '}{result.dayStats.noBreakout} no breakout
                {s.skippedForSize > 0 && ` · ${s.skippedForSize} skipped (position size rounded to 0)`}
                {result.dayStats.unpriceable > 0 && ` · ${result.dayStats.unpriceable} skipped (no volatility input to price a contract)`}
                {result.dayStats.noTimeToTrade > 0 && ` · ${result.dayStats.noTimeToTrade} signalled on the session's final bar, no bar left to trade`}
              </span>
            </div>
            {result.meta.instrument === 'options' && (
              <p className="orb-note" style={{ marginBottom: 12 }}>
                Contracts: {result.meta.options.dteDays} DTE
                {result.meta.options.dteDays === 0 ? ' (same-day expiry)' : ''}, strike from the
                {result.meta.options.strikeBasis === 'session_open' ? ' session open' : ' signal price'}
                {result.meta.options.strikeOffsetSteps !== 0
                  ? `, offset ${result.meta.options.strikeOffsetSteps} ladder step(s)` : ' (ATM)'}.
                {' '}Priced with Black-Scholes at{' '}
                {result.meta.options.optionSpreadPct === 0
                  ? 'the model mid with no bid-ask spread'
                  : `${result.meta.options.optionSpreadPct}% half-spread per side`}.
                {' '}Volatility came from:{' '}
                {Object.entries(result.sigmaSources || {})
                  .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ') || '—'}.
                {' '}A <b>realised-vol</b> figure is a model input standing in for implied
                volatility, not a market quote — only <b>captured iv</b> rows are real
                observations.
              </p>
            )}
            <p className="orb-note">
              Implied volatility was <b>not evaluated as a filter</b> in this backtest. Historical options IV is
              not available from Tradier (current chains only) or any free source, and no proxy was
              substituted. {result.meta.ivReadingsAvailable > 0
                ? `${result.meta.ivReadingsAvailable} trade(s) did carry a real IV reading captured by an earlier live screener run; those values are in the CSV.`
                : 'Run the live screener with a Tradier key to start accumulating real readings for future runs.'}
            </p>
          </div>

          <div className="orb-card">
            <div className="orb-card-head">
              <h3>TRADE LOG</h3>
              <span className="orb-mono-sm">{result.trades.length} trades</span>
              <button className="orb-btn small orb-spacer" onClick={exportCsv}>EXPORT CSV</button>
            </div>
            <div className="orb-scroll">
              <div className="orb-table">
                <div className="r head" style={{ gridTemplateColumns: logCols }}>
                  <span>DATE</span><span>TICKER</span><span>SIDE</span>
                  {logIsOptions && <><span>CONTRACT</span><span className="rt">SIGMA</span></>}
                  <span className="rt">ENTRY</span>
                  <span className="rt">STOP</span><span className="rt">TARGET</span><span className="rt">EXIT</span>
                  <span>REASON</span><span className="rt">R</span><span className="rt">P&amp;L</span>
                </div>
                {result.trades.slice(0, showTrades).map((t, i) => (
                  <div key={i} className="r" style={{ gridTemplateColumns: logCols }}>
                    <span className="dim">{t.date}</span>
                    <span className="tk">{t.ticker}</span>
                    <span style={{ color: t.direction === 'long' ? 'var(--green)' : 'var(--red)' }}>
                      {t.direction === 'long' ? 'L' : 'S'}
                    </span>
                    {logIsOptions && (
                      <>
                        <span className="dim clip" title={`${t.optionType} ${t.strike} exp ${t.expiry}`}>
                          {t.strike}{t.optionType === 'call' ? 'C' : 'P'} {t.dte}d
                        </span>
                        <span className="rt dim"
                          title={t.sigmaSource === 'captured_iv'
                            ? 'real captured IV' : 'model input, not a market quote'}
                          style={t.sigmaSource === 'captured_iv' ? { color: 'var(--green)' } : undefined}>
                          {fmtNum(t.sigma * 100, 0)}%
                        </span>
                      </>
                    )}
                    <span className="rt dim" title={formatEtTime(t.entryTime)}>{fmtNum(t.entryPrice)}</span>
                    <span className="rt dim">{fmtNum(t.initialStop)}</span>
                    <span className="rt dim">{t.target ? fmtNum(t.target) : '—'}</span>
                    <span className="rt dim" title={formatEtTime(t.exitTime)}>{fmtNum(t.exitPrice)}</span>
                    <span className="dim clip">{t.exitReason}</span>
                    <span className="rt" style={{ color: t.rMultiple >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {fmtNum(t.rMultiple, 2)}
                    </span>
                    <span className="rt" style={{ color: t.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {fmtMoney(t.pnl)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {result.trades.length > showTrades && (
              <button className="orb-btn small" style={{ marginTop: 10 }}
                onClick={() => setShowTrades(n => n + 100)}>
                SHOW MORE ({result.trades.length - showTrades} remaining)
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
