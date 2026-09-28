// Core ORB analysis — ported from the orb-screener.html prototype.
//
// The pass/fail semantics are preserved EXACTLY, including the asymmetry in the
// original: `bodyClean` and `passesRvol` must be strictly true, while RSI, VWAP,
// gap and ATR-range only have to not be false (null = "couldn't be computed" is
// treated as non-blocking). Changing that would silently alter which historical
// days produce trades, so it is deliberate.

import { calcRSI, calcVWAP, calcATR } from './indicators';
import { etFields, isRegularSession } from './time';
import { DEFAULT_SCREENER_CONFIG, SESSION_OPEN_MINS } from './constants';

const ALL_ENABLED = {
  bodyClean: true, rvol: true, rsi: true, vwap: true, gap: true, atrRange: true,
};

function fmt(n, d) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/**
 * Analyse one session's regular-hours 5-min bars.
 *
 * @param sessionBars   ordered 5-min bars for the session, regular hours only
 * @param dailyBarsBefore daily bars STRICTLY BEFORE this session (gap % + ATR)
 * @param volumeBaseline { avgBySlot, daysUsed } built from prior days only
 * @param userCfg       screener config (thresholds, singleShot, enabledFilters)
 */
export function analyzeSession(sessionBars, dailyBarsBefore, volumeBaseline, userCfg) {
  const cfg = { ...DEFAULT_SCREENER_CONFIG, ...(userCfg || {}) };
  const enabled = { ...ALL_ENABLED, ...(cfg.enabledFilters || {}) };

  if (!sessionBars || sessionBars.length < 4) {
    return { status: 'no_data', reason: 'Not enough regular-session bars for this day' };
  }

  const orbCount = cfg.orbMinutes / cfg.barMinutes;
  const orbBars = sessionBars.slice(0, orbCount);
  const orbHigh = Math.max(...orbBars.map(b => b.h));
  const orbLow = Math.min(...orbBars.map(b => b.l));
  const orbVolume = orbBars.reduce((s, b) => s + b.v, 0);

  // ---- gap % (session open vs prior day's close) ----
  const priorClose = dailyBarsBefore && dailyBarsBefore.length > 0
    ? dailyBarsBefore[dailyBarsBefore.length - 1].c : null;
  const todayOpen = orbBars[0].o;
  const gapPct = priorClose ? ((todayOpen - priorClose) / priorClose) * 100 : null;
  const gapAbsPct = gapPct !== null ? Math.abs(gapPct) : null;
  const gapOk = gapAbsPct !== null
    ? (gapAbsPct >= cfg.gapMinPct && gapAbsPct <= cfg.gapMaxPct) : null;

  // ---- ATR-based range filter ----
  const atr = dailyBarsBefore ? calcATR(dailyBarsBefore, cfg.atrPeriod) : null;
  const orbRange = orbHigh - orbLow;
  const rangeToAtr = atr ? orbRange / atr : null;
  const rangeOk = rangeToAtr !== null
    ? (rangeToAtr >= cfg.atrRangeMinRatio && rangeToAtr <= cfg.atrRangeMaxRatio) : null;

  const base = {
    orbHigh, orbLow, orbVolume, orbRange,
    gapPct, gapOk, atr, rangeToAtr, rangeOk,
  };

  const laterBars = sessionBars.slice(orbCount);
  if (laterBars.length === 0) {
    return { ...base, status: 'orb_only', reason: 'ORB just formed, no bars after it yet' };
  }

  const hasBaseline = !!(volumeBaseline && volumeBaseline.daysUsed > 0);
  const baselineDays = hasBaseline ? volumeBaseline.daysUsed : 0;
  const fallbackAvgVol = orbVolume / orbBars.length;

  function rvolFor(bar) {
    if (hasBaseline) {
      const slot = etFields(bar).mins - SESSION_OPEN_MINS;
      const slotAvg = volumeBaseline.avgBySlot[slot];
      if (slotAvg && slotAvg > 0) return { rvol: bar.v / slotAvg, proxy: false };
    }
    // Weaker same-day proxy: the ORB bars' own average volume. Flagged so it is
    // never mistaken for a real multi-day RVOL.
    return { rvol: fallbackAvgVol > 0 ? bar.v / fallbackAvgVol : 0, proxy: true };
  }

  // Gate helper. A disabled filter is still computed and reported, it just does
  // not block. `strict` mirrors the original's true-vs-not-false asymmetry.
  const gate = (key, val, strict) => {
    if (!enabled[key]) return true;
    return strict ? val === true : val !== false;
  };

  let breakout = null;
  let failReasons = [];
  const attempts = [];

  for (let i = 0; i < laterBars.length; i++) {
    const bar = laterBars[i];
    const closedAbove = bar.c > orbHigh;
    const closedBelow = bar.c < orbLow;
    if (!closedAbove && !closedBelow) continue;

    const globalIdx = orbCount + i;                     // index within sessionBars
    const direction = closedAbove ? 'long' : 'short';
    const { rvol, proxy } = rvolFor(bar);
    const bodyClean = closedAbove ? bar.o >= orbHigh : bar.o <= orbLow;

    const closesUpTo = sessionBars.slice(0, globalIdx + 1).map(b => b.c);
    const rsi = calcRSI(closesUpTo, cfg.rsiPeriod);
    const vwap = calcVWAP(sessionBars, globalIdx);

    const rsiOk = rsi === null ? null
      : (direction === 'long' ? rsi < cfg.rsiOverbought : rsi > cfg.rsiOversold);
    const vwapOk = vwap === null ? null
      : (direction === 'long' ? bar.c > vwap : bar.c < vwap);
    const passesRvol = rvol >= cfg.rvolThreshold;

    const candidate = {
      direction, time: bar.t, barIndex: globalIdx,
      open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v,
      rvol, rvolIsProxy: proxy, passesRvol,
      rsi, rsiOk, vwap, vwapOk,
      iv: null, ivInfo: null,
      filters: { bodyClean, rvol: passesRvol, rsi: rsiOk, vwap: vwapOk, gap: gapOk, atrRange: rangeOk },
    };

    const reasons = [];
    if (enabled.bodyClean && !bodyClean) reasons.push("candle body didn't close cleanly beyond the range");
    if (enabled.rvol && !passesRvol) reasons.push('RVOL ' + fmt(rvol, 2) + 'x below ' + cfg.rvolThreshold + 'x');
    if (enabled.rsi && rsiOk === false) {
      reasons.push('RSI(' + cfg.rsiPeriod + ') ' + fmt(rsi, 1) + ' ' + (direction === 'long'
        ? 'overbought (≥' + cfg.rsiOverbought + ')'
        : 'oversold (≤' + cfg.rsiOversold + ')'));
    }
    if (enabled.vwap && vwapOk === false) reasons.push('close on wrong side of VWAP');
    if (enabled.gap && gapOk === false) {
      reasons.push('gap ' + fmt(gapAbsPct, 1) + '% outside ' + cfg.gapMinPct + '–' + cfg.gapMaxPct + '% window');
    }
    if (enabled.atrRange && rangeOk === false) {
      reasons.push('ORB range ' + fmt(rangeToAtr, 2) + 'x ATR outside '
        + cfg.atrRangeMinRatio + '–' + cfg.atrRangeMaxRatio + 'x window');
    }

    const allOk = gate('bodyClean', bodyClean, true)
      && gate('rvol', passesRvol, true)
      && gate('rsi', rsiOk, false)
      && gate('vwap', vwapOk, false)
      && gate('gap', gapOk, false)
      && gate('atrRange', rangeOk, false);

    attempts.push({ time: bar.t, direction, passed: allOk, reasons: reasons.slice() });

    if (cfg.singleShot) {
      // Strict single-shot: the first close outside the range IS the signal.
      breakout = candidate;
      failReasons = allOk ? [] : reasons;
      break;
    }

    if (allOk) {
      breakout = candidate;
      failReasons = [];
      break;
    } else if (!breakout) {
      // Keep the first attempt's failure reasons in case nothing ever qualifies.
      breakout = candidate;
      failReasons = reasons;
    }
  }

  if (!breakout) {
    return {
      ...base, status: 'no_breakout', attempts,
      reason: 'No close outside ORB range', baselineDays, hasBaseline,
    };
  }

  const triggered = gate('bodyClean', breakout.filters.bodyClean, true)
    && gate('rvol', breakout.filters.rvol, true)
    && gate('rsi', breakout.filters.rsi, false)
    && gate('vwap', breakout.filters.vwap, false)
    && gate('gap', gapOk, false)
    && gate('atrRange', rangeOk, false);

  return {
    ...base,
    status: triggered ? 'triggered' : 'breakout_weak',
    breakout, attempts, baselineDays, hasBaseline,
    reason: triggered ? null : (failReasons.length ? failReasons.join('; ') : 'Filters not satisfied'),
  };
}

// Live-screener entry point: takes raw multi-day 5-min bars and slices out the
// session first. Same signature shape as the prototype's analyzeTicker.
export function analyzeTicker(bars, sessionDateStr, volumeBaseline, dailyBars, cfg) {
  if (!bars || bars.length < 4) {
    return { status: 'no_data', reason: 'Not enough 5-min bars for today' };
  }
  const sessionBars = bars.filter(b => isRegularSession(b) && etFields(b).dateKey === sessionDateStr);
  if (sessionBars.length < 4) {
    return { status: 'no_data', reason: 'Not enough regular-session bars for today' };
  }
  return analyzeSession(sessionBars, dailyBars, volumeBaseline, cfg);
}

export const STATUS_LABELS = {
  triggered: 'TRIGGERED', breakout_weak: 'WEAK', no_breakout: 'NO BREAK',
  orb_only: 'FORMING', no_data: 'NO DATA', error: 'ERROR',
};

export const STATUS_RANK = {
  triggered: 0, breakout_weak: 1, no_breakout: 2, orb_only: 3, no_data: 4, error: 5,
};
