
from fastapi.testclient import TestClient

from web.app import app
import web.routes as routes
import web.scan_terminal_cache as scan_terminal_cache
import web.scan_terminal_service as scan_terminal_service
from web.scan_terminal_cache import scan_terminal_cache_key
from src.database.db_manager import DBManager
from src.database.runtime_state import TruthRecordRepository, TrainingFeatureRecordRepository


client = TestClient(app)


def test_healthz_returns_ok_shape():
    response = client.get('/healthz')
    assert response.status_code == 200
    payload = response.json()
    assert payload['status'] in {'ok', 'degraded'}
    assert 'db' in payload
    assert 'state_storage_mode' in payload
    assert 'cities_count' in payload


def test_system_status_returns_summary_shape():
    response = client.get('/api/system/status')
    assert response.status_code == 200
    payload = response.json()
    assert 'db' in payload
    assert 'state_storage_mode' in payload
    assert 'features' in payload
    assert 'integrations' in payload
    assert 'cache' in payload
    assert 'analysis' in payload['cache']
    assert 'probability' in payload
    assert 'rollout' in payload['probability']
    assert payload['probability']['rollout']['decision']['decision'] in {'hold', 'observe', 'promote'}
    assert 'training_data' in payload
    assert 'station_networks' in payload
    assert 'prewarm' in payload
    assert 'truth_records' in payload['training_data']
    assert 'training_features' in payload['training_data']
    assert 'city_coverage' in payload['training_data']
    assert 'model_city_coverage' in payload['training_data']
    assert 'artifacts' in payload['training_data']
    assert 'metar_entries' in payload['cache']
    assert 'nmc_entries' in payload['cache']
    assert 'runtime' in payload['prewarm']
    assert 'last_summary_ok' in payload['prewarm']['runtime']
    assert 'cities_count' in payload


def test_system_status_reads_shared_prewarm_runtime(monkeypatch):
    monkeypatch.setenv("POLYWEATHER_DASHBOARD_PREWARM_ENABLED", "true")
    monkeypatch.setenv("POLYWEATHER_PREWARM_INTERVAL_SEC", "300")
    monkeypatch.setenv("POLYWEATHER_PREWARM_JITTER_SEC", "20")

    DBManager().set_payment_runtime_state(
        "dashboard_prewarm",
        {
            "cycle_count": 3,
            "success_count": 3,
            "failure_count": 0,
            "last_started_at": "2026-04-08T12:00:00",
            "last_finished_at": "2026-04-08T12:00:05",
            "last_duration_sec": 5.0,
            "last_success": True,
            "last_http_status": 200,
            "last_error": None,
            "last_requested_cities": ["shanghai", "beijing"],
            "last_requested_city_count": 2,
            "last_include_detail": True,
            "last_include_market": True,
            "last_force_refresh": False,
            "last_warmed_count": 2,
            "last_summary_ok": 2,
            "last_detail_ok": 2,
            "last_market_ok": 2,
            "last_failed_count": 0,
            "last_heartbeat_ts": __import__("time").time(),
            "writer_mode": "standalone_process",
            "writer_pid": 12345,
            "writer_thread_name": "MainThread",
        },
    )

    response = client.get('/api/system/status')

    assert response.status_code == 200
    payload = response.json()
    assert payload["prewarm"]["enabled"] is True
    assert payload["prewarm"]["thread_alive"] is True
    assert payload["prewarm"]["runtime"]["cycle_count"] >= 3
    assert payload["prewarm"]["runtime"]["last_summary_ok"] == 2


def test_metrics_endpoint_returns_prometheus_payload():
    response = client.get('/metrics')
    assert response.status_code == 200
    assert 'polyweather_http_requests_total' in response.text


