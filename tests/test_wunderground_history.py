from src.data_collection.wunderground_sources import fetch_wunderground_historical_high


class _FakeResponse:
    def __init__(self, text: str):
        self.text = text

    def raise_for_status(self):
        return None


class _FakeSession:
    def __init__(self, text: str):
        self._text = text

    def get(self, url, headers=None, timeout=None):
        return _FakeResponse(self._text)


def test_fetch_wunderground_historical_high_parses_daily_max():
    html = """
    <html><body>
    <script id="app-root-state" type="application/json">
    {
      "x": {
        "history": [
          {"validTimeLocal": "2026-04-05T09:00:00+0800", "metric": {"temp": 24.4}},
          {"validTimeLocal": "2026-04-05T13:00:00+0800", "metric": {"temp": 28.6}},
          {"validTimeLocal": "2026-04-05T15:00:00+0800", "metric": {"temp": 27.9}}
        ]
      }
    }
    </script>
    </body></html>
    """
    result = fetch_wunderground_historical_high(
        "taipei",
        "2026-04-05",
        session=_FakeSession(html),
    )
    assert result["ok"] is True
    assert result["settlement_source"] == "wunderground"
    assert result["settlement_station_code"] == "RCSS"
    assert result["actual_high"] == 29.0
