import Database from 'better-sqlite3';
import path from 'path';

let db;

export function getDb() {
  if (!db) {
    const dbPath = path.join(process.cwd(), 'forex-tracker.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        key      TEXT    NOT NULL,
        side     TEXT    NOT NULL,
        entry    REAL    NOT NULL,
        sl       REAL    NOT NULL,
        tp       REAL    NOT NULL,
        lotSize  REAL    NOT NULL,
        openedAt TEXT    NOT NULL,
        meta     TEXT    NOT NULL,
        notes    TEXT    NOT NULL DEFAULT '',
        checklist TEXT   NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        key        TEXT    NOT NULL,
        side       TEXT    NOT NULL,
        entry      REAL    NOT NULL,
        sl         REAL    NOT NULL,
        tp         REAL    NOT NULL,
        lotSize    REAL    NOT NULL,
        openedAt   TEXT    NOT NULL,
        closedAt   TEXT    NOT NULL,
        closePrice REAL    NOT NULL,
        pips       REAL    NOT NULL,
        plUsd      REAL    NOT NULL,
        meta       TEXT    NOT NULL,
        notes      TEXT    NOT NULL DEFAULT ''
      );
    `);
    // Migrations: add columns to existing DBs that predate them
    try { db.exec(`ALTER TABLE history ADD COLUMN notes TEXT NOT NULL DEFAULT ''`); } catch (_) {}
    try { db.exec(`ALTER TABLE trades  ADD COLUMN notes TEXT NOT NULL DEFAULT ''`); } catch (_) {}
    try { db.exec(`ALTER TABLE trades  ADD COLUMN checklist TEXT NOT NULL DEFAULT '[]'`); } catch (_) {}

    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('account_size',     '10000')`).run();
    db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('account_currency', 'USD')`).run();
  }
  return db;
}
