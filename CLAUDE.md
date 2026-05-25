# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PolyWeather Pro — a paid institutional weather-intelligence terminal. 50 monitored cities with real-time METAR/AMOS/MADIS observations, DEB multi-model temperature blending, Mu probability calibration, and intraday bias correction. Pure meteorological decision workspace; no market/price layer. Next.js 15 + React 19 (Vercel) frontend, FastAPI backend (VPS), Telegram bot.

**Business model**: Paid-only, $10/month, no free tier, no trial. Landing page is public; `/terminal` requires login + active subscription.

## Environment & Preferences

- Working directory: repo root
- Python: `python` (not python3), venv at `venv/`
- Frontend: `cd frontend && npm run dev` → localhost:3000
- Backend: `uvicorn web.app:app --reload --host 0.0.0.0 --port 8000`
- Package manager: **npm** (not yarn/pnpm)
- **Commit language: Chinese (简体中文) ONLY**
- **NEVER start commit messages with `@`** — Chinese directly, no prefix

## Commands

```bash
# Frontend
cd frontend
npm run dev          # dev server :3000
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run test:business  # 19 business state tests

# Backend
uvicorn web.app:app --reload --host 0.0.0.0 --port 8000
python bot_listener.py   # Telegram bot

# Python tests
python -m pytest tests/
python -m pytest tests/test_supabase_entitlement.py

# Lint
ruff check .
ruff format .

# Docker (VPS)
docker compose down && docker compose up -d --build
```

## Architecture

```
Users → Next.js (Vercel) → FastAPI :8000 (VPS)
         /terminal (paid gate)    Weather Collector
         / (landing page)         Analysis (DEB + Mu)
                                  Payment Layer (USDC on Polygon)
         Telegram Bot → bot_listener.py
```

### Frontend Structure

| Path | Purpose |
|------|---------|
| `app/page.tsx` | Landing page (`InstitutionalLandingPage`) |
| `app/terminal/page.tsx` | Paid terminal (`ScanTerminalDashboard`) |
| `app/account/` | Account center with payment/subscription |
| `app/auth/` | Supabase login/signup |
| `components/dashboard/scan-terminal/` | Terminal sub-components |
| `components/account/` | Account + payment hooks |
| `components/landing/` | Institutional landing page |
| `components/subscription/` | `UnlockProOverlay` payment overlay |
| `lib/dashboard-types.ts` | All TypeScript types |

### Terminal Component Map

- `ScanTerminalDashboard.tsx` — entry, auth gate, `ProductAccessRequired`
- `PolyWeatherTerminal` — main layout: sidebar + region tabs + 2-column grid
- `CityRegionList` — city list panel (left top)
- `CityContractDetail` — contract table panel (left bottom)
- `LiveTemperatureThresholdChart` — multi-source overlay: obs + DEB + model curves + thresholds
- `RealtimeScrollChart` — lightweight realtime scrolling temperature + threshold bars
- `TrainingDashboard` — DEB + Mu accuracy charts (sidebar "训练数据" tab)
- `continent-grouping.ts` — 7 trading regions (`TRADING_REGIONS`), city-to-region fallback (`CITY_REGION_FALLBACK`), timezone detection (`detectLocalRegion`)

### Account Module

- `AccountCenter.tsx` (~1280 lines) — main component
- `useAccountPayment.ts` — master payment hook, composes sub-hooks
- `useWalletBind.ts` — EVM/WalletConnect binding
- `usePaymentFlow.ts` — intent creation, payment, confirmation
- `useBilling.ts` — subscription recovery, billing computation

### Backend Key Files

| Path | Purpose |
|------|---------|
| `web/routers/city.py` | City detail/summary/realtime-stream endpoints |
| `web/routers/scan.py` | Scan terminal aggregation |
| `web/services/city_payloads.py` | City detail and summary payload builders |
| `web/scan_terminal_city_row.py` | Builds terminal rows from analysis data |
| `src/data_collection/city_registry.py` | 50-city registry with tz_offset |
| `src/analysis/deb_algorithm.py` | DEB prediction + Mu calibration + accuracy |
| `web/services/analysis_utils.py` | Clock helpers, bucket labeling, time parsing |
| `web/services/observation_freshness.py` | Source profiles and freshness computation |
| `web/services/scan_ai_config.py` | Scan terminal and AI configuration constants |

## Auth Gating

Middleware (`middleware.ts`) handles two layers:
1. **Terminal gate** (`handleTerminalGate`): `/terminal/*` → redirect to `/auth/login` if no Supabase session
2. **Global auth** (`handleSupabaseAuthGate`): enforced when `POLYWEATHER_AUTH_REQUIRED=true`

Client-side gate (`ProductAccessRequired`): `/terminal` checks auth + subscription via `/api/auth/me`, shows paywall if needed.

Local dev bypass: set `NEXT_PUBLIC_POLYWEATHER_LOCAL_FULL_ACCESS=false` to test auth locally.

## Polymarket Integration

**Removed.** No Polymarket price fetching, no market scan, no WS cache. Terminal operates on weather data only (Live observations + DEB predictions + model probabilities). All `polymarket_readonly.py`, `polymarket_ws_cache.py`, and market-scan API routes have been deleted.

## Trading Regions

7 regions: east_asia, southeast_asia, central_asia, west_asia, europe_africa, south_america, north_america. Mappings in `continent-grouping.ts` (`CITY_REGION_FALLBACK` — all 50 cities hardcoded) and `scan_terminal_filters.py` (`market_region_from_tz_offset`). Default region auto-detected from browser timezone.

## Scan Terminal Performance

- **Region lazy-loading**: `region=east_asia` filters cities server-side before scanning (see `_market_region_from_tz_offset`)
- **Weather-only**: Terminal returns 1 row per city with Live/DEB/probability data; no market contract matching
- **DB**: SQLite WAL mode + `busy_timeout=5000` enabled in `db_manager.py` (fixes "database is locked" with parallel workers)
- **VPS env**: `POLYWEATHER_SCAN_TERMINAL_MAX_WORKERS=2`, `POLYWEATHER_SCAN_TERMINAL_BUILD_TIMEOUT_SEC=180`
- **Caching**: `_cache` is `LRUDict(256)` with `_CACHE_LOCK`; `_SUMMARY_CACHE` is `LRUDict(128)`; weather caches trimmed every 200 writes

## Intraday Bias Correction

`analysis_service.py:_analyze()` applies intraday correction after probability generation:
- Compares current observed temp vs model hourly forecast for current hour
- Time-of-day weight: 0.15↗0.35 pre-peak, 0.40↗0.75 during peak, 0.80 post-peak
- Also checks if max-so-far already exceeds DEB prediction (strong upward nudge)
- Correction capped at ±5°F / ±3°C, applied to both `deb_val` and `mu`

## Code Style

- No `\uXXXX` escapes — write characters directly in UTF-8
- Use `var(--color-*)` CSS tokens, not hardcoded hex
- Minimum font size: 10px (`text-[10px]`)
- Avoid `!important` except Leaflet map overrides
- Remove dead code immediately when features are removed
