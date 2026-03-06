# PolyWeather Frontend (Next.js)

Standalone web frontend for `polyweather.vercel.app`.

## Stack

- Next.js 14+ (App Router)
- Tailwind CSS
- Lucide React
- shadcn/ui base components
- Leaflet (react-leaflet)

## Local Development

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Default frontend URL: `http://localhost:3000`

## Backend API

Set `POLYWEATHER_API_BASE_URL` to your FastAPI service URL.

Example:

```bash
POLYWEATHER_API_BASE_URL=https://api.yourdomain.com
```

The frontend uses Next Route Handlers as a thin BFF layer:

- `GET /api/cities`
- `GET /api/city/:name`

## Vercel Deployment

1. Import this repo in Vercel.
2. Set **Root Directory** to `frontend`.
3. Add environment variable:
   - `POLYWEATHER_API_BASE_URL=https://<your-fastapi-host>`
4. Deploy.

## Notes

- Backend CORS must allow `https://polyweather.vercel.app`.
- This is phase-1 split: map + city list + detail panel are migrated first.
