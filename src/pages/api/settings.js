import { getDb } from '../../lib/db';

const ALLOWED_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'SGD', 'HKD'];

export default function handler(req, res) {
  const db = getDb();

  if (req.method === 'GET') {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return res.json({
      size: parseFloat(map.account_size) || 10000,
      currency: map.account_currency || 'USD',
    });
  }

  if (req.method === 'POST') {
    const { size, currency } = req.body;
    const sizeN = parseFloat(size);
    if (isNaN(sizeN) || sizeN < 0) return res.status(400).json({ error: 'Invalid account size' });
    if (!ALLOWED_CURRENCIES.includes(currency)) return res.status(400).json({ error: 'Unsupported currency' });

    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('account_size', ?)`).run(String(sizeN));
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('account_currency', ?)`).run(String(currency));
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
