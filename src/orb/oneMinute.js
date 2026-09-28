// Background job manager for on-demand 1-minute backfills.
//
// The Chart Replay tool lets a user pick a date range and pull real 1-minute
// bars for one ticker, rather than the 5-min resolution the ORB screener
// backfills proactively. A download is a plain async function tied to this
// module-level map, NOT to any component's effect lifecycle — so switching
// tabs, or navigating away from Calculators entirely, does not cancel it. A
// mounted component observes progress with `subscribe` + `getJob` instead of
// owning the fetch itself. Reloading or closing the browser tab does stop it,
// same as any other in-page fetch — but whatever pages already landed are
// already written to IndexedDB, so nothing already fetched is lost.

import { createLimiter, fetchIntradayHistory, getBudget } from './twelveData';
import { putIntraday1mBars, getCached1mDates } from './store';
import { shiftIsoDate } from './time';

const jobs = new Map(); // ticker -> job state
const listeners = new Set();

function notify() { listeners.forEach(fn => fn()); }

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getJob(ticker) { return jobs.get(ticker) || null; }
export function isRunning(ticker) {
  const j = jobs.get(ticker);
  return !!j && j.status === 'running';
}

// Rough bars-per-session for sizing the request estimate and progress bar —
// native 1-minute resolution, so ~5x the 5-min cache's own estimate.
const BARS_PER_SESSION_1M = 390; // 6.5h regular session x 60

export function estimate1mRequests(fromDate, toDate, maxPointsPerRequest) {
  const days = Math.max(1, Math.round(
    (new Date(toDate + 'T12:00:00Z') - new Date(fromDate + 'T12:00:00Z')) / 86400000) + 1);
  const sessions = days * (5 / 7);
  return Math.max(1, Math.ceil((sessions * BARS_PER_SESSION_1M) / (maxPointsPerRequest || 5000)));
}

// What's actually missing for this ticker, given whatever 1-min data is
// already cached — a rerun (or a wider range next time) only fetches the gap.
export async function planMissing1mRanges(ticker, fromDate, toDate) {
  const dates = await getCached1mDates(ticker);
  if (dates.length === 0) return [{ from: fromDate, to: toDate }];
  const first = dates[0], last = dates[dates.length - 1];
  const ranges = [];
  if (fromDate < first) ranges.push({ from: fromDate, to: shiftIsoDate(first, -1) });
  if (toDate > last) ranges.push({ from: shiftIsoDate(last, 1), to: toDate });
  return ranges;
}

/**
 * Start (or return the already-running) 1-min download for `ticker`. Returns
 * immediately — call `subscribe`/`getJob` to watch it progress.
 */
export function start1mDownload({ ticker, apiKey, fromDate, toDate, maxPointsPerRequest }) {
  const existing = jobs.get(ticker);
  if (existing && existing.status === 'running') return existing;

  const limiter = createLimiter();
  const job = {
    ticker, fromDate, toDate, status: 'running', detail: 'planning…',
    requestsAtStart: getBudget().used, requestsUsed: getBudget().used,
    estimatedRequests: 1, barsWritten: 0, error: null, cancelRequested: false,
    _limiter: limiter,
  };
  jobs.set(ticker, job);
  notify();

  (async () => {
    try {
      const ranges = await planMissing1mRanges(ticker, fromDate, toDate);

      if (ranges.length === 0) {
        job.status = 'done';
        job.detail = 'already cached for this range';
        notify();
        return;
      }

      job.estimatedRequests = ranges.reduce(
        (s, r) => s + estimate1mRequests(r.from, r.to, maxPointsPerRequest), 0) || 1;

      for (const range of ranges) {
        if (job.cancelRequested) break;
        job.detail = `fetching ${range.from} → ${range.to}`;
        notify();

        // Each page is written to the cache as it arrives (via onPage) rather
        // than waiting for the whole range, so a stop or an interruption
        // mid-download keeps whatever already landed instead of losing it.
        const pendingWrites = [];
        await fetchIntradayHistory(
          ticker, apiKey, range.from, range.to, limiter,
          (p) => {
            job.requestsUsed = getBudget().used;
            if (p.waiting) {
              job.detail = `rate limit — next request in ${Math.ceil(p.waiting / 1000)}s`;
            } else if (p.bars && p.bars.length) {
              pendingWrites.push(
                putIntraday1mBars(ticker, p.bars)
                  .then(() => { job.barsWritten += p.bars.length; })
                  .catch((e) => { job.error = (e && e.message) || 'Write failed'; }),
              );
              job.detail = `page ${p.page} · ${p.bars.length} bars · back to ${p.earliest || '—'}`;
            }
            notify();
          },
          '1min',
        );
        await Promise.all(pendingWrites);
        if (job.cancelRequested) break;
      }

      job.status = job.cancelRequested ? 'cancelled' : 'done';
    } catch (e) {
      const cancelled = e && e.message === 'cancelled';
      job.status = cancelled ? 'cancelled' : 'error';
      job.error = cancelled ? null : ((e && e.message) || 'Download failed');
    }
    notify();
  })();

  return job;
}

export function cancel1mDownload(ticker) {
  const job = jobs.get(ticker);
  if (!job) return;
  job.cancelRequested = true;
  if (job._limiter) job._limiter.cancel();
  notify();
}
