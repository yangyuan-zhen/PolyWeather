# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PolyWeather Pro — a production weather-intelligence stack for temperature settlement markets. Aggregates observations and forecasts for 52 monitored cities globally, blends multi-model highs using DEB (Dynamic Error Balancing), generates calibrated probability buckets for settlement, maps weather to Polymarket quotes for mispricing scans, and serves both a Next.js dashboard (Vercel) and a Telegram bot.

## Architecture

```
Users (Web / Telegram) → Next.js Frontend (Vercel) → FastAPI /web/app.py
                                                      ↓
                                            Weather Collector (METAR, TAF, Open-Meteo, country networks)
                                                      ↓
                                            Analysis (DEB + Trend + Probability + Market Scan)
                                                      ↓
                                            Payment Layer (Intent + Event + Confirm Loop)
```

- **Backend**: FastAPI on port 8000 (`web/app.py` → `web/core.py` + `web/routes.py` + `web/analysis_service.py`)
- **Frontend**: Next.js 15 + React 19 + TypeScript + Tailwind CSS 3 on port 3000 (dev)
- **Bot**: Telegram bot via `bot_listener.py` → `src/bot/`
- **Shared analysis core** in `src/` is used by both web API and bot
- **Scan Terminal**: Real-time city opportunity scanning (`web/scan_terminal_service.py` and `frontend/components/dashboard/scan-terminal/`)
- **Dashboard**: Main dashboard with interactive map, city sidebar, detail panels, and probability views

## Commands

### Frontend (dev on port 3000)
```bash
cd frontend
npm ci
npm run dev        # Next.js dev server
npm run build      # Production build
npm run lint       # ESLint via next lint
```

### Backend (dev on port 8000)
```bash
uvicorn web.app:app --reload --host 0.0.0.0 --port 8000
```

### Telegram Bot
```bash
python bot_listener.py
# or via wrapper:
python run.py
```

### Docker (production-like stack)
```bash
docker compose up -d --build                    # bot + web API
docker compose --profile workers up -d          # + prewarm worker
docker compose --profile monitoring up -d       # + Prometheus/Grafana/Alertmanager
```

### Python tests
```bash
pytest tests/                           # all tests
pytest tests/test_web_observability.py  # single test file
```

### Lint & Format
```bash
ruff check .        # Python lint (pycodestyle + Pyflakes, line-length 88)
ruff format .       # Python format (Black-compatible, double quotes)
```

### Health & Ops checks
```bash
curl http://127.0.0.1:8000/healthz
curl http://127.0.0.1:8000/api/system/status
curl http://127.0.0.1:8000/metrics
```

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `src/data_collection/` | Weather sources (METAR, TAF, Open-Meteo, JMA, KMA, MGM, NMC, Russia stations, settlement sources), city registry (52 cities), Polymarket readonly layer |
| `src/analysis/` | DEB algorithm, trend engine, probability calibration (EMOS/LGBM), market alert engine, settlement rounding |
| `src/models/` | LightGBM daily-high model training and feature engineering |
| `src/payments/` | Onchain checkout, event listener, confirm loop, contract audit |
| `src/bot/` | Telegram bot handlers and orchestrator |
| `src/database/` | SQLite-based runtime state, DB manager, daily/truth/training feature repositories |
| `web/` | FastAPI app, routes (~65K), analysis service (~130K), scan terminal service (~56K), AI scan modules |
| `frontend/app/` | Next.js App Router pages (dashboard, account, auth, docs, ops, probabilities, scan) |
| `frontend/components/dashboard/` | Dashboard UI components (map, sidebar, detail panel, modals, charts, scan terminal) |
| `frontend/lib/` | Shared client logic: types, API client, chart utils, i18n, dashboard utils |
| `frontend/hooks/` | React hooks: dashboard store (global state), Leaflet map, chart helper |
| `scripts/` | Operational scripts: probability calibration training, backfills, payment reconciliation, prewarm worker |
| `config/` | YAML config (city list, weather settings, logging) |
| `docs/` | Bilingual product & technical docs |
| `monitoring/` | Prometheus/Grafana/Alertmanager configs |

## Key Technical Details

- **Python version**: 3.11 (target), type hints use `from __future__ import annotations` in most modules
- **Package manager**: pip (requirements.txt) + uv cache is present but not the primary tool; no pyproject.toml build system defined
- **Frontend package manager**: npm
- **State storage**: SQLite primary path (set via `POLYWEATHER_STATE_STORAGE_MODE=sqlite` + `POLYWEATHER_DB_PATH`). Legacy JSON/JSONL files are migration/fallback only.
- **Runtime data**: External dir recommended (`POLYWEATHER_RUNTIME_DATA_DIR=/var/lib/polyweather`) to avoid git conflicts
- **Auth gating** (frontend middleware): Token-based (`POLYWEATHER_DASHBOARD_ACCESS_TOKEN`) or Supabase session-based (`POLYWEATHER_AUTH_ENABLED`). Local dev hosts bypass auth.
- **CORS**: Allowed origins from `WEB_CORS_ORIGINS` env var (defaults: localhost:3000, polyweather-pro.vercel.app)
- **EMOS/CRPS calibration**: Trainable but production should use `legacy` or `emos_shadow` engine; `emos_primary` only after local evaluation + manual rollout
- **API proxy**: Frontend uses Next.js rewrites to proxy `/api/*` to the FastAPI backend; see `frontend/lib/api-proxy.ts` and `frontend/lib/backend-api.ts`

## Commit Convention

This repo uses the **Lore Commit Protocol** — structured decision records with git trailers (`Constraint:`, `Rejected:`, `Confidence:`, `Scope-risk:`, `Directive:`, `Tested:`, `Not-tested:`). Intent line first (why, not what).
