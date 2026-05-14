# AMSC AWOS Runway Observation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a China-only AMSC AWOS runway observation source and expose it as a runway observation tab next to Market Monitor.

**Architecture:** Backend fetches and normalizes AMSC `getWindPlate?cccc=...` payloads into the existing `amos`/`runway_obs` shape so current dashboard consumers can reuse runway display logic. Frontend adds a dedicated `runway` scan terminal tab that fetches a domestic city whitelist and renders runway TDZ/MID/END air temperatures without changing settlement anchors.

**Tech Stack:** Python data collection + pytest, Next.js/React TypeScript, existing business-state test runner.

---

### Task 1: Backend parser and source

**Files:**
- Create: `src/data_collection/amsc_awos_sources.py`
- Create: `tests/test_amsc_awos_sources.py`
- Modify: `src/data_collection/weather_sources.py`
- Modify: `src/data_collection/country_networks.py`

- [ ] **Step 1: Write failing parser tests**

Add tests that import `_amsc_parse_wind_plate_payload`, `_amsc_supported_city_codes`, and `AmscAwosSourceMixin`, parse a ZBAA-style sample, assert runway point temperatures, UTC observation conversion, `runway_temp_range`, and unauthorized/no-data fallback.

- [ ] **Step 2: Run red test**

Run: `python -m pytest tests/test_amsc_awos_sources.py -q`
Expected: FAIL because `src.data_collection.amsc_awos_sources` does not exist.

- [ ] **Step 3: Implement minimal backend source**

Create a source module with China whitelist: `shanghai=ZSPD`, `beijing=ZBAA`, `guangzhou=ZGGG`, `shenzhen=ZGSZ`, `chengdu=ZUUU`, `chongqing=ZUCK`, `wuhan=ZHHH`, `qingdao=ZSQD`. Fetch `https://www.amsc.net.cn/gateway/api/saas/rest/amc/AwosController/getWindPlate?cccc=<ICAO>`, optionally using `POLYWEATHER_AMSC_COOKIE` or `POLYWEATHER_AMSC_SESSION_ID`, and return existing-compatible `amos` payload with `source="amsc_awos"`.

- [ ] **Step 4: Run green backend tests**

Run: `python -m pytest tests/test_amsc_awos_sources.py tests/test_amos_station_sources.py -q`
Expected: PASS.

### Task 2: Backend integration

**Files:**
- Modify: `src/data_collection/weather_sources.py`
- Modify: `src/data_collection/country_networks.py`

- [ ] **Step 1: Attach AMSC after AMOS**

Add `AmscAwosSourceMixin` to `WeatherDataCollector`, call `_attach_china_amsc_awos_data` in both Open-Meteo and fallback paths, and persist aggregate plus first runway rows to `airport_obs_log` like AMOS.

- [ ] **Step 2: Normalize airport primary source labels**

Teach `_airport_primary_from_raw` that `raw["amos"].source == "amsc_awos"` should use `source_code="amsc_awos"`, `source_label="AMSC AWOS"`.

- [ ] **Step 3: Compile check**

Run: `python -m py_compile src/data_collection/amsc_awos_sources.py src/data_collection/weather_sources.py src/data_collection/country_networks.py`
Expected: exit 0.

### Task 3: Frontend runway tab

**Files:**
- Create: `frontend/components/dashboard/scan-terminal/RunwayObservationsPanel.tsx`
- Create: `frontend/components/dashboard/scan-terminal/__tests__/runwayObservationTab.test.ts`
- Modify: `frontend/components/dashboard/scan-terminal/ScanTerminalShellParts.tsx`
- Modify: `frontend/components/dashboard/ScanTerminalDashboard.tsx`
- Modify: `frontend/lib/dashboard-types.ts`
- Modify: `frontend/components/dashboard/monitoring/monitor-temperature.ts`
- Modify: `frontend/components/dashboard/monitoring/MonitorPanel.tsx`

- [ ] **Step 1: Write failing frontend business-state test**

Add a source-scan test asserting `ScanTerminalContentView` includes `runway`, dashboard has a `跑道观测` tab, and the panel includes `AMSC AWOS` plus TDZ/MID/END labels.

- [ ] **Step 2: Run red frontend test**

Run: `cd frontend; npm run test:business`
Expected: FAIL because the runway tab/panel strings do not exist yet.

- [ ] **Step 3: Implement tab and panel**

Add `runway` view next to Monitor. The panel fetches domestic whitelist details with `ensureCityDetail(key, false, "panel")`, displays city cards with runway rows and local-time labels, and uses a not-available message for cities without AMSC data.

- [ ] **Step 4: Run green frontend checks**

Run: `cd frontend; npm run test:business; npm run typecheck`
Expected: PASS.

### Task 4: Final verification and publish

**Files:**
- All changed files from Tasks 1-3.

- [ ] **Step 1: Full verification**

Run backend tests, Python compile, frontend business tests, typecheck, and build.

- [ ] **Step 2: Completion audit**

Map user requirement “国内几个城市的机场跑道温度，放在市场监控旁边 Tab” to changed backend source, frontend tab, tests, and build evidence.

- [ ] **Step 3: Commit/push/deploy**

If verification passes, commit, push `main`, and rely on configured deployment.
