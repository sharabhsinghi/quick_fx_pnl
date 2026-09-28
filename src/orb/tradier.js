// Tradier: ATM implied volatility for the live screener.
//
// Display-only — IV never gates TRIGGERED. Tradier serves CURRENT chains and
// greeks only; there is no historical-greeks endpoint on any tier, so this
// cannot be backfilled. Readings taken here are written to the local ivDaily
// store so a real forward IV history accumulates day by day.

import { getSessionDate } from './time';

const BASE = 'https://api.tradier.com/v1';

async function tradierGet(path, key) {
  let res;
  try {
    res = await fetch(BASE + path, {
      headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
    });
  } catch (networkErr) {
    throw new Error('Network/CORS error reaching Tradier. Raw: '
      + ((networkErr && (networkErr.message || networkErr.name)) || 'unknown'));
  }
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch (_) { /* ignore */ }
    throw new Error('HTTP ' + res.status + ' (Tradier) — ' + body.slice(0, 150));
  }
  return res.json();
}

export async function fetchNearestExpiration(ticker, key) {
  const json = await tradierGet(
    '/markets/options/expirations?symbol=' + encodeURIComponent(ticker) + '&includeAllRoots=true', key);
  let dates = json && json.expirations && json.expirations.date;
  if (!dates) return null;
  if (typeof dates === 'string') dates = [dates];
  const today = getSessionDate();
  const future = dates.filter(d => d >= today).sort();
  return future.length > 0 ? future[0] : (dates.sort()[0] || null);
}

// Nearest expiration, strike closest to the underlying, call side for longs and
// put side for shorts — the side actually being traded.
export async function fetchAtmIV(ticker, underlyingPrice, direction, key) {
  const expiration = await fetchNearestExpiration(ticker, key);
  if (!expiration) return { iv: null, reason: 'No option expirations found' };

  const json = await tradierGet(
    '/markets/options/chains?symbol=' + encodeURIComponent(ticker)
    + '&expiration=' + expiration + '&greeks=true', key);

  let options = json && json.options && json.options.option;
  if (!options) return { iv: null, expiration, reason: 'No option chain returned' };
  if (!Array.isArray(options)) options = [options];

  const wantType = direction === 'short' ? 'put' : 'call';
  let candidates = options.filter(o => o.option_type === wantType);
  if (candidates.length === 0) candidates = options;

  let closest = null, closestDiff = Infinity;
  candidates.forEach((o) => {
    const diff = Math.abs(o.strike - underlyingPrice);
    if (diff < closestDiff) { closestDiff = diff; closest = o; }
  });

  if (!closest || !closest.greeks || closest.greeks.mid_iv === undefined) {
    return { iv: null, expiration, reason: 'No IV data at ATM strike' };
  }

  return {
    iv: closest.greeks.mid_iv * 100,
    strike: closest.strike,
    expiration,
    side: wantType,
  };
}
