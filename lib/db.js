import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const DATA_DIR = path.join(process.cwd(), '.data');
const DB_PATH = path.join(DATA_DIR, 'ideas.db');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
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
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
    CREATE INDEX IF NOT EXISTS idx_ideas_edge_score ON ideas(edge_score DESC);
    CREATE INDEX IF NOT EXISTS idx_ideas_created_at ON ideas(created_at DESC);
  `);
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
