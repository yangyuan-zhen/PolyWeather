from __future__ import annotations

import json
import os
import random
import threading
import time
from datetime import datetime
from typing import Any, Dict, Optional

import httpx
from loguru import logger

from src.database.db_manager import DBManager


DEFAULT_CITIES = [
    "ankara",
    "istanbul",
    "shanghai",
    "beijing",
    "shenzhen",
    "guangzhou",
    "wuhan",
    "chengdu",
    "chongqing",
    "hong kong",
    "taipei",
    "singapore",
    "tokyo",
    "seoul",
    "busan",
    "london",
    "paris",
    "madrid",
]

_RUNTIME_LOCK = threading.Lock()
_WORKER_THREAD: Optional[threading.Thread] = None
_DB = DBManager()
_RUNTIME_STATE_KEY = "dashboard_prewarm"
_RUNTIME_STATE: Dict[str, Any] = {
    "cycle_count": 0,
    "success_count": 0,
    "failure_count": 0,
    "last_started_at": None,
    "last_finished_at": None,
    "last_duration_sec": None,
    "last_success": None,
    "last_http_status": None,
    "last_error": None,
    "last_requested_cities": [],
    "last_requested_city_count": 0,
    "last_include_detail": False,
    "last_include_market": False,
    "last_force_refresh": False,
    "last_warmed_count": 0,
    "last_summary_ok": 0,
    "last_detail_ok": 0,
    "last_market_ok": 0,
    "last_failed_count": 0,
    "last_heartbeat_ts": None,
    "writer_mode": None,
    "writer_pid": None,
    "writer_thread_name": None,
}


