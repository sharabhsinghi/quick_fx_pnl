// 1-minute futures bars from Massive (massive.com, formerly Polygon.io),
// cached in their own IndexedDB database so re-requests only fetch the gaps.
//
// Bars are stored per ROOT (ES, NQ): micro contracts (MES, MNQ) track the same
// index at the same price, so they trade off the E-mini series — one download
// covers both sizes.
// shortcut: continuous series is stitched front-month contracts with no back-adjustment, so a roll day can show a small price jump.

const DB_NAME = 'futures-practice';
const API = 'https://api.massive.com/futures/v1/aggs/';
export const ROOTS = ['ES', 'NQ'];
const MIN = 60000;
const DAY = 86400000;

let _db = null;
function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('bars', { keyPath: ['s', 't'] });
      req.result.createObjectStore('kv', { keyPath: 'k' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}
const wrap = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function kvGet(k, fallback = null) {
  const db = await openDb();
  const row = await wrap(db.transaction('kv').objectStore('kv').get(k));
  return row ? row.v : fallback;
}
export async function kvSet(k, v) {
  const db = await openDb();
  return wrap(db.transaction('kv', 'readwrite').objectStore('kv').put({ k, v }));
}

export async function getBars(root, fromMs, toMs) {
  const db = await openDb();
  const range = IDBKeyRange.bound([root, fromMs], [root, toMs]);
  return wrap(db.transaction('bars').objectStore('bars').getAll(range));
}

async function putBars(bars) {
  const db = await openDb();
  const tx = db.transaction('bars', 'readwrite');
  const store = tx.objectStore('bars');
  bars.forEach(b => store.put(b));
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}

// ── coverage bookkeeping: sorted, merged [from, to) ms intervals per root ──

export function addCoverage(list, from, to) {
  const all = [...list, [from, to]].sort((a, b) => a[0] - b[0]);
  const out = [];
  all.forEach(([a, b]) => {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  });
  return out;
}

export function missingRanges(list, from, to) {
  const gaps = [];
  let cur = from;
  list.forEach(([a, b]) => {
    if (b <= cur || a >= to) return;
    if (a > cur) gaps.push([cur, a]);
    cur = Math.max(cur, b);
  });
  if (cur < to) gaps.push([cur, to]);
  return gaps;
}

export const getCoverage = async () => kvGet('coverage', {});

// ── contract roll: quarterly H/M/U/Z, rolled 8 days before the 3rd-Friday expiry ──

const MONTH_CODES = { 3: 'H', 6: 'M', 9: 'U', 12: 'Z' };

function rollDate(year, month) { // month 1-12, returns ms (00:00 UTC)
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const thirdFriday = 1 + ((5 - first + 7) % 7) + 14;
  return Date.UTC(year, month - 1, thirdFriday) - 8 * DAY;
}

// Contract pieces covering [from, to): [{ ticker, from, to }].
export function contractPieces(root, from, to) {
  const pieces = [];
  let y = new Date(from).getUTCFullYear() - 1;
  let cur = from;
  while (cur < to) {
    for (const m of [3, 6, 9, 12]) {
      const roll = rollDate(y, m);
      if (roll <= cur) continue;
      const end = Math.min(roll, to);
      pieces.push({ ticker: root + MONTH_CODES[m] + (y % 10), from: cur, to: end });
      cur = end;
      if (cur >= to) break;
    }
    y += 1;
  }
  return pieces;
}

// ── ET wall-clock fields, cached per UTC hour (offset only changes at DST) ──

const etFmt = typeof Intl !== 'undefined'
  ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  : null;
const offsetCache = new Map();
export function etOffsetMs(ms) {
  const h = Math.floor(ms / 3600000);
  if (!offsetCache.has(h)) {
    const p = Object.fromEntries(etFmt.formatToParts(new Date(h * 3600000)).map(x => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    offsetCache.set(h, asUtc - h * 3600000);
  }
  return offsetCache.get(h);
}

// Adds d (ET date), m (ET minute of day) and sess (trading session date —
// CME index futures sessions start 18:00 ET the evening before).
export function withEtFields(b) {
  const local = b.t + etOffsetMs(b.t);
  const iso = new Date(local).toISOString();
  const d = iso.slice(0, 10);
  const m = Math.floor((local % DAY) / MIN);
  const sess = new Date(local + 6 * 3600000).toISOString().slice(0, 10);
  return { ...b, d, m, sess };
}

// Bucket 1-minute bars into `minutes`-wide candles anchored to the 18:00 ET
// session open, so 4H and 1D candles line up with the CME session.
export function aggregate(bars, minutes) {
  if (minutes === 1) return bars;
  const w = minutes * MIN;
  const out = [];
  let cur = null, key = null;
  bars.forEach((b) => {
    const shifted = b.t + etOffsetMs(b.t) + 6 * 3600000;
    const k = Math.floor(shifted / w);
    if (k !== key) {
      if (cur) out.push(cur);
      key = k;
      cur = withEtFields({ t: b.t - (shifted - k * w), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    } else {
      cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v;
    }
  });
  if (cur) out.push(cur);
  return out;
}

// ── download ──

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, signal) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { signal });
    if (res.status === 429) { await sleep(15000); continue; } // free-tier rate limit
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || body.message || `Massive returned HTTP ${res.status}`);
    return body;
  }
  throw new Error('Rate limited by Massive — try again in a minute.');
}