def test_city_ai_fallback_reasoning_identifies_fast_evidence_mode():
    payload = scan_terminal_service._build_city_ai_fallback(
        {
            "city_display_name": "Tokyo",
            "temp_symbol": "°C",
            "deb": {"prediction": 17.8},
            "model_cluster": {
                "sources": [
                    {"value": 17.0},
                    {"value": 17.8},
                    {"value": 20.6},
                ]
            },
            "observation_anchor": {
                "is_airport_metar": True,
                "station_code": "RJTT",
            },
            "airport_current": {
                "station_code": "RJTT",
                "temp": 16.0,
                "report_time": "21:30Z",
                "raw_metar": "RJTT 262130Z AUTO 00000KT 9999 FEW030 16/10 Q1015",
            },
        },
        locale="zh-CN",
        reason="preview",
    )

    assert "当前为快速证据模式" in payload["reasoning_zh"]
    assert "完整 AI 机场报文解读返回后再合并" in payload["reasoning_zh"]
    assert "AI 机场报文解读正常" not in payload["reasoning_zh"]
    assert "后补" not in payload["reasoning_zh"]
    assert "AI 增强可作为后续补充" not in payload["reasoning_zh"]


def test_city_ai_fallback_revises_up_when_latest_metar_breaks_above_models():
    payload = scan_terminal_service._build_city_ai_fallback(
        {
            "city_display_name": "Manila",
            "temp_symbol": "°C",
            "deb": {"prediction": 34.0},
            "model_cluster": {
                "sources": [
                    {"value": 32.5},
                    {"value": 33.8},
                    {"value": 34.0},
                    {"value": 34.7},
                ]
            },
            "observation_anchor": {
                "is_airport_metar": True,
                "station_code": "RPLL",
            },
            "airport_current": {
                "station_code": "RPLL",
                "temp": 35.0,
                "report_time": "03:00Z / 当地 11:00",
                "raw_metar": "RPLL 270300Z 34004KT CAVOK 35/24 Q1009",
            },
        },
        locale="zh-CN",
        reason="stream preview",
    )

    assert payload["predicted_max"] == 35.0
    assert payload["range_high"] == 35.0
    assert "高于原先 34.0°C 中枢" in payload["final_judgment_zh"]
    assert "上修到至少 35.0°C" in payload["final_judgment_zh"]
    assert "共同支撑本轮最高温中枢" not in payload["reasoning_zh"]
    assert "超过模型上沿 34.7°C" in payload["reasoning_zh"]
    assert "继续上修最高温中枢" in payload["risks_zh"][0]


def test_city_ai_fallback_revises_down_after_peak_when_observed_high_lags():
    payload = scan_terminal_service._build_city_ai_fallback(
        {
            "city_display_name": "London",
            "temp_symbol": "°C",
            "deb": {"prediction": 30.0},
            "model_cluster": {
                "sources": [
                    {"value": 29.2},
                    {"value": 30.0},
                    {"value": 31.1},
                ]
            },
            "window_phase": "post_peak",
            "peak_window_label": "14:00-16:59",
            "observation_anchor": {
                "is_airport_metar": True,
                "station_code": "EGLL",
            },
            "airport_current": {
                "station_code": "EGLL",
                "temp": 27.0,
                "max_so_far": 27.5,
                "report_time": "16:30Z",
                "raw_metar": "EGLL 271630Z 22008KT 9999 SCT030 27/15 Q1012",
            },
        },
        locale="zh-CN",
        reason="stream preview",
    )

    assert payload["predicted_max"] == 27.5
    assert "峰值窗口（14:00-16:59）已过或接近结束" in payload["final_judgment_zh"]
    assert "最高温中枢需先下修到 27.5°C" in payload["final_judgment_zh"]
    assert "共同支撑本轮最高温中枢" not in payload["reasoning_zh"]
    assert "下修压力" in payload["reasoning_zh"]
    assert "继续下修最高温中枢" in payload["risks_zh"][0]


