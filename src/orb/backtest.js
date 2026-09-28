// ORB backtest engine.
//
// Replays the live screener's exact logic (analyzeSession) day by day against
// the locally cached bars, then simulates trade management on the 5-min bars
// that follow each TRIGGERED signal. Runs entirely against IndexedDB — no
// network calls — and cooperatively yields so the UI stays responsive.
//
// Two instruments share one management loop. In equity mode the loop walks the
// underlying's bars. In options mode it walks a synthetic premium series built
// by pricing the chosen contract at each bar's underlying levels — so stops,
// targets, trailing and the ambiguous-candle rule behave identically and there
// is only one place for that logic to be wrong.
//
// Look-ahead discipline:
//   * days are walked in forward time order;
//   * the RVOL baseline for day i uses only days strictly before i;
//   * ATR, gap % and realised volatility use daily bars strictly before the
//     session;
//   * RSI/VWAP are computed only through the breakout candle;
//   * trade management only ever reads bars at or after the entry bar;
//   * a trailing stop is ratcheted using bars already closed, never the bar
//     currently being tested.

import { analyzeSession } from './analysis';
import { buildSlotVolumeByDay, baselineForDayIndex, realizedVol } from './indicators';
import { isRegularSession, shiftIsoDate } from './time';
import { blackScholes, yearsToExpiry, nearestStrike, nextExpiry } from './blackScholes';
import {
  DEFAULT_SCREENER_CONFIG, DEFAULT_TRADE_CONFIG, OPTIONS_TRADE_DEFAULTS,
} from './constants';
import { getIntradayByDay, getDailyBars, getIvByDate } from './store';

const yieldToUi = () => new Promise(resolve => setTimeout(resolve, 0));

const fmtEquity = v => '$' + Math.round(v).toLocaleString('en-US');

const optCfg = cfg => ({ ...OPTIONS_TRADE_DEFAULTS, ...(cfg.options || {}) });

// ── Contract construction ────────────────────────────────────────────────────

// Which volatility prices this session's contract, and where it came from.
// A captured reading is a real market observation; realised vol is a model
// input standing in for one. The distinction is carried on every trade.
function resolveSigma(o, ivRow, dailyBefore) {
  if (o.sigmaSource === 'flat') {
    return { sigma: o.flatIv / 100, source: 'flat' };
  }
  if (o.sigmaSource !== 'realized_vol' && ivRow && ivRow.iv > 0) {
    return { sigma: ivRow.iv / 100, source: 'captured_iv' };
  }
  const rv = realizedVol(dailyBefore, o.rvPeriod);
  if (!(rv > 0)) return { sigma: null, source: 'unavailable' };
  return { sigma: rv * o.ivMultiplier, source: 'realized_vol' };
}

function resolveExpiry(o, sessionDate) {
  if (o.expiryMode === 'next_friday') return nextExpiry(sessionDate, o.dteDays);
  return shiftIsoDate(sessionDate, o.dteDays);
}

/**
 * Price the chosen contract across every bar of the session.
 *
 * The premium is monotonic in the underlying, so a bar's option high comes from
 * the underlying's high for a call and its low for a put, and vice versa. Time
 * to expiry is recomputed per bar, so theta decays through the session — which
 * is the whole story for a 0DTE contract.
 */
export function buildOptionSeries(sessionBars, contract) {
  const { type, strike, expiry, sigma, r, q } = contract;
  const px = (S, bar) => blackScholes(
    type, S, strike,
    yearsToExpiry(bar.t, expiry, bar.d, bar.m),
    r, sigma, q,
  ).price;

  return sessionBars.map((bar) => {
    const atOpen = px(bar.o, bar);
    const atClose = px(bar.c, bar);
    const atHigh = px(bar.h, bar);
    const atLow = px(bar.l, bar);
    return {
      t: bar.t, d: bar.d, m: bar.m,
      o: atOpen,
      c: atClose,
      h: type === 'call' ? atHigh : atLow,
      l: type === 'call' ? atLow : atHigh,
      v: bar.v,
      underlying: bar.c,
    };
  });
}

// ── Trade management (shared by both instruments) ────────────────────────────

