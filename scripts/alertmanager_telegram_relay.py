from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, List

import requests


def _chat_ids() -> List[str]:
    raw = (
        os.getenv("POLYWEATHER_MONITORING_ALERT_CHAT_IDS")
        or os.getenv("TELEGRAM_CHAT_IDS")
        or os.getenv("TELEGRAM_CHAT_ID")
        or ""
    )
    return [item.strip() for item in raw.split(",") if item.strip()]


def _format_alerts(payload: Dict[str, Any]) -> str:
    alerts = payload.get("alerts") or []
    if not isinstance(alerts, list) or not alerts:
        return "PolyWeather monitoring received an empty alert payload."
    lines = ["PolyWeather monitoring alert"]
    for alert in alerts[:10]:
        if not isinstance(alert, dict):
            continue
        status = str(alert.get("status") or "unknown").upper()
        labels = alert.get("labels") or {}
        annotations = alert.get("annotations") or {}
        alert_name = labels.get("alertname") or "unknown_alert"
        severity = labels.get("severity") or "info"
        summary = annotations.get("summary") or annotations.get("description") or ""
        lines.append(f"- [{status}] {alert_name} ({severity})")
        if summary:
            lines.append(f"  {summary}")
    return "\n".join(lines)


def _send_telegram_message(text: str) -> None:
    token = str(os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
    chat_ids = _chat_ids()
    if not token or not chat_ids:
        return
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    for chat_id in chat_ids:
        try:
            requests.post(
                url,
                json={
                    "chat_id": chat_id,
                    "text": text,
                    "disable_web_page_preview": True,
                },
                timeout=10,
            ).raise_for_status()
        except Exception:
            continue


def _send_alert_notifications(text: str) -> None:
    _send_telegram_message(text)


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") == "/healthz":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return
        self.send_error(404)

    def do_POST(self) -> None:  # noqa: N802
        if self.path.rstrip("/") != "/alerts":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            self.send_error(400, "invalid json")
            return
        if not isinstance(payload, dict):
            self.send_error(400, "invalid payload")
            return
        _send_alert_notifications(_format_alerts(payload))
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return


def main() -> None:
    port = 9099
    server = HTTPServer(("0.0.0.0", port), _Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
