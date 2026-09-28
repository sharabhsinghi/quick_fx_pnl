// One-time (then incremental) historical backfill into the local cache.
//
// A full year of 5-min bars is ~19.6k rows per ticker and Twelve Data caps a
// response at 5,000 points, so a cold pull is ~4 intraday requests + 1 daily
// request per ticker — ~100 requests for the default 20-name universe, which at
// the free tier's 8/min is roughly 12 minutes. Everything is resumable: a rerun
// only fetches the dates that are missing.

import { createLimiter, fetchIntradayHistory, fetchDailyHistory, getBudget } from './twelveData';
import {
  putIntradayBars, putDailyBars, refreshMeta, getMeta, getCachedDates,
} from './store';
import { shiftIsoDate, getSessionDate } from './time';

export function defaultRange(years) {
  const to = getSessionDate();
  const from = shiftIsoDate(to, -Math.round((years || 1) * 365));
  return { from, to };
}

// What still needs fetching for one ticker, given what is already cached.
export async function planTicker(ticker, fromDate, toDate) {
  const meta = await getMeta(ticker);
  const dates = await getCachedDates(ticker);
  const have = dates.length > 0
    ? { first: dates[0], last: dates[dates.length - 1] }
    : null;

  if (!have) {
    return { ticker, cold: true, ranges: [{ from: fromDate, to: toDate }], meta };
  }

  const ranges = [];
  // Extend backward if the requested window starts before what we hold.
  if (fromDate < have.first) {
    ranges.push({ from: fromDate, to: shiftIsoDate(have.first, -1) });
  }
  // Extend forward to today.
  if (toDate > have.last) {
    ranges.push({ from: shiftIsoDate(have.last, 1), to: toDate });
  }
  return { ticker, cold: false, ranges, meta, have };
}

/**
 * Fetch and cache everything missing.
 *
 * @param opts.onProgress ({ ticker, index, total, phase, detail, requestsUsed }) => void
 * @param opts.shouldCancel () => boolean
 */
export async function runBackfill(opts) {
  const { tickers, apiKey, fromDate, toDate } = opts;
  const onProgress = opts.onProgress || (() => {});
  const shouldCancel = opts.shouldCancel || (() => false);
  const limiter = createLimiter(opts.rateLimits);

  const results = [];

  for (let i = 0; i < tickers.length; i++) {
    if (shouldCancel()) { limiter.cancel(); break; }
    const ticker = tickers[i];
    const report = { ticker, intradayBars: 0, dailyBars: 0, skipped: false, error: null };

    try {
      const plan = await planTicker(ticker, fromDate, toDate);

      if (plan.ranges.length === 0) {
        report.skipped = true;
        onProgress({ ticker, index: i, total: tickers.length, phase: 'up-to-date',
          detail: 'already covers ' + fromDate + ' → ' + toDate, requestsUsed: getBudget().used });
      }

      for (const range of plan.ranges) {
        if (shouldCancel()) break;
        onProgress({ ticker, index: i, total: tickers.length, phase: 'intraday',
          detail: range.from + ' → ' + range.to, requestsUsed: getBudget().used });

        const bars = await fetchIntradayHistory(
          ticker, apiKey, range.from, range.to, limiter,
          (p) => onProgress({
            ticker, index: i, total: tickers.length, phase: 'intraday',
            detail: p.waiting
              ? 'rate limit — next request in ' + Math.ceil(p.waiting / 1000) + 's'
              : 'page ' + p.page + ' · ' + (p.received || 0) + ' bars · back to ' + (p.earliest || '—'),
            requestsUsed: getBudget().used,
          }),
        );

        if (bars.length) {
          await putIntradayBars(ticker, bars);
          report.intradayBars += bars.length;
        }
      }

      if (shouldCancel()) { results.push(report); break; }

      // Daily bars are cheap; refresh the whole window every run so gap % and
      // ATR always have an unbroken series behind them.
      onProgress({ ticker, index: i, total: tickers.length, phase: 'daily',
        detail: 'daily bars for ATR + gap %', requestsUsed: getBudget().used });
      const daily = await fetchDailyHistory(
        ticker, apiKey, shiftIsoDate(fromDate, -40), toDate, limiter,
        (p) => onProgress({
          ticker, index: i, total: tickers.length, phase: 'daily',
          detail: p.waiting ? 'rate limit — next request in ' + Math.ceil(p.waiting / 1000) + 's' : 'daily bars',
          requestsUsed: getBudget().used,
        }),
      );
      if (daily.length) {
        await putDailyBars(ticker, daily);
        report.dailyBars = daily.length;
      }

      await refreshMeta(ticker, 'Twelve Data');
    } catch (e) {
      if (e && e.message === 'cancelled') break;
      report.error = (e && e.message) || 'Unknown error';
    }

    results.push(report);
    onProgress({ ticker, index: i + 1, total: tickers.length, phase: 'done',
      detail: report.error || (report.intradayBars + ' bars'), requestsUsed: getBudget().used });
  }

  return { results, cancelled: shouldCancel() };
}

// Rough request estimate so the /data screen can warn before a long pull.
export async function estimateRequests(tickers, fromDate, toDate, maxPointsPerRequest) {
  let total = 0;
  for (const ticker of tickers) {
    const plan = await planTicker(ticker, fromDate, toDate);
    let intraday = 0;
    plan.ranges.forEach((r) => {
      const days = Math.max(1, Math.round(
        (new Date(r.to + 'T12:00:00Z') - new Date(r.from + 'T12:00:00Z')) / 86400000));
      const sessions = days * (5 / 7);
      intraday += Math.max(1, Math.ceil((sessions * 78) / (maxPointsPerRequest || 5000)));
    });
    total += intraday + 1; // + the daily-bar request
  }
  return total;
}
