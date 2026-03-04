import { getDb } from './db';

const ALLOWED_STATUSES = new Set(['new', 'interested', 'saved', 'building', 'archived']);
const ALLOWED_SOURCES = new Set(['x', 'reddit', 'web']);

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return `idea_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function parsePainSignals(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((x) => String(x || '').trim()).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x || '').trim()).filter(Boolean);
    } catch {
      return value.split('\n').map((x) => x.trim()).filter(Boolean);
    }
  }
  return [];
}

function sanitizeScore(value, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.round(n)));
}

function normalizeStatus(status) {
  const next = String(status || 'new').toLowerCase().trim();
  if (next === 'rejected') return 'archived';
  return ALLOWED_STATUSES.has(next) ? next : 'new';
}

function normalizeSource(source) {
  const next = String(source || '').toLowerCase().trim();
  return ALLOWED_SOURCES.has(next) ? next : next || 'web';
}

function sanitizeFeedbackNotes(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function rowToIdea(row) {
  if (!row) return null;
  return {
    ...row,
    status: normalizeStatus(row.status),
    pain_signals: parsePainSignals(row.pain_signals),
    reality_score: Number(row.reality_score || 0),
    edge_score: Number(row.edge_score || 0),
    feedback_notes: sanitizeFeedbackNotes(row.feedback_notes)
  };
}

function buildFilters({ status, q }) {
  const clauses = [];
  const params = {};

  if (status) {
    clauses.push('status = @status');
    params.status = normalizeStatus(status);
  }

  if (q && String(q).trim()) {
    clauses.push('(title LIKE @q OR description LIKE @q OR feedback_notes LIKE @q)');
    params.q = `%${String(q).trim()}%`;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, params };
}

export function listIdeas({ status, sort = 'created_at', limit = 50, offset = 0, q = '' } = {}) {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const { where, params } = buildFilters({ status, q });

  let orderBy = 'created_at DESC';
  if (sort === 'edge_score') orderBy = 'edge_score DESC, created_at DESC';
  if (sort === 'reality_score') orderBy = 'reality_score DESC, created_at DESC';
  if (sort === 'updated_at') orderBy = 'updated_at DESC';

  const rows = db
    .prepare(`SELECT * FROM ideas ${where} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: safeLimit, offset: safeOffset });

  return rows.map(rowToIdea);
}

export function countIdeas({ status, q = '' } = {}) {
  const db = getDb();
  const { where, params } = buildFilters({ status, q });
  const row = db.prepare(`SELECT COUNT(*) as total FROM ideas ${where}`).get(params);
  return Number(row?.total || 0);
}

export function getIdeaById(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ideas WHERE id = ?').get(String(id));
  return rowToIdea(row);
}

export function createIdea(payload = {}) {
  const db = getDb();
  const id = String(payload.id || makeId());
  const title = String(payload.title || '').trim();
  if (!title) throw new Error('title is required');

  const idea = {
    id,
    title,
    description: String(payload.description || '').trim(),
    source: normalizeSource(payload.source),
    source_url: String(payload.source_url || '').trim(),
    source_date: String(payload.source_date || nowIso()),
    pain_signals: JSON.stringify(parsePainSignals(payload.pain_signals)),
    reality_score: sanitizeScore(payload.reality_score, 5),
    edge_score: sanitizeScore(payload.edge_score, 9),
    edge_reason: String(payload.edge_reason || '').trim(),
    cycle_focus: String(payload.cycle_focus || '').trim(),
    status: normalizeStatus(payload.status || 'new'),
    battlestation_id: String(payload.battlestation_id || '').trim() || null,
    feedback_notes: sanitizeFeedbackNotes(payload.feedback_notes || payload.feedback_note),
    created_at: nowIso(),
    updated_at: nowIso()
  };

  db.prepare(`
    INSERT INTO ideas (
      id, title, description, source, source_url, source_date,
      pain_signals, reality_score, edge_score, edge_reason, cycle_focus,
      status, battlestation_id, feedback_notes, created_at, updated_at
    ) VALUES (
      @id, @title, @description, @source, @source_url, @source_date,
      @pain_signals, @reality_score, @edge_score, @edge_reason, @cycle_focus,
      @status, @battlestation_id, @feedback_notes, @created_at, @updated_at
    )
  `).run(idea);

  return getIdeaById(id);
}

export function updateIdeaById(id, patch = {}) {
  const db = getDb();
  const existing = getIdeaById(id);
  if (!existing) return null;

  const next = {
    ...existing,
    title: patch.title !== undefined ? String(patch.title || '').trim() : existing.title,
    description: patch.description !== undefined ? String(patch.description || '').trim() : existing.description,
    source: patch.source !== undefined ? normalizeSource(patch.source) : existing.source,
    source_url: patch.source_url !== undefined ? String(patch.source_url || '').trim() : existing.source_url,
    source_date: patch.source_date !== undefined ? String(patch.source_date || '').trim() : existing.source_date,
    pain_signals: patch.pain_signals !== undefined ? parsePainSignals(patch.pain_signals) : existing.pain_signals,
    reality_score: patch.reality_score !== undefined ? sanitizeScore(patch.reality_score, 5) : existing.reality_score,
    edge_score: patch.edge_score !== undefined ? sanitizeScore(patch.edge_score, 9) : existing.edge_score,
    edge_reason: patch.edge_reason !== undefined ? String(patch.edge_reason || '').trim() : existing.edge_reason,
    cycle_focus: patch.cycle_focus !== undefined ? String(patch.cycle_focus || '').trim() : existing.cycle_focus,
    status: patch.status !== undefined ? normalizeStatus(patch.status) : existing.status,
    battlestation_id:
      patch.battlestation_id !== undefined
        ? (String(patch.battlestation_id || '').trim() || null)
        : (existing.battlestation_id || null),
    feedback_notes:
      patch.feedback_notes !== undefined || patch.feedback_note !== undefined
        ? sanitizeFeedbackNotes(patch.feedback_notes ?? patch.feedback_note)
        : sanitizeFeedbackNotes(existing.feedback_notes),
    updated_at: nowIso()
  };

  if (!next.title) throw new Error('title cannot be empty');

  db.prepare(`
    UPDATE ideas SET
      title = @title,
      description = @description,
      source = @source,
      source_url = @source_url,
      source_date = @source_date,
      pain_signals = @pain_signals,
      reality_score = @reality_score,
      edge_score = @edge_score,
      edge_reason = @edge_reason,
      cycle_focus = @cycle_focus,
      status = @status,
      battlestation_id = @battlestation_id,
      feedback_notes = @feedback_notes,
      updated_at = @updated_at
    WHERE id = @id
  `).run({
    ...next,
    id: String(id),
    pain_signals: JSON.stringify(next.pain_signals || [])
  });

  return getIdeaById(id);
}
