from __future__ import annotations

import math
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from loguru import logger

from src.utils.metrics import record_source_call


KMA_CITY_STATIONS: Dict[str, Dict[str, Any]] = {
    "busan": {
        "airport_station_code": "153",
        "airport_label": "김해공항",
        "airport_icao": "RKPK",
    },
    "seoul": {
        "airport_station_code": "113",
        "airport_label": "인천공항",
        "airport_icao": "RKSI",
    },
}

KMA_GEOJSON_URLS: Dict[str, str] = {
    "air": "https://www.weather.go.kr/wgis-nuri/js/info/air.geojson",
    "sfc": "https://www.weather.go.kr/wgis-nuri/js/info/sfc.geojson",
    "aws": "https://www.weather.go.kr/wgis-nuri/js/info/aws.geojson",
}

KMA_OBSERVATION_URLS: Dict[str, str] = {
    "air": "https://www.weather.go.kr/wgis-nuri/aws/air?date=",
    "sfc": "https://www.weather.go.kr/wgis-nuri/aws/sfc?date=",
    "aws": "https://www.weather.go.kr/wgis-nuri/aws/aws?date=",
}


class KmaStationSourceMixin:
    def _kma_http_get_json(self, url: str):
        getter = getattr(self, "_http_get_json", None)
        if callable(getter):
            return getter(url)
        response = self.session.get(url, timeout=self.timeout)
        response.raise_for_status()
        return response.json()

    @staticmethod
    def _kma_safe_float(value: Any) -> Optional[float]:
        try:
            if value in (None, "", "-", "null"):
                return None
            numeric = float(value)
            if math.isnan(numeric):
                return None
            return numeric
        except Exception:
            return None

    @staticmethod
    def _kma_distance_km(
        lat1: Optional[float],
        lon1: Optional[float],
        lat2: Optional[float],
        lon2: Optional[float],
    ) -> Optional[float]:
        if None in (lat1, lon1, lat2, lon2):
            return None
        try:
            r = 6371.0
            d_lat = math.radians(float(lat2) - float(lat1))
            d_lon = math.radians(float(lon2) - float(lon1))
            a = (
                math.sin(d_lat / 2) ** 2
                + math.cos(math.radians(float(lat1)))
                * math.cos(math.radians(float(lat2)))
                * math.sin(d_lon / 2) ** 2
            )
            c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
            return round(r * c, 2)
        except Exception:
            return None

    @staticmethod
    def _kma_to_local_obs_time(tm: Any) -> Optional[str]:
        text = str(tm or "").strip()
        if len(text) != 12 or not text.isdigit():
            return None
        try:
            parsed = datetime.strptime(text, "%Y%m%d%H%M")
            return parsed.strftime("%H:%M")
        except Exception:
            return None

    def _kma_cached_fetch(self, kind: str, url: str) -> Any:
        now_ts = time.time()
        cache_key = f"{kind}:{url}"
        with self._kma_cache_lock:
            cached = self._kma_cache.get(cache_key)
            if cached and now_ts - cached["t"] < self.kma_cache_ttl_sec:
                return cached["d"]
        data = self._kma_http_get_json(url)
        with self._kma_cache_lock:
            self._kma_cache[cache_key] = {"d": data, "t": now_ts}
        return data

    def _kma_load_geo_features(self, layer: str) -> List[Dict[str, Any]]:
        payload = self._kma_cached_fetch("geo", KMA_GEOJSON_URLS[layer])
        if not isinstance(payload, dict):
            return []
        features = payload.get("features")
        return features if isinstance(features, list) else []

    def _kma_load_observations(self, layer: str) -> List[Dict[str, Any]]:
        payload = self._kma_cached_fetch("obs", KMA_OBSERVATION_URLS[layer])
        return payload if isinstance(payload, list) else []

    def _kma_station_feature_map(self, layer: str) -> Dict[str, Dict[str, Any]]:
        mapping: Dict[str, Dict[str, Any]] = {}
        for feature in self._kma_load_geo_features(layer):
            if not isinstance(feature, dict):
                continue
            props = feature.get("properties") or {}
            geometry = feature.get("geometry") or {}
            coords = geometry.get("coordinates") or []
            if not isinstance(props, dict) or len(coords) < 2:
                continue
            station_id = str(props.get("stnId") or "").strip()
            if not station_id:
                continue
            mapping[station_id] = {
                "lat": self._kma_safe_float(coords[1]),
                "lon": self._kma_safe_float(coords[0]),
                "stn_ko": props.get("stnKo"),
                "stn_en": props.get("stnEn"),
                "type": props.get("type"),
            }
        return mapping

    def _kma_anchor(
        self,
        city: str,
    ) -> tuple[Optional[float], Optional[float], Optional[str]]:
        city_key = str(city or "").strip().lower()
        city_meta = self.CITY_REGISTRY.get(city_key) or {}
        kma_meta = KMA_CITY_STATIONS.get(city_key) or {}
        airport_station_code = str(kma_meta.get("airport_station_code") or "").strip()
        if airport_station_code:
            air_map = self._kma_station_feature_map("air")
            airport_feature = air_map.get(airport_station_code) or {}
            lat = self._kma_safe_float(airport_feature.get("lat"))
            lon = self._kma_safe_float(airport_feature.get("lon"))
            if lat is not None and lon is not None:
                return lat, lon, airport_station_code
        return (
            self._kma_safe_float(city_meta.get("lat")),
            self._kma_safe_float(city_meta.get("lon")),
            airport_station_code or None,
        )

    def fetch_kma_official_nearby(
        self,
        city: str,
        use_fahrenheit: bool = False,
    ) -> List[Dict[str, Any]]:
        started = time.perf_counter()
        city_key = str(city or "").strip().lower()
        city_meta = KMA_CITY_STATIONS.get(city_key) or {}
        if not city_meta:
            record_source_call(
                "kma",
                "nearby",
                "unsupported_city",
                (time.perf_counter() - started) * 1000.0,
            )
            return []

        try:
            anchor_lat, anchor_lon, airport_station_code = self._kma_anchor(city_key)
            feature_maps = {
                "air": self._kma_station_feature_map("air"),
                "sfc": self._kma_station_feature_map("sfc"),
                "aws": self._kma_station_feature_map("aws"),
            }
            observation_layers = {
                "air": self._kma_load_observations("air"),
                "sfc": self._kma_load_observations("sfc"),
                "aws": self._kma_load_observations("aws"),
            }

            by_station: Dict[str, Dict[str, Any]] = {}
            layer_priority = {"aws": 0, "sfc": 1}
            for layer in ("aws", "sfc"):
                for row in observation_layers[layer]:
                    if not isinstance(row, dict):
                        continue
                    station_id = str(row.get("stnId") or "").strip()
                    if not station_id or station_id == airport_station_code:
                        continue
                    temp_c = self._kma_safe_float(row.get("ta"))
                    if temp_c is None:
                        continue
                    feature_meta = feature_maps[layer].get(station_id) or {}
                    lat = self._kma_safe_float(feature_meta.get("lat"))
                    lon = self._kma_safe_float(feature_meta.get("lon"))
                    distance_km = self._kma_distance_km(anchor_lat, anchor_lon, lat, lon)
                    temp = (
                        round(temp_c * 9 / 5 + 32, 1)
                        if use_fahrenheit
                        else round(temp_c, 1)
                    )
                    candidate = {
                        "name": feature_meta.get("stn_ko")
                        or feature_meta.get("stn_en")
                        or f"KMA {station_id}",
                        "station_label": feature_meta.get("stn_ko")
                        or feature_meta.get("stn_en")
                        or f"KMA {station_id}",
                        "station_code": station_id,
                        "icao": station_id,
                        "istNo": station_id,
                        "lat": lat,
                        "lon": lon,
                        "temp": temp,
                        "obs_time": self._kma_to_local_obs_time(row.get("tm")),
                        "source": "kma",
                        "source_label": "KMA",
                        "source_code": "kma",
                        "is_official": True,
                        "is_airport_station": False,
                        "is_settlement_anchor": False,
                        "network_type": layer,
                        "distance_km": distance_km,
                    }
                    existing = by_station.get(station_id)
                    if (
                        existing is None
                        or layer_priority.get(layer, 99)
                        < layer_priority.get(str(existing.get("network_type")), 99)
                    ):
                        by_station[station_id] = candidate

            rows = sorted(
                by_station.values(),
                key=lambda item: (
                    item.get("distance_km") is None,
                    item.get("distance_km") if item.get("distance_km") is not None else 9999,
                    item.get("station_label") or "",
                ),
            )
            trimmed = rows[:6]
            record_source_call(
                "kma",
                "nearby",
                "success" if trimmed else "empty",
                (time.perf_counter() - started) * 1000.0,
            )
            return trimmed
        except Exception as exc:
            logger.warning("KMA nearby fetch failed city={} error={}", city_key, exc)
            record_source_call(
                "kma",
                "nearby",
                "error",
                (time.perf_counter() - started) * 1000.0,
            )
            return []
