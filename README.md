# PolyTrader

Standalone PolyTrader app powering `hive.komalamin.com/polytrader`.

## What this repo contains
- Next.js dashboard UI (`/polytrader`)
- Live/paper API endpoint (`/api/polytrader`)
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
The app expects PolyTrader runtime env vars (wallet, risk locks, mode flags). On Kendra VPS these are loaded from:
- `/home/kendra/.openclaw/.env.polytrader`

## Safety defaults
- Max trade: `$10`
- Max daily loss: `$30`
- Kill switch at daily loss cap
- Live execution requires explicit arming + signer key

## Note on live trading
Polymarket may reject order placement by region (geoblock). When this happens the app reports `monitor_only` with the blocker reason.
