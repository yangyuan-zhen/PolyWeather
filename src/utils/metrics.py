from __future__ import annotations

import threading
from typing import Dict, Iterable, List, Optional, Tuple


LabelTuple = Tuple[Tuple[str, str], ...]


class _MetricsRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: Dict[Tuple[str, LabelTuple], float] = {}
        self._gauges: Dict[Tuple[str, LabelTuple], float] = {}
        self._histograms: Dict[Tuple[str, LabelTuple], Dict[str, float]] = {}

    @staticmethod
    def _normalize_labels(labels: Dict[str, object]) -> LabelTuple:
        return tuple(
            sorted((str(key), str(value)) for key, value in labels.items() if value is not None)
        )

    def inc_counter(self, name: str, amount: float = 1.0, **labels: object) -> None:
        key = (name, self._normalize_labels(labels))
        with self._lock:
            self._counters[key] = self._counters.get(key, 0.0) + amount

    def set_gauge(self, name: str, value: float, **labels: object) -> None:
        key = (name, self._normalize_labels(labels))
        with self._lock:
            self._gauges[key] = value

    def observe(self, name: str, value: float, **labels: object) -> None:
        key = (name, self._normalize_labels(labels))
        with self._lock:
            bucket = self._histograms.setdefault(
                key,
                {"count": 0.0, "sum": 0.0, "max": 0.0},
            )
            bucket["count"] += 1.0
            bucket["sum"] += value
            bucket["max"] = max(bucket["max"], value)

    def snapshot(self) -> Dict[str, object]:
        with self._lock:
            return {
                "counters": dict(self._counters),
                "gauges": dict(self._gauges),
                "histograms": {
                    key: dict(value) for key, value in self._histograms.items()
                },
            }

    def export_prometheus(self) -> str:
        snap = self.snapshot()
        lines: List[str] = []
        for name, labels, value in _iter_metrics(snap["counters"]):
            lines.append(_prom_line(name, value, labels))
        for name, labels, value in _iter_metrics(snap["gauges"]):
            lines.append(_prom_line(name, value, labels))
        for (name, labels), stats in sorted(snap["histograms"].items()):
            lines.append(_prom_line(f"{name}_count", stats["count"], labels))
            lines.append(_prom_line(f"{name}_sum", stats["sum"], labels))
            lines.append(_prom_line(f"{name}_max", stats["max"], labels))
        return "\n".join(lines) + ("\n" if lines else "")


def _iter_metrics(entries: Dict[Tuple[str, LabelTuple], float]) -> Iterable[Tuple[str, LabelTuple, float]]:
    for (name, labels), value in sorted(entries.items()):
        yield name, labels, value


def _prom_line(name: str, value: float, labels: LabelTuple) -> str:
    if labels:
        def _escape(label_value: str) -> str:
            return label_value.replace("\\", "\\\\").replace('"', '\\"')

        label_str = ",".join(
            f'{key}="{_escape(str(val))}"'
            for key, val in labels
        )
        return f"{name}{{{label_str}}} {value}"
    return f"{name} {value}"


METRICS = _MetricsRegistry()


def counter_inc(name: str, amount: float = 1.0, **labels: object) -> None:
    METRICS.inc_counter(name, amount=amount, **labels)


def gauge_set(name: str, value: float, **labels: object) -> None:
    METRICS.set_gauge(name, value=value, **labels)


def histogram_observe(name: str, value: float, **labels: object) -> None:
    METRICS.observe(name, value=value, **labels)


def record_source_call(source: str, operation: str, outcome: str, duration_ms: Optional[float] = None) -> None:
    counter_inc(
        "polyweather_source_requests_total",
        source=source,
        operation=operation,
        outcome=outcome,
    )
    if duration_ms is not None:
        histogram_observe(
            "polyweather_source_request_duration_ms",
            duration_ms,
            source=source,
            operation=operation,
            outcome=outcome,
        )


def build_metrics_summary() -> Dict[str, object]:
    snapshot = METRICS.snapshot()
    request_total = 0.0
    source_total = 0.0
    source_errors = 0.0
    for (name, labels), value in snapshot["counters"].items():
        if name == "polyweather_http_requests_total":
            request_total += value
        if name == "polyweather_source_requests_total":
            source_total += value
            label_map = dict(labels)
            if label_map.get("outcome") not in {"success", "cache_hit"}:
                source_errors += value
    return {
        "http_requests_total": int(request_total),
        "source_requests_total": int(source_total),
        "source_error_total": int(source_errors),
    }


def export_prometheus_metrics() -> str:
    return METRICS.export_prometheus()
