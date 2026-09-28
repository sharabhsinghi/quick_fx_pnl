// Indicator math, ported directly from the orb-screener.html prototype so the
// live screener and the backtest cannot drift numerically. Do not "clean these
// up" into a TA library — the point is that both paths run identical code.

import { etFields, isRegularSession } from './time';
import { SESSION_OPEN_MINS } from './constants';

// Wilder-smoothed RSI over a series of closes. Returns the RSI for the LAST close.
export function calcRSI(closes, period) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change; else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let j = period + 1; j < closes.length; j++) {
    const ch = closes[j] - closes[j - 1];
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

// Session VWAP through (and including) uptoIndex. bars must be same-session, ordered.
export function calcVWAP(bars, uptoIndex) {
  let cumPV = 0, cumV = 0;
  for (let i = 0; i <= uptoIndex; i++) {
    const b = bars[i];
    cumPV += ((b.h + b.l + b.c) / 3) * b.v;
    cumV += b.v;
  }
  return cumV > 0 ? cumPV / cumV : null;
}

// Average True Range over daily bars. dailyBars must already EXCLUDE the session
// being analysed (no look-ahead into the day we are trading).
export function calcATR(dailyBars, period) {
  if (dailyBars.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < dailyBars.length; i++) {
    const cur = dailyBars[i], prev = dailyBars[i - 1];
    trs.push(Math.max(
      cur.h - cur.l,
      Math.abs(cur.h - prev.c),
      Math.abs(cur.l - prev.c),
    ));
  }
  const recent = trs.slice(-period);
  return recent.reduce((s, v) => s + v, 0) / recent.length;
}

// Average volume per 5-min time-of-day slot across prior sessions, excluding
// sessionDateStr itself. Slot 0 = 09:30-09:35, slot 5 = 09:35-09:40, etc.
export function buildVolumeBaseline(multiDayBars, sessionDateStr, lookbackDays) {
  const bySlot = {};
  const seenDates = {};

  multiDayBars.forEach((bar) => {
    if (!isRegularSession(bar)) return;
    const { dateKey, mins } = etFields(bar);
    if (dateKey === sessionDateStr) return; // exclude the session under test
    seenDates[dateKey] = true;
    const slot = mins - SESSION_OPEN_MINS;
    if (!bySlot[slot]) bySlot[slot] = [];
    bySlot[slot].push(bar.v);
  });

  const avgBySlot = {};
  Object.keys(bySlot).forEach((slot) => {
    const vols = bySlot[slot].slice(-lookbackDays);
    avgBySlot[slot] = vols.reduce((s, v) => s + v, 0) / vols.length;
  });

  return { avgBySlot, daysUsed: Object.keys(seenDates).length };
}

// ── Backtest-side helpers ────────────────────────────────────────────────────
// Same maths as buildVolumeBaseline, restructured so a year of sessions can be
// walked day by day without rescanning the whole history for every day.

// { "2026-08-31": { 0: vol, 5: vol, ... }, ... }
export function buildSlotVolumeByDay(barsByDay) {
  const out = {};
  Object.keys(barsByDay).forEach((date) => {
    const slots = {};
    barsByDay[date].forEach((bar) => {
      if (!isRegularSession(bar)) return;
      slots[etFields(bar).mins - SESSION_OPEN_MINS] = bar.v;
    });
    out[date] = slots;
  });
  return out;
}

// Baseline for orderedDates[idx], using ONLY the days strictly before it.
// Equivalent to buildVolumeBaseline over that prefix — this is the guard against
// look-ahead bias in the RVOL filter.
export function baselineForDayIndex(slotVolumeByDay, orderedDates, idx, lookbackDays) {
  const bySlot = {};
  const seenDates = {};
  const start = Math.max(0, idx - lookbackDays);

  for (let i = start; i < idx; i++) {
    const date = orderedDates[i];
    const slots = slotVolumeByDay[date];
    if (!slots) continue;
    seenDates[date] = true;
    Object.keys(slots).forEach((slot) => {
      if (!bySlot[slot]) bySlot[slot] = [];
      bySlot[slot].push(slots[slot]);
    });
  }

  const avgBySlot = {};
  Object.keys(bySlot).forEach((slot) => {
    const vols = bySlot[slot].slice(-lookbackDays);
    avgBySlot[slot] = vols.reduce((s, v) => s + v, 0) / vols.length;
  });

  return { avgBySlot, daysUsed: Object.keys(seenDates).length };
}

// Annualised realised volatility from daily closes — the standard deviation of
// daily log returns, scaled by sqrt(252).
//
// This is HISTORICAL volatility, not implied volatility. They are different
// quantities: realised vol looks backward at what the underlying actually did,
// implied vol is the market's forward-looking price of optionality, and the two
// routinely diverge by a wide margin around catalysts. Anywhere this feeds an
// option price the result must be labelled as a model input, never presented as
// a market quote.
export function realizedVol(dailyBars, period) {
  if (!dailyBars || dailyBars.length < period + 1) return null;
  const recent = dailyBars.slice(-(period + 1));
  const rets = [];
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1].c, cur = recent[i].c;
    if (prev > 0 && cur > 0) rets.push(Math.log(cur / prev));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}
