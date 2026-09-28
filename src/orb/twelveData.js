// Twelve Data client: rate-limited, paginated, and shared by the live screener
// and the historical backfill.

import { etWallClockToEpochMs } from './time';
import { DEFAULT_RATE_LIMITS } from './constants';

const BASE = 'https://api.twelvedata.com';

// A bar carries both epoch ms (for ordering/display) and the ET date key +
// minutes-of-day parsed straight out of Twelve Data's already-ET datetime
// string, so no Intl call is needed per bar during a backtest.
export function normalizeTDBar(row) {
  const s = row.datetime;
  const datePart = s.split(' ')[0];
  const timePart = s.indexOf(':') !== -1 ? s.split(' ')[1] : '16:00:00';
  const [hh, mm] = timePart.split(':');
  return {
    t: etWallClockToEpochMs(s),
    o: parseFloat(row.open),
    h: parseFloat(row.high),
    l: parseFloat(row.low),
    c: parseFloat(row.close),
    v: parseFloat(row.volume) || 0,
    d: datePart,
    m: Number(hh) * 60 + Number(mm),
  };
}

// ── Request budget ───────────────────────────────────────────────────────────
// Daily counter persisted per calendar day so the /data screen can show what is
// left of the free tier's 800/day before starting an ~80-request backfill.

const BUDGET_KEY = 'orb-td-budget';

export function getBudget() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = JSON.parse(localStorage.getItem(BUDGET_KEY) || '{}');
    if (raw.date === today) return { date: today, used: raw.used || 0 };
  } catch (_) { /* ignore */ }
  return { date: today, used: 0 };
}

function bumpBudget(n) {
  const b = getBudget();
  const next = { date: b.date, used: b.used + n };
  try { localStorage.setItem(BUDGET_KEY, JSON.stringify(next)); } catch (_) { /* ignore */ }
  return next;
}

export function resetBudget() {
  try { localStorage.removeItem(BUDGET_KEY); } catch (_) { /* ignore */ }
}

// ── Rate limiter ─────────────────────────────────────────────────────────────
// Serialises calls with a minimum gap so the free tier's 8 req/min is respected.

export function createLimiter(limits) {
  const cfg = { ...DEFAULT_RATE_LIMITS, ...(limits || {}) };
  const minGapMs = Math.ceil(60000 / Math.max(1, cfg.requestsPerMinute));
  let chain = Promise.resolve();
  let lastAt = 0;
  let cancelled = false;

  return {
    limits: cfg,
    minGapMs,
    cancel() { cancelled = true; },
    get cancelled() { return cancelled; },
    // onWait(msRemaining) lets the UI show a live countdown between calls.
    schedule(fn, onWait) {
      const run = chain.then(async () => {
        if (cancelled) throw new Error('cancelled');
        const wait = Math.max(0, lastAt + minGapMs - Date.now());
        if (wait > 0) {
          const startedAt = Date.now();
          await new Promise((resolve) => {
            const tick = () => {
              if (cancelled) return resolve();
              const left = wait - (Date.now() - startedAt);
              if (left <= 0) return resolve();
              if (onWait) onWait(left);
              setTimeout(tick, 250);
            };
            tick();
          });
        }
        if (cancelled) throw new Error('cancelled');
        lastAt = Date.now();
        bumpBudget(1);
        return fn();
      });
      chain = run.catch(() => {});
      return run;
    },
  };
}

// ── Raw fetch ────────────────────────────────────────────────────────────────

async function tdFetch(params, apiKey) {
  const qs = new URLSearchParams({
    ...params,
    timezone: 'America/New_York',
    apikey: apiKey,
  }).toString();

  let res;
  try {
    res = await fetch(BASE + '/time_series?' + qs);
  } catch (networkErr) {
    throw new Error('Network/CORS error reaching Twelve Data. Raw: '
      + ((networkErr && (networkErr.message || networkErr.name)) || 'unknown'));
  }

  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch (_) { /* ignore */ }
    throw new Error('HTTP ' + res.status + ' (Twelve Data ' + params.interval + ') — ' + body.slice(0, 150));
  }

  const json = await res.json();
  if (json.status === 'error' || json.code >= 400) {
    throw new Error('Twelve Data error: ' + (json.message || ('code ' + json.code)));
  }
  if (!json.values) return [];
  return json.values.map(normalizeTDBar);
}

