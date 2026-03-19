const TWELVE_API_URL = 'https://api.twelvedata.com/exchange_rate';
const FALLBACK_URL = 'https://api.frankfurter.app';

// Pair metadata kept server-side so clients cannot enumerate or probe internal symbols
const PAIR_META = {
  EURUSD: { base: 'EUR', quote: 'USD', display: 'EUR/USD' },
  GBPUSD: { base: 'GBP', quote: 'USD', display: 'GBP/USD' },
  USDJPY: { base: 'USD', quote: 'JPY', display: 'USD/JPY' },
  USDCHF: { base: 'USD', quote: 'CHF', display: 'USD/CHF' },
  AUDUSD: { base: 'AUD', quote: 'USD', display: 'AUD/USD' },
  NZDUSD: { base: 'NZD', quote: 'USD', display: 'NZD/USD' },
  USDCAD: { base: 'USD', quote: 'CAD', display: 'USD/CAD' },
  EURGBP: { base: 'EUR', quote: 'GBP', display: 'EUR/GBP' },
  EURJPY: { base: 'EUR', quote: 'JPY', display: 'EUR/JPY' },
  GBPJPY: { base: 'GBP', quote: 'JPY', display: 'GBP/JPY' },
  EURCHF: { base: 'EUR', quote: 'CHF', display: 'EUR/CHF' },
  GBPCHF: { base: 'GBP', quote: 'CHF', display: 'GBP/CHF' },
  AUDJPY: { base: 'AUD', quote: 'JPY', display: 'AUD/JPY' },
  CADJPY: { base: 'CAD', quote: 'JPY', display: 'CAD/JPY' },
  EURAUD: { base: 'EUR', quote: 'AUD', display: 'EUR/AUD' },
  EURCAD: { base: 'EUR', quote: 'CAD', display: 'EUR/CAD' },
  GBPAUD: { base: 'GBP', quote: 'AUD', display: 'GBP/AUD' },
  GBPCAD: { base: 'GBP', quote: 'CAD', display: 'GBP/CAD' },
  AUDCAD: { base: 'AUD', quote: 'CAD', display: 'AUD/CAD' },
  AUDCHF: { base: 'AUD', quote: 'CHF', display: 'AUD/CHF' },
  NZDJPY: { base: 'NZD', quote: 'JPY', display: 'NZD/JPY' },
  USDSGD: { base: 'USD', quote: 'SGD', display: 'USD/SGD' },
  USDMXN: { base: 'USD', quote: 'MXN', display: 'USD/MXN' },
  USDHKD: { base: 'USD', quote: 'HKD', display: 'USD/HKD' },
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { pair } = req.query;
  if (!pair || typeof pair !== 'string') {
    return res.status(400).json({ error: 'pair query parameter is required' });
  }

  const key = pair.toUpperCase().replace(/[^A-Z]/g, '');
  const meta = PAIR_META[key];
  if (!meta) {
    return res.status(400).json({ error: `Unsupported pair: ${pair}` });
  }

  const apiKey = process.env.TWELVE_API_KEY;
  if (apiKey) {
    try {
      const r = await fetch(
        `${TWELVE_API_URL}?apikey=${apiKey}&symbol=${encodeURIComponent(meta.display)}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (r.ok) {
        const data = await r.json();
        if (data?.rate) {
          return res.json({
            price: data.rate,
            source: 'twelvedata.com',
            date: new Date().toISOString().split('T')[0],
          });
        }
      }
    } catch (_) {}
  }

  try {
    const r = await fetch(
      `${FALLBACK_URL}/latest?from=${meta.base}&to=${meta.quote}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (r.ok) {
      const data = await r.json();
      const rate = data.rates?.[meta.quote];
      if (rate) {
        return res.json({ price: rate, source: 'frankfurter.app (ECB)', date: data.date });
      }
    }
  } catch (_) {}

  return res.status(503).json({ error: 'Price feed unavailable. Check your connection.' });
}
