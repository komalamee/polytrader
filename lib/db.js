import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DATA_DIR = process.env.IDEAS_DATA_DIR || path.join(process.cwd(), '.data');
const DB_PATH = path.join(DATA_DIR, 'ideas.db');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function hasColumn(db, tableName, columnName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return rows.some((row) => row.name === columnName);
}

function ensureColumn(db, tableName, columnName, ddl) {
  if (hasColumn(db, tableName, columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${ddl}`);
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ideas (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      description     TEXT,
      source          TEXT,
      source_url      TEXT,
      source_date     TEXT,
      pain_signals    TEXT,
      reality_score   INTEGER DEFAULT 0,
      edge_score      INTEGER DEFAULT 0,
      edge_reason     TEXT,
      cycle_focus     TEXT,
      status          TEXT DEFAULT 'new',
      battlestation_id TEXT,
      feedback_notes  TEXT DEFAULT '',
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
    CREATE INDEX IF NOT EXISTS idx_ideas_edge_score ON ideas(edge_score DESC);
    CREATE INDEX IF NOT EXISTS idx_ideas_created_at ON ideas(created_at DESC);
  `);

  ensureColumn(db, 'ideas', 'feedback_notes', "TEXT DEFAULT ''");

  // Legacy compatibility: older records used `rejected`; now we treat this as `archived`.
  db.prepare(`UPDATE ideas SET status = 'archived' WHERE status = 'rejected'`).run();
}

function buildDb() {
  ensureDir(DATA_DIR);
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  initSchema(db);
  return db;
}

const globalForDb = globalThis;

export function getDb() {
  if (!globalForDb.__ideasDb) {
    globalForDb.__ideasDb = buildDb();
  }
  return globalForDb.__ideasDb;
}

export { DB_PATH };
