import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ReplayChart } from './ChartReplay';
import { computeEMA, anchoredVWAP } from '../orb/replay';
import { fmtNum, fmtMoney } from '../orb/format';
import { minsToHHMM } from '../orb/time';
import {
  ROOTS, kvGet, kvSet, getCoverage, downloadRange, loadBars, aggregate, etOffsetMs, withEtFields, clearRoot,
} from '../futures/data';
import {
  INSTRUMENTS, ORDER_TYPES, START_BALANCE, newAccount, placeOrder, processBar, cancelOrder, closePosition,
  equity, unrealized, ddThreshold, setDrawdownLimit, resetDrawdown,
} from '../futures/engine';

const TIMEFRAMES = [1, 2, 3, 5, 15, 30, 60, 240, 1440];
const tfLabel = (m) => (m === 1440 ? '1 DAY' : m >= 60 ? `${m / 60} HOUR` : `${m} MIN`);
// ms of wall time per 1-minute bar; 1x is true real time.
const SPEEDS = [
  { ms: 60000, label: '1x' }, { ms: 6000, label: '10x' }, { ms: 1000, label: '60x' },
  { ms: 200, label: '300x' }, { ms: 50, label: 'MAX' },
];
const TOOLS = [
  { key: 'trend', label: 'TRENDLINE', color: 'var(--blue)' },
  { key: 'hline', label: 'H-LINE', color: '#26c6da' },
  { key: 'ray', label: 'H-RAY', color: '#b388ff' },
  { key: 'fib', label: 'FIB', color: 'var(--amber)' },
];
const EMA_COLOR = { 9: '#40c4ff', 21: '#f06292' };
const DAY = 86400000;
const DEFAULT_TICKET = { inst: 'MES', qty: 1, type: 'market', price: '', stop: '', trail: '', tpPts: '', slPts: '', slTrail: false };
const DEFAULT_IND = { vwap: true, ema9: true, ema21: true, rsi: false, volume: true };

