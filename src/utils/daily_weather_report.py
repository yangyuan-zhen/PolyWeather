"""Daily weather report for Chinese cities — AI-generated narrative pushed to Telegram."""

from __future__ import annotations

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
        # Strip all HTML tags, then find numbers followed by degree
        clean = re.sub(r"<[^>]+>", " ", tem_text)
        nums = re.findall(r"(-?\d+)\s*(?:℃|°C|°c|°)?", clean)
        if len(nums) >= 1:
            high_str = nums[0]
        if len(nums) >= 2:
            low_str = nums[1]

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

    logger.info(
        "daily_weather_report: CMA parsed {} weather={} high={} low={}",
        city_key,
        result.get("weather"),
        result.get("forecast_high"),
        result.get("forecast_low"),
    )
    return result


def _extract_first(html: str, pattern: str) -> Optional[str]:
    m = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
    return m.group(1) if m else None


def _fetch_city_data(
    collector: WeatherDataCollector, city_key: str
) -> Optional[Dict[str, Any]]:
    name = CITY_NAME_ZH.get(city_key, city_key)

    # 1. Try CMA first for weather description
    cma = _fetch_cma_forecast(city_key)

    # 2. Get Open-Meteo data for temperature fallback
    om_high = None
    info = CITY_REGISTRY.get(city_key)
    if info:
        try:
            results = collector.fetch_all_sources(
                city_key,
                lat=info["lat"],
                lon=info["lon"],
                include_taf=False,
                include_ensemble=False,
                include_multi_model=False,
            )
            if isinstance(results, dict):
                om = results.get("open-meteo", {})
                daily = om.get("daily", {}) if isinstance(om, dict) else {}
                daily_highs = daily.get("temperature_2m_max", []) or []
                om_high = daily_highs[0] if daily_highs else None
        except Exception as exc:
            logger.warning(
                "daily_weather_report: OM fetch failed for {}: {}", city_key, exc
            )

    # Use CMA weather + CMA high, fall back to OM high
    weather: Optional[str] = None
    forecast_high: Optional[float] = None

    if cma:
        weather = cma.get("weather")
        forecast_high = cma.get("forecast_high")
    if forecast_high is None:
        forecast_high = om_high

    if not weather and not forecast_high:
        return None

    logger.info(
        "daily_weather_report: {} weather={} high={} (cma_ok={})",
        city_key,
        weather or "?",
        forecast_high,
        bool(cma and cma.get("weather")),
    )

    return {
        "city": city_key,
        "name": name,
        "weather": weather or "?",
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
    lines = [f"今天是 {report_date}。请用自然亲切的中文写一段天气日报。\n"]
    lines.append("城市天气数据：")
    for c in cities_data:
        lines.append(f"{c['name']}：{c['weather']}，最高{c['forecast_high']}度")
    lines.append("\n要求：每城一行播报，城市名<b>加粗</b>，开头问候，禁止结尾废话。")
    return "\n".join(lines)


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