def test_city_ai_fallback_does_not_downrevise_before_peak_window():
    payload = scan_terminal_service._build_city_ai_fallback(
        {
            "city_display_name": "Dubai",
            "temp_symbol": "°C",
            "deb": {"prediction": 41.0},
            "model_cluster": {
                "sources": [
                    {"value": 40.5},
                    {"value": 41.0},
                    {"value": 41.6},
                ]
            },
            "window_phase": "early_today",
            "minutes_until_peak_start": 240,
            "peak_window_label": "14:00-16:59",
            "observation_anchor": {
                "is_airport_metar": True,
                "station_code": "OMDB",
            },
            "airport_current": {
                "station_code": "OMDB",
                "temp": 35.0,
                "report_time": "08:00Z",
                "raw_metar": "OMDB 270800Z 29007KT CAVOK 35/20 Q1008",
            },
        },
        locale="zh-CN",
        reason="stream preview",
    )

    assert payload["predicted_max"] == 41.0
    assert "暂不直接下修" in payload["reasoning_zh"]
    assert "峰值窗口尚未到来" in payload["reasoning_zh"]
    assert "若峰值窗口前继续偏低，需要下修最高温中枢" in payload["risks_zh"][0]


def test_city_ai_fallback_marks_peak_window_passed_without_waiting_for_warming():
    payload = scan_terminal_service._build_city_ai_fallback(
        {
            "city_display_name": "Paris",
            "temp_symbol": "°C",
            "deb": {"prediction": 28.0},
            "model_cluster": {
                "sources": [
                    {"value": 27.6},
                    {"value": 28.0},
                    {"value": 28.5},
                ]
            },
            "window_phase": "post_peak",
            "peak_window_label": "13:00-15:59",
            "observation_anchor": {
                "is_airport_metar": True,
                "station_code": "LFPG",
            },
            "airport_current": {
                "station_code": "LFPG",
                "temp": 27.0,
                "max_so_far": 27.2,
                "report_time": "17:00Z",
                "raw_metar": "LFPG 271700Z 25006KT 9999 FEW035 27/13 Q1014",
            },
        },
        locale="zh-CN",
        reason="stream preview",
    )

    assert "峰值窗口（13:00-15:59）已过" in payload["final_judgment_zh"]
    assert "不是继续按待升温路径解读" in payload["reasoning_zh"]
    assert "避免继续上调最高温中枢" in payload["risks_zh"][0]


def test_city_ai_fallback_treats_stale_metar_as_background_not_anchor():
    payload = scan_terminal_service._build_city_ai_fallback(
        {
            "city_display_name": "Manila",
            "temp_symbol": "°C",
            "deb": {"prediction": 34.0},
            "model_cluster": {
                "sources": [
                    {"value": 33.5},
                    {"value": 34.0},
                    {"value": 34.4},
                ]
            },
            "metar_context": {
                "stale_for_today": True,
                "last_observation_time": "00:00Z",
            },
            "observation_anchor": {
                "is_airport_metar": True,
                "station_code": "RPLL",
            },
            "airport_current": {
                "station_code": "RPLL",
                "temp": 36.0,
                "report_time": "00:00Z",
                "raw_metar": "RPLL 270000Z 34004KT CAVOK 36/24 Q1009",
            },
        },
        locale="zh-CN",
        reason="stream preview",
    )

    assert payload["predicted_max"] == 34.0
    assert "过旧" in payload["metar_read_zh"]
    assert "不能作为强实况锚点" in payload["metar_read_zh"]
    assert "先以 DEB 和多模型路径为主" in payload["final_judgment_zh"]
    assert "不能作为强实况锚点" in payload["reasoning_zh"]
    assert "上修到至少 36.0°C" not in payload["final_judgment_zh"]


def test_city_ai_cache_key_changes_when_observation_fingerprint_changes():
    """METAR 原文不变 → 缓存 key 不变（命中）；METAR 原文变了 → key 变化（miss）。"""
    base_input = {
        "city": "Manila",
        "local_date": "2026-04-28",
        "observation_anchor": {
            "source": "METAR",
            "is_airport_metar": True,
            "station_code": "RPLL",
        },
        "airport_current": {
            "obs_time": "03:00Z",
            "raw_metar": "RPLL 280300Z 34004KT CAVOK 34/24 Q1009",
        },
        "metar_context": {
            "stale_for_today": False,
            "last_observation_time": "03:00Z",
        },
    }
    changed_input = {
        **base_input,
        "airport_current": {
            **base_input["airport_current"],
            "raw_metar": "RPLL 280330Z 36006KT 9999 FEW020 33/25 Q1010",
            "obs_time": "03:30Z",
        },
    }

    assert scan_terminal_service._scan_city_ai_cache_key(base_input) != scan_terminal_service._scan_city_ai_cache_key(changed_input)