function stopDistance(mode, value, entry, orbDistance) {
  if (mode === 'percent') return entry * (value / 100);
  if (mode === 'dollar') return value;
  if (mode === 'r') return value * orbDistance;
  return orbDistance; // 'orb'
}

function targetDistance(mode, value, entry, riskUnit) {
  if (mode === 'percent') return entry * (value / 100);
  if (mode === 'dollar') return value;
  return value * riskUnit; // 'r'
}

/**
 * Walk the post-entry bars of `series` and decide where the trade came out.
 * Returns per-unit economics only — position size is applied later, once the
 * account equity at that point in the run is known.
 *
 * `isLong` is about the position on THIS series: an option position is always
 * long its own premium series, even when the underlying signal was a short.
 */
function manageSeries(series, entryIndex, firstManagedIndex, entryPrice, isLong, slDist, mgmt) {
  const sign = isLong ? 1 : -1;
  const initialStop = entryPrice - sign * slDist;
  const riskUnit = Math.abs(entryPrice - initialStop);

  const target = mgmt.tpEnabled
    ? entryPrice + sign * targetDistance(mgmt.tpMode, mgmt.tpValue, entryPrice, riskUnit)
    : null;

  // Percent trails off the running extreme; every other basis trails by the
  // fixed initial risk distance.
  const trailPct = mgmt.slType === 'trailing' && mgmt.slMode === 'percent' ? mgmt.slValue / 100 : null;
  const trailFixed = mgmt.slType === 'trailing' && mgmt.slMode !== 'percent' ? slDist : null;
  const giveback = mgmt.slType === 'giveback';
  const keepFrac = 1 - (mgmt.givebackPct || 0) / 100;
  const armAt = entryPrice * ((mgmt.givebackActivatePct || 0) / 100);

  let stop = initialStop;
  let extreme = entryPrice;
  let exitPrice = null, exitTime = null, exitReason = null, exitIndex = null;

  for (let i = firstManagedIndex; i < series.length; i++) {
    const bar = series[i];

    const hitStop = isLong ? bar.l <= stop : bar.h >= stop;
    const hitTarget = target !== null && (isLong ? bar.h >= target : bar.l <= target);

    if (hitStop && hitTarget) {
      // Both levels sit inside one 5-min candle and we have no tick data to
      // order them. Configurable; conservative default assumes the stop.
      const stopFirst = mgmt.ambiguity !== 'target_first';
      exitPrice = stopFirst
        ? (isLong ? Math.min(stop, bar.o) : Math.max(stop, bar.o))
        : target;
      exitReason = stopFirst
        ? `${stop !== initialStop ? (giveback ? 'giveback stop' : 'trailing stop') : 'stop'} (ambiguous bar)`
        : 'target (ambiguous bar)';
      exitTime = bar.t; exitIndex = i;
      break;
    }
    if (hitStop) {
      // A stop becomes a market order, so a gap through it fills worse.
      exitPrice = isLong ? Math.min(stop, bar.o) : Math.max(stop, bar.o);
      exitReason = stop !== initialStop
        ? (giveback ? 'giveback stop' : 'trailing stop')
        : 'stop';
      exitTime = bar.t; exitIndex = i;
      break;
    }
    if (hitTarget) {
      // A take profit is a limit order: it fills at the limit, not beyond it.
      exitPrice = target;
      exitReason = 'target';
      exitTime = bar.t; exitIndex = i;
      break;
    }

    // No exit on this bar — now, and only now, let it move the trailing stop.
    if (mgmt.slType === 'trailing') {
      extreme = isLong ? Math.max(extreme, bar.h) : Math.min(extreme, bar.l);
      const candidate = trailPct !== null
        ? extreme - sign * (extreme * trailPct)
        : extreme - sign * trailFixed;
      stop = isLong ? Math.max(stop, candidate) : Math.min(stop, candidate);
    } else if (giveback) {
      // Follow the best level reached and keep `keepFrac` of the profit earned
      // so far. The stop only ever ratchets forward, and stays disarmed until
      // the position is `armAt` in front.
      extreme = isLong ? Math.max(extreme, bar.h) : Math.min(extreme, bar.l);
      const peakProfit = sign * (extreme - entryPrice);
      if (peakProfit > 0 && peakProfit >= armAt) {
        const candidate = entryPrice + sign * peakProfit * keepFrac;
        stop = isLong ? Math.max(stop, candidate) : Math.min(stop, candidate);
      }
    }
  }

  if (exitPrice === null) {
    const last = series[series.length - 1];
    if (!last || series.length <= firstManagedIndex) return null;
    exitPrice = last.c;
    exitTime = last.t;
    exitIndex = series.length - 1;
    exitReason = 'session close';
  }

  return { initialStop, riskUnit, target, finalStop: stop, exitPrice, exitTime, exitIndex, exitReason };
}