// Single request, ascending. Used by the live screener.
export function fetchTimeSeries(symbol, interval, outputsize, apiKey) {
  return tdFetch({ symbol, interval, outputsize: String(outputsize), order: 'ASC' }, apiKey)
    .then(bars => bars.sort((a, b) => a.t - b.t));
}

// ── Paginated history ────────────────────────────────────────────────────────

function fmtStamp(isoDate, endOfDay) {
  return isoDate + (endOfDay ? ' 23:59:59' : ' 00:00:00');
}

/**
 * Page backward through intraday history at the given resolution until
 * `startDate` is covered.
 *
 * Twelve Data caps a single response at 5,000 points, so ~19.6k 5-min bars of
 * a year takes ~4 requests per ticker — 1-minute history is 5x denser and
 * pages proportionally more. Each page asks for the most recent chunk at or
 * before a moving cursor, then the cursor jumps to just before the earliest
 * bar returned.
 *
 * onPage({ page, bars, earliest, requests }) fires after every request; `bars`
 * carries that page's own rows (ascending) so a caller can persist progress
 * incrementally instead of waiting for the whole range to finish.
 */
export async function fetchIntradayHistory(symbol, apiKey, startDate, endDate, limiter, onPage, interval = '5min') {
  const maxPoints = limiter.limits.maxPointsPerRequest;
  const all = [];
  let cursorEnd = fmtStamp(endDate, true);
  let page = 0;
  const MAX_PAGES = 40; // hard stop against a pathological loop

  while (page < MAX_PAGES) {
    const params = {
      symbol,
      interval,
      outputsize: String(maxPoints),
      order: 'DESC',
      start_date: fmtStamp(startDate, false),
      end_date: cursorEnd,
    };
    const bars = await limiter.schedule(() => tdFetch(params, apiKey),
      (msLeft) => onPage && onPage({ page: page + 1, waiting: msLeft, symbol }));
    page += 1;

    if (!bars || bars.length === 0) break;

    const ascending = bars.slice().sort((a, b) => a.t - b.t);
    all.push(...ascending);

    const earliest = ascending[0];
    if (onPage) {
      onPage({
        page, symbol, received: bars.length, earliest: earliest.d, total: all.length, bars: ascending,
      });
    }

    // Done when the provider returned less than a full page (no more history in
    // range) or we have reached back past the requested start.
    if (bars.length < maxPoints) break;
    if (earliest.d <= startDate) break;

    // Step the cursor to one minute before the earliest bar we just received.
    cursorEnd = new Date(earliest.t - 60000)
      .toLocaleString('sv-SE', { timeZone: 'America/New_York' })
      .replace('T', ' ');
  }

  // De-duplicate on timestamp (page boundaries can overlap) and sort ascending.
  const seen = new Map();
  all.forEach(b => seen.set(b.t, b));
  return Array.from(seen.values()).sort((a, b) => a.t - b.t);
}

// Daily bars for gap % and ATR. A year fits comfortably in one request.
export async function fetchDailyHistory(symbol, apiKey, startDate, endDate, limiter, onPage) {
  const params = {
    symbol,
    interval: '1day',
    outputsize: '5000',
    order: 'ASC',
    start_date: fmtStamp(startDate, false),
    end_date: fmtStamp(endDate, true),
  };
  const bars = await limiter.schedule(() => tdFetch(params, apiKey),
    (msLeft) => onPage && onPage({ waiting: msLeft, symbol }));
  return bars.sort((a, b) => a.t - b.t);
}