def test_city_ai_stream_request_only_asks_provider_for_observation_read():
    request_payload = scan_terminal_service._build_city_ai_stream_request(
        {
            "city": "Tokyo",
            "city_display_name": "Tokyo",
            "temp_symbol": "°C",
            "deb": {"prediction": 17.8},
            "model_cluster": {"sources": [{"value": 17.0}, {"value": 17.8}]},
            "observation_anchor": {
                "is_airport_metar": True,
                "read_label_zh": "机场报文解读",
            },
            "airport_current": {
                "station_code": "RJTT",
                "temp": 16.0,
                "report_time": "21:30Z",
                "raw_metar": "RJTT 262130Z AUTO 00000KT 9999 FEW030 16/10 Q1015",
            },
        },
        locale="zh-CN",
    )

    user_payload = request_payload["messages"][1]["content"]
    assert request_payload["stream"] is True
    assert request_payload["max_tokens"] <= 1200
    assert request_payload["max_tokens"] < scan_terminal_service.SCAN_AI_MAX_TOKENS
    assert "taf_read_zh" in user_payload
    assert "probability_read_zh" in user_payload
    assert "predicted_max" in user_payload
    assert "final_judgment" in user_payload


def test_city_ai_partial_json_trims_dangling_taf_clause():
    payload = scan_terminal_service._build_city_ai_fallback(
        {
            "city_display_name": "London",
            "temp_symbol": "°C",
            "deb": {"prediction": 24.3},
            "model_cluster": {
                "sources": [
                    {"value": 22.3},
                    {"value": 23.1},
                    {"value": 24.3},
                    {"value": 26.3},
                ]
            },
            "observation_anchor": {
                "is_airport_metar": True,
                "station_code": "EGLL",
            },
            "airport_current": {
                "station_code": "EGLL",
                "temp": 21.0,
                "report_time": "09:00Z",
                "raw_metar": "EGLL 270900Z 34004KT CAVOK 21/09 Q1016",
            },
        },
        locale="zh-CN",
        reason="AI content is not a JSON object",
        raw_content=(
            '{"metar_read_zh":"最新METAR报文09:00观测温度21°C，西北风4节（340°），'
            'CAVOK（能见度良好，无重要云）。当前西北风弱，趋向增温但影响有限；'
            'TAF预示10-11点转南风（18012KT），南风可能带来凉爽海风抑制升温。",'
            '"reasoning_zh":"DEB预测24.3°C，多数模型集中在23-26°C，'
            '当前09时实测21°C处于快速升温路径，但TAF显示'
        ),
    )

    assert "但TAF显示" not in payload["reasoning_zh"]
    assert payload["reasoning_zh"].endswith("。")
    assert "当前09时实测21°C处于快速升温路径" in payload["reasoning_zh"]


