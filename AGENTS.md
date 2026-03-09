# AGENTS

## Scope
This repo is dedicated to PolyTrader.

## Read first (mandatory)
1. `docs/HANDOFF.md`
2. `docs/EXPLAINER.md`
3. `docs/AGENT_PLAYBOOK.md`

## Update workflow for Kendra agents
1. Create a branch from `main`.
2. Make small, reviewable commits.
3. Run `npm run build` before pushing.
4. Open a PR to `main` and include:
   - behavior changes
   - risk impact
   - deployment/runtime notes

## Guardrails
- Never commit secrets or private keys.
- Keep risk controls (`max trade`, `max daily loss`, kill switch) intact unless explicitly requested.
- Keep live execution fail-closed when env/signer/runtime checks fail.

## Production endpoint
`https://hive.komalamin.com/polytrader`
