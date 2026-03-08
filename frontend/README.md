# PolyWeather Frontend

This directory is the only web frontend in production.

Production URL:
- https://polyweather-pro.vercel.app/

## Stack

- Next.js App Router
- Tailwind CSS
- Lucide React
- shadcn/ui base layer
- Legacy dashboard shell loaded from `public/legacy/index.html`

## Production Model

- Vercel serves the web UI
- FastAPI on VPS serves API only
- The old FastAPI static website has been removed
- The production page shell is still the legacy dashboard embedded by `app/page.tsx`

Current request flow:
- Browser -> Vercel frontend
- Vercel route handlers -> FastAPI API

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
- `GET /api/history/[name]`

Current frontend behavior:
- `/` keeps the world overview layout
- City clicks stay inside the same layout and load the right-side panel
- Future forecast dates open a modal instead of mutating the base panel

## Vercel Deployment

1. Import the repo into Vercel
2. Set Root Directory to `frontend`
3. Set `POLYWEATHER_API_BASE_URL`
4. Deploy

## Notes

- Backend CORS must allow `https://polyweather-pro.vercel.app`
- The page shell currently embeds the legacy dashboard HTML from `public/legacy/index.html`
- If you change files under `public/static`, deploy to Vercel to make them live

Last updated: 2026-03-09
