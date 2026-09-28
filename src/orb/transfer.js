// Export / import of the local historical cache.
//
// A cold one-year pull costs ~100 Twelve Data requests and about twelve minutes
// of wall clock at the free tier's 8/min. That work should survive moving to
// another browser, another machine, or a cleared site-data dialog — so the whole
// cache can be written to a file and read back without touching the network.
//
// Wire format is deliberately columnar. Storing each bar as a plain object
// repeats its keys ~20,000 times per ticker; storing it as [m,o,h,l,c,v] with
// the session date carried once on the row cuts the payload roughly in half
// before compression. The epoch timestamp is NOT written at all: it is derived
// on import from the ET date and minute fields by exactly the same converter
// that produced it, so the round trip is lossless.

import { etWallClockToEpochMs, etFields } from './time';
import {
  getStoredTickers, getAllMeta, getIntradayByDay, getDailyBars, getIvByDate,
  putIntradayBars, putDailyBars, putIvReadings, refreshMeta, deleteTickerData,
} from './store';

export const FORMAT = 'orb-screener-cache';
export const FORMAT_VERSION = 1;

const pad = n => String(n).padStart(2, '0');
const minsToClock = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60) + ':00';

export function encodeBar(bar) {
  const { mins } = bar.m !== undefined ? { mins: bar.m } : etFields(bar);
  return [mins, bar.o, bar.h, bar.l, bar.c, bar.v];
}

export function decodeBar(row, date) {
  const [m, o, h, l, c, v] = row;
  return { t: etWallClockToEpochMs(date + ' ' + minsToClock(m)), o, h, l, c, v, d: date, m };
}

export function decodeDaily(row, date) {
  const [o, h, l, c, v] = row;
  return { t: etWallClockToEpochMs(date), o, h, l, c, v, d: date, m: 16 * 60 };
}

const gzipSupported = () => typeof CompressionStream !== 'undefined';

/**
 * Build the export file.
 *
 * The JSON is assembled as an array of string chunks handed straight to Blob,
 * so a 20-ticker cache never has to exist as one ~40 MB JavaScript string.
 *
 * @param opts.tickers    which symbols to include (default: everything stored)
 * @param opts.compress   gzip when the browser supports it (default true)
 * @param opts.onProgress ({ ticker, done, total }) => void
 * @returns { blob, filename, tickers, sessions, bars, compressed }
 */
export async function exportCache(opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const tickers = opts.tickers && opts.tickers.length
    ? opts.tickers
    : await getStoredTickers();
  const allMeta = await getAllMeta();

  const header = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    barFields: ['m', 'o', 'h', 'l', 'c', 'v'],
    dailyFields: ['o', 'h', 'l', 'c', 'v'],
    note: 'Timestamps are rebuilt on import from the ET date and minute-of-day.',
    tickerList: tickers,
  };

  const chunks = ['{'];
  Object.entries(header).forEach(([k, v]) => {
    chunks.push(JSON.stringify(k) + ':' + JSON.stringify(v) + ',');
  });
  chunks.push('"tickers":{');

  let totalSessions = 0;
  let totalBars = 0;

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    onProgress({ ticker, done: i, total: tickers.length });

    const [byDay, daily, ivByDate] = await Promise.all([
      getIntradayByDay(ticker),
      getDailyBars(ticker),
      getIvByDate(ticker),
    ]);

    const sessions = {};
    Object.keys(byDay).sort().forEach((date) => {
      sessions[date] = byDay[date].map(encodeBar);
      totalSessions += 1;
      totalBars += byDay[date].length;
    });

    const dailyOut = {};
    (daily || []).forEach((b) => {
      const date = b.d || etFields(b).dateKey;
      dailyOut[date] = [b.o, b.h, b.l, b.c, b.v];
    });

    const payload = {
      meta: allMeta[ticker] || null,
      sessions,
      daily: dailyOut,
      iv: ivByDate || {},
    };

    chunks.push(JSON.stringify(ticker) + ':' + JSON.stringify(payload));
    if (i < tickers.length - 1) chunks.push(',');

    // Let the UI paint between tickers.
    await new Promise(r => setTimeout(r, 0));
  }

  chunks.push('}}');
  onProgress({ ticker: null, done: tickers.length, total: tickers.length });

  let blob = new Blob(chunks, { type: 'application/json' });
  const compress = opts.compress !== false && gzipSupported();
  if (compress) {
    const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
    blob = await new Response(stream).blob();
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return {
    blob,
    filename: `orb-cache-${stamp}.json${compress ? '.gz' : ''}`,
    tickers: tickers.length,
    sessions: totalSessions,
    bars: totalBars,
    compressed: compress,
    bytes: blob.size,
  };
}

