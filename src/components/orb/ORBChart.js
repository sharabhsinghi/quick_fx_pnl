import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { analyzeSession } from '../../orb/analysis';
import { buildSlotVolumeByDay, baselineForDayIndex, calcVWAP } from '../../orb/indicators';
import { isRegularSession, formatEtTime, minsToHHMM } from '../../orb/time';
import {
  getStoredTickers, getIntradayByDay, getDailyBars, getRuns, tradesForSession,
} from '../../orb/store';
import { STATUS_LABELS } from '../../orb/analysis';
import { FILTER_KEYS, FILTER_LABELS } from '../../orb/constants';
import { fmtNum, fmtMoney } from '../../orb/format';

const STATUS_COLOR = {
  triggered: 'var(--green)', breakout_weak: 'var(--amber)', no_breakout: 'var(--text-muted)',
  orb_only: 'var(--blue)', no_data: 'var(--text-dim)', error: 'var(--red)',
};

const PAD = { top: 14, right: 62, bottom: 22, left: 8 };
const PRICE_H = 330;
const VOL_H = 70;

/**
 * Session candlestick chart with the strategy's own overlays: the opening range
 * band, session VWAP, the breakout candle, and any backtested trades.
 *
 * Hand-drawn SVG rather than a chart library — candles plus this many bespoke
 * overlays end up simpler drawn directly, and it keeps the price scale honest
 * (see the domain notes below).
 */
