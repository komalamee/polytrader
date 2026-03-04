'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import styles from './ideas.module.css';

const TELEGRAM_SPARKY_TOPIC = 'https://t.me/c/3703177695/765';

const TABS = [
  { key: 'new', label: 'New', query: { status: 'new', sort: 'created_at' } },
  { key: 'for-you', label: 'For You', query: { sort: 'edge_score' } },
  { key: 'interested', label: 'Interested', query: { status: 'interested', sort: 'updated_at' } },
  { key: 'saved', label: 'Saved', query: { status: 'saved', sort: 'updated_at' } },
  { key: 'building', label: 'Building', query: { status: 'building', sort: 'updated_at' } },
  { key: 'archived', label: 'Archive', query: { status: 'archived', sort: 'updated_at' } }
];

function scoreClass(value, max) {
  const n = Number(value || 0);
  if (n >= Math.ceil(max * 0.7)) return styles.good;
  if (n >= Math.ceil(max * 0.4)) return styles.mid;
  return styles.low;
}

function statusClass(status) {
  if (status === 'interested') return styles.statusInterested;
  if (status === 'saved') return styles.statusSaved;
  if (status === 'building') return styles.statusBuilding;
  if (status === 'archived') return styles.statusArchived;
  return styles.statusNew;
}

function sourceBadgeClass(source) {
  if (source === 'x') return styles.sourceX;
  if (source === 'reddit') return styles.sourceReddit;
  return styles.sourceWeb;
}

