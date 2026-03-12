from __future__ import annotations

from src.bot.analysis.city_analysis_service import CityAnalysisService
from src.bot.analysis.deb_analysis_service import DebAnalysisService


class BotAnalysisLayer:
    """
    Backward-compatible facade.
    New code should use CityAnalysisService / DebAnalysisService directly.
    """

    def __init__(self, weather, project_root: str):
        self._city = CityAnalysisService(weather=weather)
        self._deb = DebAnalysisService(project_root=project_root)

    def resolve_city(self, city_input: str):
        return self._city.resolve_city(city_input)

    def build_city_report(self, city_name: str, city_query_cost: int) -> str:
        return self._city.build_city_report(city_name, city_query_cost)

    def resolve_deb_city(self, city_input: str) -> str:
        return self._deb.resolve_city(city_input)

    def has_deb_history(self, city_name: str) -> bool:
        return self._deb.has_history(city_name)

    def build_deb_accuracy_report(self, city_name: str, deb_query_cost: int) -> str:
        return self._deb.build_deb_accuracy_report(city_name, deb_query_cost)

