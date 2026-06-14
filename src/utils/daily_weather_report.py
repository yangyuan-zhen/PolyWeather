"""Daily weather report for Chinese cities — AI-generated narrative pushed to Telegram."""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from loguru import logger

try:
    from zoneinfo import ZoneInfo
except Exception:
    from datetime import timezone as _utc_tz
    from datetime import timedelta as _td

    ZoneInfo = None  # type: ignore[assignment]

from src.database.db_manager import DBManager
from src.data_collection.city_registry import CITY_REGISTRY
from src.data_collection.weather_sources import WeatherDataCollector
from src.utils.telegram_i18n import copy_text, normalize_push_language, telegram_push_language
from web.services.canonical_temperature import build_city_weather_from_canonical

TARGET_CITIES: List[str] = [
    "beijing",
    "shanghai",
    "guangzhou",
    "chengdu",
    "chongqing",
    "wuhan",
    "qingdao",
]

FORUM_CHAT_ID = "-1003927451869"

CITY_NAME_ZH: Dict[str, str] = {
    "beijing": "北京",
    "shanghai": "上海",
    "guangzhou": "广州",
    "chengdu": "成都",
    "chongqing": "重庆",
    "wuhan": "武汉",
    "qingdao": "青岛",
}

_DAILY_REPORT_DB = DBManager()


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, min_val: int = 0) -> int:
    try:
        return max(min_val, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


def _daily_report_language() -> str:
    return telegram_push_language(
        "DAILY_WEATHER_REPORT_LANGUAGE",
        "TELEGRAM_PUSH_LANGUAGE",
        "POLYWEATHER_TELEGRAM_PUSH_LANGUAGE",
    )


def _safe_float(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _enqueue_daily_report_refresh(city_key: str) -> None:
    enqueue = getattr(_DAILY_REPORT_DB, "enqueue_observation_refresh_request", None)
    if not callable(enqueue):
        return
    try:
        enqueue(
            city=city_key,
            kind="panel",
            priority="normal",
            reason="daily_weather_report",
        )
    except Exception as exc:
        logger.debug("daily_weather_report: refresh enqueue skipped city={}: {}", city_key, exc)


def _load_cached_city_payload(city_key: str) -> Optional[Dict[str, Any]]:
    getter = getattr(_DAILY_REPORT_DB, "get_city_cache", None)
    if callable(getter):
        for kind in ("panel", "full", "summary"):
            try:
                entry = getter(kind, city_key)
            except Exception as exc:
                logger.debug(
                    "daily_weather_report: city cache read skipped city={} kind={}: {}",
                    city_key,
                    kind,
                    exc,
                )
                continue
            payload = entry.get("payload") if isinstance(entry, dict) else None
            if isinstance(payload, dict):
                return payload

    canonical_getter = getattr(_DAILY_REPORT_DB, "get_canonical_temperature", None)
    if callable(canonical_getter):
        try:
            canonical_entry = canonical_getter(city_key)
        except Exception as exc:
            logger.debug("daily_weather_report: canonical read skipped city={}: {}", city_key, exc)
            canonical_entry = None
        canonical = (
            canonical_entry.get("payload")
            if isinstance(canonical_entry, dict) and isinstance(canonical_entry.get("payload"), dict)
            else canonical_entry
        )
        payload = (
            build_city_weather_from_canonical(city_key, canonical)
            if isinstance(canonical, dict)
            else None
        )
        if payload:
            return payload

    _enqueue_daily_report_refresh(city_key)
    return None


def _daily_report_forecast_high(payload: Dict[str, Any]) -> Optional[float]:
    deb = payload.get("deb") if isinstance(payload.get("deb"), dict) else {}
    value = _safe_float(deb.get("prediction"))
    if value is not None:
        return value

    local_date = str(payload.get("local_date") or "").strip()
    multi_model_daily = payload.get("multi_model_daily")
    if isinstance(multi_model_daily, dict):
        dates = [local_date] if local_date in multi_model_daily else sorted(multi_model_daily.keys())
        for date_key in dates:
            entry = multi_model_daily.get(date_key)
            if not isinstance(entry, dict):
                continue
            daily_deb = entry.get("deb") if isinstance(entry.get("deb"), dict) else {}
            value = _safe_float(daily_deb.get("prediction"))
            if value is not None:
                return value
            models = entry.get("models") if isinstance(entry.get("models"), dict) else {}
            values = sorted(
                value
                for value in (_safe_float(item) for item in models.values())
                if value is not None
            )
            if values:
                return values[len(values) // 2]

    current = payload.get("current") if isinstance(payload.get("current"), dict) else {}
    for key in ("max_so_far", "max_temp_so_far", "temp"):
        value = _safe_float(current.get(key))
        if value is not None:
            return value
    return None


def _daily_report_weather_text(payload: Dict[str, Any]) -> str:
    current = payload.get("current") if isinstance(payload.get("current"), dict) else {}
    for value in (
        payload.get("weather"),
        payload.get("weather_desc"),
        current.get("wx_desc"),
        current.get("weather"),
    ):
        text = str(value or "").strip()
        if text:
            return text
    return "?"


def _fetch_city_data(
    collector: WeatherDataCollector, city_key: str
) -> Optional[Dict[str, Any]]:
    name = CITY_NAME_ZH.get(city_key, city_key)
    info = CITY_REGISTRY.get(city_key)
    name_en = str((info or {}).get("name") or city_key.title())

    payload = _load_cached_city_payload(city_key)
    if not payload:
        return None

    forecast_high = _daily_report_forecast_high(payload)
    if forecast_high is None:
        _enqueue_daily_report_refresh(city_key)
        return None
    weather = _daily_report_weather_text(payload)

    logger.info(
        "daily_weather_report: {} weather={} high={} cache_only=true",
        city_key,
        weather,
        forecast_high,
    )

    return {
        "city": city_key,
        "name": name,
        "name_en": name_en,
        "weather": weather,
        "forecast_high": forecast_high,
    }


def _build_ai_prompt(
    cities_data: List[Dict[str, Any]],
    report_date: str,
    language: Optional[str] = None,
) -> str:
    language = normalize_push_language(language or _daily_report_language())
    if language == "zh":
        lines = [f"今天是 {report_date}。请用自然亲切的中文写一段天气日报。\n"]
        lines.append("城市天气数据：")
        for c in cities_data:
            lines.append(f"{c['name']}：{c['weather']}，最高{c['forecast_high']}度")
        lines.append("\n要求：每城一行播报，城市名<b>加粗</b>，开头问候，禁止结尾废话。")
        return "\n".join(lines)

    if language == "en":
        lines = [f"Today is {report_date}. Write a concise Telegram weather briefing in English.\n"]
        lines.append("City weather data:")
        for c in cities_data:
            lines.append(
                f"{c.get('name_en') or c['city'].title()}: weather={c['weather']}, high={c['forecast_high']}°C"
            )
        lines.append("\nRequirements: one line per city, bold city names with <b>, start with a short greeting, no generic closing.")
        return "\n".join(lines)

    lines = [f"Today is {report_date}. Write a bilingual Telegram weather briefing.\n"]
    lines.append("City weather data:")
    for c in cities_data:
        lines.append(
            f"{c.get('name_en') or c['city'].title()} / {c['name']}: weather={c['weather']}, high={c['forecast_high']}°C"
        )
    lines.append(
        "\nRequirements: one line per city, English first then Chinese in the same line, "
        "bold city names with <b>, start with a short bilingual greeting, no generic closing."
    )
    return "\n".join(lines)


def _call_ai(prompt: str) -> Optional[str]:
    api_key = os.getenv("DAILY_REPORT_AI_API_KEY", "")
    base_url = os.getenv(
        "DAILY_REPORT_AI_BASE_URL", "https://token-plan-cn.xiaomimimo.com/v1"
    )
    model = os.getenv("DAILY_REPORT_AI_MODEL", "mimo-v2.5-pro")

    if not api_key:
        logger.warning("daily_weather_report: AI API key not configured")
        return None

    payload = {
        "model": model,
        "messages": [
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 800,
        "temperature": 0.5,
    }

    timeout = httpx.Timeout(timeout=30.0, connect=8.0, read=30.0)
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            choice = (data.get("choices") or [{}])[0]
            content = choice.get("message", {}).get("content", "")
            finish = choice.get("finish_reason", "")
            if not str(content or "").strip():
                logger.warning(
                    "daily_weather_report: AI empty content finish_reason={} model={}",
                    finish,
                    model,
                )
                return None
            return str(content).strip()
    except Exception as exc:
        logger.warning(f"daily_weather_report: AI call failed: {exc}")
        return None


def _runner(bot: Any, config: Dict[str, Any]) -> None:
    enabled = _env_bool("DAILY_WEATHER_REPORT_ENABLED", True)
    if not enabled:
        logger.info("daily_weather_report: disabled by env")
        return

    tz_name = str(os.getenv("DAILY_WEATHER_REPORT_TIMEZONE") or "Asia/Shanghai").strip()
    report_hour = _env_int("DAILY_WEATHER_REPORT_HOUR", 8)
    report_minute = _env_int("DAILY_WEATHER_REPORT_MINUTE", 0)

    if ZoneInfo is None:
        local_tz = _utc_tz(_td(hours=8))
    else:
        try:
            local_tz = ZoneInfo(tz_name)
        except Exception:
            local_tz = ZoneInfo("Asia/Shanghai")

    collector = WeatherDataCollector(config)

    logger.info(
        "daily_weather_report: started tz={} time={:02d}:{:02d} cities={}",
        tz_name,
        report_hour,
        report_minute,
        len(TARGET_CITIES),
    )

    sent_today = False

    while True:
        try:
            now = datetime.now(local_tz)

            if now.hour == 0 and now.minute < 5:
                sent_today = False

            if (
                now.hour == report_hour
                and now.minute >= report_minute
                and not sent_today
            ):
                logger.info("daily_weather_report: generating report...")

                cities_data: List[Dict[str, Any]] = []
                for city_key in TARGET_CITIES:
                    data = _fetch_city_data(collector, city_key)
                    if data:
                        cities_data.append(data)

                if not cities_data:
                    logger.warning("daily_weather_report: no city data available")
                    sent_today = True
                    time.sleep(60)
                    continue

                language = _daily_report_language()
                report_date = now.strftime("%m月%d日")
                prompt = _build_ai_prompt(cities_data, report_date, language=language)
                report_text = _call_ai(prompt)

                if not report_text:
                    logger.warning("daily_weather_report: AI returned empty content")
                    sent_today = True
                    time.sleep(60)
                    continue

                try:
                    report_text += "\n\n" + copy_text(
                        language,
                        "⚠️ Rough forecast only. For reference.",
                        "⚠️ 以上为粗略预测，仅供参考。",
                    )
                    bot.send_message(
                        FORUM_CHAT_ID,
                        report_text,
                        message_thread_id=0,
                        parse_mode="HTML",
                        disable_web_page_preview=True,
                    )
                    logger.info(
                        "daily_weather_report: sent successfully chars={} cities={}",
                        len(report_text),
                        len(cities_data),
                    )
                except Exception as exc:
                    logger.warning("daily_weather_report: send failed: {}", exc)

                sent_today = True

            time.sleep(60)
        except Exception as exc:
            logger.warning(f"daily_weather_report: cycle error: {exc}")
            time.sleep(60)


def start_daily_weather_report_loop(
    bot: Any, config: Dict[str, Any]
) -> threading.Thread:
    thread = threading.Thread(
        target=_runner,
        args=(bot, config),
        daemon=True,
        name="daily-weather-report-loop",
    )
    thread.start()
    return thread
