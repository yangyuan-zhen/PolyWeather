# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PolyWeather Pro — a paid institutional weather-intelligence terminal for temperature settlement markets. 50 monitored cities, DEB multi-model temperature blending, Mu probability calibration, Polymarket CLOB/WS price integration. Next.js 15 + React 19 (Vercel) frontend, FastAPI backend (VPS), Telegram bot.

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
npm run test:business  # 21 business state tests

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
         / (landing page)         Analysis (DEB + Mu + Polymarket scan)
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
- `LiveTemperatureThresholdChart` — temperature trend + market thresholds (right)
- `TrainingDashboard` — DEB + Mu accuracy charts (sidebar tab)
- `MarketOverviewView` — regional heat + top opportunities (sidebar tab)
- `GroupedMarketTable` — contract comparison table
- `continent-grouping.ts` — 7 trading regions, city-to-region mapping, timezone detection

### Account Module

- `AccountCenter.tsx` (~1280 lines) — main component
- `useAccountPayment.ts` — master payment hook, composes sub-hooks
- `useWalletBind.ts` — EVM/WalletConnect binding
- `usePaymentFlow.ts` — intent creation, payment, confirmation
- `useBilling.ts` — subscription recovery, billing computation

### Backend Key Files

| Path | Purpose |
|------|---------|
| `web/routers/city.py` | City detail/summary/market-scan endpoints |
| `web/routers/scan.py` | Scan terminal aggregation |
| `web/services/city_payloads.py` | Market scan with Polymarket integration |
| `web/scan_terminal_city_row.py` | Builds terminal rows from analysis data |
| `src/data_collection/city_registry.py` | 50-city registry with tz_offset |
| `src/data_collection/polymarket_readonly.py` | Market discovery, CLOB prices, WS cache |
| `src/data_collection/polymarket_ws_cache.py` | WebSocket quote cache |
| `src/analysis/deb_algorithm.py` | DEB prediction + Mu calibration + accuracy |

## Auth Gating

Middleware (`middleware.ts`) handles two layers:
1. **Terminal gate** (`handleTerminalGate`): `/terminal/*` → redirect to `/auth/login` if no Supabase session
2. **Global auth** (`handleSupabaseAuthGate`): enforced when `POLYWEATHER_AUTH_REQUIRED=true`

Client-side gate (`ProductAccessRequired`): `/terminal` checks auth + subscription via `/api/auth/me`, shows paywall if needed.

Local dev bypass: set `NEXT_PUBLIC_POLYWEATHER_LOCAL_FULL_ACCESS=false` to test auth locally.

## Polymarket Integration

Price pipeline:
```
Gamma API (slug discovery) → CLOB REST + WS cache → market_scan → terminal rows
```

- `resolve_city_clob_tokens()` — timezone-aware market discovery
- `collect_all_clob_token_ids()` — all YES/NO tokens for WS subscription
- `PolymarketWsQuoteCache` — WebSocket quote cache (daemon thread)
- Prices flow to terminal via `**row` spread in `_build_terminal_row`

## Trading Regions

7 regions: east_asia, southeast_asia, central_asia, west_asia, europe_africa, south_america, north_america. Mappings in `continent-grouping.ts` (`CITY_REGION_FALLBACK` — all 50 cities hardcoded) and `scan_terminal_filters.py` (`market_region_from_tz_offset`). Default region auto-detected from browser timezone.

## Code Style

- No `\uXXXX` escapes — write characters directly in UTF-8
- Use `var(--color-*)` CSS tokens, not hardcoded hex
- Minimum font size: 10px (`text-[10px]`)
- Avoid `!important` except Leaflet map overrides
- Remove dead code immediately when features are removed