def test_city_ai_schema_completion_trims_dangling_taf_clause():
    payload = scan_terminal_service._complete_city_ai_payload(
        {
            "predicted_max": 24.3,
            "range_low": 22.3,
            "range_high": 26.3,
            "unit": "°C",
            "confidence": "medium",
            "final_judgment_zh": "London 最高温中枢暂看24°C附近。",
            "final_judgment_en": "London high is centered near 24°C.",
            "metar_read_zh": "最新METAR报文09:00观测温度21°C，西北风4节，CAVOK。",
            "metar_read_en": "The latest METAR shows 21°C at 09:00 with northwesterly wind and CAVOK.",
            "reasoning_zh": "当前09时实测21°C处于快速升温路径，但TAF显示",
            "reasoning_en": "The 09:00 observation is on a fast warming path, but TAF shows",
            "risks_zh": ["后续METAR若升温放缓，需要下修。"],
            "risks_en": ["If later METAR warming slows, revise lower."],
            "model_cluster_note_zh": "4/4 个模型落在 DEB ±2°C 内。",
            "model_cluster_note_en": "4/4 models sit within 2°C of DEB.",
        },
        {
            "city_display_name": "London",
            "temp_symbol": "°C",
            "deb": {"prediction": 24.3},
            "model_cluster": {"sources": [{"value": 22.3}, {"value": 26.3}]},
            "observation_anchor": {"is_airport_metar": True, "station_code": "EGLL"},
            "airport_current": {
                "station_code": "EGLL",
                "temp": 21.0,
                "report_time": "09:00Z",
                "raw_metar": "EGLL 270900Z 34004KT CAVOK 21/09 Q1016",
            },
        },
        locale="zh-CN",
    )

    assert payload["reasoning_zh"] == "当前09时实测21°C处于快速升温路径。"
    assert payload["reasoning_en"] == "The 09:00 observation is on a fast warming path."
    assert payload["_polyweather_meta"]["trimmed_incomplete_fields"] == [
        "reasoning_en",
        "reasoning_zh",
    ]


def test_city_ai_schema_completion_guards_stale_observation_text():
    payload = scan_terminal_service._complete_city_ai_payload(
        {
            "predicted_max": 36.0,
            "range_low": 35.0,
            "range_high": 37.0,
            "unit": "°C",
            "confidence": "medium",
            "final_judgment_zh": "Manila 最新 METAR 已经支撑 36°C 高温中枢。",
            "final_judgment_en": "Manila latest METAR supports a 36°C high center.",
            "metar_read_zh": "RPLL 最新 METAR 显示 36°C，当前作为强实况锚点。",
            "metar_read_en": "RPLL latest METAR shows 36°C and is a strong live anchor.",
            "reasoning_zh": "最新 METAR 与模型共同支撑上修。",
            "reasoning_en": "Latest METAR and models jointly support an upward revision.",
            "risks_zh": ["若继续升温，需要上修。"],
            "risks_en": ["If it keeps warming, revise upward."],
            "model_cluster_note_zh": "3/3 个模型集中。",
            "model_cluster_note_en": "3/3 models are clustered.",
        },
        {
            "city_display_name": "Manila",
            "temp_symbol": "°C",
            "deb": {"prediction": 34.0},
            "model_cluster": {
                "sources": [{"value": 33.5}, {"value": 34.0}, {"value": 34.4}]
            },
            "metar_context": {
                "stale_for_today": True,
                "last_observation_time": "00:00Z",
            },
            "observation_anchor": {"is_airport_metar": True, "station_code": "RPLL"},
            "airport_current": {
                "station_code": "RPLL",
                "temp": 36.0,
                "report_time": "00:00Z",
                "raw_metar": "RPLL 270000Z 34004KT CAVOK 36/24 Q1009",
            },
        },
        locale="zh-CN",
    )

    assert payload["predicted_max"] == 34.0
    assert "过旧" in payload["metar_read_zh"]
    assert "不能作为强实况锚点" in payload["metar_read_zh"]
    assert "先以 DEB 和多模型路径为主" in payload["final_judgment_zh"]
    assert "共同支撑上修" not in payload["reasoning_zh"]
    assert "deterministic_guard_fields" in payload["_polyweather_meta"]


