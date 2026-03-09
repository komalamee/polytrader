# PolyTrader Explainer (Plain English)

Last updated: 2026-03-09

## What PolyTrader is trying to do
PolyTrader watches prediction markets, estimates where market prices may be inefficient, and decides whether a trade is worth taking under strict risk limits.

Think of it as:
- "Signal brain" (find potential mispricing)
- "Risk guard" (never exceed limits)
- "Execution hand" (submit order only when safely armed)

## Why the screen looks like this
The dashboard is intentionally split into 3 columns:
- Left: formulas and model internals
- Middle: equity curve + chart modes
- Right: live opportunities and execution tape

Top row gives summary health:
- wallet equity
- realized P&L today
- gross P&L total
- trades done + win rate
- active risk
- execution mode
- 60-day paper backtest result

## The math in simple terms

### 1) Bayesian update
When new information arrives, belief changes.
- prior belief -> posterior belief

### 2) Expected value (EV)
If our estimated probability (`p_hat`) is higher than market (`p`), EV is positive.
- `EV = p_hat - p`

### 3) Kelly sizing
Kelly tells you an aggressive fraction to bet.
In practice this app is conservative and capped, with explicit warning not to use full Kelly in short-horizon noisy markets.

### 4) LMSR framing
LMSR formulas are shown to tie price movement to inventory/cost mechanics common in prediction market making.

## What paper mode means here
Paper mode is a deterministic simulation with your risk locks.
- Start equity: `$1000`
- Horizon: `60 days`
- Trades are simulated (not exchange fills)

Use it as:
- UI and analytics sanity check
- strategy-control demonstration

Do not use it as:
- statistically validated production backtest

## What live mode means here
Live mode reads:
- real market feeds
- real wallet balances
- real account activity

Live order submission only activates when all safety gates pass.
If any gate fails, the app stays in `monitor_only` and tells you why.

## Why you can see signals but no trades
Signals are "opportunities detected".
Trades happen only if execution is allowed.

Right now, the blocker is geoblock from server region. That means:
- signals can still populate
- live orders are rejected by Polymarket CLOB

## Chart mode buttons (what they do)
- `linear`: raw equity path
- `log`: log-scaled equity values
- `drawdown`: distance from prior equity peak
- `positions`: approximate exposure based on execution flow

Hovering on the curve shows timestamp + equity value at that point.

## Guardrails currently hard-configured
- max trade: `$10`
- max daily loss: `$30`
- kill switch: stop once daily loss cap is breached

These are enforced in runtime state decisions, not just UI labels.

## If a new dev or agent joins
Start here in order:
1. `docs/HANDOFF.md`
2. `docs/AGENT_PLAYBOOK.md`
3. `app/api/polytrader/route.js`
4. `scripts/polytrader-execution-worker.py`
5. `app/polytrader/PolytraderDashboardClient.jsx`
