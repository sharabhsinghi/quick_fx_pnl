// Black-Scholes-Merton pricing, used to value option contracts during a
// backtest when no historical option quote exists.
//
// This is a MODEL price, not a market price. It assumes European exercise,
// a constant volatility over the holding period, continuous risk-free and
// dividend rates, and frictionless markets. Real listed equity options are
// American, trade at a spread, and reprice their implied volatility during the
// session. The gap between this and a real fill is not noise — treat model
// P&L as an upper bound and always apply an explicit spread assumption.

// Standard normal CDF — Abramowitz & Stegun 26.2.17, |error| < 7.5e-8.
export function normCdf(x) {
  const b1 = 0.319381530, b2 = -0.356563782, b3 = 1.781477937;
  const b4 = -1.821255978, b5 = 1.330274429, p = 0.2316419, c = 0.39894228;
  if (x >= 0) {
    const t = 1 / (1 + p * x);
    return 1 - c * Math.exp(-x * x / 2) * t * (b1 + t * (b2 + t * (b3 + t * (b4 + t * b5))));
  }
  const t = 1 / (1 - p * x);
  return c * Math.exp(-x * x / 2) * t * (b1 + t * (b2 + t * (b3 + t * (b4 + t * b5))));
}

export function normPdf(x) {
  return 0.39894228040143267794 * Math.exp(-x * x / 2);
}

/**
 * Price one European option plus its greeks.
 *
 * @param type  'call' | 'put'
 * @param S     underlying price
 * @param K     strike
 * @param T     time to expiry IN YEARS
 * @param r     continuously-compounded risk-free rate (0.04 = 4%)
 * @param sigma annualised volatility (0.30 = 30%)
 * @param q     continuous dividend yield
 */
export function blackScholes(type, S, K, T, r, sigma, q = 0) {
  const isCall = type !== 'put';

  // At (or past) expiry, or with no volatility left to speak of, the contract is
  // worth its intrinsic value and the greeks collapse.
  if (!(T > 0) || !(sigma > 0) || !(S > 0) || !(K > 0)) {
    const intrinsic = Math.max(0, isCall ? S - K : K - S);
    return {
      price: intrinsic,
      delta: intrinsic > 0 ? (isCall ? 1 : -1) : 0,
      gamma: 0, vega: 0, theta: 0, rho: 0,
      d1: null, d2: null, intrinsic, extrinsic: 0,
    };
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const dfQ = Math.exp(-q * T);   // discounted underlying
  const dfR = Math.exp(-r * T);   // discounted strike

  let price, delta, theta, rho;
  if (isCall) {
    price = S * dfQ * normCdf(d1) - K * dfR * normCdf(d2);
    delta = dfQ * normCdf(d1);
    theta = (-(S * dfQ * normPdf(d1) * sigma) / (2 * sqrtT))
      - r * K * dfR * normCdf(d2) + q * S * dfQ * normCdf(d1);
    rho = K * T * dfR * normCdf(d2);
  } else {
    price = K * dfR * normCdf(-d2) - S * dfQ * normCdf(-d1);
    delta = -dfQ * normCdf(-d1);
    theta = (-(S * dfQ * normPdf(d1) * sigma) / (2 * sqrtT))
      + r * K * dfR * normCdf(-d2) - q * S * dfQ * normCdf(-d1);
    rho = -K * T * dfR * normCdf(-d2);
  }

  const gamma = (dfQ * normPdf(d1)) / (S * sigma * sqrtT);
  const vega = S * dfQ * normPdf(d1) * sqrtT;
  const intrinsic = Math.max(0, isCall ? S - K : K - S);

  return {
    price: Math.max(0, price),
    delta, gamma,
    vega: vega / 100,        // per 1 volatility point
    theta: theta / 365,      // per calendar day
    rho: rho / 100,          // per 1% rate move
    d1, d2,
    intrinsic,
    extrinsic: Math.max(0, price) - intrinsic,
  };
}

// Back out the volatility implied by an observed premium (bisection — slower
// than Newton but it cannot diverge on the flat wings).
export function impliedVol(type, price, S, K, T, r, q = 0) {
  if (!(T > 0) || !(price > 0)) return null;
  const intrinsic = Math.max(0, type !== 'put' ? S - K : K - S);
  if (price < intrinsic) return null;

  let lo = 1e-4, hi = 5;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const p = blackScholes(type, S, K, T, r, mid, q).price;
    if (Math.abs(p - price) < 1e-8) return mid;
    if (p > price) hi = mid; else lo = mid;
  }
  const out = (lo + hi) / 2;
  return out > 4.99 ? null : out;
}

// ── Contract-selection helpers ───────────────────────────────────────────────

// Years to expiry from an intraday moment, measured to the 16:00 ET close on the
// expiration date. Short-dated contracts decay fast enough intraday that
// dropping the intra-session fraction visibly misprices them.
export function yearsToExpiry(barMs, expiryIsoDate, barDateIso, barMins) {
  const MS_DAY = 86400000;
  let ms;
  if (barDateIso !== undefined && barMins !== undefined) {
    // Prefer the ET fields carried on each bar — no timezone round-trip needed.
    // Distance = whole calendar days to the expiry date, plus whatever is left
    // of the current session before the 16:00 ET close.
    const days = Math.round(
      (Date.parse(expiryIsoDate + 'T12:00:00Z') - Date.parse(barDateIso + 'T12:00:00Z')) / MS_DAY);
    ms = days * MS_DAY + (16 * 60 - barMins) * 60000;
  } else {
    ms = Date.parse(expiryIsoDate + 'T20:00:00Z') - barMs; // ~16:00 ET
  }
  return Math.max(0, ms) / (365 * MS_DAY);
}

// Nearest listed strike, on the usual $1/$2.50/$5 ladder by price level.
export function strikeIncrement(price) {
  if (price < 25) return 0.5;
  if (price < 50) return 1;
  if (price < 100) return 1;
  if (price < 200) return 2.5;
  return 5;
}

export function nearestStrike(price, offsetSteps = 0) {
  const inc = strikeIncrement(price);
  return +(Math.round(price / inc) * inc + offsetSteps * inc).toFixed(2);
}

// Next standard weekly-ish expiry: the first Friday at least `minDays` out.
export function nextExpiry(fromIsoDate, minDays = 0) {
  const d = new Date(fromIsoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + minDays);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
