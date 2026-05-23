"""Daily weather report for Chinese cities — AI-generated narrative pushed to Telegram."""

from __future__ import annotations

import json
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

from src.data_collection.city_registry import CITY_REGISTRY
from src.data_collection.weather_sources import WeatherDataCollector

TARGET_CITIES: List[str] = [
    "beijing",
    "shanghai",
    "guangzhou",
    "chengdu",
    "chongqing",
    "wuhan",
    "qingdao",
]

FORUM_CHAT_ID = "-1003965137823"

CITY_NAME_ZH: Dict[str, str] = {
    "beijing": "北京",
    "shanghai": "上海",
    "guangzhou": "广州",
    "chengdu": "成都",
    "chongqing": "重庆",
    "wuhan": "武汉",
    "qingdao": "青岛",
}


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


def _fetch_city_data(
    collector: WeatherDataCollector, city_key: str
) -> Optional[Dict[str, Any]]:
    info = CITY_REGISTRY.get(city_key)
    if not info:
        return None

    try:
        results = collector.fetch_all_sources(
            city_key,
            lat=info["lat"],
            lon=info["lon"],
            include_taf=False,
            include_ensemble=False,
            include_multi_model=False,
        )
    except Exception as exc:
        logger.warning(f"daily_weather_report: fetch failed for {city_key}: {exc}")
        return None

    if not isinstance(results, dict):
        return None

    om = results.get("open-meteo", {}) if isinstance(results, dict) else {}
    current = om.get("current_weather", {}) if isinstance(om, dict) else {}
    daily = om.get("daily", {}) if isinstance(om, dict) else {}

    daily_highs = daily.get("temperature_2m_max", []) or []
    today_high = daily_highs[0] if daily_highs else None

    return {
        "city": city_key,
        "name": CITY_NAME_ZH.get(city_key, city_key),
        "weather_code": current.get("weathercode"),
        "forecast_high": today_high,
    }


def _build_ai_prompt(cities_data: List[Dict[str, Any]], report_date: str) -> str:
    data_json = json.dumps(cities_data, ensure_ascii=False, indent=2, default=str)
    return (
        f"今天是 {report_date}。以下是今天中国主要城市的天气预报数据（JSON格式）。\n\n"
        f"{data_json}\n\n"
        "请用自然、亲切的中文写一段天气日报，要求：\n"
        "1. forecast_high 是今日预报最高温（℃），weather_code 是天气现象代码\n"
        "2. 根据 weather_code 描述天气（晴/多云/雨/雾等），根据 forecast_high 描述冷热\n"
        "3. 每个城市1-2句，语气轻松自然，像朋友聊天\n"
        "4. 不要编造数据缺失声明，所有数据都已提供，直接基于数据播报\n"
        "5. <b>城市名</b> 用 HTML 加粗\n"
        "6. 开头加问候语，例如「☀️ 早上好！」\n"
        "7. 总体控制在 400 字以内\n"
        "weather_code 参考：0=晴, 1-3=多云, 45-48=雾, 51-67=雨, 71-86=雪, 95-99=雷暴"
    )


def _call_ai(prompt: str) -> Optional[str]:
    api_key = os.getenv("POLYWEATHER_SCAN_AI_API_KEY", "")
    base_url = os.getenv(
        "POLYWEATHER_SCAN_AI_BASE_URL", "https://token-plan-cn.xiaomimimo.com/v1"
    )
    model = os.getenv(
        "DAILY_REPORT_AI_MODEL",
        os.getenv("POLYWEATHER_SCAN_AI_MODEL", "mimo-v2.5-pro"),
    )

    if not api_key:
        logger.warning("daily_weather_report: AI API key not configured")
        return None

    payload = {
        "model": model,
        "messages": [
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 1200,
        "temperature": 0.7,
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
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            return str(content).strip() if content else None
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

                report_date = now.strftime("%m月%d日")
                prompt = _build_ai_prompt(cities_data, report_date)
                report_text = _call_ai(prompt)

                if not report_text:
                    logger.warning("daily_weather_report: AI returned empty content")
                    sent_today = True
                    time.sleep(60)
                    continue

                try:
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
