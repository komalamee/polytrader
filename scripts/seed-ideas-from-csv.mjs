import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/seed-ideas-from-csv.mjs <csv-file>');
  process.exit(1);
}

const absolutePath = path.resolve(process.cwd(), inputPath);
if (!fs.existsSync(absolutePath)) {
  console.error(`CSV file not found: ${absolutePath}`);
  process.exit(1);
}

const dbPath = path.join(process.cwd(), '.data', 'ideas.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS ideas (
    id               TEXT PRIMARY KEY,
    title            TEXT NOT NULL,
    description      TEXT,
    source           TEXT,
    source_url       TEXT,
    source_date      TEXT,
    pain_signals     TEXT,
    reality_score    INTEGER DEFAULT 0,
    edge_score       INTEGER DEFAULT 0,
    edge_reason      TEXT,
    cycle_focus      TEXT,
    status           TEXT DEFAULT 'new',
    battlestation_id TEXT,
    feedback_notes   TEXT DEFAULT '',
    created_at       TEXT DEFAULT (datetime('now')),
    updated_at       TEXT DEFAULT (datetime('now'))
  );
`);

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

const raw = fs.readFileSync(absolutePath, 'utf8').replace(/\r\n/g, '\n').trim();
if (!raw) {
  console.error('CSV is empty');
  process.exit(1);
}

const lines = raw.split('\n').filter(Boolean);
const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
const rows = lines.slice(1).map(parseCsvLine);

const pick = (record, key, fallback = '') => {
  const idx = headers.indexOf(key);
  return idx >= 0 ? String(record[idx] || '').trim() : fallback;
};

const insert = db.prepare(`
  INSERT INTO ideas (
    id, title, description, source, source_url, source_date, pain_signals,
    reality_score, edge_score, edge_reason, cycle_focus, status,
    battlestation_id, feedback_notes, created_at, updated_at
  ) VALUES (
    @id, @title, @description, @source, @source_url, @source_date, @pain_signals,
    @reality_score, @edge_score, @edge_reason, @cycle_focus, @status,
    @battlestation_id, @feedback_notes, @created_at, @updated_at
  )
`);

let inserted = 0;
let skipped = 0;
const now = () => new Date().toISOString();

for (const row of rows) {
  const title = pick(row, 'title');
  if (!title) {
    skipped += 1;
    continue;
  }

  const source = pick(row, 'source', 'web').toLowerCase() || 'web';
  const status = (pick(row, 'status', 'new').toLowerCase() || 'new').replace('rejected', 'archived');
  const painSignalsRaw = pick(row, 'pain_signals');
  const painSignals = painSignalsRaw
    ? painSignalsRaw.split('|').map((x) => x.trim()).filter(Boolean)
    : [];

  const item = {
    id: `idea_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title,
    description: pick(row, 'description'),
    source,
    source_url: pick(row, 'source_url'),
    source_date: pick(row, 'source_date', now()),
    pain_signals: JSON.stringify(painSignals),
    reality_score: Number(pick(row, 'reality_score', 0)) || 0,
    edge_score: Number(pick(row, 'edge_score', 0)) || 0,
    edge_reason: pick(row, 'edge_reason'),
    cycle_focus: pick(row, 'cycle_focus'),
    status,
    battlestation_id: pick(row, 'battlestation_id') || null,
    feedback_notes: pick(row, 'feedback_notes'),
    created_at: now(),
    updated_at: now()
  };

  insert.run(item);
  inserted += 1;
}

console.log(`Seed complete. inserted=${inserted} skipped=${skipped} db=${dbPath}`);
