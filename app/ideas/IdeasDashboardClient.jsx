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
  { key: 'rejected', label: 'Not Interested', query: { status: 'rejected', sort: 'updated_at' } }
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
  if (status === 'rejected') return styles.statusRejected;
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
      setIdeas(Array.isArray(data.ideas) ? data.ideas : []);
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
      setIdeas((prev) => prev.map((idea) => (idea.id === id ? data.idea : idea)));
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusyMap((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function approveIdea(id) {
    setBusyMap((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/ideas/${id}/approve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || 'approve failed');
      setIdeas((prev) => prev.map((idea) => (idea.id === id ? data.idea : idea)));
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusyMap((prev) => ({ ...prev, [id]: false }));
    }
  }

  function toggleExpand(id) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function runDropdownAction(id, value) {
    if (!value) return;
    if (value === 'chat') {
      window.open(TELEGRAM_SPARKY_TOPIC, '_blank', 'noopener,noreferrer');
      return;
    }
    if (value === 'archive') {
      patchIdea(id, { status: 'rejected' });
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
            Sparky&apos;s scored opportunities from X, Reddit, and web scans. Review, react, and push promising ideas to Battlestation.
          </p>
        </div>
        <input
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title + description"
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
                    {busy ? 'Pushing...' : 'Push to Battlestation'}
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
                    <option value="archive">Archive</option>
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
                    data-active={idea.status === 'rejected'}
                    disabled={busy}
                    onClick={() => patchIdea(idea.id, { status: 'rejected' })}
                  >
                    👎 Not Interested
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
