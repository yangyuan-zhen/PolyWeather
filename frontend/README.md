# PolyWeather Frontend

Production frontend for PolyWeather Pro.

Production URL:
- https://polyweather-pro.vercel.app/

## Stack

- Next.js App Router
- React + Tailwind
- Leaflet + Chart.js
- Supabase Auth
- WalletConnect + browser EVM wallets

## Runtime Model

1. Browser -> Next app (`frontend`)
2. Next Route Handlers (`/api/*`) -> FastAPI backend
3. FastAPI -> analysis/payment services

## Local Development

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

## Required Environment Variables

```env
POLYWEATHER_API_BASE_URL=https://<your-fastapi-host>
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
POLYWEATHER_AUTH_ENABLED=true
POLYWEATHER_AUTH_REQUIRED=false
POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN=
```

WalletConnect:

```env
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
NEXT_PUBLIC_WALLETCONNECT_POLYGON_RPC_URL=https://polygon-bor-rpc.publicnode.com
```

Overlay links:

```env
NEXT_PUBLIC_TELEGRAM_GROUP_URL=https://t.me/<your_group>
```

## Route Handlers

Weather:

- `GET /api/cities`
- `GET /api/city/[name]`
- `GET /api/city/[name]/summary`
- `GET /api/city/[name]/detail`
- `GET /api/history/[name]`

Auth:

- `GET /api/auth/me`

Payments:

- `GET /api/payments/config`
- `GET /api/payments/wallets`
- `POST /api/payments/wallets/challenge`
- `POST /api/payments/wallets/verify`
- `POST /api/payments/intents`
- `GET /api/payments/intents/[intentId]`
- `POST /api/payments/intents/[intentId]/submit`
- `POST /api/payments/intents/[intentId]/confirm`

## Cache Behavior

- `cities` / `summary` / `history`: `ETag + Cache-Control`
- `summary?force_refresh=true`: `no-store`
- payment routes: `no-store`

## Open-Core Note

This frontend repo includes general product UI and standard payment UX.
Commercial strategy tuning, private ops workflows, and sensitive production parameters are intentionally outside the public docs scope.

See root policy: `docs/OPEN_CORE_POLICY.md`

Last updated: `2026-03-14`
