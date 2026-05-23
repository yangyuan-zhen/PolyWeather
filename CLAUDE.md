# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PolyWeather Pro — a production weather-intelligence stack for temperature settlement markets. Aggregates observations and forecasts for 52 monitored cities globally, blends multi-model highs using DEB (Dynamic Error Balancing), generates calibrated probability buckets for settlement, maps weather to Polymarket quotes for mispricing scans, and serves both a Next.js dashboard (Vercel) and a Telegram bot.

## Environment & Preferences (ALWAYS follow)

### Working Directory
- All commands run from the repo root
- Python virtual env: `venv\Scripts\activate` (Windows) / `source venv/bin/activate` (Linux/macOS)
- Frontend dev server: `cd frontend && npm run dev` → http://localhost:3000
- Backend API server: `uvicorn web.app:app --reload --host 0.0.0.0 --port 8000` → http://localhost:8000
- When I say "start the server", assume the working directory is the repo root

### Git Conventions
- **Commit language: Chinese (简体中文) ONLY**
- Format: Lore Commit Protocol — intent line in Chinese, trailers in English
- Examples: `重构城市决策卡 hero 布局` or `统一 DEB 数据源为单一计算路径`
- **NEVER** use English for commit subject lines

### Tooling
- Package manager: **npm** (not yarn/pnpm)
- Python: `python` (not python3), venv at `venv/`
- Lint: `ruff check .` (Python) + `npx tsc --noEmit` (TypeScript)
- NEVER ask me about these preferences again — commit to memory

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

- **Backend**: FastAPI on port 8000 (`web/app.py` → `web/app_factory.py` → `web/routers/` (8 route modules: `system`, `city`, `auth`, `analytics`, `scan`, `payments`, `ops`, `routes` (legacy)) + `web/services/` (14 service modules) + `web/core.py`)
- **Frontend**: Next.js 15 + React 19 + TypeScript + Tailwind CSS 3 + shadcn/ui (new-york style) on port 3000 (dev)
- **Bot**: Telegram bot via `bot_listener.py` → `src/bot/`
- **Shared analysis core** in `src/` is used by both web API and bot
- **Scan Terminal**: Real-time city opportunity scanning (`web/scan_terminal_service.py` and `frontend/components/dashboard/scan-terminal/`)
- **Dashboard**: Main dashboard with interactive map, city sidebar, detail panels, and probability views
- **Market Monitor** (`MonitorPanel`): Real-time temperature monitoring board for 22 trading cities. Uses a temperature resolution chain (AMOS runway → AMOS → `airport_primary` → `airport_current` → `current`) defined in `frontend/components/dashboard/monitoring/monitor-temperature.ts`. Per-city refresh decisions driven by source-aware freshness (`source-freshness.ts`) instead of uniform `obs_age_min`. Seoul/Busan display runway surface temperature from AMOS; US cities get 5-min MADIS HFMETAR via `airport_primary`; others fall back to METAR.
- **High-Freq Airport Pipeline**: 19 of 22 monitor cities have dedicated realtime sources (AMOS, MADIS, JMA, MGM, FMI, KNMI, AROME). Data flows: `weather_sources.py` (fetch) → `country_networks.py` (`_airport_primary_from_raw`, per-country providers) → API `airport_primary` field. Plain METAR stays in `airport_current`. Documented in `docs/AIRPORT_REALTIME_SOURCES.md`.
- **Country Network Providers**: `country_networks.py` routes per-city to the right provider (Turkey→MGM, Korea→KMA, Japan→JMA, etc.) via `get_country_network_provider()`. Each provider controls `airport_primary_current`, `official_nearby_current`, and `official_network_status`. US cities use the default `GlobalMetarNetworkProvider` but get MADIS overrides injected via `results["madis_hfmetar_current"]`.

## Commands

### Frontend (dev on port 3000)
```bash
cd frontend
npm ci
npm run dev         # Next.js dev server (runs sync-next-server-chunks.mjs first)
npm run build       # Production build (runs sync-next-server-chunks.mjs after)
npm run start       # Production server
npm run lint        # ESLint via next lint
npm run typecheck   # tsc --noEmit
npm run test:business  # Business state tests via scripts/run-business-state-tests.mjs (also runs in CI)
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
docker compose up -d --build                    # bot + web API (polyweather + polyweather_web)
```
The compose file defines two services: `polyweather` (bot) and `polyweather_web` (FastAPI on :8000). Prewarm worker and monitoring profiles were removed in v1.6.0.

### Python tests
```bash
python -m pytest tests/                           # all tests
python -m pytest tests/test_web_observability.py  # single test file
```