function SessionChart({ bars, analysis, vwapSeries, trades, width }) {
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  const n = bars.length;
  const plotW = Math.max(120, width - PAD.left - PAD.right);
  const step = plotW / Math.max(1, n);
  const candleW = Math.max(1.5, Math.min(11, step * 0.62));

  const domain = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    bars.forEach((b) => { if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; });
    if (analysis && analysis.orbHigh !== undefined) {
      lo = Math.min(lo, analysis.orbLow);
      hi = Math.max(hi, analysis.orbHigh);
    }
    const range = hi - lo || 1;
    // Trade levels join the scale only when they are near the day's action. A
    // wide stop (say 20% on an option) would otherwise flatten the candles into
    // a line, so those levels are simply not drawn rather than distorting it.
    (trades || []).forEach((t) => {
      if (t.instrument === 'options') return; // premium levels, not price levels
      [t.initialStop, t.target].forEach((lvl) => {
        if (lvl === null || lvl === undefined) return;
        if (Math.abs(lvl - (hi + lo) / 2) <= range * 2) {
          lo = Math.min(lo, lvl); hi = Math.max(hi, lvl);
        }
      });
    });
    const pad = (hi - lo) * 0.06 || 1;
    return { lo: lo - pad, hi: hi + pad };
  }, [bars, analysis, trades]);

  const maxVol = useMemo(() => Math.max(1, ...bars.map(b => b.v)), [bars]);

  const x = i => PAD.left + i * step + step / 2;
  const y = p => PAD.top + (1 - (p - domain.lo) / (domain.hi - domain.lo)) * PRICE_H;
  const vy = v => PAD.top + PRICE_H + 16 + (1 - v / maxVol) * VOL_H;
  const inDomain = p => p >= domain.lo && p <= domain.hi;

  const totalH = PAD.top + PRICE_H + 16 + VOL_H + PAD.bottom;

  const onMove = useCallback((e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - PAD.left) / step);
    setHover(i >= 0 && i < n ? i : null);
  }, [step, n]);

  // Price gridlines at round-ish intervals.
  const ticks = useMemo(() => {
    const span = domain.hi - domain.lo;
    const raw = span / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const stepSize = [1, 2, 2.5, 5, 10].map(m => m * mag).find(v => v >= raw) || mag * 10;
    const out = [];
    for (let v = Math.ceil(domain.lo / stepSize) * stepSize; v <= domain.hi; v += stepSize) out.push(v);
    return out;
  }, [domain]);

  const orbEndX = analysis && analysis.orbHigh !== undefined
    ? PAD.left + 3 * step : PAD.left;

  const hb = hover !== null ? bars[hover] : null;

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={svgRef} width={width} height={totalH}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        style={{ display: 'block', cursor: 'crosshair' }}>

        {/* price gridlines */}
        {ticks.map(v => (
          <g key={v}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)}
              stroke="var(--border)" strokeWidth="1" />
            <text x={PAD.left + plotW + 6} y={y(v) + 3.5}
              fill="var(--text-dim)" fontSize="9" fontFamily="var(--font-mono)">
              {fmtNum(v, 2)}
            </text>
          </g>
        ))}

        {/* opening range band */}
        {analysis && analysis.orbHigh !== undefined && (
          <g>
            <rect x={PAD.left} y={y(analysis.orbHigh)}
              width={plotW} height={Math.max(1, y(analysis.orbLow) - y(analysis.orbHigh))}
              fill="var(--blue)" opacity="0.07" />
            <rect x={PAD.left} y={y(analysis.orbHigh)}
              width={orbEndX - PAD.left} height={Math.max(1, y(analysis.orbLow) - y(analysis.orbHigh))}
              fill="var(--blue)" opacity="0.10" />
            {[analysis.orbHigh, analysis.orbLow].map((lvl, i) => (
              <line key={i} x1={PAD.left} x2={PAD.left + plotW} y1={y(lvl)} y2={y(lvl)}
                stroke="var(--blue)" strokeWidth="1" strokeDasharray="4 3" opacity="0.65" />
            ))}
            <text x={PAD.left + 4} y={y(analysis.orbHigh) - 4}
              fill="var(--blue)" fontSize="9" fontFamily="var(--font-mono)">
              ORB {fmtNum(analysis.orbLow, 2)}–{fmtNum(analysis.orbHigh, 2)}
            </text>
          </g>
        )}

        {/* session VWAP */}
        {vwapSeries && vwapSeries.length > 1 && (
          <polyline
            points={vwapSeries.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`))
              .filter(Boolean).join(' ')}
            fill="none" stroke="var(--amber)" strokeWidth="1.25" opacity="0.85" />
        )}

        {/* candles */}
        {bars.map((b, i) => {
          const up = b.c >= b.o;
          const col = up ? 'var(--green)' : 'var(--red)';
          const yO = y(b.o), yC = y(b.c);
          return (
            <g key={i} opacity={hover === null || hover === i ? 1 : 0.72}>
              <line x1={x(i)} x2={x(i)} y1={y(b.h)} y2={y(b.l)} stroke={col} strokeWidth="1" />
              <rect x={x(i) - candleW / 2} y={Math.min(yO, yC)}
                width={candleW} height={Math.max(1, Math.abs(yC - yO))}
                fill={up ? 'none' : col} stroke={col} strokeWidth="1" />
              <rect x={x(i) - candleW / 2} y={vy(b.v)}
                width={candleW} height={PAD.top + PRICE_H + 16 + VOL_H - vy(b.v)}
                fill={col} opacity="0.4" />
            </g>
          );
        })}

        {/* the breakout candle the screener actually selected */}
        {analysis && analysis.breakout && (
          <g>
            <line x1={x(analysis.breakout.barIndex)} x2={x(analysis.breakout.barIndex)}
              y1={PAD.top} y2={PAD.top + PRICE_H}
              stroke={analysis.status === 'triggered' ? 'var(--green)' : 'var(--amber)'}
              strokeWidth="1" strokeDasharray="2 3" opacity="0.8" />
            <text x={x(analysis.breakout.barIndex) + 4} y={PAD.top + 10}
              fill={analysis.status === 'triggered' ? 'var(--green)' : 'var(--amber)'}
              fontSize="9" fontFamily="var(--font-mono)">
              {analysis.status === 'triggered' ? 'BREAKOUT' : 'ATTEMPT'}
            </text>
          </g>
        )}

        {/* backtested trades */}
        {(trades || []).map((t, k) => {
          const isOpt = t.instrument === 'options';
          // Options trades are entered and exited on premium; only the
          // underlying prices are meaningful on a price axis.
          const eP = isOpt ? t.underlyingEntry : t.entryPrice;
          const xP = isOpt ? t.underlyingExit : t.exitPrice;
          if (eP === undefined || xP === undefined) return null;
          const ei = t.entryIndex, xi = t.exitIndex;
          const win = t.pnl >= 0;
          const col = win ? 'var(--green)' : 'var(--red)';
          const long = t.direction === 'long';
          return (
            <g key={k}>
              {!isOpt && t.initialStop !== undefined && inDomain(t.initialStop) && (
                <line x1={x(ei)} x2={x(xi)} y1={y(t.initialStop)} y2={y(t.initialStop)}
                  stroke="var(--red)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
              )}
              {!isOpt && t.target !== null && t.target !== undefined && inDomain(t.target) && (
                <line x1={x(ei)} x2={x(xi)} y1={y(t.target)} y2={y(t.target)}
                  stroke="var(--green)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
              )}
              <line x1={x(ei)} y1={y(eP)} x2={x(xi)} y2={y(xP)}
                stroke={col} strokeWidth="1.5" opacity="0.9" />
              <polygon
                points={long
                  ? `${x(ei)},${y(eP) - 7} ${x(ei) - 5},${y(eP) + 2} ${x(ei) + 5},${y(eP) + 2}`
                  : `${x(ei)},${y(eP) + 7} ${x(ei) - 5},${y(eP) - 2} ${x(ei) + 5},${y(eP) - 2}`}
                fill={col} />
              <rect x={x(xi) - 3.5} y={y(xP) - 3.5} width="7" height="7"
                fill="var(--bg)" stroke={col} strokeWidth="1.5" />
            </g>
          );
        })}

        {/* crosshair */}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + PRICE_H + 16 + VOL_H}
            stroke="var(--text-muted)" strokeWidth="1" opacity="0.4" />
        )}

        {/* time axis */}
        {bars.map((b, i) => (i % 12 === 0 ? (
          <text key={i} x={x(i)} y={totalH - 6} textAnchor="middle"
            fill="var(--text-dim)" fontSize="9" fontFamily="var(--font-mono)">
            {minsToHHMM(b.m)}
          </text>
        ) : null))}
      </svg>

      {hb && (
        <div style={{
          position: 'absolute', top: 6,
          left: x(hover) > plotW / 2 ? 12 : undefined,
          right: x(hover) > plotW / 2 ? undefined : PAD.right + 12,
          background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 4,
          padding: '6px 9px', fontFamily: 'var(--font-mono)', fontSize: 10,
          color: 'var(--text-muted)', pointerEvents: 'none', lineHeight: 1.6,
        }}>
          <div style={{ color: 'var(--text)' }}>{minsToHHMM(hb.m)} ET</div>
          <div>O {fmtNum(hb.o)} H {fmtNum(hb.h)}</div>
          <div>L {fmtNum(hb.l)} C {fmtNum(hb.c)}</div>
          <div>Vol {hb.v.toLocaleString()}</div>
          {vwapSeries && vwapSeries[hover] !== null && (
            <div style={{ color: 'var(--amber)' }}>VWAP {fmtNum(vwapSeries[hover])}</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ORBChart({ cfg }) {
  const [tickers, setTickers] = useState([]);
  const [ticker, setTicker] = useState('');
  const [data, setData] = useState(null);       // { byDay, allDates, dailyBars, slotVol }
  const [date, setDate] = useState('');
  const [runs, setRuns] = useState([]);
  const [runId, setRunId] = useState('');
  const [cfgSource, setCfgSource] = useState('run'); // 'run' | 'live'
  const [width, setWidth] = useState(880);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    getStoredTickers()
      .then((list) => {
        setTickers(list);
        if (list.length) setTicker(prev => prev || list[0]);
      })
      .catch(e => setError((e && e.message) || 'Could not read the local store'));
    getRuns().then((r) => {
      setRuns(r);
      if (r.length) setRunId(String(r[0].id));
    }).catch(() => {});
  }, []);

  // Track the container width so the SVG can be responsive.
  useEffect(() => {
    const measure = () => {
      if (wrapRef.current) setWidth(Math.max(320, wrapRef.current.clientWidth));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [data]);

  // Load a ticker's whole cached history once, then paging days is instant.
  useEffect(() => {
    if (!ticker) return;
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([getIntradayByDay(ticker), getDailyBars(ticker)])
      .then(([byDay, dailyBars]) => {
        if (!alive) return;
        const allDates = Object.keys(byDay).sort();
        setData({ byDay, allDates, dailyBars, slotVol: buildSlotVolumeByDay(byDay) });
        setDate(prev => (allDates.includes(prev) ? prev : allDates[allDates.length - 1] || ''));
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError((e && e.message) || 'Could not load that ticker');
        setLoading(false);
      });
    return () => { alive = false; };
  }, [ticker]);

  const run = useMemo(
    () => runs.find(r => String(r.id) === String(runId)) || null,
    [runs, runId]);

  // A <select> falls back to displaying its first option when the controlled
  // value matches nothing, which would show one date while the chart rendered
  // another (or none). Keep the displayed date and the rendered date identical.
  const activeDate = useMemo(() => {
    if (!data || data.allDates.length === 0) return '';
    return data.allDates.includes(date) ? date : data.allDates[data.allDates.length - 1];
  }, [data, date]);

  // Which thresholds this chart should judge the session by. A run carries the
  // settings it was executed with — including per-run threshold overrides and
  // switched-off filters — and those, not the live CONFIG tab, are what explain
  // the trades being overlaid. Analysing with the wrong config makes the chart
  // contradict the very run it is displaying.
  const analysisCfg = useMemo(() => {
    if (cfgSource === 'run' && run && run.meta && run.meta.screenerCfg) return run.meta.screenerCfg;
    return cfg;
  }, [cfgSource, run, cfg]);

  const usingRunCfg = cfgSource === 'run' && !!(run && run.meta && run.meta.screenerCfg);

  const disabledFilters = useMemo(() => {
    const en = analysisCfg.enabledFilters || {};
    return FILTER_KEYS.filter(k => en[k] === false).map(k => FILTER_LABELS[k]);
  }, [analysisCfg]);

  const session = useMemo(() => {
    if (!data || !activeDate || !data.byDay[activeDate]) return null;
    const date = activeDate;
    const bars = data.byDay[date].filter(isRegularSession).sort((a, b) => a.t - b.t);
    if (bars.length < 4) return { bars, analysis: null, vwapSeries: [] };

    const di = data.allDates.indexOf(date);
    let cut = 0;
    while (cut < data.dailyBars.length && data.dailyBars[cut].d < date) cut += 1;
    const dailyBefore = data.dailyBars.slice(0, cut);
    const baseline = baselineForDayIndex(
      data.slotVol, data.allDates, di, analysisCfg.rvolLookbackDays);

    // Exactly the analysis the screener would have produced that morning.
    const analysis = analyzeSession(bars, dailyBefore, baseline, analysisCfg);
    const vwapSeries = bars.map((_, i) => calcVWAP(bars, i));
    return { bars, analysis, vwapSeries };
  }, [data, activeDate, analysisCfg]);

  const trades = useMemo(
    () => tradesForSession(run, ticker, activeDate),
    [run, ticker, activeDate]);

  // Dates where the selected run actually traded this ticker — for jumping
  // straight to the sessions worth looking at.
  const tradeDates = useMemo(() => {
    if (!run || !run.trades) return [];
    return Array.from(new Set(run.trades.filter(t => t.ticker === ticker).map(t => t.date))).sort();
  }, [run, ticker]);

  const stepDay = useCallback((delta) => {
    if (!data) return;
    const i = data.allDates.indexOf(activeDate);
    const next = data.allDates[i + delta];
    if (next) setDate(next);
  }, [data, activeDate]);

  const jumpTrade = useCallback((delta) => {
    if (tradeDates.length === 0) return;
    const later = tradeDates.filter(d => (delta > 0 ? d > activeDate : d < activeDate));
    const target = delta > 0 ? later[0] : later[later.length - 1];
    if (target) setDate(target);
  }, [tradeDates, activeDate]);

  // A triggered session with nothing drawn on it is the most confusing state
  // this screen can be in, so say exactly why rather than rendering silence.
  const noTradeReason = useMemo(() => {
    const an = session && session.analysis;
    if (!an || an.status !== 'triggered' || trades.length > 0) return null;
    if (!run) {
      return 'No run selected — choose one under OVERLAY TRADES FROM to draw its trades here.';
    }
    const m = run.meta || {};
    if (m.tickers && m.tickers.length && !m.tickers.includes(ticker)) {
      return `${ticker} was not part of the selected run (it covered ${m.tickers.join(', ')}).`;
    }
    if (m.fromDate && activeDate < m.fromDate) {
      return `This session is earlier than the run's window (${m.fromDate} → ${m.toDate}). Re-run the backtest over a range that includes it.`;
    }
    if (m.toDate && activeDate > m.toDate) {
      return `This session is later than the run's window (${m.fromDate} → ${m.toDate}). Re-run the backtest over a range that includes it.`;
    }
    const skip = (run.skips || []).find(k => k.ticker === ticker && k.date === activeDate);
    if (skip) return `The run triggered here but took no trade: ${skip.reason}.`;
    if (!usingRunCfg) {
      return 'This session triggers under your live CONFIG settings, but the selected run used different ones and did not trade it. Switch JUDGE SESSION BY to SELECTED RUN to see the run\'s own verdict.';
    }
    return 'The run should have traded this session but did not — its saved settings may predate a change. Re-run the backtest to refresh it.';
  }, [session, trades, run, ticker, activeDate, usingRunCfg]);

  if (tickers.length === 0) {
    return (
      <div className="orb-section">
        <div className="orb-banner warn">
          Nothing cached yet. Fetch or import history on the DATA tab, then come back.
        </div>
      </div>
    );
  }

  const a = session && session.analysis;
  const dateIdx = data ? data.allDates.indexOf(activeDate) : -1;

  return (
    <div className="orb-section">
      <div className="orb-card">
        <div className="orb-controls" style={{ marginBottom: 0 }}>
          <div className="orb-field" style={{ maxWidth: 130 }}>
            <label>TICKER</label>
            <select value={ticker} onChange={e => setTicker(e.target.value)}>
              {tickers.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="orb-field" style={{ maxWidth: 170 }}>
            <label>SESSION</label>
            <select value={activeDate} onChange={e => setDate(e.target.value)}>
              {(data ? data.allDates : []).map(d => (
                <option key={d} value={d}>
                  {d}{tradeDates.includes(d) ? '  ●' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="orb-toggle" style={{ alignSelf: 'flex-end', paddingBottom: 2 }}>
            <button onClick={() => stepDay(-1)} disabled={dateIdx <= 0}>‹ PREV</button>
            <button onClick={() => stepDay(1)}
              disabled={!data || dateIdx < 0 || dateIdx >= data.allDates.length - 1}>NEXT ›</button>
          </div>

          <div className="orb-field orb-spacer" style={{ maxWidth: 320 }}>
            <label>OVERLAY TRADES FROM</label>
            <select value={runId} onChange={e => setRunId(e.target.value)}>
              <option value="">None</option>
              {runs.map(r => (
                <option key={r.id} value={r.id}>
                  {new Date(r.finishedAt).toLocaleString()} — {r.label}
                </option>
              ))}
            </select>
          </div>

          {run && (
            <div className="orb-toggle" style={{ alignSelf: 'flex-end', paddingBottom: 2 }}>
              <button onClick={() => jumpTrade(-1)}>‹ TRADE</button>
              <button onClick={() => jumpTrade(1)}>TRADE ›</button>
            </div>
          )}
        </div>

        <div className="orb-controls" style={{ marginTop: 12, marginBottom: 0 }}>
          <div className="orb-toggle">
            <span className="lbl">JUDGE SESSION BY</span>
            <button className={usingRunCfg ? 'active' : ''}
              disabled={!run} onClick={() => setCfgSource('run')}>
              SELECTED RUN
            </button>
            <button className={!usingRunCfg ? 'active' : ''}
              onClick={() => setCfgSource('live')}>
              LIVE CONFIG
            </button>
          </div>
          <span className="orb-mono-sm">
            RVOL ≥{analysisCfg.rvolThreshold}x / {analysisCfg.rvolLookbackDays}d ·
            {' '}RSI({analysisCfg.rsiPeriod}) {analysisCfg.rsiOverbought}/{analysisCfg.rsiOversold} ·
            {' '}gap {analysisCfg.gapMinPct}–{analysisCfg.gapMaxPct}% ·
            {' '}ORB/ATR {analysisCfg.atrRangeMinRatio}–{analysisCfg.atrRangeMaxRatio}x
            {disabledFilters.length > 0 && (
              <span style={{ color: 'var(--amber)' }}>
                {' '}· filters off: {disabledFilters.join(', ')}
              </span>
            )}
          </span>
        </div>

        {runs.length === 0 && (
          <p className="orb-note" style={{ marginTop: 10, marginBottom: 0 }}>
            No saved backtests yet — run one on the BACKTEST tab and it will appear here for
            overlay. Sessions the selected run traded are marked ● in the dropdown.
          </p>
        )}
      </div>

      {error && <div className="orb-banner error">{error}</div>}

      {/* what the screener made of this session */}
      {a && (
        <div className="orb-params">
          <span>Status <b style={{ color: STATUS_COLOR[a.status] }}>
            {STATUS_LABELS[a.status] || a.status}</b></span>
          <span>ORB <b>{fmtNum(a.orbLow)}–{fmtNum(a.orbHigh)}</b></span>
          <span>Gap <b>{a.gapPct === null || a.gapPct === undefined
            ? '—' : `${a.gapPct >= 0 ? '+' : ''}${fmtNum(a.gapPct, 2)}%`}</b></span>
          <span>ORB/ATR <b>{a.rangeToAtr === null || a.rangeToAtr === undefined
            ? '—' : `${fmtNum(a.rangeToAtr, 2)}x`}</b></span>
          {a.breakout && <>
            <span>RVOL <b>{fmtNum(a.breakout.rvol, 2)}x</b>
              {a.breakout.rvolIsProxy ? ' (proxy)' : ''}</span>
            <span>RSI <b>{a.breakout.rsi === null ? '—' : fmtNum(a.breakout.rsi, 1)}</b></span>
            <span>At <b>{formatEtTime(a.breakout.time)}</b></span>
          </>}
          <span>Baseline <b>{a.hasBaseline ? `${a.baselineDays}d` : 'none'}</b></span>
        </div>
      )}

      {noTradeReason && <div className="orb-banner warn">No trade drawn: {noTradeReason}</div>}

      {a && a.status !== 'triggered' && a.reason && (
        <div className="orb-banner info">
          Why not triggered ({usingRunCfg ? "using the selected run's settings" : 'using your live CONFIG settings'}): {a.reason}
        </div>
      )}

      <div className="orb-card" ref={wrapRef}>
        {loading && <div className="orb-empty">Loading {ticker}…</div>}
        {!loading && session && session.bars.length >= 4 && (
          <SessionChart
            bars={session.bars}
            analysis={session.analysis}
            vwapSeries={session.vwapSeries}
            trades={trades}
            width={width - 34}
          />
        )}
        {!loading && session && session.bars.length < 4 && (
          <div className="orb-empty">Not enough regular-session bars cached for {activeDate}.</div>
        )}
        {!loading && !session && <div className="orb-empty">No data for this session.</div>}

        <div className="orb-mono-sm" style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--blue)' }}>▬ opening range</span>
          <span style={{ color: 'var(--amber)' }}>▬ session VWAP</span>
          <span style={{ color: 'var(--green)' }}>▲ entry</span>
          <span>▪ exit</span>
          <span style={{ color: 'var(--red)' }}>--- stop</span>
          <span style={{ color: 'var(--green)' }}>--- target</span>
        </div>
      </div>

      {/* trades on this session */}
      {trades.length > 0 && (
        <div className="orb-card">
          <div className="orb-card-head">
            <h3>TRADES ON THIS SESSION</h3>
            <span className="orb-mono-sm">{trades.length} from the selected run</span>
          </div>
          <div className="orb-scroll">
            <div className="orb-table">
              <div className="r head" style={{ gridTemplateColumns: '52px 66px 66px 66px 66px 110px 56px 78px' }}>
                <span>SIDE</span><span className="rt">ENTRY</span><span className="rt">STOP</span>
                <span className="rt">TARGET</span><span className="rt">EXIT</span>
                <span>REASON</span><span className="rt">R</span><span className="rt">P&amp;L</span>
              </div>
              {trades.map((t, i) => (
                <div key={i} className="r" style={{ gridTemplateColumns: '52px 66px 66px 66px 66px 110px 56px 78px' }}>
                  <span style={{ color: t.direction === 'long' ? 'var(--green)' : 'var(--red)' }}>
                    {t.direction === 'long' ? 'LONG' : 'SHORT'}
                  </span>
                  <span className="rt dim">{fmtNum(t.entryPrice)}</span>
                  <span className="rt dim">{fmtNum(t.initialStop)}</span>
                  <span className="rt dim">{t.target ? fmtNum(t.target) : '—'}</span>
                  <span className="rt dim">{fmtNum(t.exitPrice)}</span>
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
          {trades.some(t => t.instrument === 'options') && (
            <p className="orb-note" style={{ marginTop: 10, marginBottom: 0 }}>
              These are options trades, so the entry, stop, target and exit above are <b>option
              premiums</b>, not share prices. On the chart the markers sit at the underlying price
              at entry and exit; the premium stop and target are deliberately not drawn, because a
              premium level has no meaning on a price axis.
            </p>
          )}
        </div>
      )}

      <p className="orb-note">
        The status strip and the breakout marker come from running the screener&apos;s own
        <code>analyzeSession</code> over this day, with a RVOL baseline built only from earlier
        sessions — a faithful replay, not a re-derivation. By default it judges the session by the
        <b> selected run&apos;s</b> settings, including any per-run threshold overrides and
        switched-off filters, so the verdict always explains the trades drawn on the chart. Switch
        to <b>LIVE CONFIG</b> to see what your current CONFIG tab settings would make of the same
        day.
      </p>
    </div>
  );
}
