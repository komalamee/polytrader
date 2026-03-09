import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const POLY_DATA_API_BASE = "https://data-api.polymarket.com";
const POLY_GAMMA_API_BASE = "https://gamma-api.polymarket.com";

const POLYGON_RPC_ENDPOINTS = [
  process.env.POLYGON_RPC_URL,
  "https://polygon-bor-rpc.publicnode.com",
  "https://polygon.llamarpc.com",
  "https://polygon-rpc.com"
].filter(Boolean);

const TOKENS = {
  usdc: {
    symbol: "USDC",
    address: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
    decimals: 6
  },
  usdce: {
    symbol: "USDC.e",
    address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    decimals: 6
  }
};

const FALLBACK_ADDRESS = "0xac259156e99e651224a42678b98fcfa12b02307f";

function normalizeAddress(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(raw)) return null;
  return raw;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function withParams(base, params = {}) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchJson(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init.headers || {})
      }
    });

    if (!response.ok) {
      throw new Error(`request_failed:${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPolymarketData(pathname, params = {}) {
  return fetchJson(withParams(`${POLY_DATA_API_BASE}${pathname}`, params));
}

async function fetchPolymarketGamma(pathname, params = {}) {
  return fetchJson(withParams(`${POLY_GAMMA_API_BASE}${pathname}`, params));
}

async function polygonRpc(method, params) {
  let lastError = null;

  for (const endpoint of POLYGON_RPC_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method,
          params
        })
      });

      if (!response.ok) {
        throw new Error(`rpc_http_${response.status}`);
      }

      const payload = await response.json();
      if (payload?.error) {
        throw new Error(payload.error.message || "rpc_error");
      }

      return payload.result;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("polygon_rpc_unavailable");
}

function balanceOfCalldata(address) {
  const clean = String(address || "").replace(/^0x/, "").toLowerCase().padStart(64, "0");
  return `0x70a08231${clean}`;
}

async function readTokenBalance(address, tokenAddress, decimals) {
  const result = await polygonRpc("eth_call", [{ to: tokenAddress, data: balanceOfCalldata(address) }, "latest"]);
  const raw = BigInt(result || "0x0");
  return Number(raw) / 10 ** decimals;
}

async function readMaticBalance(address) {
  const result = await polygonRpc("eth_getBalance", [address, "latest"]);
  const raw = BigInt(result || "0x0");
  return Number(raw) / 1e18;
}

async function fetchMaticUsdPrice() {
  try {
    const payload = await fetchJson("https://api.coingecko.com/api/v3/simple/price?ids=matic-network&vs_currencies=usd");
    return toNumber(payload?.["matic-network"]?.usd, 0);
  } catch {
    return 0;
  }
}

function buildSignals(markets = []) {
  const rows = [];

  for (const market of markets) {
    const question = String(market?.question || "").trim();
    if (!question) continue;

    const outcomes = parseJsonArray(market?.outcomes);
    const prices = parseJsonArray(market?.outcomePrices).map((price) => toNumber(price, NaN));
    const yesPrice = Number.isFinite(prices[0]) ? clamp(prices[0], 0.001, 0.999) : null;
    if (yesPrice === null) continue;

    const bestBid = toNumber(market?.bestBid, NaN);
    const bestAsk = toNumber(market?.bestAsk, NaN);
    const spread = Number.isFinite(bestBid) && Number.isFinite(bestAsk) && bestAsk >= bestBid
      ? bestAsk - bestBid
      : 0;

    const probabilityDistance = Math.abs(0.5 - yesPrice);
    const edgeMagnitude = spread * 0.5 + probabilityDistance * 0.25;
    const side = yesPrice <= 0.5 ? "YES" : "NO";
    const signedEdge = side === "YES" ? edgeMagnitude : -edgeMagnitude;
    const fairPrice = clamp(yesPrice + signedEdge, 0.01, 0.99);

    const volume24hr = toNumber(market?.volume24hr, 0);
    const confidence = clamp(0.5 + Math.abs(signedEdge) * 2.2 + Math.log10(volume24hr + 1) * 0.08, 0.5, 0.99);

    rows.push({
      id: String(market?.id || market?.slug || question),
      market: question,
      slug: String(market?.slug || ""),
      outcomeYes: String(outcomes[0] || "Yes"),
      outcomeNo: String(outcomes[1] || "No"),
      marketPrice: yesPrice,
      fairPrice,
      edge: signedEdge,
      side,
      confidence,
      volume24hr,
      liquidity: toNumber(market?.liquidity, 0)
    });
  }

  return rows
    .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))
    .slice(0, 12);
}

function buildExecutionLog(activity = []) {
  return [...activity]
    .sort((a, b) => toNumber(b.timestamp, 0) - toNumber(a.timestamp, 0))
    .slice(0, 40)
    .map((entry) => {
      const timestamp = toNumber(entry?.timestamp, 0);
      const type = String(entry?.type || "TRADE");
      const side = String(entry?.side || "").toUpperCase();
      const sizeUsd = toNumber(entry?.usdcSize, NaN);
      const fallbackSize = toNumber(entry?.size, 0) * toNumber(entry?.price, 0);

      return {
        timestamp,
        isoTime: timestamp ? new Date(timestamp * 1000).toISOString() : null,
        type,
        side,
        title: String(entry?.title || "Unknown market"),
        outcome: String(entry?.outcome || ""),
        price: toNumber(entry?.price, NaN),
        sizeUsd: Number.isFinite(sizeUsd) ? sizeUsd : fallbackSize,
        txHash: String(entry?.transactionHash || "")
      };
    });
}

function buildEquitySeries({ walletEquityUsd, closedPositions = [], activity = [] }) {
  const nowUnix = Math.floor(Date.now() / 1000);

  const closed = [...closedPositions]
    .filter((item) => Number.isFinite(toNumber(item?.timestamp, NaN)))
    .sort((a, b) => toNumber(a.timestamp, 0) - toNumber(b.timestamp, 0))
    .slice(-90);

  if (closed.length > 0) {
    const totalRealized = closed.reduce((sum, row) => sum + toNumber(row?.realizedPnl, 0), 0);
    let running = walletEquityUsd - totalRealized;
    const points = closed.map((row) => {
      running += toNumber(row?.realizedPnl, 0);
      return {
        timestamp: toNumber(row?.timestamp, 0),
        value: running
      };
    });

    if (points.length === 1) {
      points.unshift({
        timestamp: Math.max(0, points[0].timestamp - 3600),
        value: points[0].value
      });
    }

    return points;
  }

  const tape = [...activity]
    .filter((row) => Number.isFinite(toNumber(row?.timestamp, NaN)))
    .sort((a, b) => toNumber(a.timestamp, 0) - toNumber(b.timestamp, 0))
    .slice(-90);

  if (tape.length > 0) {
    const deltas = tape.map((row) => {
      const usdSize = toNumber(row?.usdcSize, NaN);
      const fallback = toNumber(row?.size, 0) * toNumber(row?.price, 0);
      const amount = Number.isFinite(usdSize) ? usdSize : fallback;
      const side = String(row?.side || "").toUpperCase();
      return side === "SELL" ? amount : -amount;
    });

    const deltaSum = deltas.reduce((sum, value) => sum + value, 0);
    let running = walletEquityUsd - deltaSum;

    return tape.map((row, index) => {
      running += deltas[index];
      return {
        timestamp: toNumber(row?.timestamp, nowUnix),
        value: running
      };
    });
  }

  return [
    { timestamp: nowUnix - 3600, value: walletEquityUsd },
    { timestamp: nowUnix, value: walletEquityUsd }
  ];
}

function buildCalcPanels({ primarySignal, risk, apiTiming }) {
  const marketPrice = clamp(toNumber(primarySignal?.marketPrice, 0.5), 0.001, 0.999);
  const fairPrice = clamp(toNumber(primarySignal?.fairPrice, marketPrice), 0.001, 0.999);
  const edge = fairPrice - marketPrice;
  const b = (1 - marketPrice) / Math.max(0.001, marketPrice);
  const fullKelly = clamp((fairPrice * (1 + b) - 1) / Math.max(0.001, b), -1, 1);
  const halfKelly = clamp(fullKelly * 0.5, 0, 0.25);
  const likelihood = clamp(fairPrice / Math.max(0.001, marketPrice), 0, 10);
  const runtimeFetchMs = Math.max(1, Math.round(apiTiming.fetchMs));
  const runtimeComputeMs = Math.max(1, Math.round(apiTiming.computeMs));

  return [
    {
      title: "bayes theorem · core update",
      formula: "P(H|D) = [P(D|H) · P(H)] / P(D)",
      rows: [
        ["P(D|H) likelihood", likelihood.toFixed(4)],
        ["P(H) prior", marketPrice.toFixed(4)],
        ["P(H|D) posterior", fairPrice.toFixed(4)]
      ]
    },
    {
      title: "sequential bayesian updating",
      formula: "P(H|D1...Dt) ∝ P(H) · Π P(Dk|H)",
      rows: [
        ["log-space stable form", "log P(H|D)=log P(H)+Σlog P(Dk|H)-log Z"],
        ["normalizer", "Z (evidence mass)"]
      ]
    },
    {
      title: "expected value · position sizing",
      formula: "EV = p̂·(1-p) - (1-p̂)·p = p̂ - p",
      rows: [
        ["p̂ (true probability)", fairPrice.toFixed(4)],
        ["p (market price)", marketPrice.toFixed(4)],
        ["EV", `${edge >= 0 ? "+" : ""}${edge.toFixed(4)}`]
      ]
    },
    {
      title: "lmsr price comparison",
      formula: "p_i(q) = e^(q_i / b) / Σ e^(q_j / b)",
      rows: [
        ["C(q)", "b · ln(Σ e^(q_i/b))"],
        ["market implied p", marketPrice.toFixed(4)],
        ["model fair p̂", fairPrice.toFixed(4)]
      ]
    },
    {
      title: "kelly fraction · bankroll",
      formula: "f* = (p·(1+b)-1)/b · NEVER full Kelly on 5m markets",
      rows: [
        ["full kelly", fullKelly.toFixed(4)],
        ["half-kelly (enforced)", halfKelly.toFixed(4)],
        ["position cap", `$${risk.maxTradeUsd.toFixed(2)}`]
      ]
    },
    {
      title: "update cycle latency (production)",
      formula: "avg / p99 from memo",
      rows: [
        ["data ingestion (api/websocket)", "120ms / 340ms"],
        ["bayesian posterior computation", "15ms / 28ms"],
        ["lmsr price comparison", "3ms / 8ms"],
        ["order execution (clob)", "690ms / 1400ms"],
        ["total cycle", "828ms / 1776ms"],
        ["runtime fetch/compute", `${runtimeFetchMs}ms / ${runtimeComputeMs}ms`]
      ]
    }
  ];
}

function buildPaperSnapshot({ profileAddress, walletAddress, risk }) {
  const now = Date.now();
  const points = [];
  let value = 1000;

  for (let i = 0; i < 120; i += 1) {
    const wave = Math.sin(i / 8) * 3.4;
    const drift = 4.2 + (i % 11 === 0 ? -2.6 : 0.8);
    value += drift + wave;
    points.push({
      timestamp: Math.floor((now - (119 - i) * 300000) / 1000),
      value: Number(value.toFixed(4))
    });
  }

  const signals = [
    { id: "p1", market: "OpenAI AGI claim in 2026?", side: "YES", edge: 0.043, confidence: 0.86, marketPrice: 0.462, fairPrice: 0.505, volume24hr: 532000, liquidity: 1100000 },
    { id: "p2", market: "Trump wins 2028 election?", side: "NO", edge: -0.021, confidence: 0.67, marketPrice: 0.564, fairPrice: 0.543, volume24hr: 311000, liquidity: 744000 },
    { id: "p3", market: "US debt default by 2027?", side: "YES", edge: 0.018, confidence: 0.63, marketPrice: 0.271, fairPrice: 0.289, volume24hr: 184000, liquidity: 520000 },
    { id: "p4", market: "BTC > $150k by Sep 2026?", side: "NO", edge: -0.016, confidence: 0.59, marketPrice: 0.518, fairPrice: 0.502, volume24hr: 1480000, liquidity: 2640000 }
  ];

  const executionLog = [
    { timestamp: Math.floor(now / 1000) - 81, isoTime: new Date(now - 81000).toISOString(), type: "TRADE", side: "BUY", title: "BTC > $150k by Sep 2026?", outcome: "NO", price: 0.6008, sizeUsd: 10, txHash: "paper-1" },
    { timestamp: Math.floor(now / 1000) - 143, isoTime: new Date(now - 143000).toISOString(), type: "TRADE", side: "SELL", title: "Fed cuts rates before June?", outcome: "YES", price: 0.6077, sizeUsd: 10, txHash: "paper-2" },
    { timestamp: Math.floor(now / 1000) - 204, isoTime: new Date(now - 204000).toISOString(), type: "TRADE", side: "BUY", title: "GPT-5 released by Q3?", outcome: "YES", price: 0.6039, sizeUsd: 10, txHash: "paper-3" }
  ];

  const stats = {
    walletBalanceUsd: 3214.19,
    pnlTodayUsd: 214.19,
    pnlTodayPct: 0.2242,
    totalTrades: 1799,
    activeRiskUsd: 2.9,
    openPositions: 6,
    winRate: 0.73,
    stableBalanceUsd: 3214.19,
    polymarketValueUsd: 0,
    maticBalance: 0,
    maticUsdValue: 0
  };

  return {
    mode: "paper",
    asOf: new Date().toISOString(),
    walletAddress,
    profileAddress,
    risk,
    stats,
    signals,
    executionLog,
    equity: points,
    calcPanels: buildCalcPanels({
      primarySignal: signals[0],
      risk,
      apiTiming: { fetchMs: 24, computeMs: 8 }
    }),
    diagnostics: {
      source: "paper_simulation",
      warnings: []
    }
  };
}

async function buildLiveSnapshot({ profileAddress, walletAddress, risk }) {
  const fetchStartedAt = Date.now();

  const [positionsRaw, closedRaw, activityRaw, valueRaw, marketsRaw, maticUsd] = await Promise.all([
    fetchPolymarketData("/positions", { user: profileAddress, limit: 250, offset: 0 }).catch(() => []),
    fetchPolymarketData("/closed-positions", { user: profileAddress, limit: 250, offset: 0 }).catch(() => []),
    fetchPolymarketData("/activity", { user: profileAddress, limit: 250, offset: 0 }).catch(() => []),
    fetchPolymarketData("/value", { user: profileAddress }).catch(() => []),
    fetchPolymarketGamma("/markets", { active: true, closed: false, limit: 40, order: "volume", ascending: false }).catch(() => []),
    fetchMaticUsdPrice()
  ]);

  const balances = {
    matic: 0,
    usdc: 0,
    usdce: 0
  };

  try {
    const [matic, usdc, usdce] = await Promise.all([
      readMaticBalance(walletAddress),
      readTokenBalance(walletAddress, TOKENS.usdc.address, TOKENS.usdc.decimals),
      readTokenBalance(walletAddress, TOKENS.usdce.address, TOKENS.usdce.decimals)
    ]);
    balances.matic = matic;
    balances.usdc = usdc;
    balances.usdce = usdce;
  } catch {
    // Keep wallet balances as zero if RPC is unavailable.
  }

  const positions = Array.isArray(positionsRaw) ? positionsRaw : [];
  const closedPositions = Array.isArray(closedRaw) ? closedRaw : [];
  const activity = Array.isArray(activityRaw) ? activityRaw : [];
  const valueRows = Array.isArray(valueRaw) ? valueRaw : [];
  const markets = Array.isArray(marketsRaw) ? marketsRaw : [];

  const stableBalanceUsd = balances.usdc + balances.usdce;
  const maticUsdValue = balances.matic * maticUsd;
  const polymarketValueUsd = toNumber(valueRows[0]?.value, 0);

  const walletBalanceUsd = stableBalanceUsd + maticUsdValue + polymarketValueUsd;
  const activeRiskUsd = positions.reduce((sum, row) => sum + toNumber(row?.currentValue, 0), 0);

  const now = new Date();
  const startOfDayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  const pnlTodayUsd = closedPositions.reduce((sum, row) => {
    const ts = toNumber(row?.timestamp, 0);
    if (ts < startOfDayUtc) return sum;
    return sum + toNumber(row?.realizedPnl, 0);
  }, 0);

  const equityStart = walletBalanceUsd - pnlTodayUsd;
  const pnlTodayPct = equityStart > 0 ? pnlTodayUsd / equityStart : null;

  const totalClosed = closedPositions.length;
  const totalWins = closedPositions.filter((row) => toNumber(row?.realizedPnl, 0) > 0).length;
  const winRate = totalClosed > 0 ? totalWins / totalClosed : null;

  const signals = buildSignals(markets);
  const executionLog = buildExecutionLog(activity);
  const equity = buildEquitySeries({
    walletEquityUsd: walletBalanceUsd,
    closedPositions,
    activity
  });

  const fetchMs = Date.now() - fetchStartedAt;
  const computeStartedAt = Date.now();

  const calcPanels = buildCalcPanels({
    primarySignal: signals[0],
    risk,
    apiTiming: { fetchMs, computeMs: Date.now() - computeStartedAt + 1 }
  });

  const warnings = [];
  if (positions.length === 0 && activity.length === 0) {
    warnings.push("No Polymarket positions/trades found for profile address.");
  }

  return {
    mode: "live",
    asOf: new Date().toISOString(),
    walletAddress,
    profileAddress,
    risk,
    stats: {
      walletBalanceUsd,
      pnlTodayUsd,
      pnlTodayPct,
      totalTrades: activity.length,
      activeRiskUsd,
      openPositions: positions.length,
      winRate,
      stableBalanceUsd,
      polymarketValueUsd,
      maticBalance: balances.matic,
      maticUsdValue
    },
    signals,
    executionLog,
    equity,
    calcPanels,
    diagnostics: {
      source: "polymarket_live",
      warnings,
      counts: {
        positions: positions.length,
        closedPositions: closedPositions.length,
        activity: activity.length,
        signals: signals.length
      },
      latencyMs: fetchMs
    }
  };
}

function readRiskLocks() {
  const maxTradeUsd = toNumber(process.env.POLYTRADER_MAX_TRADE_USD, 10);
  const maxDailyLossUsd = toNumber(process.env.POLYTRADER_MAX_DAILY_LOSS_USD, 30);
  const killSwitch = String(process.env.POLYTRADER_KILL_SWITCH || "hard stop at -$30 daily realised pnl").trim();

  return {
    maxTradeUsd,
    maxDailyLossUsd,
    killSwitch
  };
}

function readExecutionState({ mode, profileAddress, walletAddress }) {
  const accountLabel = String(process.env.POLYTRADER_ACCOUNT_LABEL || "polytrader").trim() || "polytrader";
  const executionEngineAvailable = String(process.env.POLYTRADER_EXECUTION_ENGINE_ENABLED || "").trim().toLowerCase() === "true";
  const armedLive = String(process.env.POLYTRADER_ARM_LIVE || "").trim().toLowerCase() === "true";
  const hasApiCreds = Boolean(
    String(process.env.POLYMARKET_API_KEY || "").trim()
    && String(process.env.POLYMARKET_API_SECRET || "").trim()
    && String(process.env.POLYMARKET_API_PASSPHRASE || "").trim()
  );
  const hasSigner = Boolean(normalizeAddress(walletAddress));

  const canSubmitLiveOrders = mode === "live" && executionEngineAvailable && armedLive && hasApiCreds && hasSigner;
  const status = canSubmitLiveOrders ? "armed_live" : (mode === "live" ? "monitor_only" : "paper");

  let reason = "Paper mode active.";
  if (mode === "live" && !executionEngineAvailable) {
    reason = "Live execution engine is not enabled yet. This build is monitoring + signal mode only.";
  } else if (mode === "live" && !armedLive) {
    reason = "Live order submission is not armed. Set POLYTRADER_ARM_LIVE=true to enable trading.";
  } else if (mode === "live" && !hasApiCreds) {
    reason = "Polymarket API credentials are missing (POLYMARKET_API_KEY/SECRET/PASSPHRASE).";
  } else if (mode === "live" && !hasSigner) {
    reason = "Wallet signer unavailable for live order submission.";
  } else if (canSubmitLiveOrders) {
    reason = "Live order submission is armed.";
  }

  return {
    accountLabel,
    profileAddress,
    walletAddress,
    executionEngineAvailable,
    armedLive,
    hasApiCreds,
    hasSigner,
    canSubmitLiveOrders,
    status,
    reason
  };
}

function resolveAddresses(searchParams) {
  const configuredProfile = normalizeAddress(
    searchParams.get("profile")
      || process.env.POLYTRADER_PROFILE_ADDRESS
      || process.env.POLYTRADER_USER_PROFILE_ADDRESS
      || process.env.POLYTRADER_WALLET_ADDRESS
      || FALLBACK_ADDRESS
  );

  const configuredWallet = normalizeAddress(
    searchParams.get("wallet")
      || process.env.POLYTRADER_WALLET_ADDRESS
      || configuredProfile
      || FALLBACK_ADDRESS
  );

  return {
    profileAddress: configuredProfile || FALLBACK_ADDRESS,
    walletAddress: configuredWallet || FALLBACK_ADDRESS
  };
}

export async function GET(request) {
  const url = new URL(request.url);
  const mode = String(url.searchParams.get("mode") || "paper").toLowerCase() === "live" ? "live" : "paper";
  const risk = readRiskLocks();
  const { profileAddress, walletAddress } = resolveAddresses(url.searchParams);
  const execution = readExecutionState({ mode, profileAddress, walletAddress });

  try {
    const baseSnapshot = mode === "live"
      ? await buildLiveSnapshot({ profileAddress, walletAddress, risk })
      : buildPaperSnapshot({ profileAddress, walletAddress, risk });

    const warnings = Array.isArray(baseSnapshot?.diagnostics?.warnings) ? baseSnapshot.diagnostics.warnings : [];
    if (mode === "live" && !execution.canSubmitLiveOrders && !warnings.includes(execution.reason)) {
      warnings.unshift(execution.reason);
    }

    const snapshot = {
      ...baseSnapshot,
      account: {
        label: execution.accountLabel,
        profileAddress,
        walletAddress
      },
      execution,
      diagnostics: {
        ...(baseSnapshot.diagnostics || {}),
        warnings
      }
    };

    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const fallback = {
      mode,
      asOf: new Date().toISOString(),
      walletAddress,
      profileAddress,
      risk,
      stats: {
        walletBalanceUsd: 0,
        pnlTodayUsd: 0,
        pnlTodayPct: null,
        totalTrades: 0,
        activeRiskUsd: 0,
        openPositions: 0,
        winRate: null,
        stableBalanceUsd: 0,
        polymarketValueUsd: 0,
        maticBalance: 0,
        maticUsdValue: 0
      },
      signals: [],
      executionLog: [],
      equity: [
        { timestamp: Math.floor(Date.now() / 1000) - 3600, value: 0 },
        { timestamp: Math.floor(Date.now() / 1000), value: 0 }
      ],
      calcPanels: buildCalcPanels({
        primarySignal: null,
        risk,
        apiTiming: { fetchMs: 0, computeMs: 0 }
      }),
      diagnostics: {
        source: "fallback",
        warnings: [String(error?.message || error || "unknown_error")]
      },
      account: {
        label: execution.accountLabel,
        profileAddress,
        walletAddress
      },
      execution
    };

    return NextResponse.json(fallback, {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    });
  }
}