// Wilder RSI for every close (null until seeded).
function rsiSeries(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const gain = Math.max(ch, 0), loss = Math.max(-ch, 0);
    if (i <= period) { g += gain / period; l += loss / period; } else {
      g = (g * (period - 1) + gain) / period; l = (l * (period - 1) + loss) / period;
    }
    if (i >= period) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

// "YYYY-MM-DDTHH:MM" typed as ET wall clock -> epoch ms.
const etInputToMs = (s) => { const guess = Date.parse(s + ':00Z'); return guess - etOffsetMs(guess); };
const msToEtInput = (ms) => { const b = withEtFields({ t: ms }); return `${b.d}T${minsToHHMM(b.m)}`; };
const fmtEt = (ms) => { const b = withEtFields({ t: ms }); return `${b.d} ${minsToHHMM(b.m)} ET`; };
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export default function PracticeFutures() {
  const [loaded, setLoaded] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [coverage, setCoverage] = useState({});
  const [dl, setDl] = useState(() => ({ from: isoDay(Date.now() - 14 * DAY), to: isoDay(Date.now() - DAY), ES: true, NQ: true }));
  const [dlStatus, setDlStatus] = useState(null);
  const abortRef = useRef(null);

  const [root, setRoot] = useState('ES');
  const [tf, setTf] = useState(5);
  const [ind, setInd] = useState(DEFAULT_IND);
  const [speedMs, setSpeedMs] = useState(1000);
  const [startInput, setStartInput] = useState('');
  const [bars, setBars] = useState([]); // loaded 1-min window for `root`
  const [idx, setIdx] = useState(-1); // last revealed 1-min bar
  const [playing, setPlaying] = useState(false);
  const [msg, setMsg] = useState(null);

  const [acct, setAcct] = useState(() => newAccount());
  const [ticket, setTicket] = useState(DEFAULT_TICKET);
  const [ddInput, setDdInput] = useState('');

  const [drawingsByRoot, setDrawingsByRoot] = useState({});
  const [activeTool, setActiveTool] = useState(null);
  const drawings = drawingsByRoot[root] || [];

  const [width, setWidth] = useState(880);
  const wrapRef = useRef(null);
  const chartRef = useRef(null);

  const hasExposure = Object.keys(acct.positions).length > 0 || acct.orders.length > 0;
  const now = idx >= 0 ? bars[idx] : null;

  // Load a window of cached bars around `atMs` and put the cursor on it.
  const loadWindow = useCallback(async (r, atMs) => {
    const list = await loadBars(r, atMs - 5 * DAY, atMs + 30 * DAY);
    let i = -1;
    list.forEach((b, k) => { if (b.t <= atMs) i = k; });
    setBars(list);
    setIdx(i);
    if (i < 0) setMsg('No cached data at that time — download it first (DATA card below).');
    else { setMsg(null); setAcct(a => ({ ...a, last: { ...a.last, [r]: list[i].c } })); }
    return { list, i };
  }, []);

  // ── restore everything saved in the browser ──
  useEffect(() => {
    (async () => {
      const [key, cov, saved, ui, dr] = await Promise.all([
        kvGet('apiKey', ''), getCoverage(), kvGet('account'), kvGet('ui'), kvGet('drawings', {}),
      ]);
      setApiKey(key); setKeyInput(key); setCoverage(cov); setDrawingsByRoot(dr);
      if (saved) setAcct(saved);
      if (ui) {
        setRoot(ui.root); setTf(ui.tf); setInd({ ...DEFAULT_IND, ...ui.ind }); setSpeedMs(ui.speedMs);
        setTicket({ ...DEFAULT_TICKET, ...ui.ticket });
        if (ui.cursorTime) { setStartInput(msToEtInput(ui.cursorTime)); await loadWindow(ui.root, ui.cursorTime); }
      }
      setLoaded(true);
    })().catch(e => setMsg(e.message));
  }, [loadWindow]);

  // ── persist (debounced) ──
  const cursorTime = now ? now.t : null;
  useEffect(() => {
    if (!loaded) return undefined;
    const id = setTimeout(() => {
      kvSet('account', acct);
      kvSet('ui', { root, tf, ind, speedMs, ticket, cursorTime });
    }, 400);
    return () => clearTimeout(id);
  }, [loaded, acct, root, tf, ind, speedMs, ticket, cursorTime]);
  useEffect(() => { if (loaded) kvSet('drawings', drawingsByRoot); }, [loaded, drawingsByRoot]);

  useEffect(() => {
    const measure = () => wrapRef.current && setWidth(Math.max(320, wrapRef.current.clientWidth));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [loaded]);

  // ── replay clock: every step feeds one 1-min bar to the order engine ──
  const step = useCallback(async () => {
    if (idx + 1 < bars.length) {
      const next = bars[idx + 1];
      setAcct(a => processBar(a, root, next));
      setIdx(idx + 1);
      return;
    }
    if (!now) return;
    const { list, i } = await loadWindow(root, now.t); // window exhausted — slide forward
    if (i + 1 >= list.length) { setPlaying(false); setMsg('End of cached data — download more to keep going.'); }
  }, [idx, bars, root, now, loadWindow]);

  useEffect(() => {
    if (!playing) return undefined;
    const id = setTimeout(step, speedMs);
    return () => clearTimeout(id);
  }, [playing, step, speedMs]);

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'Escape') setActiveTool(null);
      if (e.key === ' ' && now) { e.preventDefault(); setPlaying(p => !p); }
      if (e.key === 'ArrowRight' && now) { e.preventDefault(); setPlaying(false); step(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [now, step]);

  const startReplay = async () => {
    if (!startInput) return;
    setPlaying(false);
    await loadWindow(root, etInputToMs(startInput));
  };

  const switchRoot = async (r) => {
    setRoot(r);
    setTicket(t => ({ ...t, inst: t.inst.startsWith('M') ? 'M' + r : r }));
    setPlaying(false);
    if (now) await loadWindow(r, now.t);
  };

  // ── chart data ──
  const candles = useMemo(() => (idx < 0 ? [] : aggregate(bars.slice(0, idx + 1), tf)), [bars, idx, tf]);
  const emaLines = useMemo(() => {
    const closes = candles.map(c => c.c);
    return [9, 21].filter(p => ind['ema' + p]).map(period => ({ period, values: computeEMA(closes, period) }));
  }, [candles, ind]);
  const vwap = useMemo(
    () => (ind.vwap ? anchoredVWAP(candles.map(c => ({ ...c, d: c.sess }))) : null), [candles, ind.vwap]);
  const rsi = useMemo(() => (ind.rsi ? rsiSeries(candles.map(c => c.c)) : null), [candles, ind.rsi]);

  const css = useMemo(() => {
    const s = getComputedStyle(document.documentElement);
    return { green: s.getPropertyValue('--green').trim(), red: s.getPropertyValue('--red').trim(), amber: s.getPropertyValue('--amber').trim(), blue: s.getPropertyValue('--blue').trim() };
  }, []);
  const priceLines = useMemo(() => {
    const mine = (inst) => INSTRUMENTS[inst].root === root;
    const lines = Object.entries(acct.positions).filter(([k]) => mine(k)).map(([k, p]) => ({
      price: p.avg, color: css.blue, title: `${k} ${p.qty > 0 ? '+' : ''}${p.qty}`,
    }));
    acct.orders.filter(o => mine(o.inst)).forEach((o) => {
      const color = o.label === 'TP' ? css.green : o.reduceOnly ? css.red : css.amber;
      const title = `${o.label || o.type.toUpperCase()} ${o.side === 'buy' ? 'B' : 'S'}${o.qty}`;
      if (o.type === 'stopLimit') lines.push({ price: o.stop, color, title: title + ' stop', dashed: true });
      lines.push({ price: o.type === 'limit' || o.type === 'stopLimit' ? o.price : o.stop, color, title, dashed: true });
    });
    return lines;
  }, [acct.positions, acct.orders, root, css]);

  // ── drawings ──
  const commitDrawing = useCallback((d) => {
    setDrawingsByRoot(prev => ({ ...prev, [root]: [...(prev[root] || []), { ...d, id: crypto.randomUUID() }] }));
    setActiveTool(null);
  }, [root]);
  const updateDrawing = useCallback((id, next) => {
    setDrawingsByRoot(prev => ({ ...prev, [root]: (prev[root] || []).map(d => (d.id === id ? next : d)) }));
  }, [root]);
  const removeDrawing = (id) => setDrawingsByRoot(prev => ({ ...prev, [root]: (prev[root] || []).filter(d => d.id !== id) }));

  // ── orders ──
  const submit = (side) => {
    const num = (v) => (v === '' ? undefined : Number(v));
    const { acct: next, error } = placeOrder(acct, {
      inst: ticket.inst, side, qty: Number(ticket.qty), type: ticket.type,
      price: num(ticket.price), stop: num(ticket.stop), trail: num(ticket.trail),
      tpPts: num(ticket.tpPts), slPts: num(ticket.slPts), slTrail: ticket.slTrail,
    }, now && now.t);
    setMsg(error);
    if (!error) setAcct(next);
  };
  const T = (k) => (e) => setTicket(t => ({ ...t, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  // ── download ──
  const saveKey = () => { const k = keyInput.trim(); setApiKey(k); kvSet('apiKey', k); };
  const runDownload = async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setDlStatus('starting…');
    try {
      let total = 0;
      for (const r of ROOTS.filter(x => dl[x])) {
        total += await downloadRange({ root: r, fromDate: dl.from, toDate: dl.to, apiKey, signal: ctrl.signal, onProgress: setDlStatus });
      }
      setDlStatus(`Done · ${total.toLocaleString()} new bars`);
      if (!now && !startInput) setStartInput(`${dl.from}T09:30`);
    } catch (e) {
      setDlStatus(e.name === 'AbortError' ? 'Stopped — finished pieces are kept.' : `Error: ${e.message}`);
    }
    abortRef.current = null;
    setCoverage(await getCoverage());
  };

  const eq = equity(acct);
  const openPnl = eq - acct.balance;
  const th = ddThreshold(acct);
  const closing = acct.fills.filter(f => f.pnl !== 0);
  const wins = closing.filter(f => f.pnl > 0).length;
  const insts = [root, 'M' + root];
  const running = !!abortRef.current;

  if (!loaded) return <div className="orb-empty">Loading…</div>;

  return (
    <div className="orb-section">
      {/* ── account ── */}
      <div className="orb-metrics">
        <div className="orb-metric"><div className="k">BALANCE</div><div className="v">{fmtMoney(acct.balance)}</div>
          <div className="s">start {fmtMoney(acct.startBalance, 0)}</div></div>
        <div className="orb-metric"><div className="k">EQUITY</div><div className="v">{fmtMoney(eq)}</div>
          <div className="s">peak {fmtMoney(acct.peak)}</div></div>
        <div className="orb-metric"><div className="k">OPEN P&amp;L</div>
          <div className={`v ${openPnl > 0 ? 'pos' : openPnl < 0 ? 'neg' : ''}`}>{fmtMoney(openPnl)}</div></div>
        <div className="orb-metric"><div className="k">TOTAL P&amp;L</div>
          <div className={`v ${eq - acct.startBalance > 0 ? 'pos' : eq < acct.startBalance ? 'neg' : ''}`}>{fmtMoney(eq - acct.startBalance)}</div>
          <div className="s">{closing.length} exits · {closing.length ? Math.round((wins / closing.length) * 100) : 0}% win</div></div>
        <div className="orb-metric"><div className="k">TRAILING DD</div>
          <div className={`v ${acct.breached ? 'neg' : ''}`}>{th == null ? 'OFF' : acct.breached ? 'BREACHED' : fmtMoney(eq - th)}</div>
          <div className="s">{th == null ? 'no limit set' : `${acct.breached ? 'locked' : 'room left'} · floor ${fmtMoney(th)}`}</div></div>
      </div>
      {acct.breached && (
        <div className="orb-banner error">Trailing drawdown limit hit — positions were flattened and trading is locked. Reset the limit below to continue.</div>
      )}
      {msg && <div className="orb-banner warn">{msg}</div>}

      {/* ── replay setup ── */}
      <div className="orb-card">
        <div className="orb-controls" style={{ marginBottom: 0 }}>
          <div className="orb-field" style={{ maxWidth: 120 }}>
            <label>PRODUCT</label>
            <select value={root} disabled={hasExposure} title={hasExposure ? 'Close positions and orders to switch' : ''}
              onChange={e => switchRoot(e.target.value)}>
              {ROOTS.map(r => <option key={r} value={r}>{r} / M{r}</option>)}
            </select>
          </div>
          <div className="orb-field" style={{ maxWidth: 120 }}>
            <label>TIMEFRAME</label>
            <select value={tf} onChange={e => setTf(Number(e.target.value))}>
              {TIMEFRAMES.map(m => <option key={m} value={m}>{tfLabel(m)}</option>)}
            </select>
          </div>
          <div className="orb-field" style={{ maxWidth: 210 }}>
            <label>START AT (ET)</label>
            <input type="datetime-local" value={startInput} onChange={e => setStartInput(e.target.value)} />
          </div>
          <button className="orb-btn primary" style={{ alignSelf: 'flex-end' }} onClick={startReplay}
            disabled={!startInput || hasExposure} title={hasExposure ? 'Close positions and orders before jumping in time' : ''}>
            GO TO START
          </button>
        </div>
        <div className="orb-controls" style={{ marginTop: 12, marginBottom: 0 }}>
          {[['vwap', 'Session VWAP'], ['ema9', 'EMA 9'], ['ema21', 'EMA 21'], ['rsi', 'RSI 14'], ['volume', 'Volume']].map(([k, label]) => (
            <label key={k} className="orb-check">
              <input type="checkbox" checked={ind[k]} onChange={e => setInd(s => ({ ...s, [k]: e.target.checked }))} />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* ── transport ── */}
      <div className="orb-card">
        <div className="orb-controls" style={{ marginBottom: 0 }}>
          <div className="orb-toggle">
            <button className={playing ? 'active' : ''} onClick={() => setPlaying(p => !p)} disabled={!now}>
              {playing ? '❚❚ PAUSE' : '▶ PLAY'}
            </button>
            <button onClick={() => { setPlaying(false); step(); }} disabled={!now}>STEP 1 MIN ›</button>
          </div>
          <div className="orb-toggle">
            <span className="lbl">SPEED</span>
            {SPEEDS.map(s => (
              <button key={s.ms} className={speedMs === s.ms ? 'active' : ''} onClick={() => setSpeedMs(s.ms)}>{s.label}</button>
            ))}
          </div>
          <button className="orb-btn small" onClick={() => chartRef.current && chartRef.current.scrollToNow()}>⟲ NOW</button>
          <span className="orb-mono-sm orb-spacer">
            {now ? `${fmtEt(now.t)} · last ${fmtNum(now.c)}` : 'pick a start time'} · space = play/pause, → = step
          </span>
        </div>
      </div>

      {/* ── chart ── */}
      <div className="orb-card" ref={wrapRef}>
        <div className="orb-controls" style={{ marginBottom: 10 }}>
          <div className="orb-toggle">
            <span className="lbl">DRAW</span>
            {TOOLS.map(t => (
              <button key={t.key} className={activeTool === t.key ? 'active' : ''}
                onClick={() => setActiveTool(cur => (cur === t.key ? null : t.key))}>{t.label}</button>
            ))}
            {activeTool && <span className="orb-mono-sm">{['ray', 'hline'].includes(activeTool) ? 'click a point' : 'click two points'} · Esc cancels</span>}
            {!activeTool && drawings.length > 0 && <span className="orb-mono-sm">drag a line or its ends to move it</span>}
          </div>
          <div className="orb-chips" style={{ marginTop: 0 }}>
            {drawings.map((d) => {
              const tool = TOOLS.find(t => t.key === d.tool);
              return (
                <span key={d.id} className="orb-chip" style={{ borderColor: tool.color, color: tool.color }}>
                  {tool.label}<button title="Remove" onClick={() => removeDrawing(d.id)}>×</button>
                </span>
              );
            })}
          </div>
        </div>
        {candles.length > 0 ? (
          <ReplayChart
            ref={chartRef} candles={candles} emaLines={emaLines} vwap={vwap} rsi={rsi}
            showVolume={ind.volume} isDaily={false} width={width - 34} height={ind.rsi ? 540 : 440}
            colorFor={p => EMA_COLOR[p]} drawings={drawings} activeTool={activeTool}
            onCommitDrawing={commitDrawing} onUpdateDrawing={updateDrawing} priceLines={priceLines}
          />
        ) : <div className="orb-empty">Download data, pick a start time and press GO TO START.</div>}
        <div className="orb-mono-sm" style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {ind.vwap && <span style={{ color: 'var(--amber)' }}>▬ session VWAP</span>}
          {ind.ema9 && <span style={{ color: EMA_COLOR[9] }}>▬ EMA 9</span>}
          {ind.ema21 && <span style={{ color: EMA_COLOR[21] }}>▬ EMA 21</span>}
          {ind.rsi && <span style={{ color: '#b388ff' }}>▬ RSI 14</span>}
        </div>
      </div>

      {/* ── order ticket ── */}
      <div className="orb-card">
        <div className="orb-card-head"><h3>ORDER TICKET</h3>
          <span className="orb-mono-sm">{INSTRUMENTS[ticket.inst].name} · ${INSTRUMENTS[ticket.inst].pointValue}/pt · ${INSTRUMENTS[ticket.inst].fee}/side fee</span>
        </div>
        <div className="orb-grid">
          <div className="orb-field"><label>CONTRACT</label>
            <select value={ticket.inst} onChange={T('inst')}>{insts.map(i => <option key={i} value={i}>{i}</option>)}</select></div>
          <div className="orb-field"><label>QTY</label><input type="number" min="1" value={ticket.qty} onChange={T('qty')} /></div>
          <div className="orb-field"><label>TYPE</label>
            <select value={ticket.type} onChange={T('type')}>{ORDER_TYPES.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select></div>
          {['stop', 'stopLimit'].includes(ticket.type) && (
            <div className="orb-field"><label>STOP PRICE</label><input type="number" step="0.25" value={ticket.stop} onChange={T('stop')} /></div>)}
          {['limit', 'stopLimit'].includes(ticket.type) && (
            <div className="orb-field"><label>LIMIT PRICE</label><input type="number" step="0.25" value={ticket.price} onChange={T('price')} /></div>)}
          {ticket.type === 'trail' && (
            <div className="orb-field"><label>TRAIL (POINTS)</label><input type="number" step="0.25" value={ticket.trail} onChange={T('trail')} /></div>)}
          <div className="orb-field"><label>TAKE PROFIT (POINTS)</label><input type="number" step="0.25" placeholder="none" value={ticket.tpPts} onChange={T('tpPts')} /></div>
          <div className="orb-field"><label>STOP LOSS (POINTS)</label><input type="number" step="0.25" placeholder="none" value={ticket.slPts} onChange={T('slPts')} />
            <label className="orb-check" style={{ fontSize: 10 }}><input type="checkbox" checked={ticket.slTrail} onChange={T('slTrail')} />trailing</label></div>
        </div>
        <div className="orb-controls" style={{ marginTop: 12, marginBottom: 0 }}>
          <button className="orb-btn" style={{ background: 'var(--green)', color: '#000', borderColor: 'var(--green)' }} disabled={!now || acct.breached} onClick={() => submit('buy')}>BUY</button>
          <button className="orb-btn" style={{ background: 'var(--red)', color: '#fff', borderColor: 'var(--red)' }} disabled={!now || acct.breached} onClick={() => submit('sell')}>SELL</button>
          <span className="orb-mono-sm">TP/SL are placed as an OCO bracket around the actual fill price.</span>
        </div>
      </div>

      {/* ── positions / orders / fills ── */}
      <div className="orb-card">
        <div className="orb-card-head"><h3>POSITIONS</h3></div>
        {Object.keys(acct.positions).length === 0 ? <div className="orb-mono-sm">Flat.</div> : (
          <div className="orb-table">
            <div className="r head" style={{ gridTemplateColumns: '70px 60px 1fr 1fr 1fr 80px' }}>
              <span>CONTRACT</span><span className="rt">QTY</span><span className="rt">AVG</span><span className="rt">LAST</span><span className="rt">OPEN P&amp;L</span><span />
            </div>
            {Object.entries(acct.positions).map(([k, p]) => {
              const u = unrealized(acct, k);
              return (
                <div key={k} className="r" style={{ gridTemplateColumns: '70px 60px 1fr 1fr 1fr 80px' }}>
                  <span className="tk">{k}</span><span className="rt">{p.qty}</span><span className="rt">{fmtNum(p.avg)}</span>
                  <span className="rt">{fmtNum(acct.last[INSTRUMENTS[k].root])}</span>
                  <span className="rt" style={{ color: u >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtMoney(u)}</span>
                  <button className="orb-btn small" onClick={() => setAcct(a => closePosition(a, k, now && now.t))}>CLOSE</button>
                </div>
              );
            })}
          </div>
        )}

        <div className="orb-card-head" style={{ marginTop: 16 }}><h3>WORKING ORDERS</h3>
          {acct.orders.length > 0 && <button className="orb-btn small" onClick={() => setAcct(a => ({ ...a, orders: [] }))}>CANCEL ALL</button>}
        </div>
        {acct.orders.length === 0 ? <div className="orb-mono-sm">None.</div> : (
          <div className="orb-table">
            <div className="r head" style={{ gridTemplateColumns: '40px 70px 50px 110px 50px 1fr 80px' }}>
              <span>#</span><span>CONTRACT</span><span>SIDE</span><span>TYPE</span><span className="rt">QTY</span><span className="rt">PRICE</span><span />
            </div>
            {acct.orders.map(o => (
              <div key={o.id} className="r" style={{ gridTemplateColumns: '40px 70px 50px 110px 50px 1fr 80px' }}>
                <span className="dim">{o.id}</span><span className="tk">{o.inst}</span>
                <span style={{ color: o.side === 'buy' ? 'var(--green)' : 'var(--red)' }}>{o.side.toUpperCase()}</span>
                <span>{o.label || ORDER_TYPES.find(x => x.key === o.type).label}</span><span className="rt">{o.qty}</span>
                <span className="rt">
                  {o.type === 'stopLimit' && `stop ${fmtNum(o.stop)} → `}
                  {o.type === 'limit' || o.type === 'stopLimit' ? fmtNum(o.price) : fmtNum(o.stop)}
                  {o.type === 'trail' && ` (trail ${o.trail})`}
                  {(o.tpPts || o.slPts) ? ` · TP ${o.tpPts || '—'} / SL ${o.slPts || '—'}` : ''}
                </span>
                <button className="orb-btn small" onClick={() => setAcct(a => cancelOrder(a, o.id))}>CANCEL</button>
              </div>
            ))}
          </div>
        )}

        <div className="orb-card-head" style={{ marginTop: 16 }}><h3>FILLS</h3><span className="orb-mono-sm">latest 50</span></div>
        {acct.fills.length === 0 ? <div className="orb-mono-sm">No fills yet.</div> : (
          <div className="orb-scroll"><div className="orb-table">
            <div className="r head" style={{ gridTemplateColumns: '150px 60px 50px 1fr 40px 1fr 1fr 70px' }}>
              <span>TIME</span><span>CONTRACT</span><span>SIDE</span><span>ORDER</span><span className="rt">QTY</span><span className="rt">PRICE</span><span className="rt">P&amp;L</span><span className="rt">FEE</span>
            </div>
            {acct.fills.slice(-50).reverse().map((f, i) => (
              <div key={i} className="r" style={{ gridTemplateColumns: '150px 60px 50px 1fr 40px 1fr 1fr 70px' }}>
                <span className="dim">{f.time ? fmtEt(f.time) : '—'}</span><span className="tk">{f.inst}</span>
                <span style={{ color: f.side === 'buy' ? 'var(--green)' : 'var(--red)' }}>{f.side.toUpperCase()}</span>
                <span className="dim">{String(f.label).toUpperCase()}</span><span className="rt">{f.qty}</span><span className="rt">{fmtNum(f.price)}</span>
                <span className="rt" style={{ color: f.pnl > 0 ? 'var(--green)' : f.pnl < 0 ? 'var(--red)' : undefined }}>{f.pnl ? fmtMoney(f.pnl) : '—'}</span>
                <span className="rt dim">{fmtMoney(f.fee)}</span>
              </div>
            ))}
          </div></div>
        )}
      </div>

      {/* ── risk ── */}
      <div className="orb-card">
        <div className="orb-card-head"><h3>RISK</h3>
          <span className="orb-mono-sm">The floor trails your highest equity by the limit; touching it flattens and locks the account.</span></div>
        <div className="orb-controls" style={{ marginBottom: 0 }}>
          <div className="orb-field" style={{ maxWidth: 180 }}>
            <label>TRAILING DRAWDOWN ($)</label>
            <input type="number" min="0" step="100" placeholder={acct.ddLimit ? String(acct.ddLimit) : 'e.g. 1500'} value={ddInput} onChange={e => setDdInput(e.target.value)} />
          </div>
          <button className="orb-btn" style={{ alignSelf: 'flex-end' }} onClick={() => { setAcct(a => setDrawdownLimit(a, Number(ddInput))); setDdInput(''); }}>
            {Number(ddInput) > 0 ? 'SET LIMIT' : 'TURN OFF'}
          </button>
          <button className="orb-btn" style={{ alignSelf: 'flex-end' }} disabled={!acct.ddLimit} onClick={() => setAcct(resetDrawdown)}>
            RESET LIMIT
          </button>
          <button className="orb-btn danger" style={{ alignSelf: 'flex-end' }} onClick={() => {
            if (window.confirm(`Reset the practice account to ${fmtMoney(START_BALANCE, 0)}? Positions, orders and fill history are wiped.`)) {
              setAcct(a => ({ ...newAccount(START_BALANCE, a.ddLimit), last: a.last }));
            }
          }}>RESET ACCOUNT</button>
        </div>
      </div>

      {/* ── data ── */}
      <div className="orb-card">
        <div className="orb-card-head"><h3>DATA · MASSIVE 1-MIN FUTURES</h3>
          <span className="orb-mono-sm">
            {ROOTS.map(r => `${r}: ${(coverage[r] || []).map(([a, b]) => `${isoDay(a)} → ${isoDay(b - 1)}`).join(', ') || 'nothing cached'}`).join(' · ')}
          </span>
        </div>
        <div className="orb-grid">
          <div className="orb-field"><label>MASSIVE API KEY</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)} placeholder="paste key" />
              <button className="orb-btn small" onClick={saveKey} disabled={keyInput.trim() === apiKey}>SAVE</button>
            </div></div>
          <div className="orb-field"><label>FROM</label><input type="date" value={dl.from} disabled={running} onChange={e => setDl(d => ({ ...d, from: e.target.value }))} /></div>
          <div className="orb-field"><label>TO</label><input type="date" value={dl.to} disabled={running} onChange={e => setDl(d => ({ ...d, to: e.target.value }))} /></div>
          <div className="orb-field"><label>PRODUCTS</label>
            <div className="orb-controls" style={{ margin: 0, paddingTop: 6 }}>
              {ROOTS.map(r => (
                <label key={r} className="orb-check"><input type="checkbox" checked={dl[r]} disabled={running} onChange={e => setDl(d => ({ ...d, [r]: e.target.checked }))} />{r}</label>
              ))}
            </div></div>
        </div>
        <div className="orb-controls" style={{ marginTop: 12, marginBottom: 0 }}>
          <button className={`orb-btn ${running ? 'danger' : 'primary'}`}
            disabled={!running && (!apiKey || !ROOTS.some(r => dl[r]))}
            onClick={running ? () => abortRef.current.abort() : runDownload}>
            {running ? 'STOP' : 'DOWNLOAD MISSING DATA'}
          </button>
          {ROOTS.filter(r => coverage[r]).map(r => (
            <button key={r} className="orb-btn small" disabled={running} onClick={async () => {
              if (!window.confirm(`Delete all cached ${r} bars?`)) return;
              await clearRoot(r); setCoverage(await getCoverage());
            }}>CLEAR {r}</button>
          ))}
          {dlStatus && <span className="orb-status">{dlStatus}</span>}
        </div>
        <p className="orb-note" style={{ marginTop: 10, marginBottom: 0 }}>
          Bars are saved in this browser (IndexedDB) and only the dates you don&apos;t already have are fetched. The
          continuous series uses the front quarterly contract, rolled 8 days before expiry. Micro contracts (MES, MNQ)
          trade off the same E-mini prices, so one download covers both sizes. Everything — key, account, orders,
          drawings and replay position — stays on this device.
        </p>
      </div>
    </div>
  );
}
