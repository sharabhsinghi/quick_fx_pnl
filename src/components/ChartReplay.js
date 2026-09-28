import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  getStoredTickers, getIntradayByDay, getDailyBars,
  getIntraday1mByDay, deleteTicker1mData,
} from '../orb/store';
import {
  REPLAY_INTERVALS, resampleBars, computeEMA, anchoredVWAP, EMA_COLORS,
} from '../orb/replay';
import {
  subscribe as subscribe1m, getJob as getJob1m, start1mDownload, cancel1mDownload,
  estimate1mRequests,
} from '../orb/oneMinute';
import { getBudget } from '../orb/twelveData';
import { DEFAULT_RATE_LIMITS } from '../orb/constants';
import { minsToHHMM, getSessionDate, shiftIsoDate } from '../orb/time';
import { fmtNum } from '../orb/format';
import { getApiKey } from '../lib/idb';

const PAD = { top: 14, right: 64, bottom: 22, left: 8 };
const PRICE_H = 360;
const VOL_H = 80;

const VIEWPORTS = [60, 120, 240, 400];
const SPEEDS = [
  { ms: 1500, label: 'SLOW' },
  { ms: 750, label: 'NORMAL' },
  { ms: 350, label: 'FAST' },
  { ms: 120, label: 'FASTEST' },
];
const EMA_PRESETS = [9, 21, 50, 100, 200];

function candleLabel(c, isDaily) {
  return isDaily ? c.d : `${c.d.slice(5)} ${minsToHHMM(c.m)}`;
}

/**
 * Hand-drawn SVG candlestick chart — same approach as the ORB session chart
 * (candles plus overlays are simpler drawn directly than wired through a
 * charting library), generalised here for an arbitrary sliding window of
 * candles rather than one fixed session.
 */
