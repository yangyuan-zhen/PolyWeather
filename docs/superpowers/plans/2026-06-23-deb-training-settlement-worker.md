# DEB Training Settlement Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore automatic DEB training data freshness after the realtime collector/canonical-cache split.

**Architecture:** Add a dedicated low-frequency training settlement service that runs city analysis for forecast/DEB snapshots and reconciles recent settled actual highs. Keep it separate from the high-frequency observation collector so user-facing realtime updates stay light.

**Tech Stack:** Python, FastAPI service modules, Docker Compose, pytest, existing `update_daily_record()` and `reconcile_recent_actual_highs()` paths.

---

### Task 1: Training Settlement Service

**Files:**
- Create: `web/training_settlement_service.py`
- Create: `tests/test_training_settlement_service.py`

- [ ] **Step 1: Write the failing service test**

```python
def test_training_settlement_cycle_runs_analysis_and_reconciles_supported_cities():
    calls = {"analysis": [], "reconcile": []}

    def analysis_runner(city):
        calls["analysis"].append(city)
        return {"city": city, "deb": {"prediction": 31.2}}

    def reconciler(city, *, lookback_days):
        calls["reconcile"].append((city, lookback_days))
        return {"ok": True, "updated": 1}

    result = run_training_settlement_cycle(
        city_registry={
            "shanghai": {"icao": "ZSSS", "settlement_source": "metar"},
            "legacy": {"settlement_source": "wunderground"},
        },
        analysis_runner=analysis_runner,
        actual_reconciler=reconciler,
        lookback_days=9,
    )

    assert result["ok"] is True
    assert result["processed"] == 1
    assert calls["analysis"] == ["shanghai"]
    assert calls["reconcile"] == [("shanghai", 9)]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_training_settlement_service.py::test_training_settlement_cycle_runs_analysis_and_reconciles_supported_cities -q`

Expected: FAIL because `web.training_settlement_service` does not exist.

- [ ] **Step 3: Implement the service**

Create `run_training_settlement_cycle()` with injectable `city_registry`, `analysis_runner`, and `actual_reconciler`. Default analysis runner calls `web.analysis_service._analyze(city, force_refresh=False, detail_mode="panel")`; default reconciler calls `src.analysis.deb_algorithm.reconcile_recent_actual_highs()`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest tests/test_training_settlement_service.py -q`

Expected: PASS.

### Task 2: Worker Entrypoint And Compose

**Files:**
- Create: `web/training_settlement_worker.py`
- Modify: `docker-compose.yml`
- Modify: `tests/test_deployment_runtime_config.py`

- [ ] **Step 1: Write failing deployment tests**

Assert the compose file contains `polyweather_training_settlement`, command `python -m web.training_settlement_worker`, role `training_settlement`, and conservative interval/lookback environment variables.

- [ ] **Step 2: Run the deployment test to verify it fails**

Run: `python -m pytest tests/test_deployment_runtime_config.py::test_runtime_compose_splits_realtime_workers -q`

Expected: FAIL because the worker service is absent.

- [ ] **Step 3: Implement worker and compose service**

The worker loops `run_training_settlement_cycle()` every `POLYWEATHER_TRAINING_SETTLEMENT_INTERVAL_SEC` seconds, with initial delay and lookback from environment.

- [ ] **Step 4: Run focused tests**

Run: `python -m pytest tests/test_training_settlement_service.py tests/test_deployment_runtime_config.py -q`

Expected: PASS.

### Task 3: Stale Monitoring

**Files:**
- Modify: `web/diagnostics/health.py`
- Modify: `web/services/system_api.py`
- Modify: `tests/test_web_observability.py`

- [ ] **Step 1: Write failing observability tests**

Assert system status training summaries include `stale_days` for daily/truth/features, and Prometheus exports stale gauges for training data.

- [ ] **Step 2: Run focused observability tests to verify failure**

Run: `python -m pytest tests/test_web_observability.py::test_system_status_includes_training_data tests/test_web_observability.py::test_metrics_endpoint_returns_prometheus_payload_for_ops_admin -q`

Expected: FAIL because stale fields/gauges are absent.

- [ ] **Step 3: Implement stale summary and gauges**

Add date-diff calculation against UTC today. Export `polyweather_daily_records_stale_days`, `polyweather_truth_records_stale_days`, `polyweather_training_features_stale_days`, and `polyweather_training_data_stale`.

- [ ] **Step 4: Run focused observability tests**

Run: `python -m pytest tests/test_web_observability.py::test_system_status_includes_training_data tests/test_web_observability.py::test_metrics_endpoint_returns_prometheus_payload_for_ops_admin -q`

Expected: PASS.

### Task 4: Verification And Backfill

**Files:**
- Optional create: `scripts/backfill_training_settlement.py`

- [ ] **Step 1: Run backend checks**

Run: `python -m ruff check .`

Run: `python -m pytest tests/test_training_settlement_service.py tests/test_deployment_runtime_config.py tests/test_web_observability.py -q`

- [ ] **Step 2: Run local one-shot cycle**

Run: `python -m web.training_settlement_worker --once --lookback-days 10 --cities shanghai`

Expected: JSON-like log output with `ok=True`; local DB should get a fresh row for the current local target date if analysis succeeds.

- [ ] **Step 3: Production note**

Missed forecast snapshots from 2026-06-15 to 2026-06-22 cannot be reconstructed honestly unless archived city analysis payloads exist. The worker restores forward automatic samples; actual-high truth can still be reconciled for supported settlement sources.
