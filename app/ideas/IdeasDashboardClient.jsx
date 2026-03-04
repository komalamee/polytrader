'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import styles from './ideas.module.css';

const TELEGRAM_SPARKY_TOPIC = 'https://t.me/c/3703177695/765';
const PAGE_SIZE = 20;

const TABS = [
  { key: 'new', label: 'New', query: { status: 'new', sort: 'created_at' } },
  { key: 'for-you', label: 'For You', query: { sort: 'edge_score' } },
  { key: 'interested', label: 'Interested', query: { status: 'interested', sort: 'updated_at' } },
  { key: 'saved', label: 'Saved', query: { status: 'saved', sort: 'updated_at' } },
  { key: 'building', label: 'Building', query: { status: 'building', sort: 'updated_at' } },
  { key: 'archived', label: 'Archive', query: { status: 'archived', sort: 'updated_at' } }
];

const SORT_OPTIONS = [
  { key: 'created_at', label: 'Newest' },
  { key: 'updated_at', label: 'Recently updated' },
  { key: 'edge_score', label: 'Highest edge score' },
  { key: 'reality_score', label: 'Highest reality score' }
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

function compactTelemetry(telemetry) {
  if (!telemetry) return '';
  const status = telemetry.upstreamStatus ?? 'n/a';
  const duration = telemetry.durationMs ?? '--';
  const proposal = telemetry.proposalId ? ` · proposal ${telemetry.proposalId}` : '';
  return `Approve telemetry: upstream ${status}, ${duration}ms${proposal}`;
}

export default function IdeasDashboardClient() {
  const [tab, setTab] = useState('new');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('created_at');
  const [page, setPage] = useState(1);
  const [ideas, setIdeas] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [expanded, setExpanded] = useState({});
  const [busyMap, setBusyMap] = useState({});
  const [noteMap, setNoteMap] = useState({});
  const [reportMap, setReportMap] = useState({});
  const [reportLoadingMap, setReportLoadingMap] = useState({});

  const activeTab = useMemo(() => TABS.find((x) => x.key === tab) || TABS[0], [tab]);
  const totalPages = Math.max(1, Math.ceil((total || 0) / PAGE_SIZE));
  const offset = (page - 1) * PAGE_SIZE;

  useEffect(() => {
    const defaultSort = activeTab?.query?.sort || 'created_at';
    setSort(defaultSort);
    setPage(1);
  }, [tab]);

  async function loadIdeas() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort,
        ...(activeTab.query?.status ? { status: activeTab.query.status } : {}),
        ...(query.trim() ? { q: query.trim() } : {})
      });
      const res = await fetch(`/api/ideas?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || 'failed to load ideas');

      const list = Array.isArray(data.ideas) ? data.ideas : [];
      setIdeas(list);
      setTotal(Number(data.total || list.length || 0));
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
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const id = setTimeout(loadIdeas, 180);
    return () => clearTimeout(id);
  }, [tab, query, sort, page]);

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
    setInfo('');

    try {
      const feedback = (noteMap[id] || '').trim();
      const payload = feedback ? { feedback_notes: feedback } : undefined;

      const res = await fetch(`/api/ideas/${id}/approve`, {
        method: 'POST',
        headers: payload ? { 'Content-Type': 'application/json' } : undefined,
        body: payload ? JSON.stringify(payload) : undefined
      });
      const data = await res.json();
      if (!res.ok) {
        const telemetryText = compactTelemetry(data?.telemetry);
        throw new Error([data?.detail || data?.error || 'approve failed', telemetryText].filter(Boolean).join(' | '));
      }

      if (data?.idea) {
        setNoteMap((prev) => ({ ...prev, [id]: data.idea.feedback_notes || '' }));
      }

      const telemetryText = compactTelemetry(data?.telemetry);
      if (telemetryText) setInfo(telemetryText);

      await loadIdeas();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusyMap((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function assignToResearcher(id) {
    setBusyMap((prev) => ({ ...prev, [id]: true }));
    setInfo('');
    setError('');

    try {
      const res = await fetch(`/api/ideas/${id}/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.detail || data?.error || 'failed to queue research');
      }

      if (data?.alreadyQueued) {
        setInfo(`Research already queued for this idea (${data.battlestation_id}). Check "View Report".`);
      } else {
        setInfo(`Research queued! Battlestation ID: ${data.battlestation_id}. Report will be ready in a few minutes.`);
      }

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

  async function fetchReport(id) {
    setReportLoadingMap((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await fetch(`/api/ideas/${id}/report`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        setReportMap((prev) => ({ ...prev, [id]: { status: 'error', message: data?.detail || data?.error || 'Failed to load report' } }));
        return;
      }
      setReportMap((prev) => ({ ...prev, [id]: data }));
    } catch (err) {
      setReportMap((prev) => ({ ...prev, [id]: { status: 'error', message: String(err.message || err) } }));
    } finally {
      setReportLoadingMap((prev) => ({ ...prev, [id]: false }));
    }
  }

  function toggleExpand(id) {
    const next = !expanded[id];
    setExpanded((prev) => ({ ...prev, [id]: next }));
    if (next && !reportMap[id]) {
      fetchReport(id);
    }
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
      assignToResearcher(id);
    }
  }

  function onSearchChange(next) {
    setQuery(next);
    setPage(1);
  }

  function onSortChange(nextSort) {
    setSort(nextSort);
    setPage(1);
  }

  function renderReport(id, idea) {
    const reportLoading = reportLoadingMap[id];
    const reportData = reportMap[id];

    if (reportLoading) {
      return <p className={styles.description}>Loading report...</p>;
    }

    if (!reportData) {
      return (
        <div>
          <p className={styles.reportTitle}>Report</p>
          <p className={styles.description}>Click &quot;View Report&quot; to load research data.</p>
        </div>
      );
    }

    if (reportData.status === 'no_research') {
      const painSignals = Array.isArray(idea.pain_signals) ? idea.pain_signals : [];
      return (
        <div>
          <p className={styles.reportTitle}>No Research Yet</p>
          <p className={styles.description}>{reportData.message}</p>

          {idea.source_url ? (
            <>
              <p className={styles.reportTitle}>Source</p>
              <a href={idea.source_url} target="_blank" rel="noopener noreferrer" className={styles.link}>
                {idea.source_url}
              </a>
            </>
          ) : null}

          {painSignals.length ? (
            <>
              <p className={styles.reportTitle}>Pain Signals</p>
              <ul>{painSignals.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </>
          ) : null}

          {idea.edge_reason ? (
            <>
              <p className={styles.reportTitle}>Edge Analysis</p>
              <p className={styles.description}>{idea.edge_reason}</p>
            </>
          ) : null}
        </div>
      );
    }

    if (reportData.status === 'pending') {
      return (
        <div>
          <p className={styles.reportTitle}>Research In Progress</p>
          <p className={styles.description}>{reportData.message}</p>
          <p className={styles.description}>Battlestation ID: <code>{reportData.battlestation_id}</code></p>
        </div>
      );
    }

    if (reportData.status === 'error') {
      return (
        <div>
          <p className={styles.reportTitle}>Report Error</p>
          <p className={styles.description}>{reportData.message}</p>
        </div>
      );
    }

    if (reportData.status === 'ready') {
      const sc = reportData.scorecard;
      return (
        <div>
          {sc ? (
            <div className={styles.scorecardRow}>
              <span>Score: <strong>{sc.score ?? '—'}/100</strong></span>
              <span>Confidence: <strong>{sc.confidence ? `${Math.round(sc.confidence * 100)}%` : '—'}</strong></span>
              <span className={styles.recommendation}>{sc.recommendation ?? ''}</span>
            </div>
          ) : null}
          <p className={styles.reportTitle}>Full Research Report</p>
          <pre className={styles.reportContent}>{reportData.report}</pre>
          <Link href={`/ideas/${id}`} className={styles.link}>Open full detail →</Link>
        </div>
      );
    }

    return null;
  }

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Ideas Dashboard</h1>
          <p className={styles.subtitle}>
            Sparky&apos;s scored opportunities from X, Reddit, and web scans. Assign to Researcher for full market analysis, then approve or pass.
          </p>
        </div>
        <input
          className={styles.search}
          value={query}
          onChange={(e) => onSearchChange(e.target.value)}
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

      <div className={styles.controlsRow}>
        <label className={styles.controlItem}>
          Sort
          <select className={styles.select} value={sort} onChange={(e) => onSortChange(e.target.value)}>
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>
        </label>
        <div className={styles.paginationMeta}>
          Showing {ideas.length ? offset + 1 : 0}-{Math.min(offset + ideas.length, total)} of {total}
        </div>
      </div>

      {error ? <div className={styles.error}>Error: {error}</div> : null}
      {info ? <div className={styles.info}>{info}</div> : null}

      {loading ? <p className={styles.loader}>Loading ideas...</p> : null}

      {!loading && ideas.length === 0 ? (
        <div className={styles.empty}>No ideas found in this filter yet.</div>
      ) : null}

      <div className={styles.list}>
        {ideas.map((idea) => {
          const isExpanded = Boolean(expanded[idea.id]);
          const busy = Boolean(busyMap[idea.id]);
          const note = noteMap[idea.id] ?? idea.feedback_notes ?? '';
          const hasResearch = Boolean(idea.battlestation_id);

          return (
            <article key={idea.id} className={styles.card}>
              <div className={styles.topRow}>
                <div>
                  <h2 className={styles.cardTitle}>{idea.title}</h2>
                  <div className={styles.meta}>
                    <span className={`${styles.badge} ${sourceBadgeClass(idea.source)}`}>{idea.source || 'web'}</span>
                    <span>{formatDate(idea.source_date || idea.created_at)}</span>
                    <span className={`${styles.statusPill} ${statusClass(idea.status)}`}>{idea.status || 'new'}</span>
                    {hasResearch ? <span className={styles.researchBadge}>Research queued</span> : null}
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
                    {busy && busyMap[idea.id] ? 'Pushing...' : 'Approve → Battlestation'}
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
                    <option value="assign-researcher">
                      {hasResearch ? 'Research already queued' : 'Assign to Researcher'}
                    </option>
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
                  {renderReport(idea.id, idea)}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className={styles.paginationRow}>
        <button className={styles.btn} disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          ← Previous
        </button>
        <span className={styles.paginationMeta}>Page {page} / {totalPages}</span>
        <button className={styles.btn} disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
          Next →
        </button>
      </div>
    </main>
  );
}
