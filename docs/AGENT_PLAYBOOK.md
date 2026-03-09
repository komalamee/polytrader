# PolyTrader Agent Playbook (Claude/Codex/Any coding agent)

Last updated: 2026-03-09

## Mission
Keep PolyTrader shippable and safe.
Prioritize correctness and risk controls over feature velocity.

## Non-negotiables
- Never commit secrets or private keys.
- Keep live execution fail-closed.
- Preserve risk locks unless explicitly requested by owner.
- Any live-mode change must include explicit verification steps.

## Fast orientation
- UI: `app/polytrader/PolytraderDashboardClient.jsx`
- API: `app/api/polytrader/route.js`
- Execution: `scripts/polytrader-execution-worker.py`
- Docs: `docs/HANDOFF.md`, `docs/EXPLAINER.md`

## Change workflow
1. Create branch from `main`.
2. Implement smallest viable change.
3. Run `npm run build`.
4. If touching worker/API logic, run one live snapshot check:
   - `curl -s http://127.0.0.1:4042/api/polytrader?mode=live | jq .execution,.diagnostics`
5. Commit with focused message.
6. Open PR with:
   - behavior change
   - risk impact
   - operational impact

## High-risk files (review carefully)
- `app/api/polytrader/route.js`
- `scripts/polytrader-execution-worker.py`

## Common tasks

### Add a new top stat card
- update UI client card section
- ensure API provides field in both paper and live paths
- verify null-safe formatting

### Change signal model
- keep output schema stable (`market`, `side`, `edge`, `confidence`)
- update both API and worker if behavior needs parity
- note backward-compatibility in PR

### Modify risk policy
- update env defaults and docs
- ensure gating reason text remains explicit
- verify daily loss and cap behavior in worker cycle

### Update execution readiness logic
- adjust `readExecutionState`
- keep reason precedence deterministic
- include clear fallback reason for monitor mode

## Production verification checklist
- `systemctl --user status komalamin-next.service`
- `systemctl --user status polytrader-execution.service`
- `curl /api/polytrader?mode=live` returns valid JSON
- UI loads `/polytrader` and chart/buttons are interactive

## Known production blocker
Current server region is geoblocked for order placement on Polymarket CLOB.
Expected live status is `monitor_only` until infrastructure moves to a supported region.


## GitHub templates
Use the built-in templates for every change:
- PR template: `.github/PULL_REQUEST_TEMPLATE.md`
- Issues: `.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/ISSUE_TEMPLATE/feature_request.yml`
