# AGENTS

## Scope
This repo is dedicated to the PolyTrader app only.

## Update workflow for Kendra agents
1. Create a branch from `main`.
2. Make changes in small, reviewable commits.
3. Run `npm run build` before pushing.
4. Open a PR to `main` with:
   - behavior changes
   - API/env changes
   - deployment notes

## Guardrails
- Do not commit secrets or `.env` files.
- Keep risk controls (`max trade`, `max daily loss`, kill switch) intact unless explicitly requested.
- Treat live order execution as high risk: fail closed when required env/signer state is missing.

## Deployment path
Production endpoint: `hive.komalamin.com/polytrader`
