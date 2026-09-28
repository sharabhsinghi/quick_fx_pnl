// Local cache for ORB historical data.
//
// Kept in its own IndexedDB database rather than bolted onto the existing
// 'fx-tracker' DB in src/lib/idb.js: the volumes are very different (~20 tickers
// x ~19.6k 5-min bars a year), and keeping it separate means this whole folder
// can be lifted into another project without dragging the tracker's schema
// along. API keys are NOT stored here — the Twelve Data key stays in the app's
// existing settings store so it is entered once.
//
// Layout:
//   bars5m     key "TICKER|YYYY-MM-DD" -> { ticker, date, bars: [...] }   (one row per session)
//   bars1m     key "TICKER|YYYY-MM-DD" -> { ticker, date, bars: [...] }   (1-min, fetched on demand
//                                        by the Chart Replay tool — a different resolution from
//                                        bars5m, so it gets its own store rather than sharing keys)
//   barsDaily  key "TICKER"            -> { ticker, bars: [...] }
//   meta       key "TICKER"            -> coverage info for the /data screen
//   ivDaily    key "TICKER|YYYY-MM-DD" -> a REAL ATM IV reading captured by the
//                                        live screener on that day
//   config     key "name"              -> persisted screener/backtest config
//   runs       autoIncrement           -> saved backtest results

const DB_NAME = 'orb-screener';
const DB_VERSION = 2;

let _db = null;

function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('bars5m')) {
        const s = db.createObjectStore('bars5m', { keyPath: 'key' });
        s.createIndex('ticker', 'ticker', { unique: false });
      }
      if (!db.objectStoreNames.contains('bars1m')) {
        const s = db.createObjectStore('bars1m', { keyPath: 'key' });
        s.createIndex('ticker', 'ticker', { unique: false });
      }
      if (!db.objectStoreNames.contains('barsDaily')) {
        db.createObjectStore('barsDaily', { keyPath: 'ticker' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'ticker' });
      }
      if (!db.objectStoreNames.contains('ivDaily')) {
        const s = db.createObjectStore('ivDaily', { keyPath: 'key' });
        s.createIndex('ticker', 'ticker', { unique: false });
      }
      if (!db.objectStoreNames.contains('config')) {
        db.createObjectStore('config', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('runs')) {
        db.createObjectStore('runs', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    request.onerror = (e) => reject(e.target.error);
  });
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
    tx.onabort = (e) => reject(e.target.error);
  });
}

const barsKey = (ticker, date) => ticker + '|' + date;

// ── 5-min bars ───────────────────────────────────────────────────────────────

// Merge bars into the per-session rows. Existing sessions are replaced only for
// the dates present in `bars`, so an incremental update never destroys history.
export async function putIntradayBars(ticker, bars) {
  if (!bars || bars.length === 0) return { days: 0, bars: 0 };
  const byDay = {};
  bars.forEach((b) => {
    if (!byDay[b.d]) byDay[b.d] = [];
    byDay[b.d].push(b);
  });

  const db = await openDb();
  const tx = db.transaction('bars5m', 'readwrite');
  const store = tx.objectStore('bars5m');
  const dates = Object.keys(byDay);

  for (const date of dates) {
    const key = barsKey(ticker, date);
    const existing = await wrap(store.get(key));
    let merged = byDay[date];
    if (existing && existing.bars && existing.bars.length) {
      const seen = new Map();
      existing.bars.forEach(b => seen.set(b.t, b));
      merged.forEach(b => seen.set(b.t, b)); // fresh data wins
      merged = Array.from(seen.values()).sort((a, b) => a.t - b.t);
    } else {
      merged = merged.slice().sort((a, b) => a.t - b.t);
    }
    store.put({ key, ticker, date, bars: merged });
  }
  await txDone(tx);
  return { days: dates.length, bars: bars.length };
}

export async function getSessionBars(ticker, date) {
  const db = await openDb();
  const tx = db.transaction('bars5m', 'readonly');
  const row = await wrap(tx.objectStore('bars5m').get(barsKey(ticker, date)));
  return row ? row.bars : null;
}

// { "YYYY-MM-DD": [bars] } for one ticker, optionally bounded by date.
export async function getIntradayByDay(ticker, fromDate, toDate) {
  const db = await openDb();
  const tx = db.transaction('bars5m', 'readonly');
  const rows = await wrap(tx.objectStore('bars5m').index('ticker').getAll(ticker));
  const out = {};
  rows.forEach((r) => {
    if (fromDate && r.date < fromDate) return;
    if (toDate && r.date > toDate) return;
    out[r.date] = r.bars;
  });
  return out;
}