function ReplayChart({
  candles, emaLines, vwap, showVolume, width, isDaily, colorFor,
}) {
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  const n = candles.length;
  const plotW = Math.max(120, width - PAD.left - PAD.right);
  const step = plotW / Math.max(1, n);
  const candleW = Math.max(1.5, Math.min(11, step * 0.62));
  const volTop = PAD.top + PRICE_H + 16;
  const totalH = showVolume ? volTop + VOL_H + PAD.bottom : PAD.top + PRICE_H + PAD.bottom;

  const domain = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    candles.forEach((b) => { if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; });
    [vwap, ...emaLines.map(e => e.values)].forEach((series) => {
      (series || []).forEach((v) => {
        if (v === null || v === undefined) return;
        if (v < lo) lo = v; if (v > hi) hi = v;
      });
    });
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    const pad = (hi - lo) * 0.06 || 1;
    return { lo: lo - pad, hi: hi + pad };
  }, [candles, vwap, emaLines]);

  const maxVol = useMemo(() => Math.max(1, ...candles.map(b => b.v)), [candles]);

  const x = i => PAD.left + i * step + step / 2;
  const y = p => PAD.top + (1 - (p - domain.lo) / (domain.hi - domain.lo)) * PRICE_H;
  const vy = v => volTop + (1 - v / maxVol) * VOL_H;

  const onMove = useCallback((e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - PAD.left) / step);
    setHover(i >= 0 && i < n ? i : null);
  }, [step, n]);

  const ticks = useMemo(() => {
    const span = domain.hi - domain.lo;
    const raw = span / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const stepSize = [1, 2, 2.5, 5, 10].map(m => m * mag).find(v => v >= raw) || mag * 10;
    const out = [];
    for (let v = Math.ceil(domain.lo / stepSize) * stepSize; v <= domain.hi; v += stepSize) out.push(v);
    return out;
  }, [domain]);

  const tickStride = Math.max(1, Math.ceil(n / 9));
  const shown = hover !== null ? candles[hover] : candles[n - 1];
  const shownIdx = hover !== null ? hover : n - 1;

  if (n === 0) return <div className="orb-empty">Nothing revealed yet — step forward or press play.</div>;

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={svgRef} width={width} height={totalH}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        style={{ display: 'block', cursor: 'crosshair' }}>

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

        {showVolume && candles.map((b, i) => {
          const up = b.c >= b.o;
          return (
            <rect key={'v' + i} x={x(i) - candleW / 2} y={vy(b.v)}
              width={candleW} height={volTop + VOL_H - vy(b.v)}
              fill={up ? 'var(--green)' : 'var(--red)'} opacity="0.4" />
          );
        })}

        {vwap && (
          <polyline
            points={vwap.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`))
              .filter(Boolean).join(' ')}
            fill="none" stroke="var(--amber)" strokeWidth="1.25" opacity="0.9" />
        )}

        {emaLines.map(e => (
          <polyline key={e.period}
            points={e.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`))
              .filter(Boolean).join(' ')}
            fill="none" stroke={colorFor(e.period)} strokeWidth="1.4" opacity="0.9" />
        ))}

        {candles.map((b, i) => {
          const up = b.c >= b.o;
          const col = up ? 'var(--green)' : 'var(--red)';
          const yO = y(b.o), yC = y(b.c);
          return (
            <g key={i} opacity={hover === null || hover === i ? 1 : 0.75}>
              <line x1={x(i)} x2={x(i)} y1={y(b.h)} y2={y(b.l)} stroke={col} strokeWidth="1" />
              <rect x={x(i) - candleW / 2} y={Math.min(yO, yC)}
                width={candleW} height={Math.max(1, Math.abs(yC - yO))}
                fill={up ? 'none' : col} stroke={col} strokeWidth="1" />
            </g>
          );
        })}

        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={totalH - PAD.bottom}
            stroke="var(--text-muted)" strokeWidth="1" opacity="0.4" />
        )}

        {candles.map((b, i) => (i % tickStride === 0 ? (
          <text key={i} x={x(i)} y={totalH - 6} textAnchor="middle"
            fill="var(--text-dim)" fontSize="9" fontFamily="var(--font-mono)">
            {candleLabel(b, isDaily)}
          </text>
        ) : null))}
      </svg>

      {shown && (
        <div style={{
          position: 'absolute', top: 6,
          left: x(shownIdx) > plotW / 2 ? 12 : undefined,
          right: x(shownIdx) > plotW / 2 ? undefined : PAD.right + 12,
          background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 4,
          padding: '6px 9px', fontFamily: 'var(--font-mono)', fontSize: 10,
          color: 'var(--text-muted)', pointerEvents: 'none', lineHeight: 1.6, minWidth: 118,
        }}>
          <div style={{ color: 'var(--text)' }}>{candleLabel(shown, isDaily)}{isDaily ? '' : ' ET'}</div>
          <div>O {fmtNum(shown.o)} H {fmtNum(shown.h)}</div>
          <div>L {fmtNum(shown.l)} C {fmtNum(shown.c)}</div>
          {showVolume && <div>Vol {shown.v.toLocaleString()}</div>}
          {vwap && vwap[shownIdx] !== null && (
            <div style={{ color: 'var(--amber)' }}>VWAP {fmtNum(vwap[shownIdx])}</div>
          )}
          {emaLines.map(e => (e.values[shownIdx] !== null && e.values[shownIdx] !== undefined ? (
            <div key={e.period} style={{ color: colorFor(e.period) }}>
              EMA{e.period} {fmtNum(e.values[shownIdx])}
            </div>
          ) : null))}
        </div>
      )}
    </div>
  );
}

