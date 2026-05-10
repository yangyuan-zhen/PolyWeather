from src.data_collection.amos_station_sources import AmosStationSourceMixin, _amos_parse_runway_table


def test_amos_parser_handles_current_public_page_format():
    text = """
    AMOS
    [인천공항 (RKSI) 2026년 05월 09일 07:28 KST]

    15 33
    15L AVG MIN MAX
    WD 230 220 250
    WS 5.6 4.3 6.3
    MOR 10000
    RVR P2000
    33R AVG MIN MAX
    WD 230 190 260
    WS 5.0 2.8 8.3
    MOR 10000
    RVR P2000

    15L 33R
    15R AVG MIN MAX
    WD 240 220 250
    WS 4.7 2.9 6.8
    MOR 10000
    RVR P2000
    TEMP(℃) 13.7
    DEW (℃) 9.8
    PRECIP(㎜) 0
    QNH (hPa) 1021.0
    QNH (inHg) 30.15
    33L AVG MIN MAX
    WD 230 210 250
    WS 4.2 3.0 5.9
    15R 33L
    """

    parsed = _amos_parse_runway_table(text)

    assert parsed["runway_pairs"] == [("15L", "33R"), ("15R", "33L")]
    assert parsed["temperatures"] == [(13.7, 9.8)]
    assert parsed["pressures_hpa"] == [1021.0]
    assert parsed["wind_directions"][0] == (230, 220, 250)
    assert parsed["wind_speeds"][1] == (5.0, 2.8, 8.3)
    assert parsed["visibility_mor"][0] == 10000
    assert parsed["rvr"][0] == 2000


def test_amos_get_page_rejects_ignored_query_returning_default_rksi():
    class FakeCollector(AmosStationSourceMixin):
        timeout = 1.0

        def _http_get_text(self, url):
            return """
            <html>
              <body>
                <a>김해공항 RKPK</a>
                [인천공항 (RKSI) 2026년 05월 09일 07:28 KST]
                METAR RKSI 082230Z 22005KT CAVOK 14/10 Q1021 NOSIG=
              </body>
            </html>
            """

    assert FakeCollector()._amos_get_page("RKPK") is None