// gzip magic number, so an import works regardless of what the file is named.
async function readAsText(file) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const isGzip = head[0] === 0x1f && head[1] === 0x8b;
  if (!isGzip) return file.text();
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This file is gzip-compressed and this browser cannot decompress it. '
      + 'Re-export with compression turned off, or open it in a current browser.');
  }
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

// Parse and validate without writing anything, so the user can see what a file
// holds before it touches their cache.
export async function inspectFile(file) {
  const text = await readAsText(file);
  let json;
  try {
    json = JSON.parse(text);
  } catch (_) {
    throw new Error('Not a readable JSON file.');
  }
  if (!json || json.format !== FORMAT) {
    throw new Error('This is not an ORB cache export (missing the expected format marker).');
  }
  if (json.version > FORMAT_VERSION) {
    throw new Error(`This file was written by a newer version (v${json.version}); this build reads up to v${FORMAT_VERSION}.`);
  }

  const summary = Object.entries(json.tickers || {}).map(([ticker, p]) => {
    const dates = Object.keys(p.sessions || {}).sort();
    return {
      ticker,
      firstDate: dates[0] || null,
      lastDate: dates[dates.length - 1] || null,
      sessions: dates.length,
      bars: dates.reduce((s, d) => s + p.sessions[d].length, 0),
      dailyBars: Object.keys(p.daily || {}).length,
      ivReadings: Object.keys(p.iv || {}).length,
    };
  }).sort((a, b) => a.ticker.localeCompare(b.ticker));

  return { json, exportedAt: json.exportedAt, version: json.version, summary };
}

/**
 * Write a previously inspected file into the local store.
 *
 * mode 'merge'   — keep everything already cached, add/overwrite the dates the
 *                  file covers. Safe default.
 * mode 'replace' — wipe each ticker the file contains before writing it, so the
 *                  local cache ends up exactly matching the file for those
 *                  symbols. Tickers absent from the file are left alone.
 */
export async function importCache(parsed, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const mode = opts.mode === 'replace' ? 'replace' : 'merge';
  const json = parsed.json;
  const entries = Object.entries(json.tickers || {})
    .filter(([t]) => !opts.only || opts.only.includes(t));

  const results = [];

  for (let i = 0; i < entries.length; i++) {
    const [ticker, payload] = entries[i];
    onProgress({ ticker, done: i, total: entries.length, phase: mode });

    try {
      if (mode === 'replace') await deleteTickerData(ticker);

      const bars = [];
      Object.keys(payload.sessions || {}).forEach((date) => {
        payload.sessions[date].forEach(row => bars.push(decodeBar(row, date)));
      });
      if (bars.length) await putIntradayBars(ticker, bars);

      const daily = Object.keys(payload.daily || {}).sort()
        .map(date => decodeDaily(payload.daily[date], date));
      if (daily.length) await putDailyBars(ticker, daily);

      const iv = Object.values(payload.iv || {});
      if (iv.length) await putIvReadings(iv);

      // Recomputed from what actually landed, never trusted from the file.
      const meta = await refreshMeta(ticker, 'imported cache');
      results.push({ ticker, bars: bars.length, dailyBars: daily.length, ivReadings: iv.length, meta });
    } catch (e) {
      results.push({ ticker, error: (e && e.message) || 'import failed' });
    }

    await new Promise(r => setTimeout(r, 0));
  }

  onProgress({ ticker: null, done: entries.length, total: entries.length, phase: 'done' });
  return results;
}
