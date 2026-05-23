"""Daily weather report for Chinese cities — AI-generated narrative pushed to Telegram."""

from __future__ import annotations

import json
import os
import re
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

# weather.com.cn city codes
CMA_CITY_CODES: Dict[str, str] = {
    "beijing": "101010100",
    "shanghai": "101020100",
    "guangzhou": "101280101",
    "chengdu": "101270101",
    "chongqing": "101040100",
    "wuhan": "101200101",
    "qingdao": "101120201",
}

_CMA_FORECAST_URL = "http://www.weather.com.cn/weather/{code}.shtml"


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


def _fetch_cma_forecast(city_key: str) -> Optional[Dict[str, Any]]:
    """Scrape today's forecast from weather.com.cn (CMA)."""
    code = CMA_CITY_CODES.get(city_key)
    if not code:
        return None

    url = _CMA_FORECAST_URL.format(code=code)
    try:
        resp = httpx.get(
            url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
            },
            timeout=httpx.Timeout(timeout=10.0, connect=5.0, read=10.0),
            follow_redirects=True,
        )
        resp.raise_for_status()
        html = resp.text
    except Exception as exc:
        logger.warning(
            "daily_weather_report: CMA fetch failed for {}: {}", city_key, exc
        )
        return None

    # Parse today's weather block from the 7-day forecast page.
    # The HTML structure has entries like:
    #   <p class="wea">晴转多云</p>
    #   <p class="tem"><span>25℃</span> / <i>19℃</i></p>
    # We target the first occurrence (today).

    weather = _extract_first(html, r'<p[^>]*class="wea"[^>]*>([^<]+)</p>')
    tem_text = _extract_first(html, r'<p[^>]*class="tem"[^>]*>(.+?)</p>')

    high_str: Optional[str] = None
    low_str: Optional[str] = None

    if tem_text:
        # Patterns: <span>25℃</span> or <span>25°C</span>
        high_match = re.search(r"<span[^>]*>(-?\d+)\s*(?:℃|°C|°c)?</span>", tem_text)
        if high_match:
            high_str = high_match.group(1)
        # Night temp in <i>: <i>19℃</i>
        low_match = re.search(r"<i[^>]*>(-?\d+)\s*(?:℃|°C|°c)?</i>", tem_text)
        if low_match:
            low_str = low_match.group(1)

    if not weather and not high_str:
        return None

    result: Dict[str, Any] = {"source": "cma"}
    if weather:
        result["weather"] = weather.strip()
    if high_str:
        try:
            result["forecast_high"] = float(high_str)
        except (TypeError, ValueError):
            result["forecast_high"] = None
    if low_str:
        try:
            result["forecast_low"] = float(low_str)
        except (TypeError, ValueError):
            result["forecast_low"] = None

    return result


def _extract_first(html: str, pattern: str) -> Optional[str]:
    m = re.search(pattern, html, re.IGNORECASE)
    return m.group(1) if m else None


def _fetch_city_data(
    collector: WeatherDataCollector, city_key: str
) -> Optional[Dict[str, Any]]:
    name = CITY_NAME_ZH.get(city_key, city_key)

    # 1. Try CMA first for weather description + official forecast high
    cma = _fetch_cma_forecast(city_key)
    if cma and cma.get("weather") and cma.get("forecast_high") is not None:
        logger.debug(
            "daily_weather_report: {} using CMA data weather={} high={}",
            city_key,
            cma["weather"],
            cma["forecast_high"],
        )
        return {
            "city": city_key,
            "name": name,
            "weather": cma["weather"],
            "forecast_high": cma["forecast_high"],
        }

    # 2. Fall back to Open-Meteo
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
        logger.warning(f"daily_weather_report: OM fetch failed for {city_key}: {exc}")
        return None

    if not isinstance(results, dict):
        return None

    om = results.get("open-meteo", {}) if isinstance(results, dict) else {}
    current = om.get("current_weather", {}) if isinstance(om, dict) else {}
    daily = om.get("daily", {}) if isinstance(om, dict) else {}

    daily_highs = daily.get("temperature_2m_max", []) or []
    today_high = daily_highs[0] if daily_highs else None

    # Use CMA weather if available, fall back to WMO code translation
    weather = (
        cma.get("weather")
        if (cma and cma.get("weather"))
        else _wmo_to_weather(current.get("weathercode"))
    )
    forecast_high = cma.get("forecast_high") if cma else None
    if forecast_high is None:
        forecast_high = today_high

    return {
        "city": city_key,
        "name": name,
        "weather": weather,
        "forecast_high": forecast_high,
    }


def _wmo_to_weather(code: Any) -> str:
    """Translate WMO weather code to Chinese (fallback only)."""
    try:
        c = int(code or 0)
    except (TypeError, ValueError):
        return "未知"
    if c == 0:
        return "晴"
    if 1 <= c <= 3:
        return "多云"
    if c in (45, 48):
        return "雾"
    if 51 <= c <= 67:
        return "雨"
    if 71 <= c <= 86:
        return "雪"
    if 95 <= c <= 99:
        return "雷暴"
    return "阴"


def _build_ai_prompt(cities_data: List[Dict[str, Any]], report_date: str) -> str:
    data_json = json.dumps(cities_data, ensure_ascii=False, indent=2, default=str)
    return (
        f"今天是 {report_date}。以下是今天中国主要城市的天气预报数据（JSON格式），"
        "数据来自中国气象局（weather.com.cn）。\n\n"
        f"{data_json}\n\n"
        "请用自然亲切的中文写一段天气日报。每个城市逐行播报，格式：\n\n"
        "城市名 weather，最高 forecast_high 度。一句话体感或穿衣建议。\n\n"
        "要求：\n"
        "1. weather 和 forecast_high 直接使用数据中的值，不要修改\n"
        "2. 每个城市一行，城市名用 <b> 加粗\n"
        "3. 开头问候语「☀️ 早上好！今天是x月x日」\n"
        "4. 播报完直接结束，禁止写结尾祝福、总结、免责声明\n"
        "5. 总字数不超过 200\n"
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
