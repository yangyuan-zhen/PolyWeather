from __future__ import annotations

from typing import Any


class CityAnalysisService:
    """City analysis adapter with lazy imports to trim cold startup."""

    def __init__(self, weather: Any):
        self.weather = weather

    def resolve_city(self, city_input: str):
        from src.analysis.city_query_service import resolve_city_name

        return resolve_city_name(city_input)

    def build_city_report(self, city_name: str, city_query_cost: int) -> str:
        coords = self.weather.get_coordinates(city_name)
        if not coords:
            raise ValueError(f"未找到城市坐标: {city_name}")

        weather_data = self.weather.fetch_all_sources(
            city_name,
            lat=coords["lat"],
            lon=coords["lon"],
            force_refresh=True,
        )

        from src.analysis.city_query_service import build_city_query_report

        return build_city_query_report(
            city_name=city_name,
            weather_data=weather_data,
            city_query_cost=city_query_cost,
        )

