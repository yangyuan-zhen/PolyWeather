from __future__ import annotations

import argparse
import json
import sys
from typing import Dict, Tuple

import requests


def _get_json(url: str, timeout: float) -> Tuple[int, Dict]:
    response = requests.get(url, timeout=timeout)
    response.raise_for_status()
    return response.status_code, response.json()


def _get_text(url: str, timeout: float) -> Tuple[int, str]:
    response = requests.get(url, timeout=timeout)
    response.raise_for_status()
    return response.status_code, response.text


def main() -> int:
    parser = argparse.ArgumentParser(description="Run basic PolyWeather ops checks.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--timeout", type=float, default=8.0)
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    timeout = args.timeout
    report = {"checks": []}
    failed = False

    try:
        _, health = _get_json(f"{base}/healthz", timeout)
        ok = str(health.get("status") or "").lower() == "ok"
        report["checks"].append({"name": "healthz", "ok": ok, "detail": health})
        failed = failed or not ok
    except Exception as exc:
        report["checks"].append({"name": "healthz", "ok": False, "detail": str(exc)})
        failed = True

    try:
        _, status = _get_json(f"{base}/api/system/status", timeout)
        features = status.get("features") or {}
        ok = status.get("status") == "ok" and bool((status.get("db") or {}).get("ok"))
        report["checks"].append({"name": "system_status", "ok": ok, "detail": {"features": features, "db": status.get("db")}})
        failed = failed or not ok
    except Exception as exc:
        report["checks"].append({"name": "system_status", "ok": False, "detail": str(exc)})
        failed = True

    try:
        _, metrics = _get_text(f"{base}/metrics", timeout)
        ok = "polyweather_http_requests_total" in metrics or "polyweather_source_requests_total" in metrics
        report["checks"].append({"name": "metrics", "ok": ok, "detail": "metrics exposed"})
        failed = failed or not ok
    except Exception as exc:
        report["checks"].append({"name": "metrics", "ok": False, "detail": str(exc)})
        failed = True

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
