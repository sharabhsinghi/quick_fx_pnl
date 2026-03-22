import { getDb } from '../../../lib/db';

export default function handler(req, res) {
  const { id } = req.query;
  if (!id || isNaN(Number(id))) {
    return res.status(400).json({ error: 'Invalid trade id' });
  }

  const db = getDb();

  if (req.method === 'DELETE') {
    db.prepare('DELETE FROM trades WHERE id = ?').run(Number(id));
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
