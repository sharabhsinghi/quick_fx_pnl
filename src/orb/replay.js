// Data helpers for the candlestick replay tool.
//
// The cache holds one native intraday resolution — 5-min bars (see store.js) —
// plus a separate daily-bar series. Every other timeframe on offer is derived
// from those two without a fresh API call: coarser intraday timeframes are
// built by bucketing the 5-min bars, and the daily timeframe reads the cached
// daily series directly rather than re-aggregating intraday (which would miss
// any pre/post-market volume Twelve Data folds into the daily bar).

import { SESSION_OPEN_MINS } from './constants';

// Every timeframe a user can replay in. `minutes: null` marks the daily
// timeframe, which is sourced from the daily-bar store instead of resampling.
// 1-min isn't fetched proactively (see orb/oneMinute.js) — whether it's
// actually available for the ticker in view depends on whether that on-demand
// download has been run, which only the component knows, so there is no
// static `available` flag here any more.
export const REPLAY_INTERVALS = [
  { key: '1min', label: '1 MIN', minutes: 1, onDemand: true },
  { key: '5min', label: '5 MIN', minutes: 5, native: true },
  { key: '15min', label: '15 MIN', minutes: 15 },
  { key: '1h', label: '1 HOUR', minutes: 60 },
  { key: '4h', label: '4 HOUR', minutes: 240 },
  { key: '1day', label: '1 DAY', minutes: null, daily: true },
];

// Bucket 5-min bars into `minutes`-wide candles, anchored to the regular
// session open (09:30 ET) rather than to midnight — the same convention
// TradingView uses for US equities, so a 1-hour candle runs 09:30–10:30, not
// 10:00–11:00. Bars from outside the regular session (pre/post market) still
// bucket cleanly; the anchor just shifts which minute a bucket starts on.
export function resampleBars(bars, minutes) {
  if (!bars || bars.length === 0) return [];
  if (minutes <= 5) return bars.slice().sort((a, b) => a.t - b.t);

  const sorted = bars.slice().sort((a, b) => a.t - b.t);
  const out = [];
  let cur = null;
  let curKey = null;

  sorted.forEach((b) => {
    const bucketStart = Math.floor((b.m - SESSION_OPEN_MINS) / minutes) * minutes + SESSION_OPEN_MINS;
    const key = b.d + '|' + bucketStart;
    if (key !== curKey) {
      if (cur) out.push(cur);
      cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, d: b.d, m: bucketStart };
      curKey = key;
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  });
  if (cur) out.push(cur);
  return out;
}

// EMA over closes, seeded with an SMA of the first `period` values (the usual
// convention — an EMA "from nothing" front-loads too much weight on bar one).
// Returns one value per input close; entries before the seed are null so the
// caller can skip drawing them rather than plotting a misleading flat run.
export function computeEMA(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period) return out;
  const k = 2 / (period + 1);
  let sma = 0;
  for (let i = 0; i < period; i++) sma += closes[i];
  sma /= period;
  out[period - 1] = sma;
  let prev = sma;
  for (let i = period; i < closes.length; i++) {
    prev = closes[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// VWAP anchored to each session — the running sum resets whenever the
// candle's date changes, so a multi-day candle series still gets a fresh
// VWAP every session instead of one meaningless cumulative average. Only
// meaningful for intraday candles; callers should not offer it on the daily
// timeframe (there is no "session" left to anchor to).
export function anchoredVWAP(candles) {
  const out = new Array(candles.length).fill(null);
  let cumPV = 0, cumV = 0, curDate = null;
  candles.forEach((c, i) => {
    if (c.d !== curDate) { curDate = c.d; cumPV = 0; cumV = 0; }
    cumPV += ((c.h + c.l + c.c) / 3) * c.v;
    cumV += c.v;
    out[i] = cumV > 0 ? cumPV / cumV : null;
  });
  return out;
}

// A small, fixed-order set of line colors for multi-EMA overlays, kept apart
// from the candle (green/red) and VWAP (amber) colors already in use. Assign
// in this order and never reuse a slot for a different period once picked —
// identity should track the period, not its position in the list.
export const EMA_COLORS = ['#40c4ff', '#b388ff', '#26c6da', '#f06292', '#9ccc65', '#ff8a65'];
