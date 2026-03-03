import Link from 'next/link';
import { notFound } from 'next/navigation';
import styles from '../ideas.module.css';
import { getIdeaById } from '../../../lib/ideas';

export const dynamic = 'force-dynamic';

function formatDate(value) {
  if (!value) return '--';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default async function IdeaDetailPage({ params }) {
  const idea = getIdeaById(params.id);
  if (!idea) notFound();

  return (
    <main className={styles.page}>
      <Link href="/ideas" className={styles.backLink}>← Back to Ideas</Link>

      <article className={styles.detailCard}>
        <h1 className={styles.title}>{idea.title}</h1>
        <p className={styles.subtitle}>{idea.description || 'No description yet.'}</p>

        <div className={styles.detailGrid}>
          <div className={styles.kv}><strong>Status</strong>{idea.status || 'new'}</div>
          <div className={styles.kv}><strong>Source</strong>{idea.source || 'web'}</div>
          <div className={styles.kv}><strong>Source date</strong>{formatDate(idea.source_date)}</div>
          <div className={styles.kv}><strong>Reality score</strong>{idea.reality_score || 0}/5</div>
          <div className={styles.kv}><strong>Edge score</strong>{idea.edge_score || 0}/9</div>
          <div className={styles.kv}><strong>Cycle focus</strong>{idea.cycle_focus || '--'}</div>
          <div className={styles.kv}><strong>Created</strong>{formatDate(idea.created_at)}</div>
          <div className={styles.kv}><strong>Updated</strong>{formatDate(idea.updated_at)}</div>
          <div className={styles.kv}><strong>Battlestation ID</strong>{idea.battlestation_id || '--'}</div>
          <div className={styles.kv}><strong>Source URL</strong>{idea.source_url ? <a className={styles.link} href={idea.source_url} target="_blank" rel="noopener noreferrer">{idea.source_url}</a> : '--'}</div>
        </div>

        <div className={styles.report}>
          <p className={styles.reportTitle}>Pain Signals</p>
          {Array.isArray(idea.pain_signals) && idea.pain_signals.length ? (
            <ul>
              {idea.pain_signals.map((signal, idx) => (
                <li key={`${idea.id}-pain-${idx}`}>{signal}</li>
              ))}
            </ul>
          ) : (
            <p className={styles.description}>No pain signals captured.</p>
          )}

          <p className={styles.reportTitle}>Edge Reason</p>
          <p className={styles.description}>{idea.edge_reason || 'No edge reason captured.'}</p>
        </div>
      </article>
    </main>
  );
}
