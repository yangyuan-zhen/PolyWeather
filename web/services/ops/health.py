"""Ops health / source health / training accuracy service functions."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import Request
import requests as _requests

from web.services.observation_freshness import (
    build_observation_freshness,
    canonical_observation_source_code,
)
import web.routes as legacy_routes

_DEB_VERSION_BACKTEST_SAMPLE_LIMIT = 400


# ── tiny helpers (also in ops_api.py, copied for self-contained module) ──────

def _sf(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _round_metric(value: Optional[float], digits: int = 1) -> Optional[float]:
    return None if value is None else round(float(value), digits)




# ── Source health helpers ─────────────────────────────────────────────

def _safe_source_text(value: Any) -> str:
    return str(value or "").strip()


def _source_observed_at(source: dict[str, Any]) -> Any:
    for key in (
        "observed_at",
        "obs_time",
        "report_time",
        "observation_time",
        "observation_time_local",
        "time",
        "timestamp",
    ):
        value = source.get(key)
        if _safe_source_text(value):
            return value
    return None


def _source_code(source: dict[str, Any], fallback: str = "") -> str:
    for key in ("source_code", "source", "provider_code", "network_provider"):
        value = _safe_source_text(source.get(key))
        if value:
            return canonical_observation_source_code(value)
    return canonical_observation_source_code(fallback)


def _source_label(source: dict[str, Any], code: str, fallback: str = "") -> str:
    for key in ("source_label", "station_label", "station_name", "label", "provider_label"):
        value = _safe_source_text(source.get(key))
        if value:
            return value
    return fallback or code.upper()


def _source_health_entry(
    *,
    city: str,
    role: str,
    source: dict[str, Any],
    fallback_code: str = "",
    fallback_label: str = "",
) -> dict[str, Any] | None:
    if not isinstance(source, dict) or not source:
        return None

    code = _source_code(source, fallback_code)
    label = _source_label(source, code, fallback_label)
    observed_at = _source_observed_at(source)
    freshness = source.get("freshness") if isinstance(source.get("freshness"), dict) else None
    if freshness:
        status = _safe_source_text(freshness.get("freshness_status")) or "unknown"
        age_sec = freshness.get("age_sec")
        observed_at = freshness.get("observed_at") or freshness.get("observed_at_local") or observed_at
        expected_next = freshness.get("expected_next_update_at")
        reason = freshness.get("freshness_reason")
    else:
        age_min = source.get("obs_age_min")
        try:
            age_min_int = int(age_min) if age_min is not None else None
        except Exception:
            age_min_int = None
        freshness = build_observation_freshness(
            source_code=code,
            source_label=label,
            observed_at=observed_at,
            age_min=age_min_int,
        )
        status = str(freshness.get("freshness_status") or "unknown")
        age_sec = freshness.get("age_sec")
        expected_next = freshness.get("expected_next_update_at")
        reason = freshness.get("freshness_reason")

    return {
        "city": city,
        "role": role,
        "source_code": code,
        "source_label": label,
        "station_code": source.get("station_code") or source.get("icao"),
        "station_label": source.get("station_label") or source.get("station_name"),
        "status": status,
        "reason": reason,
        "age_sec": age_sec,
        "age_min": round(float(age_sec) / 60, 1) if isinstance(age_sec, (int, float)) else None,
        "observed_at": observed_at,
        "expected_next_update_at": expected_next,
        "temp": source.get("temp"),
    }


def _expected_city_source_codes(city: str, payload: dict[str, Any]) -> list[str]:
    city_key = str(city or "").strip().lower().replace(" ", "")
    expected: list[str] = []
    if city_key in {"ankara", "istanbul"}:
        expected.append("mgm")
    if city_key == "amsterdam":
        expected.append("knmi")
    if city_key in {"telaviv", "telavivyafo"}:
        expected.append("ims")
    provider = canonical_observation_source_code(payload.get("official_network_source"))
    if provider and provider not in {"metar", "none"}:
        expected.append(provider)
    return list(dict.fromkeys(expected))


def _collect_city_source_health(city: str, entry: dict[str, Any] | None) -> dict[str, Any]:
    payload = (entry or {}).get("payload") if isinstance(entry, dict) else {}
    if not isinstance(payload, dict):
        payload = {}

    sources: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    def add(role: str, source: Any, fallback_code: str = "", fallback_label: str = "") -> None:
        item = _source_health_entry(
            city=city,
            role=role,
            source=source if isinstance(source, dict) else {},
            fallback_code=fallback_code,
            fallback_label=fallback_label,
        )
        if not item:
            return
        key = (str(item.get("role")), str(item.get("source_code")))
        if key in seen:
            return
        seen.add(key)
        sources.append(item)

    add("settlement", payload.get("current"), fallback_label="Settlement")
    add("airport_metar", payload.get("airport_current"), fallback_code="metar", fallback_label="METAR")
    add("airport_primary", payload.get("airport_primary"), fallback_label="Airport station")

    official = payload.get("official") if isinstance(payload.get("official"), dict) else {}
    add("official_airport_primary", official.get("airport_primary"), fallback_label="Official airport station")
    add("official_airport_primary", official.get("airport_primary_current"), fallback_label="Official airport station")

    mgm = payload.get("mgm") if isinstance(payload.get("mgm"), dict) else {}
    if mgm:
        mgm_current = mgm.get("current") if isinstance(mgm.get("current"), dict) else {}
        add(
            "official_network",
            {
                **mgm_current,
                "source_code": "mgm",
                "source_label": "MGM",
                "obs_time": mgm.get("obs_time") or mgm_current.get("time"),
            },
            fallback_code="mgm",
            fallback_label="MGM",
        )

    for nearby in payload.get("official_nearby") or payload.get("mgm_nearby") or []:
        if isinstance(nearby, dict):
            add("nearby_official", nearby, fallback_label="Nearby official")

    expected_codes = _expected_city_source_codes(city, payload)
    present_codes = {str(item.get("source_code") or "") for item in sources}
    for code in expected_codes:
        if code and code not in present_codes:
            sources.append(
                {
                    "city": city,
                    "role": "expected_source",
                    "source_code": code,
                    "source_label": code.upper(),
                    "status": "missing",
                    "reason": "expected_source_not_present_in_cached_detail",
                    "age_sec": None,
                    "age_min": None,
                    "observed_at": None,
                    "expected_next_update_at": None,
                    "temp": None,
                }
            )

    priority = {"stale": 4, "missing": 4, "delayed": 3, "unknown": 2, "expected_wait": 1, "fresh": 0}
    worst = max(sources, key=lambda item: priority.get(str(item.get("status") or ""), 2), default=None)
    full_age_sec = (
        round(max(0.0, __import__("time").time() - float(entry.get("updated_at_ts") or 0.0)), 1)
        if entry
        else None
    )
    return {
        "city": city,
        "cache_exists": bool(entry),
        "cache_updated_at": entry.get("updated_at") if entry else None,
        "cache_age_sec": full_age_sec,
        "source_count": len(sources),
        "worst_status": str(worst.get("status") if worst else "missing"),
        "sources": sources,
    }


# ── Ops endpoint functions ────────────────────────────────────────────

def get_ops_source_health(
    request: Request,
    cities: str = "",
    limit: int = 80,
) -> dict[str, Any]:
    from web.services.ops_api import _require_ops

    _require_ops(request)
    requested = legacy_routes._normalize_city_list(cities) if cities else []
    if requested:
        selected = requested
    else:
        all_cities = getattr(legacy_routes, "CITIES", {})
        selected = list(all_cities.keys()) if isinstance(all_cities, dict) else []
    safe_limit = max(1, min(int(limit or 80), 200))
    rows = []
    for city in selected[:safe_limit]:
        entry = legacy_routes._CACHE_DB.get_city_cache("full", city)
        if not entry:
            entry = legacy_routes._CACHE_DB.get_city_cache("panel", city)
        rows.append(_collect_city_source_health(city, entry))

    status_counts: dict[str, int] = {}
    for row in rows:
        for source in row.get("sources") or []:
            status = str(source.get("status") or "unknown")
            status_counts[status] = status_counts.get(status, 0) + 1

    return {
        "checked_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "cities": rows,
        "status_counts": status_counts,
        "total_cities": len(rows),
    }


def get_ops_observation_collector_status(
    request: Request,
    limit: int = 200,
) -> dict[str, Any]:
    from web.services.ops_api import _require_ops, ObservationCollectorStatusRepository

    _require_ops(request)
    safe_limit = max(1, min(int(limit or 200), 500))
    return ObservationCollectorStatusRepository().load_snapshot(limit=safe_limit)


def get_ops_health_check(request: Request) -> dict[str, Any]:
    from web.services.ops_api import _require_ops

    _require_ops(request)
    import os as _os
    import requests as _r
    import time as _time
    import urllib3 as _urllib3

    _urllib3.disable_warnings(_urllib3.exceptions.InsecureRequestWarning)

    results: dict[str, dict] = {}
    timeout = 8

    # Supabase
    supabase_url = str(_os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
    supabase_key = str(_os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if supabase_url and supabase_key:
        try:
            r = _r.get(
                f"{supabase_url}/rest/v1/",
                headers={
                    "apikey": supabase_key,
                    "Authorization": f"Bearer {supabase_key}",
                },
                timeout=timeout,
            )
            results["supabase"] = {
                "ok": r.ok,
                "status": r.status_code,
                "latency_ms": round(r.elapsed.total_seconds() * 1000),
            }
        except Exception as e:
            results["supabase"] = {"ok": False, "error": str(e)[:100]}
    else:
        results["supabase"] = {"ok": False, "error": "not configured"}

    # Open-Meteo
    try:
        t0 = _time.perf_counter()
        r = _r.get(
            "https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&daily=temperature_2m_max&timezone=auto&forecast_days=1",
            timeout=timeout,
        )
        results["open_meteo"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["open_meteo"] = {"ok": False, "error": str(e)[:100]}

    # METAR (aviationweather)
    try:
        t0 = _time.perf_counter()
        r = _r.get(
            "https://aviationweather.gov/api/data/metar?ids=KJFK&format=json",
            timeout=timeout,
        )
        results["metar"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["metar"] = {"ok": False, "error": str(e)[:100]}

    # KNMI
    knmi_key = str(_os.getenv("KNMI_API_KEY") or "").strip()
    if knmi_key:
        try:
            t0 = _time.perf_counter()
            r = _r.get(
                "https://api.dataplatform.knmi.nl/open-data/v1/datasets/10-minute-in-situ-meteorological-observations/versions/1.0/files?maxKeys=1",
                headers={"Authorization": knmi_key},
                timeout=timeout,
            )
            results["knmi"] = {
                "ok": r.ok,
                "status": r.status_code,
                "latency_ms": round((_time.perf_counter() - t0) * 1000),
            }
        except Exception as e:
            results["knmi"] = {"ok": False, "error": str(e)[:100]}
    else:
        results["knmi"] = {"ok": False, "error": "not configured"}

    # MADIS (NOAA)
    try:
        t0 = _time.perf_counter()
        r = _r.head(
            "https://madis-data.ncep.noaa.gov/madisPublic1/data/LDAD/hfmetar/netCDF/",
            timeout=timeout,
            allow_redirects=True,
        )
        results["madis"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["madis"] = {"ok": False, "error": str(e)[:100]}

    # Telegram Bot
    bot_token = str(_os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
    if bot_token:
        try:
            t0 = _time.perf_counter()
            r = _r.get(
                f"https://api.telegram.org/bot{bot_token}/getMe", timeout=timeout
            )
            results["telegram"] = {
                "ok": r.ok,
                "status": r.status_code,
                "latency_ms": round((_time.perf_counter() - t0) * 1000),
            }
        except Exception as e:
            results["telegram"] = {"ok": False, "error": str(e)[:100]}
    else:
        results["telegram"] = {"ok": False, "error": "not configured"}

    # JMA (Japan Meteorological Agency)
    try:
        t0 = _time.perf_counter()
        r = _r.get("https://www.jma.go.jp/bosai/forecast/", timeout=timeout)
        results["jma"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["jma"] = {"ok": False, "error": str(e)[:100]}

    # MGM (Turkish State Meteorological Service)
    try:
        t0 = _time.perf_counter()
        r = _r.get(
            "https://servis.mgm.gov.tr/web/sondurumlar?istno=17130&_=1",
            timeout=timeout,
            headers={"Origin": "https://www.mgm.gov.tr"},
        )
        results["mgm"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["mgm"] = {"ok": False, "error": str(e)[:100]}

    # FMI (Finnish Meteorological Institute)
    try:
        t0 = _time.perf_counter()
        r = _r.get(
            "https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=GetCapabilities",
            timeout=timeout,
        )
        results["fmi"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["fmi"] = {"ok": False, "error": str(e)[:100]}

    # KMA (Korea Meteorological Administration)
    try:
        t0 = _time.perf_counter()
        r = _r.get(
            "https://www.weather.go.kr/wgis-nuri/js/info/sfc.geojson", timeout=timeout
        )
        results["kma"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["kma"] = {"ok": False, "error": str(e)[:100]}

    # HKO (Hong Kong Observatory)
    try:
        t0 = _time.perf_counter()
        r = _r.get(
            "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_1min_temperature.csv",
            timeout=timeout,
        )
        results["hko"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["hko"] = {"ok": False, "error": str(e)[:100]}

    # Singapore MSS (data.gov.sg)
    try:
        t0 = _time.perf_counter()
        r = _r.get(
            "https://api.data.gov.sg/v1/environment/air-temperature", timeout=timeout
        )
        results["singapore_mss"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["singapore_mss"] = {"ok": False, "error": str(e)[:100]}

    # CWA (Taiwan Central Weather Administration)
    cwa_key = str(
        _os.getenv("CWA_API_KEY")
        or _os.getenv("CWA_OPEN_DATA_AUTH")
        or _os.getenv("CWA_OPEN_DATA_API_KEY")
        or ""
    ).strip()
    if cwa_key:
        try:
            t0 = _time.perf_counter()
            r = _r.get(
                f"https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001?Authorization={cwa_key}&limit=1",
                timeout=timeout,
            )
            results["cwa"] = {
                "ok": r.ok,
                "status": r.status_code,
                "latency_ms": round((_time.perf_counter() - t0) * 1000),
            }
        except Exception as e:
            results["cwa"] = {"ok": False, "error": str(e)[:100]}
    else:
        results["cwa"] = {"ok": False, "error": "not configured"}

    # AMOS (Korea runway sensors)
    try:
        t0 = _time.perf_counter()
        r = _r.get(
            "https://global.amo.go.kr/amosobsnew/AmosRealTimeImage.do", timeout=timeout
        )
        results["amos"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["amos"] = {"ok": False, "error": str(e)[:100]}


    # NOAA WRH (US settlement verification)
    try:
        t0 = _time.perf_counter()
        r = _r.get("https://www.weather.gov/wrh/timeseries?site=KJFK", timeout=timeout)
        results["noaa_wrh"] = {
            "ok": r.ok,
            "status": r.status_code,
            "latency_ms": round((_time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        results["noaa_wrh"] = {"ok": False, "error": str(e)[:100]}

    all_ok = all(v.get("ok") for v in results.values())
    return {
        "ok": all_ok,
        "checked_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "services": results,
    }


# ── Training accuracy helpers ─────────────────────────────────────────

def _evaluate_deb_records(
    records: List[Dict[str, Any]],
    *,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Dict[str, Any]:
    from src.analysis.settlement_rounding import apply_city_settlement

    hits = 0
    total = 0
    errors: List[float] = []
    signed_errors: List[float] = []
    cities = set()
    dates = set()
    for row in records:
        target_date = str(row.get("target_date") or "").strip()
        if start_date and target_date < start_date:
            continue
        if end_date and target_date > end_date:
            continue
        city = str(row.get("city") or "").strip().lower()
        prediction = _sf(row.get("deb_prediction"))
        actual = _sf(row.get("actual_high"))
        if not city or not target_date or prediction is None or actual is None:
            continue
        try:
            pred_bucket = apply_city_settlement(city, prediction)
            actual_bucket = apply_city_settlement(city, actual)
        except Exception:
            continue
        if pred_bucket is None or actual_bucket is None:
            continue
        total += 1
        if pred_bucket == actual_bucket:
            hits += 1
        errors.append(abs(prediction - actual))
        signed_errors.append(prediction - actual)
        cities.add(city)
        dates.add(target_date)

    return {
        "start_date": start_date,
        "end_date": end_date,
        "samples": total,
        "hits": hits,
        "hit_rate": _round_metric((hits / total * 100) if total else None, 1),
        "mae": _round_metric((sum(errors) / len(errors)) if errors else None, 2),
        "bias": _round_metric((sum(signed_errors) / len(signed_errors)) if signed_errors else None, 2),
        "city_count": len(cities),
        "date_count": len(dates),
    }


def _build_city_deb_rows(
    city_id: str,
    city_rows: Dict[str, Dict[str, Any]],
    today_str: str,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for target_date, record in sorted((city_rows or {}).items()):
        if target_date >= today_str or not isinstance(record, dict):
            continue
        rows.append(
            {
                "city": city_id,
                "target_date": target_date,
                "actual_high": record.get("actual_high"),
                "deb_prediction": record.get("deb_prediction"),
            }
        )
    return rows


def _deb_recent_bias_direction(bias: Optional[float]) -> str:
    if bias is None:
        return "unknown"
    if bias <= -0.5:
        return "under"
    if bias >= 0.5:
        return "over"
    return "neutral"


def _build_deb_recent_trust_strategy(
    recent_7d: Dict[str, Any],
    recent_14d: Dict[str, Any],
) -> Dict[str, Any]:
    window_key = "recent_14d" if int(recent_14d.get("samples") or 0) >= int(recent_7d.get("samples") or 0) else "recent_7d"
    metrics = recent_14d if window_key == "recent_14d" else recent_7d
    samples = int(metrics.get("samples") or 0)
    hit_rate = _sf(metrics.get("hit_rate"))
    mae = _sf(metrics.get("mae"))
    bias = _sf(metrics.get("bias"))

    if samples < 3 or hit_rate is None or mae is None:
        trust_tier = "insufficient"
        recommendation = "insufficient"
        reason = f"{window_key}: only {samples} settled DEB samples."
    elif hit_rate >= 67.0 and mae <= 1.25:
        trust_tier = "high"
        recommendation = "primary"
        reason = f"{window_key}: {hit_rate:.1f}% hit rate, MAE {mae:.2f}°."
    elif hit_rate >= 34.0 and mae <= 1.75:
        trust_tier = "medium"
        recommendation = "supporting"
        reason = f"{window_key}: {hit_rate:.1f}% hit rate, MAE {mae:.2f}°."
    else:
        trust_tier = "low"
        recommendation = "context_only"
        reason = f"{window_key}: {hit_rate:.1f}% hit rate, MAE {mae:.2f}°."

    return {
        "trust_tier": trust_tier,
        "recommendation": recommendation,
        "bias_direction": _deb_recent_bias_direction(bias),
        "reason": reason,
    }


def _build_city_deb_recent_strategy(
    city_id: str,
    city_rows: Dict[str, Dict[str, Any]],
    today_str: str,
) -> Optional[Dict[str, Any]]:
    today_date = datetime.strptime(today_str, "%Y-%m-%d").date()
    recent_7_start = (today_date - timedelta(days=7)).isoformat()
    recent_14_start = (today_date - timedelta(days=14)).isoformat()
    end_date = (today_date - timedelta(days=1)).isoformat()
    rows = _build_city_deb_rows(city_id, city_rows, today_str)
    if not rows:
        return None
    recent_7d = _evaluate_deb_records(rows, start_date=recent_7_start, end_date=end_date)
    recent_14d = _evaluate_deb_records(rows, start_date=recent_14_start, end_date=end_date)
    return {
        "recent_7d": recent_7d,
        "recent_14d": recent_14d,
        **_build_deb_recent_trust_strategy(recent_7d, recent_14d),
    }


def _build_city_deb_accuracy(city_id: str, city_rows: Dict[str, Dict[str, Any]], today_str: str) -> Optional[Dict[str, Any]]:
    rows = _build_city_deb_rows(city_id, city_rows, today_str)
    metrics = _evaluate_deb_records(rows)
    if not metrics["samples"]:
        return None
    total = int(metrics["samples"])
    hits = int(metrics["hits"])
    mae = float(metrics["mae"] or 0.0)
    hit_rate = float(metrics["hit_rate"] or 0.0)
    return {
        "hit_rate": hit_rate,
        "mae": mae,
        "total_days": total,
        "hits": hits,
        "details_str": f"过去{total}天 WU命中 {hits}/{total} ({hit_rate:.0f}%) | MAE: {mae:.1f}°",
    }


def _build_city_mu_accuracy(city_id: str, city_rows: Dict[str, Dict[str, Any]], today_str: str) -> Optional[Dict[str, Any]]:
    from src.analysis.settlement_rounding import apply_city_settlement

    errors: List[float] = []
    hits = 0
    total = 0
    brier_scores: List[float] = []
    for target_date, record in sorted((city_rows or {}).items()):
        if target_date >= today_str or not isinstance(record, dict):
            continue
        actual = _sf(record.get("actual_high"))
        mu_value = _sf(record.get("mu"))
        if actual is None or mu_value is None:
            continue
        total += 1
        errors.append(abs(mu_value - actual))
        if apply_city_settlement(city_id, mu_value) == apply_city_settlement(city_id, actual):
            hits += 1
        prob_snapshot = record.get("prob_snapshot") or []
        if isinstance(prob_snapshot, list):
            actual_bucket = apply_city_settlement(city_id, actual)
            score = 0.0
            used = False
            for entry in prob_snapshot:
                if not isinstance(entry, dict):
                    continue
                predicted_p = _sf(entry.get("p")) or 0.0
                outcome = 1.0 if entry.get("v") == actual_bucket else 0.0
                score += (predicted_p - outcome) ** 2
                used = True
            if used:
                brier_scores.append(score)

    if not total:
        return None
    mae = sum(errors) / len(errors)
    hit_rate = hits / total * 100
    brier = (sum(brier_scores) / len(brier_scores)) if brier_scores else None
    details_parts = [
        f"μ准确率: 过去{total}天",
        f"WU命中 {hits}/{total} ({hit_rate:.0f}%)",
        f"MAE: {mae:.1f}°",
    ]
    if brier is not None:
        details_parts.append(f"Brier: {brier:.3f}")
    return {
        "mae": mae,
        "hit_rate": hit_rate,
        "brier_score": brier,
        "total_days": total,
        "hits": hits,
        "details_str": " | ".join(details_parts),
    }


def _build_deb_historical_summary(accuracy_data: List[Dict[str, Any]]) -> Dict[str, Any]:
    deb_rows = [row for row in accuracy_data if row.get("deb")]
    if not deb_rows:
        return {
            "city_count": 0,
            "avg_hit_rate": None,
            "weighted_hit_rate": None,
            "avg_mae": None,
            "avg_days_per_city": 0,
            "sample_days": 0,
            "hits": 0,
        }
    sample_days = sum(int(row["deb"].get("total_days") or 0) for row in deb_rows)
    hits = sum(int(row["deb"].get("hits") or 0) for row in deb_rows)
    return {
        "city_count": len(deb_rows),
        "avg_hit_rate": _round_metric(
            sum(float(row["deb"].get("hit_rate") or 0.0) for row in deb_rows) / len(deb_rows),
            1,
        ),
        "weighted_hit_rate": _round_metric((hits / sample_days * 100) if sample_days else None, 1),
        "avg_mae": _round_metric(
            sum(float(row["deb"].get("mae") or 0.0) for row in deb_rows) / len(deb_rows),
            2,
        ),
        "avg_days_per_city": round(sample_days / len(deb_rows)) if deb_rows else 0,
        "sample_days": sample_days,
        "hits": hits,
    }


def _build_deb_usable_recent_summary(
    accuracy_data: List[Dict[str, Any]],
) -> Dict[str, Any]:
    usable_rows = []
    recommendations = {"primary": 0, "supporting": 0}
    for row in accuracy_data:
        recent = row.get("deb_recent") if isinstance(row.get("deb_recent"), dict) else None
        if not recent:
            continue
        recommendation = str(recent.get("recommendation") or "").strip().lower()
        if recommendation not in {"primary", "supporting"}:
            continue
        usable_rows.append(row)
        recommendations[recommendation] += 1

    def build_window(window_key: str) -> Dict[str, Any]:
        samples = 0
        hits = 0
        weighted_mae = 0.0
        city_count = 0
        for row in usable_rows:
            recent = row.get("deb_recent") if isinstance(row.get("deb_recent"), dict) else {}
            metrics = recent.get(window_key) if isinstance(recent.get(window_key), dict) else {}
            row_samples = int(metrics.get("samples") or 0)
            if row_samples <= 0:
                continue
            row_hits = int(metrics.get("hits") or 0)
            row_mae = _sf(metrics.get("mae"))
            samples += row_samples
            hits += row_hits
            city_count += 1
            if row_mae is not None:
                weighted_mae += row_mae * row_samples
        return {
            "window": window_key,
            "city_count": city_count,
            "samples": samples,
            "hits": hits,
            "hit_rate": _round_metric((hits / samples * 100) if samples else None, 1),
            "avg_mae": _round_metric((weighted_mae / samples) if samples else None, 2),
            "recommendations": dict(recommendations),
        }

    recent_7d = build_window("recent_7d")
    if int(recent_7d.get("samples") or 0) > 0:
        return recent_7d
    return build_window("recent_14d")


def _flatten_training_history(history: Dict[str, Dict[str, Dict[str, Any]]], today_str: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for city, city_rows in (history or {}).items():
        if not isinstance(city_rows, dict):
            continue
        for target_date, record in city_rows.items():
            if not isinstance(record, dict):
                continue
            target_text = str(target_date or "").strip()
            if not target_text or target_text >= today_str:
                continue
            rows.append(
                {
                    "city": str(city or "").strip().lower(),
                    "target_date": target_text,
                    "actual_high": record.get("actual_high"),
                    "deb_prediction": record.get("deb_prediction"),
                    "mu": record.get("mu"),
                    "prob_snapshot": record.get("prob_snapshot"),
                }
            )
    rows.sort(key=lambda row: (row["target_date"], row["city"]))
    return rows


def _build_training_accuracy_payload(
    history: Dict[str, Dict[str, Dict[str, Any]]],
    city_registry: Dict[str, Dict[str, Any]],
    *,
    today_str: Optional[str] = None,
) -> Dict[str, Any]:
    from src.analysis.deb_evaluation import backtest_deb_versions

    today = today_str or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    accuracy_data: List[Dict[str, Any]] = []
    for city_id, info in (city_registry or {}).items():
        city_rows = history.get(city_id) or history.get(str(city_id).strip().lower()) or {}
        deb_payload = _build_city_deb_accuracy(city_id, city_rows, today)
        deb_recent = _build_city_deb_recent_strategy(city_id, city_rows, today) if deb_payload else None
        mu_payload = _build_city_mu_accuracy(city_id, city_rows, today)
        if deb_payload or mu_payload:
            accuracy_data.append(
                {
                    "city_id": city_id,
                    "name": (info or {}).get("name") or city_id,
                    "deb": deb_payload,
                    "deb_recent": deb_recent,
                    "mu": mu_payload,
                }
            )

    accuracy_data.sort(
        key=lambda row: max(
            row["deb"]["total_days"] if row.get("deb") else 0,
            row["mu"]["total_days"] if row.get("mu") else 0,
        ),
        reverse=True,
    )

    all_rows = _flatten_training_history(history, today)
    today_date = datetime.strptime(today, "%Y-%m-%d").date()
    recent_7_start = (today_date - timedelta(days=7)).isoformat()
    recent_14_start = (today_date - timedelta(days=14)).isoformat()
    end_date = (today_date - timedelta(days=1)).isoformat()
    version_rows = all_rows[-_DEB_VERSION_BACKTEST_SAMPLE_LIMIT:]
    versions = backtest_deb_versions(
        version_rows,
        min_train_samples=2,
    ).get("versions", {})

    return {
        "accuracy": accuracy_data,
        "deb_summary": {
            "historical": _build_deb_historical_summary(accuracy_data),
            "usable_recent": _build_deb_usable_recent_summary(accuracy_data),
            "recent_7d": _evaluate_deb_records(
                all_rows,
                start_date=recent_7_start,
                end_date=end_date,
            ),
            "recent_14d": _evaluate_deb_records(
                all_rows,
                start_date=recent_14_start,
                end_date=end_date,
            ),
            "versions": versions,
        },
    }


def get_ops_training_accuracy(request: Request) -> Dict[str, Any]:
    from src.analysis.deb_algorithm import load_history
    from src.data_collection.city_registry import CITY_REGISTRY

    history_file = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
        "data",
        "daily_records.json",
    )
    history = load_history(history_file)
    return _build_training_accuracy_payload(history, CITY_REGISTRY)


# ── Truth history ─────────────────────────────────────────────────────

def get_ops_truth_history(
    request: Request,
    city: str = "",
    date_from: str = "",
    date_to: str = "",
    limit: int = 200,
) -> Dict[str, Any]:
    from web.services.ops_api import _require_ops

    _require_ops(request)

    truth_history = legacy_routes.TruthRecordRepository().load_all()
    normalized_city = str(city or "").strip().lower()
    normalized_from = str(date_from or "").strip()
    normalized_to = str(date_to or "").strip()
    max_limit = max(1, min(int(limit or 200), 1000))

    rows = []
    for row_city, by_date in truth_history.items():
        if normalized_city and row_city != normalized_city:
            continue
        if not isinstance(by_date, dict):
            continue
        for target_date, payload in by_date.items():
            if normalized_from and str(target_date) < normalized_from:
                continue
            if normalized_to and str(target_date) > normalized_to:
                continue
            if not isinstance(payload, dict):
                continue
            rows.append(
                {
                    "city": row_city,
                    "display_name": str(
                        (legacy_routes.CITY_REGISTRY.get(row_city) or {}).get("name")
                        or row_city
                    ),
                    "target_date": str(target_date),
                    "actual_high": payload.get("actual_high"),
                    "settlement_source": payload.get("settlement_source"),
                    "settlement_station_code": payload.get("settlement_station_code"),
                    "settlement_station_label": payload.get("settlement_station_label"),
                    "truth_version": payload.get("truth_version"),
                    "updated_by": payload.get("updated_by"),
                    "truth_updated_at": payload.get("truth_updated_at"),
                    "is_final": payload.get("is_final"),
                }
            )

    rows.sort(
        key=lambda item: (str(item["target_date"]), str(item["city"])), reverse=True
    )
    filtered_count = len(rows)
    rows = rows[:max_limit]
    available_cities = [
        {
            "city": city_id,
            "name": str(info.get("name") or city_id),
        }
        for city_id, info in sorted(
            legacy_routes.CITY_REGISTRY.items(),
            key=lambda item: str(item[1].get("name") or item[0]),
        )
    ]
    return {
        "items": rows,
        "available_cities": available_cities,
        "filters": {
            "city": normalized_city or None,
            "date_from": normalized_from or None,
            "date_to": normalized_to or None,
            "limit": max_limit,
        },
        "filtered_count": filtered_count,
    }
