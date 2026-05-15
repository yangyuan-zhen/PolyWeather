"""City payload builders for API-facing response shapes."""

from __future__ import annotations

from typing import Any, Dict, Optional

from src.analysis.settlement_rounding import apply_city_settlement
from web.core import _is_excluded_model_name, _market_layer, _sf

TURKISH_MGM_CITIES = {"ankara", "istanbul"}


def build_city_summary_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "name": data.get("name"),
        "display_name": data.get("display_name"),
        "icao": data.get("risk", {}).get("icao"),
        "utc_offset_seconds": data.get("utc_offset_seconds"),
        "local_time": data.get("local_time"),
        "temp_symbol": data.get("temp_symbol"),
        "current": {
            "temp": data.get("current", {}).get("temp"),
            "obs_time": data.get("current", {}).get("obs_time"),
            "settlement_source": data.get("current", {}).get("settlement_source"),
            "settlement_source_label": data.get("current", {}).get("settlement_source_label"),
        },
        "deb": {"prediction": data.get("deb", {}).get("prediction")},
        "deviation_monitor": data.get("deviation_monitor") or {},
        "risk": {
            "level": data.get("risk", {}).get("level"),
            "warning": data.get("risk", {}).get("warning"),
        },
        "updated_at": data.get("updated_at"),
    }