/**
 * Turn one TRIGGERED analysis into a simulated trade.
 *
 * @param ctx { sessionDate, ivRow, dailyBefore } — needed only in options mode
 */
export function simulateTrade(sessionBars, analysis, tradeCfg, ctx = {}) {
  const cfg = { ...DEFAULT_TRADE_CONFIG, ...(tradeCfg || {}) };
  const sig = analysis.breakout;
  const isLongSignal = sig.direction === 'long';

  // ---- entry bar (same for both instruments) ----
  let entryIndex, firstManagedIndex;
  if (cfg.entryMode === 'next_open') {
    if (!sessionBars[sig.barIndex + 1]) return null; // signal on the final bar
    entryIndex = sig.barIndex + 1;
    firstManagedIndex = entryIndex;
  } else {
    entryIndex = sig.barIndex;
    firstManagedIndex = entryIndex + 1;
  }
  const useOpen = cfg.entryMode === 'next_open';

  const orbOpposite = isLongSignal ? analysis.orbLow : analysis.orbHigh;

  if (cfg.instrument !== 'options') {
    // ── equity ──
    const entryPrice = useOpen ? sessionBars[entryIndex].o : sig.close;
    const orbDistance = Math.abs(entryPrice - orbOpposite);
    let slDist = stopDistance(cfg.slMode, cfg.slValue, entryPrice, orbDistance);
    if (!(slDist > 0)) slDist = orbDistance > 0 ? orbDistance : entryPrice * 0.01;

    const out = manageSeries(sessionBars, entryIndex, firstManagedIndex,
      entryPrice, isLongSignal, slDist, cfg);
    if (!out) return null;

    const sign = isLongSignal ? 1 : -1;
    const slip = cfg.slippageBps / 10000;
    const entryFill = entryPrice * (1 + sign * slip);
    const exitFill = out.exitPrice * (1 - sign * slip);

    return {
      instrument: 'equity',
      direction: sig.direction,
      entryIndex, entryTime: sessionBars[entryIndex].t,
      entryPrice, entryFill,
      ...out,
      exitFill,
      perUnitPnl: sign * (exitFill - entryFill),
      unitMultiplier: 1,
      barsHeld: out.exitIndex - entryIndex,
    };
  }

  // ── options ──
  const o = optCfg(cfg);
  const type = isLongSignal ? 'call' : 'put';           // long breakout -> call
  const { sigma, source } = resolveSigma(o, ctx.ivRow, ctx.dailyBefore || []);
  if (!(sigma > 0)) return { unpriceable: true, reason: 'no volatility input available' };

  const underlyingAtEntry = useOpen ? sessionBars[entryIndex].o : sig.close;
  const strikeRef = o.strikeBasis === 'signal_price' ? underlyingAtEntry : sessionBars[0].o;
  const strike = nearestStrike(strikeRef, o.strikeOffsetSteps);
  const expiry = resolveExpiry(o, ctx.sessionDate || sessionBars[0].d);

  const contract = {
    type, strike, expiry, sigma,
    r: o.riskFreeRate / 100, q: o.dividendYield / 100,
  };
  const optionSeries = buildOptionSeries(sessionBars, contract);

  const entryPremium = useOpen ? optionSeries[entryIndex].o : optionSeries[entryIndex].c;
  if (!(entryPremium > 0)) {
    return { unpriceable: true, reason: 'contract prices to zero at entry' };
  }

  // An 'orb'/'r' stop still means something here: the premium left if the
  // underlying were to travel back to the far side of the opening range.
  const premiumAtOrbStop = blackScholes(
    type, orbOpposite, strike,
    yearsToExpiry(sessionBars[entryIndex].t, expiry,
      sessionBars[entryIndex].d, sessionBars[entryIndex].m),
    contract.r, sigma, contract.q,
  ).price;
  const orbDistance = Math.max(0, entryPremium - premiumAtOrbStop);

  let slDist = stopDistance(o.slMode, o.slValue, entryPremium, orbDistance);
  if (!(slDist > 0)) slDist = entryPremium * 0.2;
  // A long option cannot lose more than the premium paid.
  slDist = Math.min(slDist, entryPremium);

  const mgmt = {
    slMode: o.slMode, slValue: o.slValue, slType: o.slType,
    givebackPct: o.givebackPct, givebackActivatePct: o.givebackActivatePct,
    tpEnabled: o.tpEnabled, tpMode: o.tpMode, tpValue: o.tpValue,
    ambiguity: cfg.ambiguity,
  };
  const out = manageSeries(optionSeries, entryIndex, firstManagedIndex,
    entryPremium, true, slDist, mgmt);
  if (!out) return null;

  // Spread is charged as a percent of premium per side (0 = fills at the mid).
  const half = o.optionSpreadPct / 100;
  const entryFill = entryPremium * (1 + half);
  const exitFill = out.exitPrice * (1 - half);

  return {
    instrument: 'options',
    direction: sig.direction,
    optionType: type, strike, expiry, sigma, sigmaSource: source,
    dte: Math.round(
      (Date.parse(expiry + 'T12:00:00Z') - Date.parse(sessionBars[0].d + 'T12:00:00Z')) / 86400000),
    underlyingEntry: underlyingAtEntry,
    underlyingExit: optionSeries[out.exitIndex].underlying,
    entryIndex, entryTime: sessionBars[entryIndex].t,
    entryPrice: entryPremium, entryFill,
    ...out,
    exitFill,
    perUnitPnl: exitFill - entryFill,
    unitMultiplier: o.contractMultiplier,
    barsHeld: out.exitIndex - entryIndex,
  };
}

