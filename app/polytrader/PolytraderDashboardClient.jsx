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
  tradeMarkers: [],
  backtest: null,
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
const CHART_WIDTH = 1000;
const CHART_HEIGHT = 560;
const CHART_PAD = 18;

function isAddress(value) {
  return /^0x[0-9a-f]{40}$/i.test(String(value || "").trim());
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

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

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function buildChartMeta(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const minTime = rows[0].timestamp;
  const maxTime = rows[rows.length - 1].timestamp;
  const minValue = Math.min(...rows.map((row) => row.value));
  const maxValue = Math.max(...rows.map((row) => row.value));

  return {
    minTime,
    maxTime,
    minValue,
    maxValue,
    timeSpan: Math.max(1, maxTime - minTime),
    valueSpan: Math.max(1e-6, maxValue - minValue)
  };
}

function mapToChart(meta, timestamp, value) {
  const x = CHART_PAD + ((timestamp - meta.minTime) / meta.timeSpan) * (CHART_WIDTH - CHART_PAD * 2);
  const y = CHART_HEIGHT - CHART_PAD - ((value - meta.minValue) / meta.valueSpan) * (CHART_HEIGHT - CHART_PAD * 2);
  return { x, y };
}

function findNearestPoint(rows, targetTimestamp) {
  if (!rows.length) return null;
  let nearest = rows[0];
  let distance = Math.abs(rows[0].timestamp - targetTimestamp);
  for (let i = 1; i < rows.length; i += 1) {
    const nextDistance = Math.abs(rows[i].timestamp - targetTimestamp);
    if (nextDistance < distance) {
      nearest = rows[i];
      distance = nextDistance;
    }
  }
  return nearest;
}

function buildChartPath(points) {
  const rows = normalizeSeries(points);

  if (rows.length < 2) return "";
  const meta = buildChartMeta(rows);
  if (!meta) return "";

  return rows
    .map((row, index) => {
      const { x, y } = mapToChart(meta, row.timestamp, row.value);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function buildMarkerDots(points, markers = []) {
  const rows = normalizeSeries(points);
  if (rows.length < 2 || !Array.isArray(markers) || markers.length === 0) return [];
  const meta = buildChartMeta(rows);
  if (!meta) return [];

  return markers
    .map((marker, index) => {
      const ts = Number(marker?.timestamp || 0);
      const value = Number(marker?.value || 0);
      if (!Number.isFinite(ts) || !Number.isFinite(value)) return null;
      if (ts < meta.minTime || ts > meta.maxTime) return null;
      const { x, y } = mapToChart(meta, ts, value);
      return {
        key: `${ts}-${index}`,
        timestamp: ts,
        value,
        x,
        y,
        pnlUsd: Number(marker?.pnlUsd || 0)
      };
    })
    .filter(Boolean);
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
  const [mode, setMode] = useState("live");
  const [chartMode, setChartMode] = useState("linear");
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastSwitchAt, setLastSwitchAt] = useState(null);
  const [hoverPoint, setHoverPoint] = useState(null);

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
  const tradeMarkers = Array.isArray(snapshot?.tradeMarkers) ? snapshot.tradeMarkers : [];
  const backtest = snapshot?.backtest || null;
  const account = snapshot?.account || {};
  const execution = snapshot?.execution || {};
  const profileAddress = account?.profileAddress || snapshot?.profileAddress || "—";
  const walletAddress = account?.walletAddress || snapshot?.walletAddress || "—";
  const profileLink = isAddress(profileAddress)
    ? `https://polymarket.com/profile/${profileAddress}`
    : "https://polymarket.com";
  const walletLink = isAddress(walletAddress)
    ? `https://polygonscan.com/address/${walletAddress}`
    : "https://polygonscan.com";

  const chartSeries = useMemo(
    () => transformChartSeries({
      mode: chartMode,
      equity: snapshot?.equity,
      executionLog,
      openPositions: stats.openPositions
    }),
    [chartMode, snapshot?.equity, executionLog, stats.openPositions]
  );
  const chartRows = useMemo(() => normalizeSeries(chartSeries), [chartSeries]);
  const chartMeta = useMemo(() => buildChartMeta(chartRows), [chartRows]);
  const chartPath = useMemo(() => buildChartPath(chartRows), [chartRows]);
  const markerDots = useMemo(
    () => (chartMode === "linear" ? buildMarkerDots(chartRows, tradeMarkers) : []),
    [chartMode, chartRows, tradeMarkers]
  );
  const startPoint = useMemo(() => {
    if (!chartMeta || chartRows.length < 1) return null;
    const start = chartRows[0];
    const coords = mapToChart(chartMeta, start.timestamp, start.value);
    return { ...start, ...coords };
  }, [chartMeta, chartRows]);
  const grossPnlUsd = useMemo(() => {
    if (backtest && Number.isFinite(Number(backtest?.pnlUsd))) {
      return Number(backtest.pnlUsd);
    }
    if (chartRows.length >= 2) {
      return Number(chartRows[chartRows.length - 1].value) - Number(chartRows[0].value);
    }
    return null;
  }, [backtest, chartRows]);
  const grossPnlPct = useMemo(() => {
    if (backtest && Number.isFinite(Number(backtest?.returnPct))) {
      return Number(backtest.returnPct);
    }
    if (chartRows.length >= 2) {
      const start = Number(chartRows[0].value);
      const end = Number(chartRows[chartRows.length - 1].value);
      return start > 0 ? (end - start) / start : null;
    }
    return null;
  }, [backtest, chartRows]);
  const tooltipBox = useMemo(() => {
    if (!hoverPoint) return null;
    const width = 220;
    const height = 44;
    const x = Math.min(CHART_WIDTH - width - 8, Math.max(8, hoverPoint.x + 8));
    const y = Math.min(CHART_HEIGHT - height - 8, Math.max(8, hoverPoint.y - height - 8));
    return { x, y, width, height };
  }, [hoverPoint]);

  function onChartMove(event) {
    if (!chartMeta || chartRows.length < 2) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const x = ((event.clientX - bounds.left) / bounds.width) * CHART_WIDTH;
    const ratio = clamp((x - CHART_PAD) / (CHART_WIDTH - CHART_PAD * 2), 0, 1);
    const targetTimestamp = chartMeta.minTime + ratio * chartMeta.timeSpan;
    const nearest = findNearestPoint(chartRows, targetTimestamp);
    if (!nearest) return;
    const coords = mapToChart(chartMeta, nearest.timestamp, nearest.value);
    setHoverPoint({ ...nearest, ...coords });
  }

  function onChartLeave() {
    setHoverPoint(null);
  }

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
          title="gross pnl (total)"
          value={grossPnlUsd === null ? "—" : formatSignedUsd(grossPnlUsd)}
          sub={grossPnlPct === null ? "from equity baseline" : formatPct(grossPnlPct)}
          isDanger={Number(grossPnlUsd) < 0}
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
        <StatCard
          title="paper 60d backtest"
          value={backtest ? formatUsd(backtest.endEquityUsd) : "—"}
          sub={backtest ? `start ${formatUsd(backtest.startEquityUsd)} · ${formatPct(backtest.returnPct)} · ${backtest.totalTrades} trades` : "no backtest data"}
          isDanger={Boolean(backtest && Number(backtest.returnPct) < 0)}
        />
      </section>

      <section className={styles.sessionStrip}>
        <div className={styles.sessionItem}>
          <span>account</span>
          <strong>{account?.label || "polytrader"}</strong>
        </div>
        <div className={styles.sessionItem}>
          <span>profile</span>
          <strong className={styles.addressValue} title={profileAddress}>{profileAddress}</strong>
          <a className={styles.inlineLink} href={profileLink} target="_blank" rel="noreferrer">open profile</a>
        </div>
        <div className={styles.sessionItem}>
          <span>wallet</span>
          <strong className={styles.addressValue} title={walletAddress}>{walletAddress}</strong>
          <a className={styles.inlineLink} href={walletLink} target="_blank" rel="noreferrer">open wallet</a>
        </div>
        <div className={styles.sessionItem}>
          <span>engine</span>
          <strong className={execution?.canSubmitLiveOrders ? styles.execArmed : styles.execMonitor}>
            {execution?.status || (isLive ? "monitor_only" : "paper")}
          </strong>
          <a className={styles.inlineLink} href="https://polymarket.com" target="_blank" rel="noreferrer">login polymarket</a>
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
                {startPoint ? (
                  <g className={styles.startMarker}>
                    <circle cx={startPoint.x} cy={startPoint.y} r="3.3" className={styles.startDot} />
                    <text x={Math.min(startPoint.x + 8, CHART_WIDTH - 130)} y={Math.max(18, startPoint.y - 8)} className={styles.startLabel}>
                      START {formatUsd(startPoint.value)}
                    </text>
                  </g>
                ) : null}
                {markerDots.map((dot) => (
                  <circle
                    key={dot.key}
                    cx={dot.x}
                    cy={dot.y}
                    r="2.8"
                    className={dot.pnlUsd >= 0 ? styles.tradeWin : styles.tradeLoss}
                  />
                ))}
                {hoverPoint && tooltipBox ? (
                  <g className={styles.hoverLayer}>
                    <line x1={hoverPoint.x} y1={CHART_PAD} x2={hoverPoint.x} y2={CHART_HEIGHT - CHART_PAD} className={styles.hoverLine} />
                    <circle cx={hoverPoint.x} cy={hoverPoint.y} r="4.2" className={styles.hoverDot} />
                    <rect x={tooltipBox.x} y={tooltipBox.y} width={tooltipBox.width} height={tooltipBox.height} rx="4" className={styles.hoverBox} />
                    <text x={tooltipBox.x + 8} y={tooltipBox.y + 17} className={styles.hoverText}>
                      {formatDateTime(new Date(hoverPoint.timestamp * 1000))}
                    </text>
                    <text x={tooltipBox.x + 8} y={tooltipBox.y + 34} className={styles.hoverValue}>
                      {formatUsd(hoverPoint.value)}
                    </text>
                  </g>
                ) : null}
                <rect
                  x="0"
                  y="0"
                  width={CHART_WIDTH}
                  height={CHART_HEIGHT}
                  className={styles.chartHitArea}
                  onMouseMove={onChartMove}
                  onMouseLeave={onChartLeave}
                />
              </svg>
            ) : (
              <div className={styles.chartEmpty}>No equity history available yet.</div>
            )}
          </div>

          <p className={styles.switchMeta}>
            {lastSwitchAt ? `last mode switch: ${formatTime(lastSwitchAt)} · ` : ""}view: {chartMode} · feed profile:{" "}
            {profileAddress}
            {backtest ? ` · 60d paper: ${formatUsd(backtest.startEquityUsd)} → ${formatUsd(backtest.endEquityUsd)}` : ""}
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
                    <span className={Number(entry.pnlUsd) >= 0 ? styles.tradeWinText : styles.tradeLossText}>
                      {Number.isFinite(Number(entry.pnlUsd)) ? formatSignedUsd(entry.pnlUsd) : "—"}
                    </span>
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
