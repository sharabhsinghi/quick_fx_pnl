

import { getApiKey } from './lib/idb';

export const PAIR_META = {
  EURUSD: { base: 'EUR', quote: 'USD', pipSize: 0.0001, display: 'EUR/USD' },
  GBPUSD: { base: 'GBP', quote: 'USD', pipSize: 0.0001, display: 'GBP/USD' },
  USDJPY: { base: 'USD', quote: 'JPY', pipSize: 0.01,   display: 'USD/JPY' },
  USDCHF: { base: 'USD', quote: 'CHF', pipSize: 0.0001, display: 'USD/CHF' },
  AUDUSD: { base: 'AUD', quote: 'USD', pipSize: 0.0001, display: 'AUD/USD' },
  NZDUSD: { base: 'NZD', quote: 'USD', pipSize: 0.0001, display: 'NZD/USD' },
  USDCAD: { base: 'USD', quote: 'CAD', pipSize: 0.0001, display: 'USD/CAD' },
  EURGBP: { base: 'EUR', quote: 'GBP', pipSize: 0.0001, display: 'EUR/GBP' },
  EURJPY: { base: 'EUR', quote: 'JPY', pipSize: 0.01,   display: 'EUR/JPY' },
  GBPJPY: { base: 'GBP', quote: 'JPY', pipSize: 0.01,   display: 'GBP/JPY' },
  EURCHF: { base: 'EUR', quote: 'CHF', pipSize: 0.0001, display: 'EUR/CHF' },
  GBPCHF: { base: 'GBP', quote: 'CHF', pipSize: 0.0001, display: 'GBP/CHF' },
  AUDJPY: { base: 'AUD', quote: 'JPY', pipSize: 0.01,   display: 'AUD/JPY' },
  CADJPY: { base: 'CAD', quote: 'JPY', pipSize: 0.01,   display: 'CAD/JPY' },
  EURAUD: { base: 'EUR', quote: 'AUD', pipSize: 0.0001, display: 'EUR/AUD' },
  EURCAD: { base: 'EUR', quote: 'CAD', pipSize: 0.0001, display: 'EUR/CAD' },
  GBPAUD: { base: 'GBP', quote: 'AUD', pipSize: 0.0001, display: 'GBP/AUD' },
  GBPCAD: { base: 'GBP', quote: 'CAD', pipSize: 0.0001, display: 'GBP/CAD' },
  AUDCAD: { base: 'AUD', quote: 'CAD', pipSize: 0.0001, display: 'AUD/CAD' },
  AUDCHF: { base: 'AUD', quote: 'CHF', pipSize: 0.0001, display: 'AUD/CHF' },
  NZDJPY: { base: 'NZD', quote: 'JPY', pipSize: 0.01,   display: 'NZD/JPY' },
  USDSGD: { base: 'USD', quote: 'SGD', pipSize: 0.0001, display: 'USD/SGD' },
  USDMXN: { base: 'USD', quote: 'MXN', pipSize: 0.0001, display: 'USD/MXN' },
  USDHKD: { base: 'USD', quote: 'HKD', pipSize: 0.0001, display: 'USD/HKD' },
};

export function normalizePair(input) {
  return input.toUpperCase().replace(/[^A-Z]/g, '');
}

export function getPairMeta(pairKey) {
  return PAIR_META[pairKey] || null;
}

export function getSupportedPairs() {
  return Object.values(PAIR_META).map(p => p.display);
}

const _priceCache = new Map(); // pairKey -> { price, source, date, ts }
const CACHE_TTL_MS = 60_000; // 1 minute

export async function fetchLivePrice(pairKey) {
  const meta = PAIR_META[pairKey];
  if (!meta) throw new Error(`Unsupported pair: ${pairKey}`);

  const cached = _priceCache.get(pairKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { price: cached.price, source: cached.source, date: cached.date };
  }

  // Try Twelve Data if the user has stored an API key
  const apiKey = await getApiKey();
  if (apiKey) {
    try {
      const r = await fetch(
        `https://api.twelvedata.com/exchange_rate?apikey=${apiKey}&symbol=${encodeURIComponent(meta.display)}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (r.ok) {
        const data = await r.json();
        if (data?.rate) {
          const result = { price: data.rate, source: 'twelvedata.com', date: new Date().toISOString().split('T')[0] };
          _priceCache.set(pairKey, { ...result, ts: Date.now() });
          return result;
        }
      }
    } catch (_) {}
  }

  // Fallback: frankfurter.app (ECB, no key needed)
  const r = await fetch(
    `https://api.frankfurter.app/latest?from=${meta.base}&to=${meta.quote}`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!r.ok) throw new Error('Price feed unavailable. Check your connection.');
  const data = await r.json();
  const rate = data.rates?.[meta.quote];
  if (!rate) throw new Error('Rate not in response');
  const result = { price: rate, source: 'frankfurter.app (ECB)', date: data.date };
  _priceCache.set(pairKey, { ...result, ts: Date.now() });
  return result;
}

const _usdRateCache = new Map(); // targetCurrency -> { rate, ts }

export async function fetchUsdRate(targetCurrency) {
  if (targetCurrency === 'USD') return 1;
  const cached = _usdRateCache.get(targetCurrency);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.rate;
  try {
    const r = await fetch(
      `https://api.frankfurter.app/latest?from=USD&to=${targetCurrency}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (r.ok) {
      const data = await r.json();
      const rate = data.rates?.[targetCurrency];
      if (rate) {
        _usdRateCache.set(targetCurrency, { rate, ts: Date.now() });
        return rate;
      }
    }
  } catch (_) {}
  return 1; // fallback: treat as USD if fetch fails
}

const CURRENCY_SYMBOLS = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥',
  AUD: 'A$', CAD: 'C$', CHF: 'Fr', NZD: 'NZ$', SGD: 'S$', HKD: 'HK$',
};

export function getCurrencySymbol(currency) {
  return CURRENCY_SYMBOLS[currency] ?? currency;
}

// Formats the absolute value of amount with the currency symbol (no sign).
export function formatPL(amount, currency = 'USD') {
  const decimals = currency === 'JPY' ? 0 : 2;
  const sym = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  return `${sym}${Math.abs(amount).toFixed(decimals)}`;
}

export function calcPnL({ entry, currentPrice, side, lotSize, pipSize }) {
  const direction = side === 'buy' ? 1 : -1;
  const pips = direction * (currentPrice - entry) / pipSize;
  const standardLot = 100000;
  const pipValuePerStandardLot = pipSize < 0.001 ? (pipSize * standardLot) : (0.0001 * standardLot);
  const lots = lotSize / standardLot;
  const plUsd = pips * pipValuePerStandardLot * lots;
  return { pips, plUsd };
}

export function calcRR({ entry, sl, tp, side }) {
  const dir = side === 'buy' ? 1 : -1;
  const risk = dir * (entry - sl);
  const reward = dir * (tp - entry);
  if (risk <= 0) return null;
  return (reward / risk).toFixed(2);
}

export function formatPrice(price, pipSize) {
  const decimals = 5; // pipSize <= 0.001 ? 3 : 5;
  return price.toFixed(decimals);
}

export function calcPipValue({ pairKey, lotSize }) {
  const meta = PAIR_META[pairKey];
  if (!meta) return null;
  const standardLot = 100000;
  const pipValuePerStandardLot = meta.pipSize < 0.001 ? (meta.pipSize * standardLot) : (0.0001 * standardLot);
  return (lotSize / standardLot) * pipValuePerStandardLot;
}