// ── Position sizing ──────────────────────────────────────────────────────────

function sizePosition(trade, equity, cfg) {
  const mult = trade.unitMultiplier || 1;
  let units;

  if (cfg.sizing === 'fixed_shares') {
    units = cfg.fixedShares;
  } else if (cfg.sizing === 'fixed_dollar') {
    units = cfg.fixedDollar / (trade.entryPrice * mult);
  } else {
    const riskDollars = equity * (cfg.riskPct / 100);
    units = trade.riskUnit > 0 ? riskDollars / (trade.riskUnit * mult) : 0;
  }

  const maxNotional = equity * (cfg.maxPositionPctOfEquity / 100);
  if (maxNotional > 0 && units * trade.entryPrice * mult > maxNotional) {
    units = maxNotional / (trade.entryPrice * mult);
  }
  // Contracts are never fractional; shares are only if allowed.
  if (trade.instrument === 'options' || !cfg.allowFractionalShares) units = Math.floor(units);
  return units > 0 ? units : 0;
}

function tradeCosts(trade, units, cfg) {
  if (trade.instrument === 'options') {
    const o = optCfg(cfg);
    return o.commissionPerContract * units * 2; // one leg in, one leg out
  }
  return cfg.commissionPerTrade;
}

// ── Main engine ──────────────────────────────────────────────────────────────

/**
 * @param opts.tickers       symbols to include (must already be cached)
 * @param opts.fromDate      "YYYY-MM-DD" inclusive
 * @param opts.toDate        "YYYY-MM-DD" inclusive
 * @param opts.screenerCfg   thresholds for this run (may differ from live config)
 * @param opts.tradeCfg      trade-management config
 * @param opts.onProgress    ({ phase, ticker, done, total, signals }) => void
 * @param opts.shouldCancel  () => boolean
 */