def _truthy_env(value: str, default: bool = False) -> bool:
    raw = str(os.getenv(value) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _parse_cities(value: str) -> list[str]:
    items = [item.strip() for item in str(value or "").split(",")]
    return [item for item in items if item]


def _update_runtime_state(**kwargs: Any) -> None:
    with _RUNTIME_LOCK:
        _RUNTIME_STATE.update(kwargs)


def _runtime_mode() -> str:
    current = threading.current_thread()
    if current.name == "dashboard-prewarm-worker":
        return "embedded_thread"
    if str(os.getenv("POLYWEATHER_PREWARM_WORKER_MODE") or "").strip():
        return str(os.getenv("POLYWEATHER_PREWARM_WORKER_MODE") or "").strip().lower()
    return "standalone_process"


def _snapshot_runtime_state() -> Dict[str, Any]:
    with _RUNTIME_LOCK:
        snapshot = dict(_RUNTIME_STATE)
    snapshot["last_heartbeat_ts"] = time.time()
    snapshot["writer_mode"] = _runtime_mode()
    snapshot["writer_pid"] = os.getpid()
    snapshot["writer_thread_name"] = threading.current_thread().name
    return snapshot


def _persist_runtime_state() -> Dict[str, Any]:
    snapshot = _snapshot_runtime_state()
    with _RUNTIME_LOCK:
        _RUNTIME_STATE.update(
            {
                "last_heartbeat_ts": snapshot["last_heartbeat_ts"],
                "writer_mode": snapshot["writer_mode"],
                "writer_pid": snapshot["writer_pid"],
                "writer_thread_name": snapshot["writer_thread_name"],
            }
        )
    try:
        _DB.set_payment_runtime_state(_RUNTIME_STATE_KEY, snapshot)
    except Exception as exc:
        logger.debug("dashboard prewarm runtime persist failed: {}", exc)
    return snapshot


def _record_prewarm_result(
    *,
    ok: bool,
    duration_sec: float,
    http_status: Optional[int],
    error: Optional[str],
    warmed_count: int,
    summary_ok: int,
    detail_ok: int,
    market_ok: int,
    failed_count: int,
) -> None:
    with _RUNTIME_LOCK:
        _RUNTIME_STATE["cycle_count"] = int(_RUNTIME_STATE.get("cycle_count") or 0) + 1
        if ok:
            _RUNTIME_STATE["success_count"] = int(_RUNTIME_STATE.get("success_count") or 0) + 1
        else:
            _RUNTIME_STATE["failure_count"] = int(_RUNTIME_STATE.get("failure_count") or 0) + 1
        _RUNTIME_STATE["last_finished_at"] = datetime.now().isoformat(timespec="seconds")
        _RUNTIME_STATE["last_duration_sec"] = round(float(duration_sec), 2)
        _RUNTIME_STATE["last_success"] = bool(ok)
        _RUNTIME_STATE["last_http_status"] = http_status
        _RUNTIME_STATE["last_error"] = error
        _RUNTIME_STATE["last_warmed_count"] = int(warmed_count or 0)
        _RUNTIME_STATE["last_summary_ok"] = int(summary_ok or 0)
        _RUNTIME_STATE["last_detail_ok"] = int(detail_ok or 0)
        _RUNTIME_STATE["last_market_ok"] = int(market_ok or 0)
        _RUNTIME_STATE["last_failed_count"] = int(failed_count or 0)
    _persist_runtime_state()


def _parse_iso_timestamp(value: Any) -> float:
    text = str(value or "").strip()
    if not text:
        return 0.0
    try:
        return datetime.fromisoformat(text).timestamp()
    except Exception:
        return 0.0


def _runtime_sort_key(payload: Dict[str, Any]) -> float:
    if not isinstance(payload, dict):
        return 0.0
    candidates = [
        float(payload.get("last_heartbeat_ts") or 0.0),
        _parse_iso_timestamp(payload.get("last_finished_at")),
        _parse_iso_timestamp(payload.get("last_started_at")),
    ]
    return max(candidates)


def _load_shared_runtime_state() -> Dict[str, Any]:
    try:
        payload = _DB.get_payment_runtime_state(_RUNTIME_STATE_KEY)
    except Exception as exc:
        logger.debug("dashboard prewarm runtime load failed: {}", exc)
        return {}
    return payload if isinstance(payload, dict) else {}


def get_prewarm_runtime_summary() -> Dict[str, Any]:
    configured_cities = _parse_cities(str(os.getenv("POLYWEATHER_PREWARM_CITIES") or ",".join(DEFAULT_CITIES)))
    with _RUNTIME_LOCK:
        local_runtime = dict(_RUNTIME_STATE)
    shared_runtime = _load_shared_runtime_state()
    runtime = local_runtime
    if _runtime_sort_key(shared_runtime) > _runtime_sort_key(local_runtime):
        runtime = shared_runtime
    interval_sec = max(30, int(os.getenv("POLYWEATHER_PREWARM_INTERVAL_SEC", "300")))
    jitter_sec = max(0, int(os.getenv("POLYWEATHER_PREWARM_JITTER_SEC", "20")))
    heartbeat_age_sec = None
    last_heartbeat_ts = float(runtime.get("last_heartbeat_ts") or 0.0)
    if last_heartbeat_ts > 0:
        heartbeat_age_sec = max(0.0, time.time() - last_heartbeat_ts)
    shared_alive = bool(
        last_heartbeat_ts > 0
        and heartbeat_age_sec is not None
        and heartbeat_age_sec <= float(interval_sec + jitter_sec + 90)
    )
    return {
        "enabled": _truthy_env("POLYWEATHER_DASHBOARD_PREWARM_ENABLED", False),
        "base_url": str(os.getenv("POLYWEATHER_BACKEND_URL") or "http://127.0.0.1:8000").strip(),
        "configured_cities": configured_cities,
        "configured_city_count": len(configured_cities),
        "interval_sec": interval_sec,
        "jitter_sec": jitter_sec,
        "include_detail": _truthy_env("POLYWEATHER_PREWARM_INCLUDE_DETAIL", True),
        "include_market": _truthy_env("POLYWEATHER_PREWARM_INCLUDE_MARKET", True),
        "force_refresh": _truthy_env("POLYWEATHER_PREWARM_FORCE_REFRESH", False),
        "thread_alive": bool(_WORKER_THREAD and _WORKER_THREAD.is_alive()) or shared_alive,
        "heartbeat_age_sec": None if heartbeat_age_sec is None else round(heartbeat_age_sec, 2),
        "runtime": runtime,
    }


def run_prewarm(
    *,
    base_url: str,
    cities: str,
    force_refresh: bool,
    include_detail: bool,
    include_market: bool,
) -> int:
    token = str(os.getenv("POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN") or "").strip()
    requested_cities = _parse_cities(cities)
    started = time.perf_counter()
    _update_runtime_state(
        last_started_at=datetime.now().isoformat(timespec="seconds"),
        last_requested_cities=requested_cities,
        last_requested_city_count=len(requested_cities),
        last_include_detail=bool(include_detail),
        last_include_market=bool(include_market),
        last_force_refresh=bool(force_refresh),
        last_error=None,
        last_http_status=None,
    )
    _persist_runtime_state()
    if not token:
        _record_prewarm_result(
            ok=False,
            duration_sec=time.perf_counter() - started,
            http_status=None,
            error="missing_backend_token",
            warmed_count=0,
            summary_ok=0,
            detail_ok=0,
            market_ok=0,
            failed_count=0,
        )
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": "missing_backend_token",
                    "detail": "POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN is required",
                },
                ensure_ascii=False,
            )
        )
        return 1

    try:
        with httpx.Client(timeout=180, follow_redirects=True) as client:
            response = client.post(
                f"{base_url.rstrip('/')}/api/system/prewarm",
                params={
                    "cities": cities,
                    "force_refresh": str(bool(force_refresh)).lower(),
                    "include_detail": str(bool(include_detail)).lower(),
                    "include_market": str(bool(include_market)).lower(),
                },
                headers={
                    "Accept": "application/json",
                    "x-polyweather-entitlement": token,
                },
            )
        try:
            payload = response.json()
        except Exception:
            payload = {"ok": False, "raw": (response.text or "")[:500]}
        warmed_count = int((payload or {}).get("count") or 0) if isinstance(payload, dict) else 0
        summary_ok = int((payload or {}).get("summary_ok") or 0) if isinstance(payload, dict) else 0
        detail_ok = int((payload or {}).get("detail_ok") or 0) if isinstance(payload, dict) else 0
        market_ok = int((payload or {}).get("market_ok") or 0) if isinstance(payload, dict) else 0
        failed_count = int((payload or {}).get("failed_count") or 0) if isinstance(payload, dict) else 0
        ok = bool(response.is_success and (not isinstance(payload, dict) or payload.get("ok", True)))
        _record_prewarm_result(
            ok=ok,
            duration_sec=time.perf_counter() - started,
            http_status=response.status_code,
            error=None if ok else str((payload or {}).get("detail") or (payload or {}).get("reason") or response.text[:200]),
            warmed_count=warmed_count,
            summary_ok=summary_ok,
            detail_ok=detail_ok,
            market_ok=market_ok,
            failed_count=failed_count,
        )
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0 if response.is_success else 1
    except Exception as exc:
        _record_prewarm_result(
            ok=False,
            duration_sec=time.perf_counter() - started,
            http_status=None,
            error=str(exc),
            warmed_count=0,
            summary_ok=0,
            detail_ok=0,
            market_ok=0,
            failed_count=0,
        )
        print(json.dumps({"ok": False, "reason": "request_failed", "detail": str(exc)}, ensure_ascii=False, indent=2))
        return 1


