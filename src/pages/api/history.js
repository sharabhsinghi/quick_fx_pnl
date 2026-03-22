import { getDb } from '../../lib/db';

export default function handler(req, res) {
  const db = getDb();

  if (req.method === 'GET') {
    const rows = db.prepare('SELECT * FROM history ORDER BY closedAt DESC').all();
    const history = rows.map(row => ({ ...row, meta: JSON.parse(row.meta) }));
    return res.json(history);
  }

  if (req.method === 'POST') {
    const { key, meta, side, entry, sl, tp, lotSize, openedAt, closedAt, closePrice, pips, plUsd, notes } = req.body;
    if (
      !key || !meta || !side || entry == null || sl == null || tp == null || lotSize == null ||
      !openedAt || !closedAt || closePrice == null || pips == null || plUsd == null
    ) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const stmt = db.prepare(`
      INSERT INTO history (key, side, entry, sl, tp, lotSize, openedAt, closedAt, closePrice, pips, plUsd, meta, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      String(key), String(side),
      Number(entry), Number(sl), Number(tp), Number(lotSize),
      String(openedAt), String(closedAt),
      Number(closePrice), Number(pips), Number(plUsd),
      JSON.stringify(meta), String(notes || '')
    );
    return res.status(201).json({ id: Number(result.lastInsertRowid) });
  }

  if (req.method === 'DELETE') {
    db.prepare('DELETE FROM history').run();
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