export async function getCachedDates(ticker) {
  const db = await openDb();
  const tx = db.transaction('bars5m', 'readonly');
  const rows = await wrap(tx.objectStore('bars5m').index('ticker').getAll(ticker));
  return rows.map(r => r.date).sort();
}

// ── 1-min bars ───────────────────────────────────────────────────────────────
//
// Only fetched on demand from the Chart Replay tool, for whatever date range a
// user actually wants to step through minute-by-minute — unlike bars5m this
// never gets fetched proactively, so most tickers will have none. Same merge
// semantics as putIntradayBars, just against the separate bars1m store.

export async function putIntraday1mBars(ticker, bars) {
  if (!bars || bars.length === 0) return { days: 0, bars: 0 };
  const byDay = {};
  bars.forEach((b) => {
    if (!byDay[b.d]) byDay[b.d] = [];
    byDay[b.d].push(b);
  });

  const db = await openDb();
  const tx = db.transaction('bars1m', 'readwrite');
  const store = tx.objectStore('bars1m');
  const dates = Object.keys(byDay);

  for (const date of dates) {
    const key = barsKey(ticker, date);
    const existing = await wrap(store.get(key));
    let merged = byDay[date];
    if (existing && existing.bars && existing.bars.length) {
      const seen = new Map();
      existing.bars.forEach(b => seen.set(b.t, b));
      merged.forEach(b => seen.set(b.t, b)); // fresh data wins
      merged = Array.from(seen.values()).sort((a, b) => a.t - b.t);
    } else {
      merged = merged.slice().sort((a, b) => a.t - b.t);
    }
    store.put({ key, ticker, date, bars: merged });
  }
  await txDone(tx);
  return { days: dates.length, bars: bars.length };
}

// { "YYYY-MM-DD": [bars] } for one ticker's cached 1-min data.
export async function getIntraday1mByDay(ticker, fromDate, toDate) {
  const db = await openDb();
  const tx = db.transaction('bars1m', 'readonly');
  const rows = await wrap(tx.objectStore('bars1m').index('ticker').getAll(ticker));
  const out = {};
  rows.forEach((r) => {
    if (fromDate && r.date < fromDate) return;
    if (toDate && r.date > toDate) return;
    out[r.date] = r.bars;
  });
  return out;
}

export async function getCached1mDates(ticker) {
  const db = await openDb();
  const tx = db.transaction('bars1m', 'readonly');
  const rows = await wrap(tx.objectStore('bars1m').index('ticker').getAll(ticker));
  return rows.map(r => r.date).sort();
}

export async function deleteTicker1mData(ticker) {
  const db = await openDb();
  const tx = db.transaction('bars1m', 'readwrite');
  const idx = tx.objectStore('bars1m').index('ticker');
  const keys = await wrap(idx.getAllKeys(ticker));
  keys.forEach(k => tx.objectStore('bars1m').delete(k));
  await txDone(tx);
}

// ── Daily bars ───────────────────────────────────────────────────────────────

export async function putDailyBars(ticker, bars) {
  const db = await openDb();
  const tx = db.transaction('barsDaily', 'readwrite');
  const store = tx.objectStore('barsDaily');
  const existing = await wrap(store.get(ticker));
  const seen = new Map();
  if (existing && existing.bars) existing.bars.forEach(b => seen.set(b.d, b));
  (bars || []).forEach(b => seen.set(b.d, b));
  const merged = Array.from(seen.values()).sort((a, b) => a.t - b.t);
  store.put({ ticker, bars: merged });
  await txDone(tx);
  return merged.length;
}

export async function getDailyBars(ticker) {
  const db = await openDb();
  const tx = db.transaction('barsDaily', 'readonly');
  const row = await wrap(tx.objectStore('barsDaily').get(ticker));
  return row ? row.bars : [];
}

// ── Coverage metadata ────────────────────────────────────────────────────────

export async function getMeta(ticker) {
  const db = await openDb();
  const tx = db.transaction('meta', 'readonly');
  return (await wrap(tx.objectStore('meta').get(ticker))) || null;
}

export async function getAllMeta() {
  const db = await openDb();
  const tx = db.transaction('meta', 'readonly');
  const rows = await wrap(tx.objectStore('meta').getAll());
  return Object.fromEntries(rows.map(r => [r.ticker, r]));
}

export async function putMeta(meta) {
  const db = await openDb();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put(meta);
  await txDone(tx);
}

// Recompute coverage for a ticker from what is actually stored.
export async function refreshMeta(ticker, source) {
  const dates = await getCachedDates(ticker);
  const daily = await getDailyBars(ticker);
  const db = await openDb();
  const tx = db.transaction('bars5m', 'readonly');
  const rows = await wrap(tx.objectStore('bars5m').index('ticker').getAll(ticker));
  const barCount = rows.reduce((s, r) => s + r.bars.length, 0);
  const meta = {
    ticker,
    firstDate: dates[0] || null,
    lastDate: dates[dates.length - 1] || null,
    dayCount: dates.length,
    barCount,
    dailyBarCount: daily.length,
    updatedAt: new Date().toISOString(),
    source: source || 'Twelve Data',
  };
  await putMeta(meta);
  return meta;
}

