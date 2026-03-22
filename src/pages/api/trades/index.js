import { getDb } from '../../../lib/db';

export default function handler(req, res) {
  const db = getDb();

  if (req.method === 'GET') {
    const rows = db.prepare('SELECT * FROM trades ORDER BY openedAt ASC').all();
    const trades = rows.map(row => ({
      ...row,
      meta: JSON.parse(row.meta),
      livePrice: null,
      pips: null,
      plUsd: null,
      lastUpdated: null,
      error: null,
      loading: false,
    }));
    return res.json(trades);
  }

  if (req.method === 'POST') {
    const { key, meta, side, entry, sl, tp, lotSize, openedAt } = req.body;
    if (!key || !meta || !side || entry == null || sl == null || tp == null || lotSize == null || !openedAt) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const stmt = db.prepare(
      'INSERT INTO trades (key, side, entry, sl, tp, lotSize, openedAt, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const result = stmt.run(
      String(key), String(side),
      Number(entry), Number(sl), Number(tp), Number(lotSize),
      String(openedAt), JSON.stringify(meta)
    );
    return res.status(201).json({ id: Number(result.lastInsertRowid) });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