### Version bump (see RELEASE.md)
```bash
python scripts/bump_version.py patch   # or minor / major / 1.5.0
python scripts/sync_version.py         # verify sync across files
```
`VERSION` file is the single source of truth; frontend `package.json` and docs sync from it.

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
| `src/analysis/` | DEB algorithm, trend engine, market alert engine, settlement rounding |
| `src/auth/` | Supabase entitlement checks, Telegram group pricing |
| `src/bot/` | Telegram bot handlers and orchestrator |
| `src/database/` | SQLite-based runtime state, DB manager, daily/truth/training feature repositories |
| `src/data_collection/` | Weather sources (METAR, TAF, Open-Meteo, JMA, KMA, MGM, NMC, Russia stations, settlement sources), city registry (52 cities), Polymarket readonly layer. Also: `madis_sources.py` (NOAA 5-min NetCDF), `amos_station_sources.py` (Korean runway sensors), `country_networks.py` (per-country provider routing + `_airport_primary_from_raw`) |
| `src/data_mining/` | Historical data fetch utilities |
| `src/onchain/` | Polygon wallet watcher, Polymarket wallet activity watcher |
| `src/payments/` | Onchain checkout, event listener, confirm loop, contract audit |
| `src/strategy/` | Trading strategy modules |
| `src/trading/` | Trading execution modules |
| `src/utils/` | Shared utilities: config loader, logging, metrics, Telegram push, chat ID helpers |
| `web/` | FastAPI app (`app.py` → `app_factory.py`), `routers/` (8 route modules), `services/` (14 service modules), `core.py`, scan terminal modules (AI fallback, AI prompts, METAR gate, city rows, ranker, cache) |
| `frontend/app/` | Next.js App Router pages (dashboard, account, auth, docs, ops, probabilities, scan) |
| `frontend/components/dashboard/` | Dashboard UI components (map, sidebar, detail panel, modals, charts, scan terminal). `scan-root-styles.ts` is the CSS Module barrel, combining 22 module roots into one pre-composed className. `monitoring/` subdirectory: `MonitorPanel`, `monitor-temperature.ts` (temp resolution chain), `monitor-refresh-policy.ts`. |
| `frontend/lib/` | Shared client logic: types (`dashboard-types.ts`, including `AirportCurrentConditions`, `CityDetail`), API client, chart utils, i18n, `source-freshness.ts` (per-source freshness with `expected_next_update_at`), dashboard utils |
| `frontend/hooks/` | React hooks: dashboard store (global state), Leaflet map, chart helper |
| `scripts/` | Operational scripts: backfills, payment reconciliation. `supabase/` subdirectory: DB schema and migration SQL. |
| `config/` | YAML config (city list, weather settings, logging) |
| `docs/` | Bilingual product & technical docs |

## Key Technical Details

- **Python version**: 3.11 (target), type hints use `from __future__ import annotations` in most modules
- **Package manager**: pip (requirements.txt) + uv cache is present but not the primary tool; no pyproject.toml build system defined
- **Frontend package manager**: npm
- **State storage**: SQLite primary path (set via `POLYWEATHER_STATE_STORAGE_MODE=sqlite` + `POLYWEATHER_DB_PATH`). Legacy JSON/JSONL files are migration/fallback only.
- **Runtime data**: External dir recommended (`POLYWEATHER_RUNTIME_DATA_DIR=/var/lib/polyweather`) to avoid git conflicts
- **Configuration**: `.env.example` is the comprehensive reference (8 config sections: runtime, Telegram, weather cache, auth, ops, frontend, optional modules, Polygon monitor). Copy to `.env` and fill in secrets.
- **Auth gating** (frontend middleware): Three-tier priority in `middleware.ts` — (1) local dev hosts (localhost / 127.0.0.1 / ::1) bypass auth entirely, (2) Supabase session-based when `POLYWEATHER_AUTH_ENABLED=true` via `handleSupabaseAuthGate` or `handleSupabaseOptionalSession`, (3) legacy token fallback via `POLYWEATHER_DASHBOARD_ACCESS_TOKEN` cookie/query-param. Public pages (`/`, `/docs`, `/auth/*`, `/entitlement-required`) and public API routes are always accessible.
- **CORS**: Allowed origins from `WEB_CORS_ORIGINS` env var (defaults: localhost:3000, polyweather-pro.vercel.app)
- **API proxy**: Frontend uses Next.js rewrites to proxy `/api/*` to the FastAPI backend; see `frontend/lib/api-proxy.ts` and `frontend/lib/backend-api.ts`

## Commit Convention

This repo uses the **Lore Commit Protocol** — structured decision records with git trailers (`Constraint:`, `Rejected:`, `Confidence:`, `Scope-risk:`, `Directive:`, `Tested:`, `Not-tested:`). Intent line first (why, not what).

- Always write git commit messages in **Chinese (简体中文)**.

## Code Style

- Never use Unicode escape sequences (`\uXXXX`) in source code; write characters directly in UTF-8 encoding.
- When modifying UI components, update both **dark-mode and light-mode CSS files** in the same edit batch.
- **CSS Variables First**: Prefer `var(--color-*)` / `var(--color-signal-*)` tokens over hardcoded hex values. The token system is defined in `globals.css` with light-theme overrides under `html.light`.
- **Avoid `!important`**: Only use it for Leaflet map overrides (inline style conflict) and chart canvas sizing. For light-theme overrides, use `html.light .root` prefix for higher specificity.
- **Monitoring CSS note**: `MonitorPanel.module.css` scopes its light-theme overrides to `.scan-terminal.light` (the terminal's built-in toggle), NOT `html.light`. When adding light styles for monitoring components, match this scoping.
- **New CSS Modules**: Add the module root class to `scan-root-styles.ts` barrel file instead of importing it separately in `ScanTerminalDashboard.tsx`.

## Quality Gates (MANDATORY)

Before marking any task as complete, you MUST:

1. **Type check** — Run `npx tsc --noEmit` (frontend) or `python -m ruff check .` (backend) on modified files
2. **No Unicode escapes** — Verify that NO `\uXXXX` sequences were introduced; if found, revert and fix
3. **Dual-theme CSS** — For any UI change, confirm BOTH dark and light styles. Most components need `ScanTerminalLightTheme.module.css` updated; monitoring components (`MonitorPanel.module.css`) contain their own `.scan-terminal.light` blocks inline.
4. **No new hardcoded palette colors** — Use `var(--color-*)` token references instead of `#4DA3FF` / `#E6EDF3` / `#9FB2C7` / `#6B7A90` hex values
5. **Show the diff** — Output `git diff --stat` and test results before declaring success

If any gate fails, fix it BEFORE reporting success.
