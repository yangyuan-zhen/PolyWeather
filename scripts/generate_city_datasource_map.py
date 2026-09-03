"""Generate config/city_datasource_map.json from code (read-only, no DB writes)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.data_collection.city_registry import CITY_REGISTRY  # noqa: E402
from src.data_collection.city_time import CITY_TIME_ZONES  # noqa: E402
from web.services.observation_freshness import _OBSERVATION_SOURCE_PROFILES  # noqa: E402


def _provider_for_city(city: str, meta: dict) -> str:
    settlement = str(meta.get("settlement_source") or "metar").strip().lower()
    if settlement == "hko":
        return "hongkong_hko"
    if city in {"tokyo"}:
        return "japan_jma"
    if city in {"seoul", "busan"}:
        return "korea_kma"
    if city in {"tel aviv"}:
        return "israel_ims"
    if city in {"jeddah"}:
        return "saudi_ncm"
    if city in {"paris"}:
        return "fr_aeroweb"
    return "global_metar"


def main() -> None:
    out = {"generated_by": "scripts/generate_city_datasource_map.py", "cities": {}}
    for city in sorted(CITY_REGISTRY.keys()):
        meta = CITY_REGISTRY[city]
        settlement = str(meta.get("settlement_source") or "metar").strip().lower()
        station = str(
            meta.get("settlement_station_code") or meta.get("icao") or ""
        ).strip().upper()
        profile_key = settlement if settlement in _OBSERVATION_SOURCE_PROFILES else "metar"
        profile = _OBSERVATION_SOURCE_PROFILES[profile_key]
        provider = _provider_for_city(city, meta)
        aux = {provider, "metar"}
        if city == "hong kong":
            aux |= {"cowin", "hko"}
        if city == "singapore":
            aux.add("singapore_mss")
        if str(meta.get("icao") or "").startswith(("K", "C", "M", "S")) and provider == "global_metar":
            aux.add("madis")
        out["cities"][city] = {
            "city_id": city,
            "display_name": meta.get("name") or city,
            "timezone": CITY_TIME_ZONES.get(city),
            "tz_offset_seconds": meta.get("tz_offset"),
            "icao": meta.get("icao"),
            "settlement_source": settlement,
            "settlement_station_code": station or None,
            "settlement_station_label": meta.get("settlement_station_label"),
            "aux_sources": sorted(aux),
            "update_interval_sec": profile["native_update_interval_sec"],
            "freshness": {
                "fresh_window_sec": profile["fresh_window_sec"],
                "expected_grace_sec": profile["expected_grace_sec"],
                "stale_after_sec": profile["stale_after_sec"],
            },
            "fallback": "metar_cluster" if settlement != "hko" else "none",
            "canonical_selection": "score(settlement+station+freshness)",
            "frontend_source": "live_observation via /api/city/{city}/observation + SSE patch",
        }
    target = ROOT / "config" / "city_datasource_map.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {target} cities={len(out['cities'])}")


if __name__ == "__main__":
    main()
