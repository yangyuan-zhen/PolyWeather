from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from src.data_collection.city_registry import CITY_REGISTRY


CHINA_CMA_CITIES = {
    "beijing",
    "chengdu",
    "chongqing",
    "shanghai",
    "shenzhen",
    "wuhan",
}


def _japan_jma_cities() -> set[str]:
    return {"tokyo"}


def _safe_float(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except Exception:
        return None


def _city_meta(city: str) -> Dict[str, Any]:
    return CITY_REGISTRY.get(str(city or "").strip().lower(), {}) or {}


def _provider_code_for_city(city: str) -> str:
    normalized = str(city or "").strip().lower()
    meta = _city_meta(normalized)
    settlement_source = str(meta.get("settlement_source") or "").strip().lower()
    if normalized in {"ankara", "istanbul"}:
        return "turkey_mgm"
    if normalized in {"busan", "seoul"}:
        return "korea_kma"
    if normalized == "moscow":
        return "russia_station_web"
    if settlement_source == "hko":
        return "hongkong_hko"
    if settlement_source == "cwa":
        return "taiwan_cwa"
    if normalized in _japan_jma_cities():
        return "japan_jma"
    if normalized in CHINA_CMA_CITIES:
        return "china_cma"
    return "global_metar"


def _bool(value: Any) -> bool:
    return bool(value)


def _normalize_station_row(
    *,
    station_code: Optional[str],
    station_label: Optional[str],
    temp: Any,
    lat: Any = None,
    lon: Any = None,
    obs_time: Optional[str] = None,
    source_code: str,
    source_label: str,
    is_official: bool,
    is_airport_station: bool,
    is_settlement_anchor: bool,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    payload = {
        "station_code": str(station_code or "").strip() or None,
        "station_label": str(station_label or "").strip() or None,
        "is_airport_station": bool(is_airport_station),
        "lat": _safe_float(lat),
        "lon": _safe_float(lon),
        "obs_time": str(obs_time or "").strip() or None,
        "temp": _safe_float(temp),
        "source_code": str(source_code or "").strip().lower() or None,
        "source_label": str(source_label or "").strip() or None,
        "is_official": bool(is_official),
        "is_settlement_anchor": bool(is_settlement_anchor),
    }
    if isinstance(extra, dict):
        for key, value in extra.items():
            if key not in payload:
                payload[key] = value
    return payload


def _airport_primary_from_raw(city: str, raw: Dict[str, Any]) -> Dict[str, Any]:
    meta = _city_meta(city)
    metar = raw.get("metar") or {}
    current = metar.get("current") or {}
    return _normalize_station_row(
        station_code=meta.get("icao") or metar.get("icao"),
        station_label=meta.get("airport_name") or metar.get("station_name") or metar.get("icao"),
        temp=current.get("temp"),
        obs_time=metar.get("observation_time"),
        source_code="metar",
        source_label="METAR",
        is_official=True,
        is_airport_station=True,
        is_settlement_anchor=False,
        extra={
            "max_so_far": _safe_float(current.get("max_temp_so_far")),
            "max_temp_time": current.get("max_temp_time"),
            "obs_age_min": None,
            "report_time": metar.get("report_time"),
            "receipt_time": metar.get("receipt_time"),
            "obs_time_epoch": metar.get("obs_time_epoch"),
            "wind_speed_kt": _safe_float(current.get("wind_speed_kt")),
            "wind_dir": _safe_float(current.get("wind_dir")),
            "humidity": _safe_float(current.get("humidity")),
            "visibility_mi": _safe_float(current.get("visibility_mi")),
            "wx_desc": current.get("wx_desc"),
            "raw_metar": current.get("raw_metar"),
        },
    )


def _metar_cluster_rows(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows = raw.get("mgm_nearby") or []
    out: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        out.append(
            _normalize_station_row(
                station_code=row.get("icao") or row.get("istNo"),
                station_label=row.get("name"),
                temp=row.get("temp"),
                lat=row.get("lat"),
                lon=row.get("lon"),
                source_code="metar_cluster",
                source_label="METAR cluster",
                is_official=False,
                is_airport_station=True,
                is_settlement_anchor=False,
                extra={
                    "wind_dir": _safe_float(row.get("wind_dir")),
                    "wind_speed_kt": _safe_float(row.get("wind_speed_kt") or row.get("wind_speed")),
                    "raw_metar": row.get("raw_metar"),
                },
            )
        )
    return out


def _nmc_rows(raw: Dict[str, Any], city: str) -> List[Dict[str, Any]]:
    rows = raw.get("nmc_official_nearby") or []
    out: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        out.append(
            _normalize_station_row(
                station_code=row.get("icao") or row.get("istNo"),
                station_label=row.get("name"),
                temp=row.get("temp"),
                lat=row.get("lat"),
                lon=row.get("lon"),
                obs_time=row.get("obs_time"),
                source_code="nmc",
                source_label="NMC",
                is_official=True,
                is_airport_station=False,
                is_settlement_anchor=False,
                extra={
                    "page_url": row.get("page_url"),
                    "humidity": _safe_float(row.get("humidity")),
                    "rain": _safe_float(row.get("rain")),
                    "airpressure": _safe_float(row.get("airpressure")),
                    "wx_desc": row.get("wx_desc"),
                    "wind_direction_text": row.get("wind_direction_text"),
                    "wind_power_text": row.get("wind_power_text"),
                },
            )
        )
    return out


def _jma_rows(raw: Dict[str, Any], city: str) -> List[Dict[str, Any]]:
    rows = raw.get("jma_official_nearby") or []
    out: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        out.append(
            _normalize_station_row(
                station_code=row.get("icao") or row.get("istNo"),
                station_label=row.get("name"),
                temp=row.get("temp"),
                lat=row.get("lat"),
                lon=row.get("lon"),
                obs_time=row.get("obs_time"),
                source_code="jma",
                source_label="JMA",
                is_official=True,
                is_airport_station=False,
                is_settlement_anchor=False,
            )
        )
    return out


def _kma_rows(raw: Dict[str, Any], city: str) -> List[Dict[str, Any]]:
    rows = raw.get("kma_official_nearby") or []
    out: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        out.append(
            _normalize_station_row(
                station_code=row.get("station_code") or row.get("icao") or row.get("istNo"),
                station_label=row.get("station_label") or row.get("name"),
                temp=row.get("temp"),
                lat=row.get("lat"),
                lon=row.get("lon"),
                obs_time=row.get("obs_time"),
                source_code="kma",
                source_label="KMA",
                is_official=True,
                is_airport_station=False,
                is_settlement_anchor=False,
                extra={
                    "distance_km": _safe_float(row.get("distance_km")),
                    "network_type": row.get("network_type"),
                },
            )
        )
    return out


def _ru_rows(raw: Dict[str, Any], city: str) -> List[Dict[str, Any]]:
    rows = raw.get("ru_official_nearby") or []
    out: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        out.append(
            _normalize_station_row(
                station_code=row.get("station_code") or row.get("icao") or row.get("istNo"),
                station_label=row.get("station_label") or row.get("name"),
                temp=row.get("temp"),
                lat=row.get("lat"),
                lon=row.get("lon"),
                obs_time=row.get("obs_time"),
                source_code="ru_station_web",
                source_label="Russia station web",
                is_official=True,
                is_airport_station=_bool(row.get("is_airport_station")),
                is_settlement_anchor=False,
                extra={
                    "distance_km": _safe_float(row.get("distance_km")),
                    "page_url": row.get("page_url"),
                },
            )
        )
    return out


def _mgm_rows(raw: Dict[str, Any], city: str) -> List[Dict[str, Any]]:
    meta = _city_meta(city)
    rows = raw.get("mgm_nearby") or []
    out: List[Dict[str, Any]] = []
    airport_code = str(meta.get("icao") or "").strip().upper()
    for row in rows:
        if not isinstance(row, dict):
            continue
        station_code = str(row.get("icao") or row.get("istNo") or "").strip() or None
        station_label = row.get("name")
        out.append(
            _normalize_station_row(
                station_code=station_code,
                station_label=station_label,
                temp=row.get("temp"),
                lat=row.get("lat"),
                lon=row.get("lon"),
                source_code="mgm",
                source_label="MGM",
                is_official=True,
                is_airport_station=_bool(station_code and station_code.upper() == airport_code)
                or ("airport" in str(station_label or "").lower()),
                is_settlement_anchor=False,
                extra={
                    "wind_dir": _safe_float(row.get("wind_dir")),
                    "wind_speed_kt": _safe_float(row.get("wind_speed_kt") or row.get("wind_speed")),
                },
            )
        )
    return out


def _settlement_anchor_row(city: str, raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    meta = _city_meta(city)
    settlement_current = raw.get("settlement_current") or {}
    current = settlement_current.get("current") or {}
    if not current and not settlement_current:
        return None
    station_code = (
        settlement_current.get("station_code")
        or meta.get("settlement_station_code")
        or meta.get("icao")
    )
    station_label = (
        settlement_current.get("station_name")
        or meta.get("settlement_station_label")
        or meta.get("airport_name")
    )
    settlement_source = str(meta.get("settlement_source") or "official").strip().lower() or "official"
    return _normalize_station_row(
        station_code=station_code,
        station_label=station_label,
        temp=current.get("temp"),
        obs_time=settlement_current.get("observation_time"),
        source_code=settlement_source,
        source_label=settlement_source.upper(),
        is_official=True,
        is_airport_station=False,
        is_settlement_anchor=True,
        extra={
            "max_so_far": _safe_float(current.get("max_temp_so_far")),
            "max_temp_time": current.get("max_temp_time"),
            "humidity": _safe_float(current.get("humidity")),
            "wind_speed_kt": _safe_float(current.get("wind_speed_kt")),
            "wind_dir": _safe_float(current.get("wind_dir")),
        },
    )


def _settlement_station_metadata(city: str) -> Dict[str, Any]:
    meta = _city_meta(city)
    settlement_source = str(meta.get("settlement_source") or "metar").strip().lower() or "metar"
    station_code = (
        str(meta.get("settlement_station_code") or "").strip()
        or str(meta.get("icao") or "").strip()
        or None
    )
    station_label = (
        str(meta.get("settlement_station_label") or "").strip()
        or str(meta.get("airport_name") or "").strip()
        or None
    )
    airport_code = str(meta.get("icao") or "").strip()
    is_explicit_official_anchor = settlement_source in {"hko", "cwa"}
    return {
        "provider_code": _provider_code_for_city(city),
        "settlement_source": settlement_source,
        "settlement_station_code": station_code,
        "settlement_station_label": station_label,
        "airport_code": airport_code or None,
        "airport_name": str(meta.get("airport_name") or "").strip() or None,
        "is_airport_anchor": not is_explicit_official_anchor,
        "is_official_station_anchor": is_explicit_official_anchor,
    }


def _network_signals(
    airport_primary: Optional[Dict[str, Any]],
    official_rows: List[Dict[str, Any]],
) -> Dict[str, Any]:
    airport_temp = _safe_float((airport_primary or {}).get("temp"))
    valid_rows = [row for row in official_rows if _safe_float(row.get("temp")) is not None]
    if not valid_rows:
        return {
            "network_lead_signal": {"available": False},
            "network_spread_signal": {"available": False},
            "center_station_candidate": None,
            "airport_vs_network_delta": None,
        }

    hottest = max(valid_rows, key=lambda row: float(row.get("temp") or -999))
    coolest = min(valid_rows, key=lambda row: float(row.get("temp") or 999))
    hottest_temp = _safe_float(hottest.get("temp"))
    coolest_temp = _safe_float(coolest.get("temp"))
    spread = None
    airport_delta = None
    if hottest_temp is not None and coolest_temp is not None:
        spread = round(hottest_temp - coolest_temp, 1)
    if airport_temp is not None and hottest_temp is not None:
        airport_delta = round(hottest_temp - airport_temp, 1)
    return {
        "network_lead_signal": {
            "available": airport_delta is not None,
            "delta": airport_delta,
            "leader_station_code": hottest.get("station_code"),
            "leader_station_label": hottest.get("station_label"),
            "leader_temp": hottest_temp,
        },
        "network_spread_signal": {
            "available": spread is not None,
            "spread": spread,
            "hottest_station_code": hottest.get("station_code"),
            "coolest_station_code": coolest.get("station_code"),
        },
        "center_station_candidate": hottest,
        "airport_vs_network_delta": airport_delta,
    }


@dataclass
class CountryNetworkProvider:
    provider_code: str
    provider_label: str

    def airport_primary_current(self, city: str, raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return _airport_primary_from_raw(city, raw)

    def airport_primary_history(self, city: str, target_date: str) -> Optional[Dict[str, Any]]:
        return None

    def official_nearby_current(self, city: str, raw: Dict[str, Any]) -> List[Dict[str, Any]]:
        return []

    def official_nearby_history(self, city: str, target_date: str) -> List[Dict[str, Any]]:
        return []

    def settlement_station_metadata(self, city: str) -> Dict[str, Any]:
        return _settlement_station_metadata(city)

    def official_network_status(self, city: str, raw: Dict[str, Any]) -> Dict[str, Any]:
        rows = self.official_nearby_current(city, raw)
        return {
            "provider_code": self.provider_code,
            "provider_label": self.provider_label,
            "available": bool(rows),
            "mode": "active" if rows else "unavailable",
            "row_count": len(rows),
        }


class GlobalMetarNetworkProvider(CountryNetworkProvider):
    def __init__(self) -> None:
        super().__init__("global_metar", "METAR")

    def official_nearby_current(self, city: str, raw: Dict[str, Any]) -> List[Dict[str, Any]]:
        return _metar_cluster_rows(raw)

    def official_network_status(self, city: str, raw: Dict[str, Any]) -> Dict[str, Any]:
        rows = self.official_nearby_current(city, raw)
        return {
            "provider_code": self.provider_code,
            "provider_label": self.provider_label,
            "available": bool(rows),
            "mode": "fallback_metar_cluster" if rows else "no_official_network",
            "row_count": len(rows),
        }


class TurkeyMgmNetworkProvider(CountryNetworkProvider):
    def __init__(self) -> None:
        super().__init__("turkey_mgm", "MGM")

    def official_nearby_current(self, city: str, raw: Dict[str, Any]) -> List[Dict[str, Any]]:
        return _mgm_rows(raw, city)


class ChinaCmaNetworkProvider(CountryNetworkProvider):
    def __init__(self) -> None:
        super().__init__("china_cma", "CMA/NMC")

    def official_nearby_current(self, city: str, raw: Dict[str, Any]) -> List[Dict[str, Any]]:
        rows = _nmc_rows(raw, city)
        if rows:
            return rows
        return _metar_cluster_rows(raw)

    def official_network_status(self, city: str, raw: Dict[str, Any]) -> Dict[str, Any]:
        rows = self.official_nearby_current(city, raw)
        has_nmc = bool(_nmc_rows(raw, city))
        return {
            "provider_code": self.provider_code,
            "provider_label": self.provider_label,
            "available": has_nmc,
            "mode": "official_active" if has_nmc else ("fallback_metar_cluster" if rows else "reference_only"),
            "row_count": len(rows),
        }


class JapanJmaNetworkProvider(CountryNetworkProvider):
    def __init__(self) -> None:
        super().__init__("japan_jma", "JMA")

    def official_nearby_current(self, city: str, raw: Dict[str, Any]) -> List[Dict[str, Any]]:
        rows = _jma_rows(raw, city)
        if rows:
            return rows
        return _metar_cluster_rows(raw)

    def official_network_status(self, city: str, raw: Dict[str, Any]) -> Dict[str, Any]:
        rows = self.official_nearby_current(city, raw)
        has_jma = bool(_jma_rows(raw, city))
        return {
            "provider_code": self.provider_code,
            "provider_label": self.provider_label,
            "available": has_jma,
            "mode": "official_active" if has_jma else ("fallback_metar_cluster" if rows else "reference_only"),
            "row_count": len(rows),
        }


class KoreaKmaNetworkProvider(CountryNetworkProvider):
    def __init__(self) -> None:
        super().__init__("korea_kma", "KMA")

    def official_nearby_current(self, city: str, raw: Dict[str, Any]) -> List[Dict[str, Any]]:
        rows = _kma_rows(raw, city)
        if rows:
            return rows
        return _metar_cluster_rows(raw)

    def official_network_status(self, city: str, raw: Dict[str, Any]) -> Dict[str, Any]:
        rows = self.official_nearby_current(city, raw)
        has_kma = bool(_kma_rows(raw, city))
        return {
            "provider_code": self.provider_code,
            "provider_label": self.provider_label,
            "available": has_kma,
            "mode": "official_active" if has_kma else ("fallback_metar_cluster" if rows else "reference_only"),
            "row_count": len(rows),
        }


class RussiaStationWebNetworkProvider(CountryNetworkProvider):
    def __init__(self) -> None:
        super().__init__("russia_station_web", "Russia station web")

    def official_nearby_current(self, city: str, raw: Dict[str, Any]) -> List[Dict[str, Any]]:
        rows = _ru_rows(raw, city)
        if rows:
            return rows
        return _metar_cluster_rows(raw)

    def official_network_status(self, city: str, raw: Dict[str, Any]) -> Dict[str, Any]:
        rows = self.official_nearby_current(city, raw)
        has_ru = bool(_ru_rows(raw, city))
        return {
            "provider_code": self.provider_code,
            "provider_label": self.provider_label,
            "available": has_ru,
            "mode": "official_web_crawl" if has_ru else ("fallback_metar_cluster" if rows else "reference_only"),
            "row_count": len(rows),
        }


class HongKongHkoNetworkProvider(CountryNetworkProvider):
    def __init__(self) -> None:
        super().__init__("hongkong_hko", "HKO")

    def official_nearby_current(self, city: str, raw: Dict[str, Any]) -> List[Dict[str, Any]]:
        anchor = _settlement_anchor_row(city, raw)
        return [anchor] if anchor else []


class TaiwanCwaNetworkProvider(CountryNetworkProvider):
    def __init__(self) -> None:
        super().__init__("taiwan_cwa", "CWA")

    def official_nearby_current(self, city: str, raw: Dict[str, Any]) -> List[Dict[str, Any]]:
        anchor = _settlement_anchor_row(city, raw)
        return [anchor] if anchor else []


def get_country_network_provider(city: str) -> CountryNetworkProvider:
    provider_code = _provider_code_for_city(city)
    if provider_code == "turkey_mgm":
        return TurkeyMgmNetworkProvider()
    if provider_code == "korea_kma":
        return KoreaKmaNetworkProvider()
    if provider_code == "russia_station_web":
        return RussiaStationWebNetworkProvider()
    if provider_code == "japan_jma":
        return JapanJmaNetworkProvider()
    if provider_code == "china_cma":
        return ChinaCmaNetworkProvider()
    if provider_code == "hongkong_hko":
        return HongKongHkoNetworkProvider()
    if provider_code == "taiwan_cwa":
        return TaiwanCwaNetworkProvider()
    return GlobalMetarNetworkProvider()


def build_country_network_snapshot(city: str, raw: Dict[str, Any]) -> Dict[str, Any]:
    provider = get_country_network_provider(city)
    metadata = provider.settlement_station_metadata(city)
    airport_primary = provider.airport_primary_current(city, raw) or {}
    official_nearby = provider.official_nearby_current(city, raw)
    status = provider.official_network_status(city, raw)
    signals = _network_signals(airport_primary, official_nearby)
    return {
        "provider_code": provider.provider_code,
        "provider_label": provider.provider_label,
        "settlement_station": metadata,
        "airport_primary_current": airport_primary,
        "airport_primary_today_obs": ((raw.get("metar") or {}).get("today_obs") or []),
        "official_nearby": official_nearby,
        "official_network_source": status.get("provider_code"),
        "official_network_status": status,
        **signals,
    }


def provider_coverage_summary() -> Dict[str, Any]:
    providers: Dict[str, Dict[str, Any]] = {}
    for city in CITY_REGISTRY:
        provider_code = _provider_code_for_city(city)
        entry = providers.setdefault(
            provider_code,
            {
                "cities": [],
                "cities_count": 0,
            },
        )
        entry["cities"].append(city)
        entry["cities_count"] += 1
    return {
        "providers": providers,
        "airport_anchor_coverage": sum(
            1
            for city, meta in CITY_REGISTRY.items()
            if str(meta.get("icao") or "").strip()
        ),
        "official_station_anchor_coverage": sum(
            1
            for city in CITY_REGISTRY
            if _settlement_station_metadata(city).get("is_official_station_anchor")
        ),
    }