export async function runBacktest(opts) {
  const screenerCfg = { ...DEFAULT_SCREENER_CONFIG, ...(opts.screenerCfg || {}) };
  const tradeCfg = { ...DEFAULT_TRADE_CONFIG, ...(opts.tradeCfg || {}) };
  const tickers = opts.tickers || [];
  const onProgress = opts.onProgress || (() => {});
  const shouldCancel = opts.shouldCancel || (() => false);

  const signals = [];
  const dayStats = {
    sessions: 0, triggered: 0, weak: 0, noBreakout: 0, noData: 0,
    skippedNoBars: 0, unpriceable: 0, noTimeToTrade: 0,
  };
  const sigmaSources = {};
  const weakReasonCounts = {};
  const sessionDates = new Set();
  const warnings = [];
  const skips = [];   // triggered signals that never became trades, and why

  for (let ti = 0; ti < tickers.length; ti++) {
    if (shouldCancel()) return { cancelled: true };
    const ticker = tickers[ti];
    onProgress({ phase: 'loading', ticker, done: ti, total: tickers.length, signals: signals.length });

    // Load the ENTIRE cached history, not just the backtest window: days before
    // fromDate are needed to build the RVOL baseline, ATR and realised vol for
    // the first days in range without peeking forward.
    const [byDayAll, dailyBars, ivByDate] = await Promise.all([
      getIntradayByDay(ticker),
      getDailyBars(ticker),
      getIvByDate(ticker),
    ]);

    const allDates = Object.keys(byDayAll).sort();
    if (allDates.length === 0) {
      warnings.push(ticker + ': no cached 5-min data, skipped');
      continue;
    }
    if (!dailyBars || dailyBars.length === 0) {
      warnings.push(ticker + ': no cached daily bars — gap %, ATR and realised vol unavailable');
    }

    const slotVolumeByDay = buildSlotVolumeByDay(byDayAll);
    const dailyDates = dailyBars.map(b => b.d);

    for (let di = 0; di < allDates.length; di++) {
      const date = allDates[di];
      if (date < opts.fromDate || date > opts.toDate) continue;
      if (shouldCancel()) return { cancelled: true };

      sessionDates.add(date);
      dayStats.sessions += 1;

      const sessionBars = byDayAll[date].filter(isRegularSession).sort((a, b) => a.t - b.t);
      if (sessionBars.length < 4) { dayStats.skippedNoBars += 1; continue; }

      // Daily bars strictly before this session.
      let cut = 0;
      while (cut < dailyDates.length && dailyDates[cut] < date) cut += 1;
      const dailyBefore = dailyBars.slice(0, cut);

      const baseline = baselineForDayIndex(
        slotVolumeByDay, allDates, di, screenerCfg.rvolLookbackDays);

      const analysis = analyzeSession(sessionBars, dailyBefore, baseline, screenerCfg);

      if (analysis.status === 'triggered') {
        dayStats.triggered += 1;
        const sim = simulateTrade(sessionBars, analysis, tradeCfg, {
          sessionDate: date, ivRow: ivByDate[date], dailyBefore,
        });
        // Qualified on the last bar of the session: real signal, no bar left to
        // trade it on. Counted rather than silently dropped.
        if (!sim) {
          dayStats.noTimeToTrade += 1;
          skips.push({ ticker, date, reason: "the signal printed on the session's final bar, leaving no bar to trade on" });
          continue;
        }
        if (sim.unpriceable) {
          dayStats.unpriceable += 1;
          skips.push({ ticker, date, reason: sim.reason || 'the option contract could not be priced' });
          continue;
        }

        if (sim.sigmaSource) {
          sigmaSources[sim.sigmaSource] = (sigmaSources[sim.sigmaSource] || 0) + 1;
        }

        const ivRow = ivByDate[date];
        signals.push({
          ticker, date, ...sim,
          orbHigh: analysis.orbHigh, orbLow: analysis.orbLow,
          rvol: analysis.breakout.rvol,
          rvolIsProxy: analysis.breakout.rvolIsProxy,
          baselineDays: analysis.baselineDays,
          rsi: analysis.breakout.rsi,
          vwap: analysis.breakout.vwap,
          gapPct: analysis.gapPct,
          rangeToAtr: analysis.rangeToAtr,
          filters: analysis.breakout.filters,
          iv: ivRow ? ivRow.iv : null,
        });
      } else if (analysis.status === 'breakout_weak') {
        dayStats.weak += 1;
        (analysis.attempts || []).forEach((a) => {
          a.reasons.forEach((r) => {
            const bucket = r.split(' ')[0];
            weakReasonCounts[bucket] = (weakReasonCounts[bucket] || 0) + 1;
          });
        });
      } else if (analysis.status === 'no_breakout') {
        dayStats.noBreakout += 1;
      } else {
        dayStats.noData += 1;
      }

      if (di % 40 === 0) await yieldToUi();
    }

    onProgress({ phase: 'analysed', ticker, done: ti + 1, total: tickers.length, signals: signals.length });
    await yieldToUi();
  }

  // ── Apply sizing and build the equity curve ────────────────────────────────
  //
  // Trades are sized off the equity at the START of their entry day, so several
  // signals on the same day are sized consistently rather than compounding off
  // each other while all of them are still open.

  signals.sort((a, b) => a.entryTime - b.entryTime || a.ticker.localeCompare(b.ticker));

  const orderedDates = Array.from(sessionDates).sort();
  const byDate = {};
  signals.forEach((s) => {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  });

  let equity = tradeCfg.startingCapital;
  let peakEquity = equity;
  let maxDrawdown = 0, maxDrawdownPct = 0;
  const trades = [];
  const equityCurve = [{ date: orderedDates[0] || opts.fromDate, equity }];
  const dailyReturns = [];
  let skippedForSize = 0;
  let totalCosts = 0;

  orderedDates.forEach((date) => {
    const equityAtOpen = equity;
    let dayPnl = 0;

    (byDate[date] || []).forEach((sig) => {
      const units = sizePosition(sig, equityAtOpen, tradeCfg);
      if (units <= 0) {
        skippedForSize += 1;
        skips.push({
          ticker: sig.ticker, date: sig.date,
          reason: `position size rounded to zero — risking ${tradeCfg.riskPct}% of ${fmtEquity(equityAtOpen)} over a ${sig.riskUnit.toFixed(4)} stop buys less than one ${sig.instrument === 'options' ? 'contract' : 'share'}`,
        });
        return;
      }
      const mult = sig.unitMultiplier || 1;
      const gross = units * sig.perUnitPnl * mult;
      const costs = tradeCosts(sig, units, tradeCfg);
      const net = gross - costs;
      dayPnl += net;
      totalCosts += costs;
      trades.push({
        ...sig,
        shares: units,
        notional: units * sig.entryPrice * mult,
        grossPnl: gross,
        commission: costs,
        pnl: net,
        rMultiple: sig.riskUnit > 0 ? net / (units * sig.riskUnit * mult) : 0,
        equityBefore: equityAtOpen,
      });
    });

    equity += dayPnl;
    // Always plot the final day so a flat tail (no signals late in the window)
    // is visible rather than the curve just ending early.
    if (dayPnl !== 0 || equityCurve.length === 1 || date === orderedDates[orderedDates.length - 1]) {
      equityCurve.push({ date, equity });
    }
    dailyReturns.push(equityAtOpen > 0 ? dayPnl / equityAtOpen : 0);

    if (equity > peakEquity) peakEquity = equity;
    const dd = peakEquity - equity;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownPct = peakEquity > 0 ? (dd / peakEquity) * 100 : 0;
    }
  });

  return {
    cancelled: false,
    trades,
    equityCurve,
    warnings,
    skips,
    stats: buildStats(trades, {
      startingCapital: tradeCfg.startingCapital,
      finalEquity: equity,
      maxDrawdown, maxDrawdownPct,
      dailyReturns,
      tradingDays: orderedDates.length,
      skippedForSize,
      totalCosts,
    }),
    dayStats,
    sigmaSources,
    weakReasonCounts,
    meta: {
      tickers, fromDate: opts.fromDate, toDate: opts.toDate,
      screenerCfg, tradeCfg,
      instrument: tradeCfg.instrument || 'equity',
      options: tradeCfg.instrument === 'options' ? optCfg(tradeCfg) : null,
      ivEvaluated: false,
      ivReadingsAvailable: trades.filter(t => t.iv !== null && t.iv !== undefined).length,
      finishedAt: new Date().toISOString(),
    },
  };
}