def test_city_ai_schema_completion_guards_observed_high_break_numbers():
    payload = scan_terminal_service._complete_city_ai_payload(
        {
            "predicted_max": 34.0,
            "range_low": 32.5,
            "range_high": 34.7,
            "unit": "°C",
            "confidence": "medium",
            "final_judgment_zh": "Manila 最高温仍以 34.0°C 为中枢。",
            "final_judgment_en": "Manila high remains centered near 34.0°C.",
            "metar_read_zh": "RPLL 最新 METAR 显示 35°C，CAVOK。",
            "metar_read_en": "RPLL latest METAR shows 35°C and CAVOK.",
            "reasoning_zh": "模型区间仍覆盖当前路径，无需上修。",
            "reasoning_en": "The model range still covers the path, so no upward revision is needed.",
            "risks_zh": ["后续报文偏离再修正。"],
            "risks_en": ["Revise if later reports diverge."],
            "model_cluster_note_zh": "4/4 个模型集中。",
            "model_cluster_note_en": "4/4 models are clustered.",
        },
        {
            "city_display_name": "Manila",
            "temp_symbol": "°C",
            "deb": {"prediction": 34.0},
            "model_cluster": {
                "sources": [
                    {"value": 32.5},
                    {"value": 33.8},
                    {"value": 34.0},
                    {"value": 34.7},
                ]
            },
            "observation_anchor": {"is_airport_metar": True, "station_code": "RPLL"},
            "airport_current": {
                "station_code": "RPLL",
                "temp": 35.0,
                "report_time": "03:00Z / 当地 11:00",
                "raw_metar": "RPLL 270300Z 34004KT CAVOK 35/24 Q1009",
            },
        },
        locale="zh-CN",
    )

    assert payload["predicted_max"] == 35.0
    assert payload["range_high"] == 35.0
    assert "上修到至少 35.0°C" in payload["final_judgment_zh"]
    assert "无需上修" not in payload["reasoning_zh"]
    assert "deterministic_guard_fields" in payload["_polyweather_meta"]


def test_cities_endpoint_uses_denver_display_name_for_aurora_market():
    response = client.get("/api/cities")
    assert response.status_code == 200
    payload = response.json()
    denver = next(item for item in payload["cities"] if item["name"] == "denver")
    assert denver["display_name"] == "Denver"
    assert denver["network_provider"] == "global_metar"
    assert denver["deb_recent_tier"] in {"high", "medium", "low", "other"}
    assert "deb_recent_sample_count" in denver


def test_cities_endpoint_includes_new_wunderground_cities():
    response = client.get("/api/cities")
    assert response.status_code == 200
    payload = response.json()
    names = {item["name"] for item in payload["cities"]}
    assert {
        "busan",
        "qingdao",
        "panama city",
        "kuala lumpur",
        "jakarta",
        "helsinki",
        "amsterdam",
    }.issubset(names)


def test_payment_runtime_endpoint_returns_shape():
    response = client.get('/api/payments/runtime')
    assert response.status_code == 200
    payload = response.json()
    assert 'checkout' in payload
    assert 'rpc' in payload
    assert 'event_loop_state' in payload
    assert 'recent_audit_events' in payload


def test_auth_me_does_not_reconcile_on_status_probe(monkeypatch):
    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)

    def _bind_identity(request):
        request.state.auth_user_id = "user-1"
        request.state.auth_email = "user@example.com"

    monkeypatch.setattr(routes, "_bind_optional_supabase_identity", _bind_identity)
    monkeypatch.setattr(routes, "_resolve_auth_points", lambda request: 0)
    monkeypatch.setattr(routes, "_resolve_weekly_profile", lambda request: {"weekly_points": 0, "weekly_rank": None})
    monkeypatch.setattr(routes.SUPABASE_ENTITLEMENT, "enabled", True)

    calls = {"count": 0}
    reconcile_calls = {"count": 0}

    def _latest_subscription(user_id, respect_requirement=False):
        calls["count"] += 1
        return {
            "plan_code": "pro_monthly",
            "starts_at": "2026-03-22T00:00:00+00:00",
            "expires_at": "2026-04-21T00:00:00+00:00",
        }

    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "get_latest_active_subscription",
        _latest_subscription,
    )
    monkeypatch.setattr(routes.PAYMENT_CHECKOUT, "enabled", True)

    def _reconcile_latest_intent(user_id):
        reconcile_calls["count"] += 1
        return {"ok": True, "action": "reconciled_confirmed_intent"}

    monkeypatch.setattr(
        routes.PAYMENT_CHECKOUT,
        "reconcile_latest_intent",
        _reconcile_latest_intent,
    )

    response = client.get("/api/auth/me")

    assert response.status_code == 200
    payload = response.json()
    assert payload["subscription_active"] is True
    assert payload["subscription_plan_code"] == "pro_monthly"
    assert reconcile_calls["count"] == 0