export async function deleteTickerData(ticker) {
  const db = await openDb();
  const tx = db.transaction(['bars5m', 'barsDaily', 'meta'], 'readwrite');
  const idx = tx.objectStore('bars5m').index('ticker');
  const keys = await wrap(idx.getAllKeys(ticker));
  keys.forEach(k => tx.objectStore('bars5m').delete(k));
  tx.objectStore('barsDaily').delete(ticker);
  tx.objectStore('meta').delete(ticker);
  await txDone(tx);
}

// ── Implied volatility captured by the live screener ─────────────────────────
//
// There is no free historical options-IV source (Tradier serves current chains
// only), so instead of fabricating a proxy we record every real ATM reading the
// live screener takes. That builds a genuine IV history going forward, and the
// backtest simply reports "not evaluated" for days with no reading.

export async function putIvReading(reading) {
  if (!reading || !reading.ticker || !reading.date) return;
  const db = await openDb();
  const tx = db.transaction('ivDaily', 'readwrite');
  tx.objectStore('ivDaily').put({ ...reading, key: barsKey(reading.ticker, reading.date) });
  await txDone(tx);
}

export async function getIvByDate(ticker) {
  const db = await openDb();
  const tx = db.transaction('ivDaily', 'readonly');
  const rows = await wrap(tx.objectStore('ivDaily').index('ticker').getAll(ticker));
  return Object.fromEntries(rows.map(r => [r.date, r]));
}

export async function countIvReadings() {
  const db = await openDb();
  const tx = db.transaction('ivDaily', 'readonly');
  return wrap(tx.objectStore('ivDaily').count());
}

// ── Config ───────────────────────────────────────────────────────────────────

export async function getConfig(name, fallback) {
  try {
    const db = await openDb();
    const tx = db.transaction('config', 'readonly');
    const row = await wrap(tx.objectStore('config').get(name));
    return row ? { ...fallback, ...row.value } : fallback;
  } catch (_) {
    return fallback;
  }
}

export async function saveConfig(name, value) {
  const db = await openDb();
  const tx = db.transaction('config', 'readwrite');
  tx.objectStore('config').put({ key: name, value });
  await txDone(tx);
}

// ── Saved backtest runs ──────────────────────────────────────────────────────

export async function saveRun(run) {
  const db = await openDb();
  const tx = db.transaction('runs', 'readwrite');
  const id = await wrap(tx.objectStore('runs').add(run));
  await txDone(tx);
  return id;
}

export async function getRuns() {
  const db = await openDb();
  const tx = db.transaction('runs', 'readonly');
  const rows = await wrap(tx.objectStore('runs').getAll());
  return rows.sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));
}

export async function deleteRun(id) {
  const db = await openDb();
  const tx = db.transaction('runs', 'readwrite');
  tx.objectStore('runs').delete(id);
  await txDone(tx);
}

export async function estimateUsage() {
  if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota };
  } catch (_) {
    return null;
  }
}

// ── Bulk helpers for cache transfer ──────────────────────────────────────────

// Every ticker present in the local store, whether or not it is still in the
// configured universe — an export should carry everything that was paid for.
export async function getStoredTickers() {
  const db = await openDb();
  const tx = db.transaction('meta', 'readonly');
  const rows = await wrap(tx.objectStore('meta').getAll());
  return rows.map(r => r.ticker).sort();
}

export async function putIvReadings(rows) {
  if (!rows || rows.length === 0) return 0;
  const db = await openDb();
  const tx = db.transaction('ivDaily', 'readwrite');
  const store = tx.objectStore('ivDaily');
  rows.forEach((r) => {
    if (r && r.ticker && r.date) store.put({ ...r, key: barsKey(r.ticker, r.date) });
  });
  await txDone(tx);
  return rows.length;
}

// Keep only the most recent runs so saved backtests cannot grow without bound.
export async function pruneRuns(keep = 10) {
  const db = await openDb();
  const tx = db.transaction('runs', 'readwrite');
  const store = tx.objectStore('runs');
  const all = await wrap(store.getAll());
  all.sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));
  all.slice(keep).forEach(r => store.delete(r.id));
  await txDone(tx);
  return Math.max(0, all.length - keep);
}

// Trades for one ticker on one session, from a saved run.
export function tradesForSession(run, ticker, date) {
  if (!run || !run.trades) return [];
  return run.trades.filter(t => t.ticker === ticker && t.date === date);
}
