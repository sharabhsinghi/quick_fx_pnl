

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

export async function fetchLivePrice(pairKey) {
  const meta = PAIR_META[pairKey];
  if (!meta) throw new Error(`Unsupported pair: ${pairKey}`);
  const res = await fetch(`/api/price?pair=${encodeURIComponent(pairKey)}`, {
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return { price: data.price, source: data.source, date: data.date };
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
