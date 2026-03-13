from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from src.bot.analysis.deb_analysis_service import DebAnalysisService


@dataclass
class DebReportResult:
    ok: bool
    report: Optional[str] = None
    error: Optional[str] = None


class DebCommandService:
    def __init__(self, analysis: DebAnalysisService):
        self.analysis = analysis

    def resolve_city(self, city_input: str) -> str:
        return self.analysis.resolve_city(city_input)

    def has_history(self, city_name: str) -> bool:
        return self.analysis.has_history(city_name)

    def build_report(self, city_name: str, deb_query_cost: int) -> DebReportResult:
        try:
            report = self.analysis.build_deb_accuracy_report(city_name, deb_query_cost)
            return DebReportResult(ok=True, report=report)
        except Exception as exc:
            return DebReportResult(ok=False, error=str(exc))