// ── Reporting ────────────────────────────────────────────────────────────────

function groupStats(trades) {
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    pnl: trades.reduce((s, t) => s + t.pnl, 0),
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
    avgR: trades.length ? trades.reduce((s, t) => s + t.rMultiple, 0) / trades.length : 0,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
  };
}

function buildStats(trades, ctx) {
  const overall = groupStats(trades);

  const byTicker = {};
  const byDirection = { long: [], short: [] };
  const byExitReason = {};
  const byFilter = {};
  const bySigmaSource = {};

  trades.forEach((t) => {
    (byTicker[t.ticker] = byTicker[t.ticker] || []).push(t);
    byDirection[t.direction].push(t);
    (byExitReason[t.exitReason] = byExitReason[t.exitReason] || []).push(t);
    if (t.sigmaSource) (bySigmaSource[t.sigmaSource] = bySigmaSource[t.sigmaSource] || []).push(t);
    // Which filters were actually satisfied (vs merely not-false) on this trade,
    // so "how did trades that passed RSI do?" is answerable without re-running.
    Object.keys(t.filters || {}).forEach((k) => {
      if (t.filters[k] === true) (byFilter[k] = byFilter[k] || []).push(t);
    });
  });

  const mapStats = obj => Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, groupStats(v)]));

  // Sharpe on daily account returns, annualised at 252 trading days. Rough by
  // design — it treats a flat (no-trade) day as a 0% return.
  const rets = ctx.dailyReturns || [];
  const mean = rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : 0;
  const variance = rets.length > 1
    ? rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1) : 0;
  const sd = Math.sqrt(variance);
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;

  const totalReturnPct = ctx.startingCapital > 0
    ? ((ctx.finalEquity - ctx.startingCapital) / ctx.startingCapital) * 100 : 0;

  return {
    ...overall,
    startingCapital: ctx.startingCapital,
    finalEquity: ctx.finalEquity,
    totalReturnPct,
    maxDrawdown: ctx.maxDrawdown,
    maxDrawdownPct: ctx.maxDrawdownPct,
    sharpe,
    tradingDays: ctx.tradingDays,
    skippedForSize: ctx.skippedForSize,
    totalCosts: ctx.totalCosts,
    costsVsGross: overall.grossProfit > 0 ? (ctx.totalCosts / overall.grossProfit) * 100 : null,
    expectancy: overall.trades ? overall.pnl / overall.trades : 0,
    byTicker: mapStats(byTicker),
    byDirection: mapStats(byDirection),
    byExitReason: mapStats(byExitReason),
    byFilter: mapStats(byFilter),
    bySigmaSource: mapStats(bySigmaSource),
  };
}