def test_ops_memberships_prefers_supabase_auth_email(monkeypatch):
    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(routes, "_require_ops_admin", lambda request: None)
    monkeypatch.setattr(routes.PAYMENT_CHECKOUT, "enabled", False)

    class _FakeDB:
        @staticmethod
        def get_users_by_supabase_user_ids(user_ids):
            return {
                "user-1": {
                    "supabase_email": "stale@example.com",
                    "username": "tester",
                    "telegram_id": 1,
                    "created_at": "2026-03-01T00:00:00+00:00",
                }
            }

    import src.database.db_manager as db_module

    monkeypatch.setattr(db_module, "DBManager", lambda: _FakeDB())
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "list_active_subscriptions",
        lambda limit=200: [
            {
                "user_id": "user-1",
                "plan_code": "pro_monthly",
                "starts_at": "2026-03-22T00:00:00+00:00",
                "expires_at": "2026-04-21T00:00:00+00:00",
            }
        ],
    )
    monkeypatch.setattr(
        routes.SUPABASE_ENTITLEMENT,
        "get_auth_users",
        lambda user_ids: {
            "user-1": {
                "email": "fresh@example.com",
                "created_at": "2026-03-02T00:00:00+00:00",
            }
        },
    )
    response = client.get("/api/ops/memberships")

    assert response.status_code == 200
    payload = response.json()
    assert payload["memberships"][0]["email"] == "fresh@example.com"


def test_ops_truth_history_returns_filtered_rows(monkeypatch):
    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)
    monkeypatch.setattr(routes, "_require_ops_admin", lambda request: None)

    repo = TruthRecordRepository()
    repo.upsert_truth(
        city="taipei",
        target_date="2026-04-02",
        actual_high=26.0,
        settlement_source="wunderground",
        settlement_station_code="RCSS",
        settlement_station_label="Taipei Songshan Airport Station",
        truth_version="v1",
        updated_by="test",
        source_payload={"sample": True},
        is_final=True,
    )

    response = client.get("/api/ops/truth-history?city=taipei&date_from=2026-04-01&date_to=2026-04-03&limit=10")

    assert response.status_code == 200
    payload = response.json()
    assert "items" in payload
    assert payload["filters"]["city"] == "taipei"
    assert payload["items"][0]["city"] == "taipei"


def test_scan_terminal_service_returns_stale_payload_after_failed_refresh(monkeypatch):
    filters = {"scan_mode": "tradable", "limit": 5}
    normalized_filters = scan_terminal_service._normalize_scan_terminal_filters(filters)
    scan_terminal_cache._SCAN_TERMINAL_CACHE.clear()

    monkeypatch.setattr(
        scan_terminal_service,
        "_scan_city_terminal_rows",
        lambda *_args, **_kwargs: {
            "city": "taipei",
            "rows": [
                {
                    "id": "row-1",
                    "market_key": "market-1",
                    "edge_percent": 12.4,
                    "final_score": 83.0,
                    "volume": 2000,
                }
            ],
            "candidate_total": 1,
            "primary_scores": [83.0],
        },
    )

    ready = scan_terminal_service.build_scan_terminal_payload(filters, force_refresh=True)
    assert ready["status"] == "ready"
    assert ready["rows"][0]["id"] == "row-1"

    def _explode(*_args, **_kwargs):
        raise RuntimeError("upstream 504")

    monkeypatch.setattr(scan_terminal_service, "_scan_city_terminal_rows", _explode)

    stale = scan_terminal_service.build_scan_terminal_payload(filters, force_refresh=True)

    assert stale["status"] == "stale"
    assert stale["stale"] is True
    assert stale["rows"][0]["id"] == "row-1"
    assert stale["filters"] == normalized_filters
    assert stale["stale_reason"] == "upstream 504"


