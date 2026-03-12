# PolyWeather Frontend

This directory contains the production web frontend.

Production URL:
- https://polyweather-pro.vercel.app/

## Stack

- Next.js App Router
- React (dashboard component architecture)
- Tailwind CSS
- Leaflet (map)
- Chart.js
- Typed dashboard store + typed data client

## Runtime Model

- Vercel hosts UI + BFF route handlers.
- FastAPI on VPS provides weather/analysis APIs.
- Browser never calls backend directly in normal flow.

Request path:

1. Browser -> `https://polyweather-pro.vercel.app`
2. Frontend -> Next route handlers (`/api/*`)
3. Route handlers -> FastAPI (`POLYWEATHER_API_BASE_URL`)

## Local Development

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Default local URL:
- http://localhost:3000

## Required Environment Variables

```env
POLYWEATHER_API_BASE_URL=https://<your-fastapi-host>
```

Optional entitlement variables:

```env
POLYWEATHER_DASHBOARD_ACCESS_TOKEN=
POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN=
```

## Route Handlers

- `GET /api/cities`
- `GET /api/city/[name]`
- `GET /api/city/[name]/summary`
- `GET /api/city/[name]/detail`
- `GET /api/history/[name]`

Cache behavior:

- `cities` / `summary` / `history` return `ETag` + `Cache-Control`.
- `summary?force_refresh=true` returns `Cache-Control: no-store`.
- `city/[name]` and `city/[name]/detail` are dynamic pass-through (no shared HTTP cache).

## Frontend State & Local Cache

- `sessionStorage`:
  - city detail cache bundle (TTL 5 minutes)
- `localStorage`:
  - selected city
  - sidebar risk-group collapse state
- in-flight request de-duplication for city detail/summary/history/market scan

## Entitlement

- `frontend/middleware.ts` enforces dashboard/API access when `POLYWEATHER_DASHBOARD_ACCESS_TOKEN` is set.
- BFF forwards backend entitlement token via `x-polyweather-entitlement` header when configured.

## UI Notes

- Left sidebar supports risk-group collapsible sections.
- City rows keep local time and peak-time hints visible.
- Future-date modal requests market scan with `target_date`.
- Detail panel accessibility uses `inert` + blur when hidden.

## Icons & Manifest

- `frontend/app/favicon.ico`
- `frontend/app/favicon-16x16.png`
- `frontend/app/favicon-32x32.png`
- `frontend/app/apple-touch-icon.png`
- `frontend/app/site.webmanifest`

## Vercel Deployment

1. Import repo into Vercel
2. Set Root Directory = `frontend`
3. Set env vars
4. Deploy

## Verification

```bash
./scripts/validate_frontend_cache.sh "https://polyweather-pro.vercel.app"
```

Last updated: `2026-03-12`
