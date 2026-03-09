# PolyTrader

Standalone PolyTrader app powering `hive.komalamin.com/polytrader`.

## Core docs
- Technical handoff: `docs/HANDOFF.md`
- Plain-English explainer: `docs/EXPLAINER.md`
- Agent coding playbook: `docs/AGENT_PLAYBOOK.md`
- Env template: `.env.polytrader.example`

## What this repo contains
- Next.js dashboard UI (`/polytrader`)
- Live/paper snapshot API (`/api/polytrader`)
- Polymarket execution worker (`scripts/polytrader-execution-worker.py`)

## Local dev
```bash
npm install
npm run dev
```

## Production build
```bash
npm run build
npm start
```

## Runtime env
On Kendra VPS this is loaded from:
- `/home/kendra/.openclaw/.env.polytrader`

## Safety defaults
- Max trade: `$10`
- Max daily loss: `$30`
- Kill switch at daily loss cap
- Live execution requires explicit arming + signer key

## Live-trading note
Polymarket may reject order placement by region (geoblock). When this happens the app reports `monitor_only` with blocker reason.