async function fetchPiece(piece, apiKey, signal, onPage) {
  const ns = (ms) => `${ms}000000`; // ms -> ns as a string (too big for exact JS numbers)
  let url = `${API}${piece.ticker}?resolution=1min&limit=50000`
    + `&window_start.gte=${ns(piece.from)}&window_start.lt=${ns(piece.to)}&apiKey=${encodeURIComponent(apiKey)}`;
  while (url) {
    const body = await fetchJson(url, signal);
    const bars = (body.results || []).map(r => ({
      s: piece.root, t: Math.round(r.window_start / 1e6), o: r.open, h: r.high, l: r.low, c: r.close, v: r.volume || 0,
    }));
    if (bars.length) await putBars(bars);
    onPage(bars.length);
    url = body.next_url ? body.next_url + (body.next_url.includes('apiKey=') ? '' : `&apiKey=${encodeURIComponent(apiKey)}`) : null;
  }
}

/**
 * Download 1-min bars for `root` over [fromDate, toDate] (inclusive, YYYY-MM-DD, UTC days),
 * skipping whatever is already cached. Returns the number of bars written.
 */
export async function downloadRange({ root, fromDate, toDate, apiKey, signal, onProgress }) {
  const from = Date.parse(fromDate + 'T00:00:00Z');
  const to = Math.min(Date.parse(toDate + 'T00:00:00Z') + DAY, Date.now());
  if (!(to > from)) throw new Error('Pick a FROM date before TO.');
  const coverage = await getCoverage();
  const gaps = missingRanges(coverage[root] || [], from, to);
  if (!gaps.length) { onProgress && onProgress(`${root}: already cached`); return 0; }

  let written = 0;
  for (const [a, b] of gaps) {
    for (const piece of contractPieces(root, a, b)) {
      onProgress && onProgress(`${root}: fetching ${piece.ticker} ${new Date(piece.from).toISOString().slice(0, 10)} → ${new Date(piece.to - 1).toISOString().slice(0, 10)}`);
      await fetchPiece({ ...piece, root }, apiKey, signal, (n) => {
        written += n;
        onProgress && onProgress(`${root}: ${piece.ticker} · ${written.toLocaleString()} bars`);
      });
      // Only mark finished pieces as covered, and never the last 8h (delayed plans haven't published it yet).
      const end = Math.min(piece.to, Date.now() - 8 * 3600000);
      if (end > piece.from) {
        const cov = await getCoverage();
        cov[root] = addCoverage(cov[root] || [], piece.from, end);
        await kvSet('coverage', cov);
      }
    }
  }
  return written;
}

// Every bar of a root (in ms range) with ET fields attached, oldest first.
export async function loadBars(root, fromMs, toMs) {
  const raw = await getBars(root, fromMs, toMs);
  return raw.map(withEtFields);
}

export async function clearRoot(root) {
  const db = await openDb();
  const range = IDBKeyRange.bound([root, 0], [root, Number.MAX_SAFE_INTEGER]);
  await wrap(db.transaction('bars', 'readwrite').objectStore('bars').delete(range));
  const cov = await getCoverage();
  delete cov[root];
  await kvSet('coverage', cov);
}
