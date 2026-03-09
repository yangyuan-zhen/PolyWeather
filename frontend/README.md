# PolyWeather Frontend

This directory is the only web frontend in production.

Production URL:
- https://polyweather-pro.vercel.app/

## Stack

- Next.js App Router
- React (component-driven dashboard)
- Tailwind CSS
- Leaflet (map runtime)
- Chart.js (charts with manual lifecycle wrapper)
- Typed store + typed data client

## Production Model

- Vercel serves the web UI and BFF route handlers
- FastAPI on VPS serves weather APIs only
- The old FastAPI static website has been removed
- The production page shell is React-driven (`components/dashboard/*`), with no runtime dependency on `public/static/app.js`

Current request flow:
- Browser -> Vercel frontend
- React store/client -> Next route handlers
- Next route handlers -> FastAPI API

## Local Development

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Default local URL:
- http://localhost:3000

## Required Environment Variable

```env
POLYWEATHER_API_BASE_URL=https://<your-fastapi-host>
```

Examples:
- `http://38.54.27.70:8000`
- `https://api.example.com`

## Route Handlers

Thin BFF routes currently exposed by Next:
- `GET /api/cities`
- `GET /api/city/[name]`
- `GET /api/city/[name]/summary`
- `GET /api/history/[name]`

Current frontend behavior:
- `/` keeps the world overview layout and initial city temperatures preload
- Marker click: focus map + open right city card + render nearby stations
- Right-card "今日日内分析": opens modal and freezes map motion
- Blank-map click: closes right card only, without resetting camera

## Vercel Deployment

1. Import the repo into Vercel
2. Set Root Directory to `frontend`
3. Set `POLYWEATHER_API_BASE_URL`
4. Deploy

## Notes

- Backend CORS must allow `https://polyweather-pro.vercel.app`
- City detail cache TTL is 5 minutes with revision probe; manual refresh bypasses cache
- UI layout and sizing remain aligned with the legacy visual contract after React migration

Last updated: 2026-03-09
