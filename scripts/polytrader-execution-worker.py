#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import signal
import time
import traceback
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from py_clob_client.client import ClobClient
from py_clob_client.clob_types import ApiCreds, MarketOrderArgs, OrderType
from py_clob_client.order_builder.constants import BUY

STOP_REQUESTED = False


def _request_stop(_sig, _frame):
    global STOP_REQUESTED
    STOP_REQUESTED = True


signal.signal(signal.SIGTERM, _request_stop)
signal.signal(signal.SIGINT, _request_stop)


DEFAULT_STATE = {
    "version": 1,
    "createdAt": None,
    "lastCycleAt": None,
    "lastStatus": "booting",
    "positions": [],
    "events": [],
    "equityCurve": [],
    "lastTradeByMarket": {},
    "dailyUnrealizedPnl": {},
    "dailyRealizedPnl": {},
    "initialEquityUsd": None,
}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def day_key_from_ts(ts: int | None = None) -> str:
    dt = datetime.fromtimestamp(ts or int(time.time()), tz=timezone.utc)
    return dt.strftime("%Y-%m-%d")


def to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        f = float(value)
        if math.isfinite(f):
            return f
    except Exception:
        pass
    return fallback


def clamp(value: float, min_value: float, max_value: float) -> float:
    return min(max_value, max(min_value, value))


