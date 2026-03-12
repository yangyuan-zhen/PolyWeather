from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from src.bot.analysis.city_analysis_service import CityAnalysisService


@dataclass
class CityResolveResult:
    ok: bool
    city_name: Optional[str] = None
    supported_cities: List[str] | None = None


@dataclass
class CityReportResult:
    ok: bool
    report: Optional[str] = None
    error: Optional[str] = None


class CityCommandService:
    def __init__(self, analysis: CityAnalysisService):
        self.analysis = analysis

    def resolve_city(self, city_input: str) -> CityResolveResult:
        city_name, supported = self.analysis.resolve_city(city_input)
        if not city_name:
            return CityResolveResult(ok=False, supported_cities=supported)
        return CityResolveResult(ok=True, city_name=city_name, supported_cities=supported)

    def build_report(self, city_name: str, city_query_cost: int) -> CityReportResult:
        try:
            report = self.analysis.build_city_report(city_name, city_query_cost)
            return CityReportResult(ok=True, report=report)
        except Exception as exc:
            return CityReportResult(ok=False, error=str(exc))
