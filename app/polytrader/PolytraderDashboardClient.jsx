"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./polytrader.module.css";

const EMPTY_SNAPSHOT = {
  mode: "paper",
  asOf: null,
  risk: {
    maxTradeUsd: 10,
    maxDailyLossUsd: 30,
    killSwitch: "hard stop at -$30 daily realised pnl"
  },
  stats: {
    walletBalanceUsd: 0,
    pnlTodayUsd: 0,
    pnlTodayPct: null,
    totalTrades: 0,
    activeRiskUsd: 0,
    openPositions: 0,
    winRate: null
  },
  signals: [],
  executionLog: [],
  equity: [],
  calcPanels: [],
  diagnostics: {
    warnings: []
  }
};

const CHART_MODES = [
  { id: "linear", label: "linear" },
  { id: "log", label: "log" },
  { id: "drawdown", label: "drawdown" },
  { id: "positions", label: "positions" }
];

function formatUsd(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(n);
}

function formatSignedUsd(value) {
  const n = Number(value || 0);
  const prefix = n > 0 ? "+" : "";
  return `${prefix}${formatUsd(n)}`;
}

function formatPct(value) {
  if (!Number.isFinite(Number(value))) return "—";
  const n = Number(value) * 100;
  const prefix = n > 0 ? "+" : "";
  return `${prefix}${n.toFixed(2)}%`;
}

function formatEdge(value) {
  const n = Number(value || 0);
  const prefix = n > 0 ? "+" : "";
  return `${prefix}${n.toFixed(4)}`;
}