def parse_json_array(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if not isinstance(value, str) or not value.strip():
        return []
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def bool_env(name: str, default: bool = False) -> bool:
    raw = str(os.getenv(name, "" if not default else "true")).strip().lower()
    return raw in {"1", "true", "yes", "on"}


def float_env(name: str, default: float) -> float:
    return to_float(os.getenv(name), default)


def int_env(name: str, default: int) -> int:
    try:
        return int(float(os.getenv(name, str(default))))
    except Exception:
        return default


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        if key in os.environ:
            continue
        os.environ[key] = value.strip().strip('"').strip("'")


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        state = dict(DEFAULT_STATE)
        state["createdAt"] = utc_now_iso()
        return state
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(parsed, dict):
            raise ValueError("invalid_state")
        state = dict(DEFAULT_STATE)
        state.update(parsed)
        state.setdefault("positions", [])
        state.setdefault("events", [])
        state.setdefault("equityCurve", [])
        state.setdefault("lastTradeByMarket", {})
        state.setdefault("dailyUnrealizedPnl", {})
        state.setdefault("dailyRealizedPnl", {})
        return state
    except Exception:
        state = dict(DEFAULT_STATE)
        state["createdAt"] = utc_now_iso()
        state["lastStatus"] = "state_recovered_after_parse_error"
        return state


def save_state(path: Path, state: dict[str, Any]) -> None:
    ensure_parent(path)
    path.write_text(json.dumps(state, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def append_event(path: Path, event: dict[str, Any]) -> None:
    ensure_parent(path)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False) + "\n")


def prune_state(state: dict[str, Any], max_events: int = 800, max_equity_points: int = 1200) -> None:
    events = state.get("events")
    if isinstance(events, list) and len(events) > max_events:
        state["events"] = events[-max_events:]

    points = state.get("equityCurve")
    if isinstance(points, list) and len(points) > max_equity_points:
        state["equityCurve"] = points[-max_equity_points:]


@dataclass
class Config:
    enabled: bool
    armed_live: bool
    cycle_seconds: int
    data_dir: Path
    state_path: Path
    events_path: Path
    clob_host: str
    gamma_host: str
    chain_id: int
    signature_type: int
    private_key: str
    funder_address: str
    api_key: str
    api_secret: str
    api_passphrase: str
    profile_address: str
    max_trade_usd: float
    max_daily_loss_usd: float
    max_open_positions: int
    market_cooldown_seconds: int
    min_edge: float
    min_confidence: float
    edge_scale: float
    market_limit: int
    live_start_equity_usd: float


def build_config() -> Config:
    data_dir = Path(
        os.getenv("POLYTRADER_DATA_DIR")
        or os.getenv("IDEAS_DATA_DIR")
        or str(Path(__file__).resolve().parents[1] / ".data")
    ).expanduser()

    state_path = Path(os.getenv("POLYTRADER_STATE_PATH") or data_dir / "polytrader-live-state.json").expanduser()
    events_path = Path(os.getenv("POLYTRADER_EVENTS_PATH") or data_dir / "polytrader-live-events.jsonl").expanduser()

    return Config(
        enabled=bool_env("POLYTRADER_EXECUTION_ENGINE_ENABLED", False),
        armed_live=bool_env("POLYTRADER_ARM_LIVE", False),
        cycle_seconds=max(15, int_env("POLYTRADER_CYCLE_SECONDS", 45)),
        data_dir=data_dir,
        state_path=state_path,
        events_path=events_path,
        clob_host=str(os.getenv("POLYTRADER_CLOB_HOST") or "https://clob.polymarket.com").strip(),
        gamma_host=str(os.getenv("POLYTRADER_GAMMA_HOST") or "https://gamma-api.polymarket.com").strip(),
        chain_id=max(1, int_env("POLYTRADER_CHAIN_ID", 137)),
        signature_type=max(0, int_env("POLYTRADER_SIGNATURE_TYPE", 0)),
        private_key=str(os.getenv("POLYTRADER_PRIVATE_KEY") or "").strip(),
        funder_address=str(
            os.getenv("POLYTRADER_FUNDER_ADDRESS")
            or os.getenv("POLYTRADER_WALLET_ADDRESS")
            or ""
        ).strip(),
        api_key=str(os.getenv("POLYMARKET_API_KEY") or "").strip(),
        api_secret=str(os.getenv("POLYMARKET_API_SECRET") or "").strip(),
        api_passphrase=str(os.getenv("POLYMARKET_API_PASSPHRASE") or "").strip(),
        profile_address=str(
            os.getenv("POLYTRADER_PROFILE_ADDRESS")
            or os.getenv("POLYTRADER_USER_PROFILE_ADDRESS")
            or os.getenv("POLYTRADER_WALLET_ADDRESS")
            or ""
        ).strip(),
        max_trade_usd=max(1.0, float_env("POLYTRADER_MAX_TRADE_USD", 10.0)),
        max_daily_loss_usd=max(1.0, float_env("POLYTRADER_MAX_DAILY_LOSS_USD", 30.0)),
        max_open_positions=max(1, int_env("POLYTRADER_MAX_OPEN_POSITIONS", 12)),
        market_cooldown_seconds=max(60, int_env("POLYTRADER_MARKET_COOLDOWN_SECONDS", 7200)),
        min_edge=max(0.0001, float_env("POLYTRADER_MIN_EDGE", 0.015)),
        min_confidence=clamp(float_env("POLYTRADER_MIN_CONFIDENCE", 0.62), 0.5, 0.99),
        edge_scale=max(0.001, float_env("POLYTRADER_EDGE_SCALE", 0.05)),
        market_limit=max(10, int_env("POLYTRADER_MARKET_LIMIT", 80)),
        live_start_equity_usd=max(1.0, float_env("POLYTRADER_LIVE_START_EQUITY_USD", 1000.0)),
    )


def fetch_markets(cfg: Config) -> list[dict[str, Any]]:
    response = requests.get(
        f"{cfg.gamma_host}/markets",
        params={
            "active": "true",
            "closed": "false",
            "limit": str(cfg.market_limit),
            "order": "volume",
            "ascending": "false",
        },
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json()
    return payload if isinstance(payload, list) else []


def build_signals(markets: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, float]]:
    rows: list[dict[str, Any]] = []
    price_by_token: dict[str, float] = {}

    for market in markets:
        question = str(market.get("question") or "").strip()
        if not question:
            continue

        outcomes = [str(item) for item in parse_json_array(market.get("outcomes"))]
        prices = [to_float(item, float("nan")) for item in parse_json_array(market.get("outcomePrices"))]
        token_ids = [str(item) for item in parse_json_array(market.get("clobTokenIds"))]
        if len(prices) < 2 or len(token_ids) < 2:
            continue
        if not math.isfinite(prices[0]) or not math.isfinite(prices[1]):
            continue

        yes_price = clamp(prices[0], 0.001, 0.999)
        no_price = clamp(prices[1], 0.001, 0.999)

        best_bid = to_float(market.get("bestBid"), float("nan"))
        best_ask = to_float(market.get("bestAsk"), float("nan"))
        spread = (best_ask - best_bid) if (math.isfinite(best_bid) and math.isfinite(best_ask) and best_ask >= best_bid) else 0.0

        probability_distance = abs(0.5 - yes_price)
        edge_magnitude = spread * 0.5 + probability_distance * 0.25
        signal_side = "YES" if yes_price <= 0.5 else "NO"
        signed_edge = edge_magnitude if signal_side == "YES" else -edge_magnitude
        fair_yes = clamp(yes_price + signed_edge, 0.01, 0.99)

        volume_24h = to_float(market.get("volume24hr"), 0.0)
        confidence = clamp(0.5 + abs(signed_edge) * 2.2 + math.log10(volume_24h + 1) * 0.08, 0.5, 0.99)

        token_index = 0 if signal_side == "YES" else 1
        token_id = token_ids[token_index]
        side_price = yes_price if signal_side == "YES" else no_price
        outcome_label = outcomes[token_index] if token_index < len(outcomes) else signal_side

        price_by_token[token_ids[0]] = yes_price
        price_by_token[token_ids[1]] = no_price

        rows.append(
            {
                "market_id": str(market.get("id") or market.get("slug") or question),
                "slug": str(market.get("slug") or ""),
                "market": question,
                "signal_side": signal_side,
                "outcome_label": outcome_label,
                "token_id": token_id,
                "market_price": side_price,
                "yes_price": yes_price,
                "fair_yes": fair_yes,
                "edge": signed_edge,
                "confidence": confidence,
                "volume24hr": volume_24h,
            }
        )

    rows.sort(key=lambda row: abs(row["edge"]), reverse=True)
    return rows, price_by_token


def compute_unrealized_pnl(state: dict[str, Any], price_by_token: dict[str, float]) -> float:
    total = 0.0
    positions = state.get("positions") if isinstance(state.get("positions"), list) else []

    for pos in positions:
        if str(pos.get("status") or "open").lower() != "open":
            continue
        token_id = str(pos.get("tokenId") or "")
        mark_price = to_float(price_by_token.get(token_id), float("nan"))
        if not math.isfinite(mark_price):
            continue
        shares = to_float(pos.get("shares"), 0.0)
        cost = to_float(pos.get("amountUsd"), 0.0)
        market_value = shares * mark_price
        unrealized = market_value - cost
        pos["markPrice"] = mark_price
        pos["unrealizedPnlUsd"] = round(unrealized, 6)
        total += unrealized

    return float(round(total, 6))


def pick_candidate(signals: list[dict[str, Any]], state: dict[str, Any], cfg: Config, now_ts: int) -> dict[str, Any] | None:
    last_trade_by_market = state.get("lastTradeByMarket") if isinstance(state.get("lastTradeByMarket"), dict) else {}
    open_token_ids = {
        str(pos.get("tokenId") or "")
        for pos in (state.get("positions") if isinstance(state.get("positions"), list) else [])
        if str(pos.get("status") or "open").lower() == "open"
    }

    for signal in signals:
        if abs(to_float(signal.get("edge"), 0.0)) < cfg.min_edge:
            continue
        if to_float(signal.get("confidence"), 0.0) < cfg.min_confidence:
            continue

        market_id = str(signal.get("market_id") or "")
        last_ts = int(to_float(last_trade_by_market.get(market_id), 0)) if market_id else 0
        if market_id and now_ts - last_ts < cfg.market_cooldown_seconds:
            continue

        token_id = str(signal.get("token_id") or "")
        if token_id in open_token_ids:
            continue

        return signal

    return None


def resolve_fill_price(response: dict[str, Any], fallback_price: float) -> float:
    if not isinstance(response, dict):
        return fallback_price

    candidate_keys = [
        "avgPrice",
        "averagePrice",
        "takingPrice",
        "price",
    ]

    for key in candidate_keys:
        value = to_float(response.get(key), float("nan"))
        if math.isfinite(value) and value > 0:
            return value

    order = response.get("order")
    if isinstance(order, dict):
        for key in candidate_keys:
            value = to_float(order.get(key), float("nan"))
            if math.isfinite(value) and value > 0:
                return value

    return fallback_price


def ensure_client(cfg: Config) -> ClobClient:
    client = ClobClient(
        cfg.clob_host,
        chain_id=cfg.chain_id,
        key=cfg.private_key,
        signature_type=cfg.signature_type,
        funder=cfg.funder_address,
    )

    if cfg.api_key and cfg.api_secret and cfg.api_passphrase:
        client.set_api_creds(ApiCreds(cfg.api_key, cfg.api_secret, cfg.api_passphrase))
    else:
        # If explicit API creds are not provided, derive them from signer.
        client.set_api_creds(client.create_or_derive_api_creds())

    return client


def trade_size_usd(cfg: Config, edge: float) -> float:
    scaler = clamp(abs(edge) / cfg.edge_scale, 0.5, 1.0)
    return round(clamp(cfg.max_trade_usd * scaler, 1.0, cfg.max_trade_usd), 2)


def normalize_state(state: dict[str, Any], cfg: Config) -> None:
    if not state.get("createdAt"):
        state["createdAt"] = utc_now_iso()
    if not isinstance(state.get("positions"), list):
        state["positions"] = []
    if not isinstance(state.get("events"), list):
        state["events"] = []
    if not isinstance(state.get("equityCurve"), list):
        state["equityCurve"] = []
    if not isinstance(state.get("lastTradeByMarket"), dict):
        state["lastTradeByMarket"] = {}
    if not isinstance(state.get("dailyUnrealizedPnl"), dict):
        state["dailyUnrealizedPnl"] = {}
    if not isinstance(state.get("dailyRealizedPnl"), dict):
        state["dailyRealizedPnl"] = {}

    if not math.isfinite(to_float(state.get("initialEquityUsd"), float("nan"))):
        state["initialEquityUsd"] = cfg.live_start_equity_usd


def update_equity_curve(state: dict[str, Any], now_ts: int, unrealized_pnl: float) -> None:
    initial_equity = to_float(state.get("initialEquityUsd"), 1000.0)
    today = day_key_from_ts(now_ts)
    realized_today = to_float(state.get("dailyRealizedPnl", {}).get(today), 0.0)
    est_equity = initial_equity + realized_today + unrealized_pnl

    points = state.get("equityCurve") if isinstance(state.get("equityCurve"), list) else []
    points.append({"timestamp": now_ts, "value": round(est_equity, 6)})
    state["equityCurve"] = points


def run_cycle(cfg: Config, state: dict[str, Any], client_holder: dict[str, Any]) -> None:
    now_ts = int(time.time())
    day = day_key_from_ts(now_ts)

    try:
        markets = fetch_markets(cfg)
    except Exception as exc:
        state["lastCycleAt"] = utc_now_iso()
        state["lastStatus"] = f"fetch_markets_error: {exc}"
        return

    signals, price_by_token = build_signals(markets)
    unrealized_pnl = compute_unrealized_pnl(state, price_by_token)
    state["dailyUnrealizedPnl"][day] = round(unrealized_pnl, 6)

    open_positions = [
        row
        for row in state.get("positions", [])
        if str(row.get("status") or "open").lower() == "open"
    ]

    if not cfg.enabled:
        state["lastStatus"] = "disabled: set POLYTRADER_EXECUTION_ENGINE_ENABLED=true"
    elif not cfg.armed_live:
        state["lastStatus"] = "disarmed: set POLYTRADER_ARM_LIVE=true"
    elif not cfg.private_key:
        state["lastStatus"] = "missing_private_key: set POLYTRADER_PRIVATE_KEY"
    elif to_float(state["dailyUnrealizedPnl"].get(day), 0.0) <= -cfg.max_daily_loss_usd:
        state["lastStatus"] = f"kill_switch: unrealized {state['dailyUnrealizedPnl'][day]:.2f} <= -{cfg.max_daily_loss_usd:.2f}"
    elif len(open_positions) >= cfg.max_open_positions:
        state["lastStatus"] = f"open_position_cap_reached: {len(open_positions)} >= {cfg.max_open_positions}"
    else:
        candidate = pick_candidate(signals, state, cfg, now_ts)

        if not candidate:
            state["lastStatus"] = "idle: no eligible signal"
        else:
            try:
                if client_holder.get("client") is None:
                    client_holder["client"] = ensure_client(cfg)

                size_usd = trade_size_usd(cfg, to_float(candidate.get("edge"), 0.0))

                order_args = MarketOrderArgs(
                    token_id=str(candidate["token_id"]),
                    amount=float(size_usd),
                    side=BUY,
                    order_type=OrderType.FOK,
                )

                signed = client_holder["client"].create_market_order(order_args)
                response = client_holder["client"].post_order(signed, OrderType.FOK)

                fill_price = resolve_fill_price(response if isinstance(response, dict) else {}, to_float(candidate.get("market_price"), 0.5))
                shares = size_usd / max(fill_price, 1e-6)
                order_id = str(
                    (response.get("orderID") if isinstance(response, dict) else None)
                    or (response.get("orderId") if isinstance(response, dict) else None)
                    or (response.get("id") if isinstance(response, dict) else None)
                    or uuid.uuid4().hex
                )

                event = {
                    "timestamp": now_ts,
                    "isoTime": datetime.fromtimestamp(now_ts, tz=timezone.utc).isoformat(),
                    "type": "TRADE",
                    "side": "BUY",
                    "signalSide": candidate["signal_side"],
                    "title": candidate["market"],
                    "outcome": candidate["outcome_label"],
                    "price": round(fill_price, 6),
                    "sizeUsd": size_usd,
                    "pnlUsd": None,
                    "txHash": order_id,
                    "marketId": candidate["market_id"],
                    "slug": candidate["slug"],
                    "tokenId": candidate["token_id"],
                    "edge": round(to_float(candidate.get("edge"), 0.0), 6),
                    "confidence": round(to_float(candidate.get("confidence"), 0.0), 6),
                }

                position = {
                    "id": order_id,
                    "status": "open",
                    "openedAt": now_ts,
                    "marketId": candidate["market_id"],
                    "slug": candidate["slug"],
                    "tokenId": candidate["token_id"],
                    "market": candidate["market"],
                    "outcome": candidate["outcome_label"],
                    "signalSide": candidate["signal_side"],
                    "amountUsd": size_usd,
                    "entryPrice": round(fill_price, 6),
                    "shares": round(shares, 8),
                    "edge": round(to_float(candidate.get("edge"), 0.0), 6),
                }

                state["events"].append(event)
                state["positions"].append(position)
                state["lastTradeByMarket"][str(candidate["market_id"])] = now_ts
                append_event(cfg.events_path, event)
                state["lastStatus"] = (
                    f"executed: {candidate['market']} [{candidate['signal_side']}] ${size_usd:.2f} @ {fill_price:.4f}"
                )

            except Exception as exc:
                # If creds became stale, rebuild client next cycle.
                client_holder["client"] = None
                state["lastStatus"] = f"order_error: {exc}"
                error_event = {
                    "timestamp": now_ts,
                    "isoTime": datetime.fromtimestamp(now_ts, tz=timezone.utc).isoformat(),
                    "type": "ERROR",
                    "message": str(exc),
                    "trace": traceback.format_exc(limit=4),
                }
                append_event(cfg.events_path, error_event)

    update_equity_curve(state, now_ts, unrealized_pnl)
    prune_state(state)
    state["lastCycleAt"] = utc_now_iso()


def main() -> int:
    load_env_file(Path("/home/kendra/.openclaw/.env.polytrader"))
    cfg = build_config()

    state = load_state(cfg.state_path)
    normalize_state(state, cfg)

    once = "--once" in set(os.sys.argv[1:])
    client_holder: dict[str, Any] = {"client": None}

    while not STOP_REQUESTED:
        normalize_state(state, cfg)
        run_cycle(cfg, state, client_holder)
        save_state(cfg.state_path, state)

        if once:
            break

        sleep_left = cfg.cycle_seconds
        while sleep_left > 0 and not STOP_REQUESTED:
            time.sleep(1)
            sleep_left -= 1

    save_state(cfg.state_path, state)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
