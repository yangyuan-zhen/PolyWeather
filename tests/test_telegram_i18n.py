from src.bot.weekly_reward_loop import _render_settle_report
from src.utils.daily_weather_report import _build_ai_prompt
from src.utils.telegram_i18n import copy_text, telegram_push_language


def test_telegram_push_language_defaults_to_bilingual(monkeypatch):
    monkeypatch.delenv("TELEGRAM_PUSH_LANGUAGE", raising=False)
    monkeypatch.delenv("POLYWEATHER_TELEGRAM_PUSH_LANGUAGE", raising=False)

    assert telegram_push_language() == "both"
    assert copy_text("both", "Current", "当前") == "Current / 当前"


def test_daily_weather_report_prompt_defaults_to_bilingual(monkeypatch):
    monkeypatch.delenv("DAILY_WEATHER_REPORT_LANGUAGE", raising=False)
    monkeypatch.delenv("TELEGRAM_PUSH_LANGUAGE", raising=False)

    prompt = _build_ai_prompt(
        [
            {
                "city": "beijing",
                "name": "北京",
                "name_en": "Beijing",
                "weather": "晴",
                "forecast_high": 28.0,
            }
        ],
        "05月27日",
    )

    assert "bilingual Telegram weather briefing" in prompt
    assert "Beijing / 北京" in prompt
    assert "English first then Chinese" in prompt


def test_weekly_reward_report_defaults_to_bilingual(monkeypatch):
    monkeypatch.delenv("POLYWEATHER_WEEKLY_REWARD_LANGUAGE", raising=False)
    monkeypatch.delenv("TELEGRAM_PUSH_LANGUAGE", raising=False)

    text = _render_settle_report(
        week_key="2026-W21",
        winners=[
            {
                "rank": 1,
                "username": "ada",
                "points_bonus": 200,
                "pro_days": 7,
            }
        ],
        skipped=1,
        participation_count=3,
        active_count=1,
    )

    assert "weekly rewards settled" in text
    assert "周榜奖励已结算" in text
    assert "points / 积分" in text
    assert "Participation bonus" in text
    assert "参与奖" in text