def test_scan_terminal_service_returns_failed_without_success_snapshot(monkeypatch):
    filters = {"scan_mode": "tradable", "limit": 5}
    scan_terminal_cache._SCAN_TERMINAL_CACHE.clear()

    def _explode(*_args, **_kwargs):
        raise RuntimeError("network down")

    monkeypatch.setattr(scan_terminal_service, "_scan_city_terminal_rows", _explode)

    failed = scan_terminal_service.build_scan_terminal_payload(filters, force_refresh=True)

    assert failed["status"] == "failed"
    assert failed["stale"] is False
    assert failed["rows"] == []
    assert failed["summary"]["candidate_total"] == 0
    assert failed["stale_reason"] == "network down"


def test_scan_terminal_endpoint_forwards_filters(monkeypatch):
    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)

    captured = {}

    def _fake_build_scan_terminal_payload(filters, *, force_refresh=False):
        captured["filters"] = dict(filters)
        captured["force_refresh"] = force_refresh
        return {
            "generated_at": "2026-04-23T00:00:00Z",
            "filters": filters,
            "summary": {
                "recommended_count": 1,
                "visible_count": 1,
                "candidate_total": 3,
                "avg_edge_percent": 4.2,
                "avg_primary_confidence": 88.0,
                "tradable_market_count": 1,
                "total_volume": 1500,
                "resolved_market_type": "maxtemp",
            },
            "top_signal": None,
            "rows": [],
        }

    monkeypatch.setattr(routes, "build_scan_terminal_payload", _fake_build_scan_terminal_payload)

    response = client.get(
        "/api/scan/terminal?scan_mode=trend&min_price=0.1&max_price=0.8&min_edge_pct=3"
        "&min_liquidity=700&high_liquidity_only=true&market_type=all&time_range=week&limit=12&force_refresh=true"
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["recommended_count"] == 1
    assert captured["force_refresh"] is True
    assert captured["filters"]["scan_mode"] == "trend"
    assert captured["filters"]["market_type"] == "all"
    assert captured["filters"]["time_range"] == "week"
    assert captured["filters"]["limit"] == 12


def test_scan_terminal_cache_key_includes_filter_dimensions():
    first = scan_terminal_cache_key(
        {
            "scan_mode": "tradable",
            "time_range": "today",
            "limit": 25,
        }
    )
    second = scan_terminal_cache_key(
        {
            "scan_mode": "trend",
            "time_range": "week",
            "limit": 10,
        }
    )

    assert first != second
    assert "trend" in second
    assert "week" in second


def test_city_history_is_read_only_and_uses_sqlite_truth_and_features(monkeypatch):
    monkeypatch.setattr(routes, "_assert_entitlement", lambda request: None)

    def _fail_bootstrap(*args, **kwargs):
        raise AssertionError("bootstrap should not be called by /api/history")

    monkeypatch.setattr(routes, "bootstrap_recent_daily_history_if_missing", _fail_bootstrap, raising=False)

    truth_repo = TruthRecordRepository()
    truth_repo.upsert_truth(
        city="ankara",
        target_date="2026-04-02",
        actual_high=16.0,
        settlement_source="metar",
        settlement_station_code="LTAC",
        settlement_station_label="Ankara Esenboga Airport",
        truth_version="v1",
        updated_by="test",
        source_payload={"sample": True},
        is_final=True,
    )
    feature_repo = TrainingFeatureRecordRepository()
    feature_repo.upsert_record(
        "ankara",
        "2026-04-02",
        {
            "deb_prediction": 16.4,
            "mu": 16.2,
            "forecasts": {"Open-Meteo": 15.8, "ECMWF": 16.1},
        },
    )

    response = client.get("/api/history/ankara")

    assert response.status_code == 200
    payload = response.json()
    assert payload["history"]
    row = next(item for item in payload["history"] if item["date"] == "2026-04-02")
    assert row["actual"] == 16.0
    assert row["deb"] == 16.4
    assert row["mu"] == 16.2
    assert row["forecasts"]["Open-Meteo"] == 15.8
    assert row["settlement_station_code"] == "LTAC"
    assert row["truth_version"] == "v1"