def run_worker_loop(
    *,
    base_url: str,
    cities: str,
    interval_sec: int,
    jitter_sec: int,
    force_refresh: bool,
    include_detail: bool,
    include_market: bool,
    once: bool = False,
) -> int:
    interval_sec = max(30, int(interval_sec))
    jitter_sec = max(0, int(jitter_sec))

    logger.info(
        "dashboard prewarm worker started base_url={} cities={} interval_sec={} jitter_sec={} include_detail={} include_market={} force_refresh={} once={}",
        base_url,
        cities,
        interval_sec,
        jitter_sec,
        bool(include_detail),
        bool(include_market),
        bool(force_refresh),
        bool(once),
    )
    _persist_runtime_state()

    while True:
        started = time.perf_counter()
        exit_code = run_prewarm(
            base_url=base_url,
            cities=cities,
            force_refresh=bool(force_refresh),
            include_detail=bool(include_detail),
            include_market=bool(include_market),
        )
        elapsed = time.perf_counter() - started
        logger.info(
            "dashboard prewarm worker cycle exit_code={} elapsed_sec={} finished_at={}",
            exit_code,
            round(elapsed, 2),
            datetime.now().isoformat(timespec="seconds"),
        )
        if once:
            return exit_code

        sleep_sec = max(5.0, interval_sec - elapsed)
        if jitter_sec > 0:
            sleep_sec += random.randint(0, jitter_sec)
        logger.info("dashboard prewarm worker sleeping sleep_sec={}", round(sleep_sec, 2))
        time.sleep(sleep_sec)


def start_prewarm_worker_thread() -> Optional[threading.Thread]:
    enabled = str(os.getenv("POLYWEATHER_DASHBOARD_PREWARM_ENABLED") or "").strip().lower()
    if enabled not in {"1", "true", "yes", "on"}:
        return None

    base_url = str(os.getenv("POLYWEATHER_BACKEND_URL") or "http://127.0.0.1:8000").strip()
    cities = str(os.getenv("POLYWEATHER_PREWARM_CITIES") or ",".join(DEFAULT_CITIES)).strip()
    interval_sec = int(os.getenv("POLYWEATHER_PREWARM_INTERVAL_SEC", "300"))
    jitter_sec = int(os.getenv("POLYWEATHER_PREWARM_JITTER_SEC", "20"))
    force_refresh = str(os.getenv("POLYWEATHER_PREWARM_FORCE_REFRESH") or "").strip().lower() in {"1", "true", "yes", "on"}
    include_detail = str(os.getenv("POLYWEATHER_PREWARM_INCLUDE_DETAIL", "true")).strip().lower() in {"1", "true", "yes", "on"}
    include_market = str(os.getenv("POLYWEATHER_PREWARM_INCLUDE_MARKET", "true")).strip().lower() in {"1", "true", "yes", "on"}

    thread = threading.Thread(
        target=run_worker_loop,
        kwargs={
            "base_url": base_url,
            "cities": cities,
            "interval_sec": interval_sec,
            "jitter_sec": jitter_sec,
            "force_refresh": force_refresh,
            "include_detail": include_detail,
            "include_market": include_market,
            "once": False,
        },
        name="dashboard-prewarm-worker",
        daemon=True,
    )
    thread.start()
    global _WORKER_THREAD
    _WORKER_THREAD = thread
    return thread