function formatDate(value) {
  if (!value) return 'Unknown date';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function IdeasDashboardClient() {
  const [tab, setTab] = useState('new');
  const [query, setQuery] = useState('');
  const [ideas, setIdeas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState({});
  const [busyMap, setBusyMap] = useState({});
  const [noteMap, setNoteMap] = useState({});

  const activeTab = useMemo(() => TABS.find((x) => x.key === tab) || TABS[0], [tab]);

  async function loadIdeas() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        limit: '120',
        ...(activeTab.query || {}),
        ...(query.trim() ? { q: query.trim() } : {})
      });
      const res = await fetch(`/api/ideas?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || 'failed to load ideas');

      const list = Array.isArray(data.ideas) ? data.ideas : [];
      setIdeas(list);
      setNoteMap((prev) => {
        const next = { ...prev };
        for (const idea of list) {
          if (next[idea.id] === undefined) {
            next[idea.id] = idea.feedback_notes || '';
          }
        }
        return next;
      });
    } catch (err) {
      setError(String(err.message || err));
      setIdeas([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const id = setTimeout(loadIdeas, 180);
    return () => clearTimeout(id);
  }, [tab, query]);

  async function patchIdea(id, patch) {
    setBusyMap((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/ideas/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || 'update failed');

      if (data?.idea) {
        setNoteMap((prev) => ({ ...prev, [id]: data.idea.feedback_notes || '' }));
      }

      await loadIdeas();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusyMap((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function approveIdea(id) {
    setBusyMap((prev) => ({ ...prev, [id]: true }));
    try {
      const feedback = (noteMap[id] || '').trim();
      const payload = feedback ? { feedback_notes: feedback } : undefined;

      const res = await fetch(`/api/ideas/${id}/approve`, {
        method: 'POST',
        headers: payload ? { 'Content-Type': 'application/json' } : undefined,
        body: payload ? JSON.stringify(payload) : undefined
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || 'approve failed');

      if (data?.idea) {
        setNoteMap((prev) => ({ ...prev, [id]: data.idea.feedback_notes || '' }));
      }

      await loadIdeas();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusyMap((prev) => ({ ...prev, [id]: false }));
    }
  }

  function toggleExpand(id) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function setIdeaNote(id, value) {
    setNoteMap((prev) => ({ ...prev, [id]: value }));
  }

  function saveFeedback(id) {
    patchIdea(id, { feedback_notes: noteMap[id] || '' });
  }

  function disapproveIdea(id) {
    patchIdea(id, {
      status: 'archived',
      feedback_notes: noteMap[id] || ''
    });
  }

  function runDropdownAction(id, value) {
    if (!value) return;
    if (value === 'chat') {
      window.open(TELEGRAM_SPARKY_TOPIC, '_blank', 'noopener,noreferrer');
      return;
    }
    if (value === 'archive') {
      disapproveIdea(id);
      return;
    }
    if (value === 'assign-researcher') {
      patchIdea(id, { status: 'interested' });
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Ideas Dashboard</h1>
          <p className={styles.subtitle}>
            Sparky&apos;s scored opportunities from X, Reddit, and web scans. Review, approve, archive, and keep feedback notes for better future sourcing.
          </p>
        </div>
        <input
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title + description + feedback"
          aria-label="Search ideas"
        />
      </div>

      <div className={styles.tabs}>
        {TABS.map((item) => (
          <button
            key={item.key}
            className={styles.tab}
            data-active={item.key === tab}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? <div className={styles.error}>Error: {error}</div> : null}

      {loading ? <p className={styles.loader}>Loading ideas...</p> : null}

      {!loading && ideas.length === 0 ? (
        <div className={styles.empty}>No ideas found in this filter yet.</div>
      ) : null}

      <div className={styles.list}>
        {ideas.map((idea) => {
          const painSignals = Array.isArray(idea.pain_signals) ? idea.pain_signals : [];
          const isExpanded = Boolean(expanded[idea.id]);
          const busy = Boolean(busyMap[idea.id]);
          const note = noteMap[idea.id] ?? idea.feedback_notes ?? '';

          return (
            <article key={idea.id} className={styles.card}>
              <div className={styles.topRow}>
                <div>
                  <h2 className={styles.cardTitle}>{idea.title}</h2>
                  <div className={styles.meta}>
                    <span className={`${styles.badge} ${sourceBadgeClass(idea.source)}`}>{idea.source || 'web'}</span>
                    <span>{formatDate(idea.source_date || idea.created_at)}</span>
                    <span className={`${styles.statusPill} ${statusClass(idea.status)}`}>{idea.status || 'new'}</span>
                  </div>
                </div>

                <div className={styles.scoreWrap}>
                  <div className={styles.score}>
                    <span>Reality</span>
                    <span className={`${styles.scoreValue} ${scoreClass(idea.reality_score, 5)}`}>
                      {idea.reality_score || 0}/5
                    </span>
                  </div>
                  <div className={styles.score}>
                    <span>Edge</span>
                    <span className={`${styles.scoreValue} ${scoreClass(idea.edge_score, 9)}`}>
                      {idea.edge_score || 0}/9
                    </span>
                  </div>
                </div>
              </div>

              <p className={styles.description}>{idea.description || 'No description yet.'}</p>

              <div className={styles.actionsRow}>
                <div className={styles.leftActions}>
                  <button className={`${styles.btn} ${styles.btnGhost}`} onClick={() => toggleExpand(idea.id)}>
                    {isExpanded ? 'Hide Report' : 'View Report'}
                  </button>
                  <button className={styles.btn} disabled={busy} onClick={() => approveIdea(idea.id)}>
                    {busy ? 'Pushing...' : 'Approve → Battlestation'}
                  </button>

                  <select
                    className={styles.select}
                    defaultValue=""
                    onChange={(e) => {
                      runDropdownAction(idea.id, e.target.value);
                      e.target.value = '';
                    }}
                  >
                    <option value="">More</option>
                    <option value="chat">Chat with Sparky</option>
                    <option value="archive">Disapprove + Archive</option>
                    <option value="assign-researcher">Assign to Researcher</option>
                  </select>
                </div>

                <div className={styles.rightActions}>
                  <button
                    className={`${styles.btn} ${styles.reaction}`}
                    data-active={idea.status === 'interested'}
                    disabled={busy}
                    onClick={() => patchIdea(idea.id, { status: 'interested' })}
                  >
                    👍 Interested
                  </button>
                  <button
                    className={`${styles.btn} ${styles.reaction}`}
                    data-active={idea.status === 'archived'}
                    disabled={busy}
                    onClick={() => disapproveIdea(idea.id)}
                  >
                    👎 Disapprove
                  </button>
                  <button
                    className={`${styles.btn} ${styles.reaction}`}
                    data-active={idea.status === 'saved'}
                    disabled={busy}
                    onClick={() => patchIdea(idea.id, { status: 'saved' })}
                  >
                    🔖 Save
                  </button>
                  <button
                    className={`${styles.btn} ${styles.reaction}`}
                    data-active={idea.status === 'building'}
                    disabled={busy}
                    onClick={() => patchIdea(idea.id, { status: 'building' })}
                  >
                    🚀 Building
                  </button>
                </div>
              </div>

              <div className={styles.feedbackRow}>
                <textarea
                  className={styles.feedbackInput}
                  rows={2}
                  placeholder="Feedback notes (why approved/disapproved). Used to improve future idea sourcing."
                  value={note}
                  disabled={busy}
                  onChange={(e) => setIdeaNote(idea.id, e.target.value)}
                />
                <button className={`${styles.btn} ${styles.btnGhost}`} disabled={busy} onClick={() => saveFeedback(idea.id)}>
                  Save Note
                </button>
              </div>

              {isExpanded ? (
                <div className={styles.report}>
                  <p className={styles.reportTitle}>Source</p>
                  {idea.source_url ? (
                    <a href={idea.source_url} target="_blank" rel="noopener noreferrer" className={styles.link}>
                      {idea.source_url}
                    </a>
                  ) : (
                    <p className={styles.description}>No source URL attached.</p>
                  )}

                  <p className={styles.reportTitle}>Pain Signals</p>
                  {painSignals.length ? (
                    <ul>
                      {painSignals.map((signal, idx) => (
                        <li key={`${idea.id}-signal-${idx}`}>{signal}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.description}>No pain signals captured.</p>
                  )}

                  <p className={styles.reportTitle}>Edge Analysis</p>
                  <p className={styles.description}>{idea.edge_reason || 'No edge reason yet.'}</p>

                  <p className={styles.reportTitle}>Feedback Notes</p>
                  <p className={styles.description}>{note || 'No feedback notes yet.'}</p>

                  <p className={styles.reportTitle}>Cycle Focus</p>
                  <p className={styles.description}>{idea.cycle_focus || 'n/a'}</p>

                  <Link href={`/ideas/${idea.id}`} className={styles.link}>Open full detail →</Link>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </main>
  );
}