def build_city_market_scan_payload(
    data: Dict[str, Any],
    market_slug: Optional[str] = None,
    target_date: Optional[str] = None,
    lite: bool = False,
    scan_filters: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    city = str(data.get("name") or "").strip().lower()
    local_date = str(data.get("local_date") or "").strip()
    requested_date = str(target_date or "").strip()
    selected_date = requested_date or local_date

    multi_model_daily = data.get("multi_model_daily") or {}
    selected_daily = (
        multi_model_daily.get(selected_date)
        if isinstance(multi_model_daily, dict)
        else None
    )
    if not isinstance(selected_daily, dict):
        selected_daily = {}
        selected_date = local_date

    distribution = selected_daily.get("probabilities")
    if not isinstance(distribution, list) or not distribution:
        distribution = data.get("probabilities", {}).get("distribution", []) or []
    distribution_all = selected_daily.get("probabilities_all")
    if not isinstance(distribution_all, list) or not distribution_all:
        distribution_all = data.get("probabilities", {}).get("distribution_all", []) or []
    if not distribution_all:
        distribution_all = distribution

    model_map = selected_daily.get("models") or data.get("multi_model") or {}
    if not isinstance(model_map, dict):
        model_map = {}

    anchor_temp = None
    anchor_model = None
    for model_name, raw_value in model_map.items():
        value = _sf(raw_value)
        if value is None:
            continue
        if anchor_temp is None or value > anchor_temp:
            anchor_temp = value
            anchor_model = str(model_name or "").strip() or None

    anchor_temp_c = anchor_temp
    temp_symbol = str(data.get("temp_symbol") or "")
    if anchor_temp_c is not None and "F" in temp_symbol.upper():
        anchor_temp_c = (anchor_temp_c - 32.0) * 5.0 / 9.0
    anchor_settlement = apply_city_settlement(city, anchor_temp_c) if anchor_temp_c is not None else None

    primary_bucket = None
    if isinstance(distribution, list) and distribution:
        ranked_buckets = []
        temp_symbol_upper = str(temp_symbol or "").upper()
        max_primary_bucket_delta = 16.0 if "F" in temp_symbol_upper else 8.0
        for idx, row in enumerate(distribution_all):
            if not isinstance(row, dict):
                continue
            bucket_value = _sf(
                row.get("temp")
                if row.get("temp") is not None
                else row.get("value")
                if row.get("value") is not None
                else row.get("lower")
            )
            if (
                anchor_temp is not None
                and bucket_value is not None
                and abs(float(bucket_value) - float(anchor_temp)) > max_primary_bucket_delta
            ):
                continue
            bucket_prob = _sf(row.get("probability"))
            prob_rank = bucket_prob if bucket_prob is not None else -1.0
            ranked_buckets.append((-prob_rank, idx, row))
        if ranked_buckets:
            ranked_buckets.sort(key=lambda x: (x[0], x[1]))
            primary_bucket = ranked_buckets[0][2]
        elif anchor_temp is None:
            primary_bucket = distribution[0]

    model_probability = None
    if isinstance(primary_bucket, dict) and primary_bucket.get("probability") is not None:
        try:
            raw_probability = float(primary_bucket.get("probability"))
            model_probability = raw_probability / 100.0 if raw_probability > 1.0 else raw_probability
        except Exception:
            model_probability = None

    fallback_sparkline = [
        p.get("probability", 0)
        for p in distribution_all[:8]
        if isinstance(p, dict)
    ]
    current = data.get("current") or {}
    selected_deb = selected_daily.get("deb") if isinstance(selected_daily.get("deb"), dict) else {}
    current_deb = data.get("deb") if isinstance(data.get("deb"), dict) else {}
    scan_context = {
        "local_date": data.get("local_date"),
        "local_time": data.get("local_time"),
        "peak": data.get("peak") or {},
        "current_max_so_far": current.get("max_so_far"),
        "current_temp": current.get("temp"),
        "trend": data.get("trend") or {},
        "network_lead_signal": data.get("network_lead_signal") or {},
        "models": model_map,
        "deb_prediction": selected_deb.get("prediction") or current_deb.get("prediction"),
    }
    market_scan = _market_layer.build_market_scan(
        city=data.get("name"),
        target_date=selected_date or data.get("local_date"),
        temperature_bucket=primary_bucket if isinstance(primary_bucket, dict) else None,
        model_probability=model_probability,
        probability_distribution=distribution_all,
        temp_symbol=temp_symbol,
        fallback_sparkline=fallback_sparkline,
        forced_market_slug=market_slug,
        include_related_buckets=not lite,
        scan_filters=scan_filters,
        scan_context=scan_context,
    )
    if isinstance(market_scan, dict):
        market_scan["anchor_model"] = anchor_model
        market_scan["anchor_high"] = anchor_temp
        market_scan["anchor_settlement"] = anchor_settlement
        market_scan["open_meteo_settlement"] = anchor_settlement
        probabilities = data.get("probabilities") or {}
        market_scan["probability_engine"] = str(
            probabilities.get("engine") or "legacy"
        ).strip() or "legacy"
        market_scan["probability_calibration_mode"] = str(
            probabilities.get("calibration_mode") or "legacy"
        ).strip() or "legacy"
    return {
        "market_scan": market_scan,
        "selected_date": selected_date or data.get("local_date"),
        "fetched_at": data.get("updated_at"),
    }


def build_city_detail_payload(
    data: Dict[str, Any],
    market_slug: Optional[str] = None,
    target_date: Optional[str] = None,
) -> Dict[str, Any]:
    market_payload = build_city_market_scan_payload(
        data,
        market_slug=market_slug,
        target_date=target_date,
    )
    market_scan = market_payload.get("market_scan")
    return {
        "city": data.get("name"),
        "fetched_at": data.get("updated_at"),
        "overview": {
            "name": data.get("name"),
            "display_name": data.get("display_name"),
            "icao": data.get("risk", {}).get("icao"),
            "airport": data.get("risk", {}).get("airport"),
            "lat": data.get("lat"),
            "lon": data.get("lon"),
            "local_time": data.get("local_time"),
            "local_date": data.get("local_date"),
            "temp_symbol": data.get("temp_symbol"),
            "current_temp": data.get("current", {}).get("temp"),
            "settlement_source": data.get("current", {}).get("settlement_source"),
            "settlement_source_label": data.get("current", {}).get("settlement_source_label"),
            "settlement_station": data.get("settlement_station") or {},
            "deb_prediction": data.get("deb", {}).get("prediction"),
            "risk_level": data.get("risk", {}).get("level"),
            "risk_warning": data.get("risk", {}).get("warning"),
            "updated_at": data.get("updated_at"),
        },
        "official": {
            "available": bool(data.get("current", {}).get("temp") is not None),
            "metar": {
                "observation_time": data.get("airport_current", {}).get("obs_time"),
                "obs_age_min": data.get("airport_current", {}).get("obs_age_min"),
                "report_time": data.get("airport_current", {}).get("report_time"),
                "receipt_time": data.get("airport_current", {}).get("receipt_time"),
                "raw_metar": data.get("airport_current", {}).get("raw_metar"),
                "current": data.get("airport_current") or {},
            },
            "taf": data.get("taf") or {},
            "weather_gov": {},
            "mgm": data.get("mgm") or {},
            "mgm_nearby": data.get("mgm_nearby") or [],
            "nearby_source": data.get("nearby_source") or ("mgm" if str(data.get("name") or "").lower() in TURKISH_MGM_CITIES else "metar_cluster"),
            "airport_primary": data.get("airport_primary") or {},
            "airport_primary_today_obs": data.get("airport_primary_today_obs") or [],
            "official_nearby": data.get("official_nearby") or [],
            "official_network_source": data.get("official_network_source"),
            "official_network_status": data.get("official_network_status") or {},
            "network_lead_signal": data.get("network_lead_signal") or {},
            "network_spread_signal": data.get("network_spread_signal") or {},
            "center_station_candidate": data.get("center_station_candidate"),
            "airport_vs_network_delta": data.get("airport_vs_network_delta"),
        },
        "timeseries": {
            "metar_recent_obs": data.get("metar_recent_obs") or [],
            "metar_today_obs": data.get("metar_today_obs") or [],
            "settlement_today_obs": data.get("settlement_today_obs") or [],
            "hourly": data.get("hourly") or {},
            "mgm_hourly": (data.get("mgm") or {}).get("hourly", []),
            "forecast_daily": (data.get("forecast") or {}).get("daily", []),
        },
        "models": {
            k: v
            for k, v in (data.get("multi_model") or {}).items()
            if not _is_excluded_model_name(k)
        },
        "deb": data.get("deb") or {},
        "multi_model_daily": data.get("multi_model_daily") or {},
        "probabilities": data.get("probabilities") or {"mu": None, "distribution": []},
        "dynamic_commentary": data.get("dynamic_commentary") or {"summary": "", "notes": []},
        "intraday_meteorology": data.get("intraday_meteorology")
        or _build_intraday_meteorology(data),
        "vertical_profile_signal": data.get("vertical_profile_signal") or {},
        "taf": data.get("taf") or {},
        "market_scan": market_scan,
        "risk": data.get("risk"),
        "settlement_station": data.get("settlement_station") or {},
        "airport_primary": data.get("airport_primary") or {},
        "official_nearby": data.get("official_nearby") or [],
        "official_network_source": data.get("official_network_source"),
        "official_network_status": data.get("official_network_status") or {},
        "network_lead_signal": data.get("network_lead_signal") or {},
        "network_spread_signal": data.get("network_spread_signal") or {},
        "center_station_candidate": data.get("center_station_candidate"),
        "airport_vs_network_delta": data.get("airport_vs_network_delta"),
        "airport_current": data.get("airport_current") or {},
        "amos": data.get("amos") or {},
        "nearby_source": data.get("nearby_source") or ("mgm" if str(data.get("name") or "").lower() in TURKISH_MGM_CITIES else "metar_cluster"),
        "ai_analysis": data.get("ai_analysis") or "",
        "errors": {},
    }


def _build_intraday_meteorology(data: Dict[str, Any]) -> Dict[str, Any]:
    from web.analysis_service import _build_intraday_meteorology as build_intraday

    return build_intraday(data)