export default function ChartReplay() {
  const [tickers, setTickers] = useState([]);
  const [ticker, setTicker] = useState('');
  const [data, setData] = useState(null); // { byDay, allDates, dailyBars }
  const [data1m, setData1m] = useState(null); // { byDay, allDates } — 1-min, fetched on demand
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [apiKey, setApiKey] = useState('');
  const [range1m, setRange1m] = useState(() => {
    const to = getSessionDate();
    return { from: shiftIsoDate(to, -7), to };
  });
  const [, bump1m] = useState(0); // re-render on background job progress

  const [intervalKey, setIntervalKey] = useState('5min');
  const [viewport, setViewport] = useState(120);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(SPEEDS[1].ms);

  const [showVolume, setShowVolume] = useState(true);
  const [showVWAP, setShowVWAP] = useState(true);
  const [emaPeriods, setEmaPeriods] = useState([9, 21]);
  const [newEma, setNewEma] = useState('');
  const [jumpDate, setJumpDate] = useState('');

  const [width, setWidth] = useState(880);
  const wrapRef = useRef(null);
  const emaColorMap = useRef(new Map());
  const nextColorIdx = useRef(0);

  const colorFor = useCallback((period) => {
    if (!emaColorMap.current.has(period)) {
      emaColorMap.current.set(period, EMA_COLORS[nextColorIdx.current % EMA_COLORS.length]);
      nextColorIdx.current += 1;
    }
    return emaColorMap.current.get(period);
  }, []);

  useEffect(() => {
    getStoredTickers()
      .then((list) => {
        setTickers(list);
        if (list.length) setTicker(prev => prev || list[0]);
      })
      .catch(e => setError((e && e.message) || 'Could not read the local store'));
    // Shared with the rest of the app's Twelve Data lookups — set once on
    // ORB → CONFIG, no separate key needed here.
    getApiKey().then(setApiKey).catch(() => {});
  }, []);

  // The 1-min download runs in the background (orb/oneMinute.js), independent
  // of this component's lifecycle — subscribe so a running or finished job
  // for any ticker triggers a re-render here.
  useEffect(() => subscribe1m(() => bump1m(n => n + 1)), []);

  const loadData1m = useCallback((tk) => {
    if (!tk) return;
    getIntraday1mByDay(tk)
      .then(byDay => setData1m({ byDay, allDates: Object.keys(byDay).sort() }))
      .catch(() => {});
  }, []);

  useEffect(() => { loadData1m(ticker); }, [ticker, loadData1m]);

  const job1m = ticker ? getJob1m(ticker) : null;

  // Reload the cached 1-min bars whenever the background job for this ticker
  // writes a new page, so newly fetched candles show up without a manual
  // refresh — and once more when it finishes.
  useEffect(() => {
    if (job1m && (job1m.status === 'running' || job1m.status === 'done')) loadData1m(ticker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, job1m && job1m.barsWritten, job1m && job1m.status]);

  useEffect(() => {
    const measure = () => {
      if (wrapRef.current) setWidth(Math.max(320, wrapRef.current.clientWidth));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [data]);

  // Load the whole cached history for a ticker once — every timeframe and
  // every position of the replay is then just a slice, no further fetching.
  useEffect(() => {
    if (!ticker) return;
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([getIntradayByDay(ticker), getDailyBars(ticker)])
      .then(([byDay, dailyBars]) => {
        if (!alive) return;
        const allDates = Object.keys(byDay).sort();
        setData({ byDay, allDates, dailyBars });
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError((e && e.message) || 'Could not load that ticker');
        setLoading(false);
      });
    return () => { alive = false; };
  }, [ticker]);

  const interval = REPLAY_INTERVALS.find(i => i.key === intervalKey) || REPLAY_INTERVALS[1];
  const has1mData = !!(data1m && data1m.allDates.length > 0);

  // All cached intraday bars for this ticker, oldest first, spanning every
  // cached session — the continuous timeline the replay scrubs across.
  const allBars = useMemo(() => {
    if (!data) return [];
    const out = [];
    data.allDates.forEach(d => out.push(...(data.byDay[d] || [])));
    return out;
  }, [data]);

  // Same idea for the separately cached 1-min store — only populated once a
  // download has actually been run for this ticker.
  const allBars1m = useMemo(() => {
    if (!data1m) return [];
    const out = [];
    data1m.allDates.forEach(d => out.push(...(data1m.byDay[d] || [])));
    return out;
  }, [data1m]);

  const candles = useMemo(() => {
    if (interval.daily) return data ? data.dailyBars : [];
    if (interval.onDemand) return resampleBars(allBars1m, interval.minutes);
    return data ? resampleBars(allBars, interval.minutes) : [];
  }, [data, allBars, allBars1m, interval]);

  const total = candles.length;

  const emaSeriesFull = useMemo(() => {
    const closes = candles.map(c => c.c);
    return emaPeriods.map(period => ({ period, values: computeEMA(closes, period) }));
  }, [candles, emaPeriods]);

  const vwapFull = useMemo(
    () => (interval.daily ? null : anchoredVWAP(candles)),
    [candles, interval]);

  // A fresh ticker or timeframe starts the replay at the most recent data —
  // an ordinary chart until the user scrubs or rewinds to a starting point.
  useEffect(() => {
    setCursor(total);
    setPlaying(false);
  }, [ticker, intervalKey, total]);

  useEffect(() => {
    if (!playing) return undefined;
    if (cursor >= total) { setPlaying(false); return undefined; }
    const id = setTimeout(() => setCursor(c => Math.min(total, c + 1)), speedMs);
    return () => clearTimeout(id);
  }, [playing, cursor, total, speedMs]);

  const windowStart = Math.max(0, cursor - viewport);
  const visibleCandles = candles.slice(windowStart, cursor);
  const visibleEma = useMemo(
    () => emaSeriesFull.map(e => ({ period: e.period, values: e.values.slice(windowStart, cursor) })),
    [emaSeriesFull, windowStart, cursor]);
  const visibleVwap = vwapFull ? vwapFull.slice(windowStart, cursor) : null;

  const stepBack = useCallback(() => { setPlaying(false); setCursor(c => Math.max(1, c - 1)); }, []);
  const stepFwd = useCallback(() => { setPlaying(false); setCursor(c => Math.min(total, c + 1)); }, [total]);
  const jumpStart = useCallback(() => {
    setPlaying(false);
    setCursor(Math.min(20, total));
  }, [total]);
  const jumpEnd = useCallback(() => { setPlaying(false); setCursor(total); }, [total]);
  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (!p && cursor >= total) setCursor(Math.min(total, 20));
      return !p;
    });
  }, [cursor, total]);

  const applyJumpDate = useCallback((dateStr) => {
    setJumpDate(dateStr);
    if (!dateStr) return;
    const idx = candles.findIndex(c => c.d >= dateStr);
    if (idx === -1) { setCursor(total); return; }
    setPlaying(false);
    setCursor(Math.min(total, idx + 1));
  }, [candles, total]);

  const addEma = useCallback((period) => {
    const p = Number(period);
    if (!p || p < 1 || p > 1000) return;
    setEmaPeriods((prev) => (prev.includes(p) || prev.length >= EMA_COLORS.length
      ? prev : [...prev, p].sort((a, b) => a - b)));
    setNewEma('');
  }, []);

  const removeEma = useCallback((period) => {
    setEmaPeriods(prev => prev.filter(p => p !== period));
  }, []);

  const jobRunning1m = !!(job1m && job1m.status === 'running');
  const estimate1m = useMemo(
    () => estimate1mRequests(range1m.from, range1m.to, DEFAULT_RATE_LIMITS.maxPointsPerRequest),
    [range1m]);
  const budget = typeof window !== 'undefined' ? getBudget() : { used: 0 };

  const startDownload1m = useCallback(() => {
    if (!ticker || !apiKey || range1m.from > range1m.to) return;
    start1mDownload({
      ticker, apiKey, fromDate: range1m.from, toDate: range1m.to,
      maxPointsPerRequest: DEFAULT_RATE_LIMITS.maxPointsPerRequest,
    });
    bump1m(n => n + 1);
  }, [ticker, apiKey, range1m]);

  const clear1mCache = useCallback(() => {
    deleteTicker1mData(ticker).then(() => loadData1m(ticker)).catch(() => {});
  }, [ticker, loadData1m]);

  if (tickers.length === 0 && !error) {
    return (
      <div className="orb-section">
        <div className="orb-banner warn">
          Nothing cached yet. Fetch or import history on ORB → DATA, then come back here to replay it.
        </div>
      </div>
    );
  }

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

          <div className="orb-field" style={{ maxWidth: 130 }}>
            <label>TIMEFRAME</label>
            <select value={intervalKey} onChange={e => setIntervalKey(e.target.value)}>
              {REPLAY_INTERVALS.map((i) => {
                const disabled = i.onDemand && !has1mData;
                return (
                  <option key={i.key} value={i.key} disabled={disabled}>
                    {i.label}{disabled ? ' (download below)' : ''}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="orb-field" style={{ maxWidth: 110 }}>
            <label>VIEWPORT</label>
            <select value={viewport} onChange={e => setViewport(Number(e.target.value))}>
              {VIEWPORTS.map(v => <option key={v} value={v}>{v} bars</option>)}
            </select>
          </div>

          <div className="orb-field" style={{ maxWidth: 160 }}>
            <label>JUMP TO DATE</label>
            <select value={jumpDate} onChange={e => applyJumpDate(e.target.value)}>
              <option value="">— pick a session —</option>
              {(interval.onDemand ? (data1m ? data1m.allDates : []) : (data ? data.allDates : []))
                .map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        <div className="orb-controls" style={{ marginTop: 12, marginBottom: 0 }}>
          <label className="orb-check">
            <input type="checkbox" checked={showVolume} onChange={e => setShowVolume(e.target.checked)} />
            Volume
          </label>
          <label className="orb-check" style={{ opacity: interval.daily ? 0.4 : 1 }}>
            <input type="checkbox" checked={showVWAP && !interval.daily} disabled={interval.daily}
              onChange={e => setShowVWAP(e.target.checked)} />
            Session VWAP{interval.daily ? ' (not meaningful on daily candles)' : ''}
          </label>

          <div className="orb-chips" style={{ marginTop: 0 }}>
            {emaPeriods.map(p => (
              <span key={p} className="orb-chip" style={{ borderColor: colorFor(p), color: colorFor(p) }}>
                EMA {p}
                <button title={`Remove EMA ${p}`} onClick={() => removeEma(p)}>×</button>
              </span>
            ))}
          </div>

          <div className="orb-toggle">
            {EMA_PRESETS.filter(p => !emaPeriods.includes(p)).map(p => (
              <button key={p} onClick={() => addEma(p)} disabled={emaPeriods.length >= EMA_COLORS.length}>
                +EMA {p}
              </button>
            ))}
          </div>

          <div className="orb-toggle">
            <input type="number" min="1" max="1000" placeholder="period" value={newEma}
              style={{ width: 64 }}
              onChange={e => setNewEma(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addEma(newEma); }} />
            <button className="orb-btn small" onClick={() => addEma(newEma)}
              disabled={emaPeriods.length >= EMA_COLORS.length}>ADD EMA</button>
          </div>
        </div>
      </div>

      <div className="orb-card">
        <div className="orb-card-head">
          <h3>1-MINUTE DATA</h3>
          <span className="orb-mono-sm">
            {ticker || '—'} ·{' '}
            {has1mData
              ? `cached ${data1m.allDates[0]} → ${data1m.allDates[data1m.allDates.length - 1]} (${data1m.allDates.length} session${data1m.allDates.length === 1 ? '' : 's'})`
              : 'not cached yet'}
          </span>
        </div>

        <div className="orb-grid">
          <div className="orb-field">
            <label>FROM</label>
            <input type="date" value={range1m.from} disabled={jobRunning1m}
              onChange={e => setRange1m(r => ({ ...r, from: e.target.value }))} />
          </div>
          <div className="orb-field">
            <label>TO</label>
            <input type="date" value={range1m.to} disabled={jobRunning1m}
              onChange={e => setRange1m(r => ({ ...r, to: e.target.value }))} />
          </div>
          <div className="orb-field">
            <label>ESTIMATED REQUESTS</label>
            <div className="orb-status" style={{ paddingTop: 7 }}>
              {estimate1m} · ~{Math.max(1, Math.ceil(estimate1m / DEFAULT_RATE_LIMITS.requestsPerMinute))} min
            </div>
          </div>
          <div className="orb-field">
            <label>BUDGET USED TODAY</label>
            <div className="orb-status" style={{ paddingTop: 7 }}>
              {budget.used} / {DEFAULT_RATE_LIMITS.requestsPerDay}
              {(DEFAULT_RATE_LIMITS.requestsPerDay - budget.used) < estimate1m && (
                <span style={{ color: 'var(--red)' }}> · not enough left</span>
              )}
            </div>
          </div>
        </div>

        <div className="orb-controls" style={{ marginTop: 12, marginBottom: 0 }}>
          <button className={`orb-btn ${jobRunning1m ? 'danger' : 'primary'}`}
            onClick={jobRunning1m ? () => cancel1mDownload(ticker) : startDownload1m}
            disabled={!ticker || (!jobRunning1m && (!apiKey || range1m.from > range1m.to))}>
            {jobRunning1m ? 'STOP' : 'DOWNLOAD 1-MIN DATA'}
          </button>
          {has1mData && !jobRunning1m && (
            <button className="orb-btn small" onClick={clear1mCache}>CLEAR 1-MIN CACHE</button>
          )}
          {job1m && (
            <span className="orb-status">
              {job1m.status === 'running' && job1m.detail}
              {job1m.status === 'done' && `Done · ${job1m.barsWritten.toLocaleString()} bars written this run`}
              {job1m.status === 'cancelled' && `Stopped · ${job1m.barsWritten.toLocaleString()} bars kept`}
              {job1m.status === 'error' && `Error: ${job1m.error}`}
            </span>
          )}
        </div>

        {jobRunning1m && (
          <div className="orb-progress">
            <div style={{
              width: `${Math.min(100, Math.max(4,
                ((job1m.requestsUsed - job1m.requestsAtStart) / job1m.estimatedRequests) * 100))}%`,
            }} />
          </div>
        )}

        {!apiKey && (
          <p className="orb-note" style={{ marginTop: 10, marginBottom: 0 }}>
            Add a Twelve Data API key on ORB → CONFIG first — it&apos;s shared with the rest of the app.
          </p>
        )}
        <p className="orb-note" style={{ marginTop: 10, marginBottom: 0 }}>
          Fetches real 1-minute bars for <b>{ticker || 'the selected ticker'}</b> over the range above
          and caches them locally (a separate store from the 5-min ORB cache), counted against the
          same shared Twelve Data daily budget shown above. The download keeps running in the
          background if you switch tools or tickers — come back and this card will show its
          progress. Only what&apos;s missing for the range gets fetched, so widening the range later
          or re-running it is cheap.
        </p>
      </div>

      {error && <div className="orb-banner error">{error}</div>}

      <div className="orb-card">
        <div className="orb-controls" style={{ marginBottom: 0 }}>
          <div className="orb-toggle">
            <button onClick={jumpStart} title="Rewind to the start of cached history" disabled={total === 0}>|◂ START</button>
            <button onClick={stepBack} disabled={cursor <= 1}>‹ STEP</button>
            <button className={playing ? 'active' : ''} onClick={togglePlay} disabled={total === 0}>
              {playing ? '❚❚ PAUSE' : '▶ PLAY'}
            </button>
            <button onClick={stepFwd} disabled={cursor >= total}>STEP ›</button>
            <button onClick={jumpEnd} disabled={cursor >= total}>END ▸|</button>
          </div>

          <div className="orb-toggle">
            <span className="lbl">SPEED</span>
            {SPEEDS.map(s => (
              <button key={s.ms} className={speedMs === s.ms ? 'active' : ''}
                onClick={() => setSpeedMs(s.ms)}>{s.label}</button>
            ))}
          </div>

          <span className="orb-mono-sm orb-spacer">
            Candle {Math.min(cursor, total)} / {total}
          </span>
        </div>

        <input type="range" className="replay-scrubber" min={total > 0 ? 1 : 0} max={total}
          value={Math.min(cursor, total)} disabled={total === 0}
          onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }} />
      </div>

      <div className="orb-card" ref={wrapRef}>
        {loading && <div className="orb-empty">Loading {ticker}…</div>}
        {!loading && data && total === 0 && (
          <div className="orb-empty">No cached bars for {ticker} at this timeframe.</div>
        )}
        {!loading && total > 0 && (
          <ReplayChart
            candles={visibleCandles}
            emaLines={visibleEma}
            vwap={showVWAP && !interval.daily ? visibleVwap : null}
            showVolume={showVolume}
            isDaily={!!interval.daily}
            width={width - 34}
            colorFor={colorFor}
          />
        )}

        <div className="orb-mono-sm" style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--green)' }}>▬ up candle</span>
          <span style={{ color: 'var(--red)' }}>▬ down candle</span>
          {showVWAP && !interval.daily && <span style={{ color: 'var(--amber)' }}>▬ session VWAP</span>}
          {emaPeriods.map(p => (
            <span key={p} style={{ color: colorFor(p) }}>▬ EMA {p}</span>
          ))}
        </div>
      </div>

      <p className="orb-note">
        5-min, 15-min, 1-hour, 4-hour and 1-day all replay the same Twelve Data history already
        cached for the ORB screener (ORB → DATA), so none of them spend any API budget — 15-min,
        1-hour and 4-hour candles are built by bucketing the cached 5-min bars (anchored to the
        09:30 ET session open, the same convention TradingView uses), and 1-day candles read the
        separately cached daily series rather than re-aggregating intraday. <b>1-minute</b> is the
        exception: it is not fetched proactively, so it only becomes available once you run the
        1-MINUTE DATA download above for this ticker and date range, cached in its own store from
        then on. VWAP resets at the start of every session; EMAs are seeded with a simple average of
        their first period and only start drawing once seeded, so a long period (e.g. EMA 200) needs
        that many bars of history in view before a line appears. Stepping, playback and the scrubber
        all reveal more of the same underlying series — nothing is recomputed differently at
        different speeds.
      </p>
    </div>
  );
}
