"""City payload builders for API-facing response shapes."""

from __future__ import annotations

from typing import Any, Dict, Optional

from web.core import _is_excluded_model_name

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
            "settlement_source_label": data.get("current", {}).get(
                "settlement_source_label"
            ),
        },
        "deb": {"prediction": data.get("deb", {}).get("prediction")},
        "deviation_monitor": data.get("deviation_monitor") or {},
        "risk": {
            "level": data.get("risk", {}).get("level"),
            "warning": data.get("risk", {}).get("warning"),
        },
        "updated_at": data.get("updated_at"),
    }


def build_city_detail_payload(
    data: Dict[str, Any],
    market_slug: Optional[str] = None,
    target_date: Optional[str] = None,
) -> Dict[str, Any]:
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
            "settlement_source_label": data.get("current", {}).get(
                "settlement_source_label"
            ),
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
            "nearby_source": data.get("nearby_source")
            or (
                "mgm"
                if str(data.get("name") or "").lower() in TURKISH_MGM_CITIES
                else "metar_cluster"
            ),
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
        "models_hourly": {
            "times": (data.get("multi_model") or {}).get("hourly_times", []),
            "curves": {
                model: values
                for model, values in (
                    (data.get("multi_model") or {}).get("hourly_forecasts", {})
                ).items()
                if not _is_excluded_model_name(model)
            },
        },
        "deb": data.get("deb") or {},
        "multi_model_daily": data.get("multi_model_daily") or {},
        "probabilities": data.get("probabilities") or {"mu": None, "distribution": []},
        "dynamic_commentary": data.get("dynamic_commentary")
        or {"summary": "", "notes": []},
        "intraday_meteorology": data.get("intraday_meteorology")
        or _build_intraday_meteorology(data),
        "vertical_profile_signal": data.get("vertical_profile_signal") or {},
        "taf": data.get("taf") or {},

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
        "nearby_source": data.get("nearby_source")
        or (
            "mgm"
            if str(data.get("name") or "").lower() in TURKISH_MGM_CITIES
            else "metar_cluster"
        ),
        "ai_analysis": data.get("ai_analysis") or "",
        "errors": {},
    }


def _build_intraday_meteorology(data: Dict[str, Any]) -> Dict[str, Any]:
    from web.analysis_service import _build_intraday_meteorology as build_intraday

    return build_intraday(data)
