# PolyWeather Pro

Production weather-intelligence stack for temperature settlement markets.

Official dashboard: [polyweather-pro.vercel.app](https://polyweather-pro.vercel.app/)

## What This Project Does

- Aggregates weather observations and forecasts for monitored cities.
- Blends multi-model forecasts with DEB (Dynamic Error Balancing).
- Computes settlement-oriented probability buckets (mu-centered distribution).
- Maps model view to Polymarket read-only market data for mispricing/risk scan.
- Delivers the same core logic to web dashboard and Telegram bot.

## Mindmap

```mermaid
mindmap
  root((PolyWeather Pro))
    Data Layer
      METAR(Aviation Weather / METAR)
      MGM(Turkey MGM)
      Station 17130(Ankara Center 17130)
      Open-Meteo
      weather.gov(US cities)
      Polymarket(P0 Read-only)
    Analysis Layer
      DEB(Dynamic Error Balancing)
      Probability Engine(mu + buckets)
      Trend Engine
      Risk Profiles
      Mispricing Radar
    Delivery Layer
      FastAPI
      Next.js Dashboard
      Telegram Bot
      Alert Push
    Ops Layer
      Docker Compose(VPS backend + bot)
      Vercel(frontend)
      Cache + force_refresh
      Speed Insights
```

## Architecture

```mermaid
graph TD
    User[Web / Telegram User] --> FE[Next.js Frontend on Vercel]
    User --> Bot[Telegram Bot on VPS]
    FE --> API[FastAPI Service]
    Bot --> API

    API --> WX[Weather Data Collector]
    WX --> METAR[METAR / Aviation Weather]
    WX --> MGM[MGM API / nearby stations]
    WX --> OM[Open-Meteo]
    WX --> NWS[weather.gov]

    API --> DEB[DEB + Trend + Probability Engines]
    API --> PM[Polymarket Read-only Layer]
    PM --> Gamma[Gamma API]
    PM --> CLOB[CLOB / py-clob-client]
```

## Current Source Policy

| Domain | Source Policy |
| :-- | :-- |
| Primary observation | Aviation Weather / METAR |
| Ankara enhancement | MGM + nearby stations, lead station fixed to `17130` |
| Forecast baseline | Open-Meteo |
| US official context | weather.gov |
| Market layer | Polymarket P0 read-only discovery + quotes |
| Removed source | Meteoblue (fully removed from code and docs) |

## Recent Changes (2026-03-11)

- Removed all Meteoblue API integration and references.
- Fixed market top-bucket rendering path by deduplicating repeated temperature buckets.
- Added frontend fallback guard when market top buckets collapse to low-quality duplicates.
- Fixed detail panel accessibility issue (`aria-hidden` focus conflict) using `inert` + active-element blur.
- Added Vercel Speed Insights integration in `frontend/app/layout.tsx`.

## Repositories and Runtime Paths

- Frontend: `frontend/` (Next.js App Router)
- Backend API: `web/app.py` and `src/`
- Telegram runtime: `bot_listener.py` + `src/analysis/*`
- Docs: `docs/`

## Quick Start

### Backend + Bot (VPS / Docker)

```bash
docker compose up -d --build
```

### Frontend (local)

```bash
cd frontend
npm install
npm run dev
```

### Frontend production build check

```bash
cd frontend
npm run build
```

## Command Surface (Telegram)

| Command | Purpose |
| :-- | :-- |
| `/city <name>` | City real-time analysis |
| `/deb <name>` | DEB historical reconciliation |
| `/top` | User leaderboard |
| `/help` | Help and command usage |

## Documentation Index

- Chinese API guide: `docs/API_ZH.md`
- Commercial roadmap: `docs/COMMERCIALIZATION.md`
- Tech debt (EN): `docs/TECH_DEBT.md`
- Tech debt (ZH): `docs/TECH_DEBT_ZH.md`
- Chinese overview: `README_ZH.md`

## Status

- Version: `v1.3`
- Last Updated: `2026-03-11`
- Runtime: Stable (web + bot + market read-only layer in production)