function formatConfidence(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return `${Math.round(Number(value) * 100)}%`;
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function buildChartPath(points) {
  const rows = Array.isArray(points)
    ? points
      .map((point) => ({
        timestamp: Number(point?.timestamp || 0),
        value: Number(point?.value || 0)
      }))
      .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value))
    : [];

  if (rows.length < 2) return "";

  const width = 1000;
  const height = 560;
  const pad = 18;

  const minTime = rows[0].timestamp;
  const maxTime = rows[rows.length - 1].timestamp;
  const minValue = Math.min(...rows.map((row) => row.value));
  const maxValue = Math.max(...rows.map((row) => row.value));

  const timeSpan = Math.max(1, maxTime - minTime);
  const valueSpan = Math.max(1e-6, maxValue - minValue);

  return rows
    .map((row, index) => {
      const x = pad + ((row.timestamp - minTime) / timeSpan) * (width - pad * 2);
      const y = height - pad - ((row.value - minValue) / valueSpan) * (height - pad * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function normalizeSeries(points) {
  return Array.isArray(points)
    ? points
      .map((point) => ({
        timestamp: Number(point?.timestamp || 0),
        value: Number(point?.value || 0)
      }))
      .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value))
      .sort((a, b) => a.timestamp - b.timestamp)
    : [];
}

function buildPositionsSeries(executionLog = [], fallbackSeries = [], fallbackOpenPositions = 0) {
  const rows = Array.isArray(executionLog)
    ? executionLog
      .map((entry) => {
        const ts = Number(entry?.timestamp || 0);
        const side = String(entry?.side || "").toUpperCase();
        const usd = Number(entry?.sizeUsd || 0);
        return Number.isFinite(ts) && Number.isFinite(usd)
          ? { timestamp: ts, side, sizeUsd: usd }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.timestamp - b.timestamp)
    : [];

  if (rows.length >= 2) {
    let running = 0;
    return rows.map((row) => {
      if (row.side === "BUY") running += row.sizeUsd;
      if (row.side === "SELL") running -= row.sizeUsd;
      return {
        timestamp: row.timestamp,
        value: running
      };
    });
  }

  if (fallbackSeries.length >= 2) {
    const open = Number(fallbackOpenPositions || 0);
    return fallbackSeries.map((point) => ({ ...point, value: open }));
  }

  return fallbackSeries;
}

function transformChartSeries({ mode, equity, executionLog, openPositions }) {
  const base = normalizeSeries(equity);
  if (base.length < 2) return base;

  if (mode === "log") {
    return base.map((row) => ({
      ...row,
      value: Math.log10(Math.max(row.value, 1e-6))
    }));
  }

  if (mode === "drawdown") {
    let peak = -Infinity;
    return base.map((row) => {
      peak = Math.max(peak, row.value);
      const drawdown = peak > 0 ? (row.value - peak) / peak : 0;
      return { ...row, value: drawdown };
    });
  }

  if (mode === "positions") {
    return buildPositionsSeries(executionLog, base, openPositions);
  }

  return base;
}

function StatCard({ title, value, sub, isDanger = false }) {
  return (
    <article className={styles.statCard}>
      <p className={styles.statTitle}>{title}</p>
      <strong className={isDanger ? styles.danger : styles.statValue}>{value}</strong>
      <small className={styles.statSub}>{sub}</small>
    </article>
  );
}

export default function PolytraderDashboardClient() {
  const [mode, setMode] = useState("paper");
  const [chartMode, setChartMode] = useState("linear");
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastSwitchAt, setLastSwitchAt] = useState(null);

  const isLive = mode === "live";

  useEffect(() => {
    let active = true;

    async function loadSnapshot({ silent = false } = {}) {
      if (!silent) setLoading(true);
      setError("");

      try {
        const response = await fetch(`/api/polytrader?mode=${mode}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.detail || payload?.error || "snapshot_fetch_failed");
        }
        if (active) {
          setSnapshot({ ...EMPTY_SNAPSHOT, ...payload });
        }
      } catch (fetchError) {
        if (active) {
          setError(String(fetchError?.message || fetchError));
        }
      } finally {
        if (active && !silent) {
          setLoading(false);
        }
      }
    }

    loadSnapshot();
    const interval = setInterval(
      () => loadSnapshot({ silent: true }),
      mode === "live" ? 15000 : 45000
    );

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [mode]);

  function switchMode(nextMode) {
    if (nextMode === mode) return;

    if (nextMode === "live") {
      const ok = window.confirm(
        "Arm LIVE mode now? This view will use live Polymarket and wallet data (no mock feed)."
      );
      if (!ok) return;
    }

    setMode(nextMode);
    setLastSwitchAt(new Date().toISOString());
  }

  const stats = snapshot?.stats || EMPTY_SNAPSHOT.stats;
  const risk = snapshot?.risk || EMPTY_SNAPSHOT.risk;
  const signals = Array.isArray(snapshot?.signals) ? snapshot.signals : [];
  const executionLog = Array.isArray(snapshot?.executionLog) ? snapshot.executionLog : [];
  const calcPanels = Array.isArray(snapshot?.calcPanels) ? snapshot.calcPanels : [];
  const account = snapshot?.account || {};
  const execution = snapshot?.execution || {};

  const chartSeries = useMemo(
    () => transformChartSeries({
      mode: chartMode,
      equity: snapshot?.equity,
      executionLog,
      openPositions: stats.openPositions
    }),
    [chartMode, snapshot?.equity, executionLog, stats.openPositions]
  );
  const chartPath = useMemo(() => buildChartPath(chartSeries), [chartSeries]);

  const warningMessages = Array.isArray(snapshot?.diagnostics?.warnings)
    ? snapshot.diagnostics.warnings.filter(Boolean)
    : [];
  const warning = warningMessages[0] || "";

  return (
    <main className={styles.wrap}>
      <header className={styles.topBar}>
        <div className={styles.brand}>
          <span className={styles.dot} />
          <strong>LMSR Bayesian Arb Engine</strong>
          <span className={styles.badge}>{isLive ? "LIVE DATA" : "PAPER"}</span>
          {loading ? <span className={styles.busyDot}>syncing…</span> : null}
        </div>

        <div className={styles.topMeta}>
          <span className={styles.topMetaItem}>
            {isLive ? "CL0B LIVE" : "PAPER SAFE"}
          </span>
          <span className={styles.topMetaItem}>as of {formatTime(snapshot?.asOf)}</span>
          <div className={styles.modeSwitch} role="group" aria-label="execution mode toggle">
            <button type="button" onClick={() => switchMode("paper")} className={!isLive ? styles.active : ""}>
              paper
            </button>
            <button type="button" onClick={() => switchMode("live")} className={isLive ? styles.activeLive : ""}>
              live
            </button>
          </div>
        </div>
      </header>

      <section className={styles.statsRow}>
        <StatCard
          title="wallet equity"
          value={formatUsd(stats.walletBalanceUsd)}
          sub={`stable ${formatUsd(stats.stableBalanceUsd || 0)} · polymarket ${formatUsd(stats.polymarketValueUsd || 0)}`}
        />
        <StatCard
          title="realized pnl (today)"
          value={formatSignedUsd(stats.pnlTodayUsd)}
          sub={formatPct(stats.pnlTodayPct)}
          isDanger={Number(stats.pnlTodayUsd) < 0}
        />
        <StatCard
          title="trades done"
          value={String(stats.totalTrades || 0)}
          sub={Number.isFinite(Number(stats.winRate)) ? `wr ${Math.round(Number(stats.winRate) * 100)}%` : "wr —"}
        />
        <StatCard
          title="active bet risk"
          value={formatUsd(stats.activeRiskUsd)}
          sub={`open ${stats.openPositions || 0} · cap ${formatUsd(risk.maxDailyLossUsd)}`}
          isDanger={Number(stats.activeRiskUsd) > Number(risk.maxDailyLossUsd)}
        />
        <StatCard
          title="execution mode"
          value={isLive ? "LIVE" : "PAPER"}
          sub={isLive ? "real feeds only" : "simulated fills"}
        />
      </section>

      <section className={styles.sessionStrip}>
        <div className={styles.sessionItem}>
          <span>account</span>
          <strong>{account?.label || "polytrader"}</strong>
        </div>
        <div className={styles.sessionItem}>
          <span>profile</span>
          <strong title={account?.profileAddress || snapshot?.profileAddress || "—"}>
            {account?.profileAddress || snapshot?.profileAddress || "—"}
          </strong>
        </div>
        <div className={styles.sessionItem}>
          <span>wallet</span>
          <strong title={account?.walletAddress || snapshot?.walletAddress || "—"}>
            {account?.walletAddress || snapshot?.walletAddress || "—"}
          </strong>
        </div>
        <div className={styles.sessionItem}>
          <span>engine</span>
          <strong className={execution?.canSubmitLiveOrders ? styles.execArmed : styles.execMonitor}>
            {execution?.status || (isLive ? "monitor_only" : "paper")}
          </strong>
        </div>
        <div className={styles.sessionWide}>
          <span>status</span>
          <strong>{execution?.reason || (isLive ? "Live data monitoring only." : "Paper mode active.")}</strong>
        </div>
      </section>

      <section className={styles.board}>
        <aside className={styles.leftRail}>
          {calcPanels.map((panel) => (
            <article key={panel.title} className={styles.panel}>
              <h2>{panel.title}</h2>
              <p className={styles.formula}>{panel.formula}</p>
              <ul className={styles.panelList}>
                {(panel.rows || []).map(([label, value]) => (
                  <li key={label} className={styles.panelRow}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </aside>

        <article className={styles.chartPanel}>
          <div className={styles.chartHead}>
            <p>equity curve · lmsr bayesian strategy</p>
            <div className={styles.headPills}>
              {CHART_MODES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={chartMode === option.id ? styles.pillActive : styles.pill}
                  onClick={() => setChartMode(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.chartArea}>
            {chartPath ? (
              <svg viewBox="0 0 1000 560" className={styles.chartSvg} aria-label="equity curve">
                <defs>
                  <linearGradient id="equityGlow" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#00f583" />
                    <stop offset="100%" stopColor="#8dffd0" />
                  </linearGradient>
                </defs>
                <g className={styles.gridLines}>
                  <line x1="18" y1="120" x2="982" y2="120" />
                  <line x1="18" y1="220" x2="982" y2="220" />
                  <line x1="18" y1="320" x2="982" y2="320" />
                  <line x1="18" y1="420" x2="982" y2="420" />
                </g>
                <path d={chartPath} className={styles.equityGlow} />
                <path d={chartPath} className={styles.equityPath} />
              </svg>
            ) : (
              <div className={styles.chartEmpty}>No equity history available yet.</div>
            )}
          </div>

          <p className={styles.switchMeta}>
            {lastSwitchAt ? `last mode switch: ${formatTime(lastSwitchAt)} · ` : ""}view: {chartMode} · feed profile:{" "}
            {snapshot?.profileAddress || "—"}
          </p>
        </article>

        <aside className={styles.rightRail}>
          <article className={styles.panel}>
            <h2>live inefficiency signals</h2>
            {signals.length === 0 ? (
              <p className={styles.empty}>No live opportunities available from current feed.</p>
            ) : (
              <ul className={styles.signalList}>
                {signals.slice(0, 10).map((signal) => (
                  <li key={signal.id} className={styles.signalRow}>
                    <div className={styles.signalMain}>
                      <span>{signal.market}</span>
                      <small>{signal.side} · conf {formatConfidence(signal.confidence)}</small>
                    </div>
                    <strong className={signal.edge >= 0 ? styles.edgePositive : styles.edgeNegative}>
                      {formatEdge(signal.edge)}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className={styles.panel}>
            <h2>execution log</h2>
            {executionLog.length === 0 ? (
              <p className={styles.empty}>No live executions for this profile address yet.</p>
            ) : (
              <ul className={styles.executionList}>
                {executionLog.slice(0, 14).map((entry) => (
                  <li key={`${entry.timestamp}-${entry.txHash}-${entry.title}`} className={styles.executionRow}>
                    <span>{formatTime(entry.isoTime)}</span>
                    <span>{entry.side || entry.type}</span>
                    <span>{entry.outcome || "—"}</span>
                    <span>{formatUsd(entry.sizeUsd || 0)}</span>
                    <span>{Number.isFinite(Number(entry.price)) ? Number(entry.price).toFixed(4) : "—"}</span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </aside>
      </section>

      <footer className={styles.footerBar}>
        <span>
          risk locks: trade {formatUsd(risk.maxTradeUsd)} · daily loss {formatUsd(risk.maxDailyLossUsd)}
        </span>
        <span>{risk.killSwitch}</span>
      </footer>

      {warning ? <p className={styles.warning}>{warning}</p> : null}
      {error ? <p className={styles.errorText}>{error}</p> : null}
    </main>
  );
}
