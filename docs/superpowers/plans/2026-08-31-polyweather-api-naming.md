# PolyWeather API Naming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the stable public `PolyWeather API` v1 forecast endpoint while preserving the legacy endpoint.

**Architecture:** Extract the existing forecast payload into a shared builder, expose it through `/api/v1/forecasts`, and retain `/api/cities/deb-forecast` as a compatibility wrapper. The new endpoint will normalize the response under `forecasts`, including DEB, daily forecasts, and per-model hourly curves.

**Tech Stack:** FastAPI, pytest, Markdown API documentation, Docker Compose deployment.

---

### Task 1: Add failing coverage for the standardized endpoint

**Files:**
- Modify: `tests/test_city_forecast_api.py`

- [ ] Add a test requesting `/api/v1/forecasts?cities=beijing` and assert status 200, `forecasts.beijing`, and nested `deb`, `daily`, and `models.hourly` fields.
- [ ] Run `python -m pytest tests/test_city_forecast_api.py -q` and confirm the new test fails because the route does not exist.

### Task 2: Implement shared payload and compatibility routes

**Files:**
- Modify: `web/routers/city_forecast.py`

- [ ] Extract the existing entitlement, city resolution, cache lookup, and computation flow into a shared handler helper.
- [ ] Keep `/api/cities/deb-forecast` returning its current shape.
- [ ] Add `/api/v1/forecasts` returning `generated_at`, `temp_symbol_default`, `count`, and `forecasts`.
- [ ] Map each legacy city payload as follows: DEB fields under `deb`, `forecast_daily` to `daily`, and `model_keys` plus `models_daily` plus `models_hourly` under `models`.
- [ ] Keep authentication, five-minute cache, city aliases, and hourly curve alignment unchanged.
- [ ] Run the focused API tests and confirm they pass.

### Task 3: Update public API documentation

**Files:**
- Modify: `docs/API_ZH.md`

- [ ] Name the product `PolyWeather API`.
- [ ] Document `/api/v1/forecasts` as the recommended external endpoint and mark `/api/cities/deb-forecast` as a legacy compatibility endpoint.
- [ ] Document the normalized response and `models.hourly.times` / `models.hourly.curves` alignment.

### Task 4: Verify and deploy

**Files:**
- No additional files.

- [ ] Run `python -m pytest tests/test_city_forecast_api.py -q`.
- [ ] Run `python -m pytest -q` and `ruff check .`.
- [ ] Commit with the Chinese message `规范PolyWeather对外API入口`.
- [ ] Push `main`, rebuild the backend image, and restart only the backend web service as needed.
- [ ] Verify production `/api/v1/forecasts?cities=beijing` with entitlement authentication returns HTTP 200 and nested hourly curves.