// ── CSV export ───────────────────────────────────────────────────────────────

export function tradesToCsv(trades) {
  const isOptions = trades.some(t => t.instrument === 'options');
  const cols = [
    'date', 'ticker', 'instrument', 'direction',
    ...(isOptions ? ['optionType', 'strike', 'expiry', 'dte', 'sigma', 'sigmaSource',
      'underlyingEntry', 'underlyingExit'] : []),
    'entryTime', 'entryPrice', 'entryFill',
    'initialStop', 'target', 'exitTime', 'exitPrice', 'exitFill', 'exitReason',
    'shares', 'notional', 'riskUnit', 'rMultiple', 'grossPnl', 'commission', 'pnl',
    'rvol', 'rvolIsProxy', 'rsi', 'vwap', 'gapPct', 'rangeToAtr', 'iv',
    'barsHeld', 'equityBefore',
  ];
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const fmtTime = ms => (ms
    ? new Date(ms).toLocaleString('sv-SE', { timeZone: 'America/New_York' })
    : '');

  const lines = [cols.join(',')];
  trades.forEach((t) => {
    lines.push(cols.map((c) => {
      if (c === 'entryTime' || c === 'exitTime') return esc(fmtTime(t[c]));
      const v = t[c];
      return esc(typeof v === 'number' ? Number(v.toFixed(6)) : v);
    }).join(','));
  });
  return lines.join('\n');
}
