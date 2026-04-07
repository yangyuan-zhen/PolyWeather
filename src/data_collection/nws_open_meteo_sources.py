from __future__ import annotations

import time
from datetime import datetime, timedelta
from typing import Dict, Optional

from loguru import logger

from src.utils.metrics import record_source_call


class NwsOpenMeteoSourceMixin:
    def fetch_nws(self, lat: float, lon: float) -> Optional[Dict]:
        """
        从 NWS (美国国家气象局) 获取高精度预报
        仅适用于美国城市，全球 VPS 均可访问
        """
        started = time.perf_counter()
        try:
            # 1. 获取网格点
            points_url = f"https://api.weather.gov/points/{lat},{lon}"
            headers = {"User-Agent": "PolyWeather/1.0 (weather-bot)"}

            points_resp = self._http_get(
                points_url, headers=headers, timeout=self.timeout
            )
            points_resp.raise_for_status()
            points_data = points_resp.json()

            properties = points_data.get("properties", {})
            forecast_url = properties.get("forecast")
            hourly_url = properties.get("forecastHourly")
            if not forecast_url:
                record_source_call("nws", "forecast", "empty", (time.perf_counter() - started) * 1000.0)
                return None

            # 2. 获取预报
            forecast_resp = self._http_get(
                forecast_url, headers=headers, timeout=self.timeout
            )
            forecast_resp.raise_for_status()
            forecast_data = forecast_resp.json()

            periods = forecast_data.get("properties", {}).get("periods", [])
            if not periods:
                record_source_call("nws", "forecast", "empty", (time.perf_counter() - started) * 1000.0)
                return None

            hourly_periods = []
            if hourly_url:
                hourly_resp = self._http_get(
                    hourly_url, headers=headers, timeout=self.timeout
                )
                hourly_resp.raise_for_status()
                hourly_data = hourly_resp.json()
                hourly_periods = hourly_data.get("properties", {}).get("periods", [])[:48]

            active_alerts = []
            try:
                alerts_resp = self._http_get(
                    "https://api.weather.gov/alerts/active",
                    params={"point": f"{lat},{lon}"},
                    headers=headers,
                    timeout=self.timeout,
                )
                alerts_resp.raise_for_status()
                alerts_data = alerts_resp.json()
                for feature in alerts_data.get("features", [])[:8]:
                    ap = feature.get("properties", {})
                    active_alerts.append(
                        {
                            "event": ap.get("event"),
                            "headline": ap.get("headline"),
                            "severity": ap.get("severity"),
                            "certainty": ap.get("certainty"),
                            "urgency": ap.get("urgency"),
                            "effective": ap.get("effective"),
                            "ends": ap.get("ends"),
                        }
                    )
            except Exception:
                active_alerts = []

            # 3. 提取今日最高温（找 isDaytime=True 的第一个）
            today_high = None
            for p in periods:
                if p.get("isDaytime") and "High" in p.get("name", ""):
                    today_high = p.get("temperature")
                    break
            # 如果没有明确的 High，取第一个 daytime 的温度
            if today_high is None:
                for p in periods:
                    if p.get("isDaytime"):
                        today_high = p.get("temperature")
                        break

            result = {
                "source": "nws",
                "today_high": today_high,
                "unit": "fahrenheit",
                "forecast_periods": [
                    {
                        "name": p.get("name"),
                        "start_time": p.get("startTime"),
                        "end_time": p.get("endTime"),
                        "is_daytime": p.get("isDaytime"),
                        "temperature": p.get("temperature"),
                        "temperature_trend": p.get("temperatureTrend"),
                        "wind_speed": p.get("windSpeed"),
                        "wind_direction": p.get("windDirection"),
                        "short_forecast": p.get("shortForecast"),
                        "detailed_forecast": p.get("detailedForecast"),
                        "precipitation_probability": (p.get("probabilityOfPrecipitation") or {}).get("value"),
                    }
                    for p in periods[:14]
                ],
                "hourly_periods": [
                    {
                        "start_time": p.get("startTime"),
                        "end_time": p.get("endTime"),
                        "temperature": p.get("temperature"),
                        "temperature_unit": p.get("temperatureUnit"),
                        "wind_speed": p.get("windSpeed"),
                        "wind_direction": p.get("windDirection"),
                        "short_forecast": p.get("shortForecast"),
                        "precipitation_probability": (p.get("probabilityOfPrecipitation") or {}).get("value"),
                    }
                    for p in hourly_periods
                ],
                "active_alerts": active_alerts,
            }
            record_source_call("nws", "forecast", "success", (time.perf_counter() - started) * 1000.0)
            return result
        except Exception as e:
            logger.warning(f"NWS 请求失败: {e}")
            record_source_call("nws", "forecast", "error", (time.perf_counter() - started) * 1000.0)
            return None

    def fetch_from_open_meteo(
        self,
        lat: float,
        lon: float,
        forecast_days: int = 14,
        use_fahrenheit: bool = False,
    ) -> Optional[Dict]:
        """
        Fetch weather from Open-Meteo with forecast data

        Args:
            lat: Latitude
            lon: Longitude
            forecast_days: Number of forecast days to fetch (default 14 to cover all market dates)
            use_fahrenheit: Whether to return temperatures in Fahrenheit (for US markets)
        """
        started = time.perf_counter()
        cache_key = (
            f"{round(float(lat), 4)}:{round(float(lon), 4)}:"
            f"{forecast_days}:{'f' if use_fahrenheit else 'c'}"
        )
        self._maybe_reload_open_meteo_disk_cache()
        now_ts = time.time()
        # ── 429 冷却期检查（所有 Open-Meteo 端点共享）─────────────────
        with self._open_meteo_rl_lock:
            if now_ts < self._open_meteo_rate_limit_until:
                remaining = int(self._open_meteo_rate_limit_until - now_ts)
                logger.debug(f"Open-Meteo 冷却期中，跳过请求，还需 {remaining}s")
                with self._open_meteo_cache_lock:
                        stale = self._open_meteo_cache.get(cache_key)
                        if stale and isinstance(stale.get("data"), dict):
                            record_source_call("open_meteo", "forecast", "stale_cache", (time.perf_counter() - started) * 1000.0)
                            return dict(stale["data"])
                record_source_call("open_meteo", "forecast", "cooldown_skip", (time.perf_counter() - started) * 1000.0)
                return None
        with self._open_meteo_cache_lock:
            cached = self._open_meteo_cache.get(cache_key)
            if (
                cached
                and now_ts - float(cached.get("t", 0)) < self.open_meteo_cache_ttl_sec
            ):
                cached_data = cached.get("data")
                if isinstance(cached_data, dict):
                    record_source_call("open_meteo", "forecast", "cache_hit", (time.perf_counter() - started) * 1000.0)
                    return dict(cached_data)
        try:
            url = "https://api.open-meteo.com/v1/forecast"
            params = {
                "latitude": lat,
                "longitude": lon,
                "current_weather": "true",
                "hourly": (
                    "temperature_2m,shortwave_radiation,dew_point_2m,pressure_msl,"
                    "wind_speed_10m,wind_direction_10m,wind_speed_180m,wind_direction_180m,"
                    "precipitation_probability,cloud_cover,cape,convective_inhibition,"
                    "lifted_index,boundary_layer_height"
                ),
                "daily": "temperature_2m_max,apparent_temperature_max,sunrise,sunset,sunshine_duration",
                "timezone": "auto",
                "forecast_days": forecast_days,
            }

            # 显式指定单位，防止 API 默认行为漂移
            if use_fahrenheit:
                params["temperature_unit"] = "fahrenheit"
            else:
                params["temperature_unit"] = "celsius"

            self._wait_open_meteo_slot("forecast")
            response = self._http_get(
                url,
                params=params,
                timeout=self.timeout,
            )
            response.raise_for_status()
            data = response.json()

            current = data.get("current_weather", {})
            utc_offset = data.get("utc_offset_seconds", 0)
            timezone_name = data.get("timezone", "UTC")

            # 处理多模型数据 (如果请求了 models 参数，返回结构会变化)
            daily_data = data.get("daily", {})
            if "temperature_2m_max_ecmwf_ifs04" in daily_data:
                ecmwf_max = daily_data.get("temperature_2m_max_ecmwf_ifs04", [])
                hrrr_max = daily_data.get("temperature_2m_max_ncep_hrrr_conus", [])

                # 记录今日模型分歧
                daily_data["model_split"] = {
                    "ecmwf": ecmwf_max[0] if ecmwf_max else None,
                    "hrrr": hrrr_max[0] if hrrr_max else None,
                }

                # 智能合并：HRRR 仅覆盖 48 小时，远期用 ECMWF 补全
                merged_max = []
                for i in range(len(ecmwf_max)):
                    hrrr_val = hrrr_max[i] if i < len(hrrr_max) else None
                    ecmwf_val = ecmwf_max[i] if i < len(ecmwf_max) else None

                    # 优先 HRRR，其次 ECMWF，都没有就跳过
                    if hrrr_val is not None:
                        merged_max.append(hrrr_val)
                    elif ecmwf_val is not None:
                        merged_max.append(ecmwf_val)
                    else:
                        # 两个都没有，用占位符 (理论上不应该发生)
                        merged_max.append(ecmwf_val)  # None
                daily_data["temperature_2m_max"] = merged_max

            # 映射逐小时数据
            hourly_data = data.get("hourly", {})
            if "temperature_2m_ncep_hrrr_conus" in hourly_data:
                hourly_data["temperature_2m"] = hourly_data[
                    "temperature_2m_ncep_hrrr_conus"
                ]

            # 计算精确的当地时间
            now_utc = datetime.utcnow()
            local_now = now_utc + timedelta(seconds=utc_offset)
            local_time_str = local_now.strftime("%Y-%m-%d %H:%M")

            result = {
                "source": "open-meteo",
                "timestamp": now_utc.isoformat(),
                "timezone": timezone_name,
                "utc_offset": utc_offset,
                "current": {
                    "temp": current.get("temperature"),
                    "local_time": local_time_str,
                },
                "hourly": hourly_data,
                "daily": daily_data,
                "unit": "fahrenheit" if use_fahrenheit else "celsius",
            }
            with self._open_meteo_cache_lock:
                self._open_meteo_cache[cache_key] = {
                    "t": time.time(),
                    "data": dict(result),
                }
            self._flush_open_meteo_disk_cache()
            record_source_call("open_meteo", "forecast", "success", (time.perf_counter() - started) * 1000.0)
            return result
        except Exception as e:
            status_code = getattr(getattr(e, "response", None), "status_code", None)
            if status_code == 429:
                retry_after_str = getattr(e.response, "headers", {}).get("Retry-After")
                cooldown_to_use = self._open_meteo_rl_cooldown
                if retry_after_str:
                    try:
                        parsed = int(retry_after_str)
                        if parsed > 0:
                            cooldown_to_use = min(parsed + 60, 3600)  # Add 60s buffer, max 1 hour
                            logger.info(f"Open-Meteo 响应包含 Retry-After: {retry_after_str}s")
                    except ValueError:
                        pass
                logger.warning(
                    f"Open-Meteo rate limited (429), fallback to cache if available: lat={lat}, lon={lon}"
                )
                # 设置全局冷却期，避免短时内重复触发 429
                with self._open_meteo_rl_lock:
                    self._open_meteo_rate_limit_until = time.time() + cooldown_to_use
                    logger.warning(f"Open-Meteo 触发限流，设置 {cooldown_to_use}s 冷却期")
            else:
                logger.error(f"Open-Meteo forecast failed: {e}")
            with self._open_meteo_cache_lock:
                stale = self._open_meteo_cache.get(cache_key)
                if stale and isinstance(stale.get("data"), dict):
                    fallback = dict(stale["data"])
                    fallback["stale_cache"] = True
                    record_source_call("open_meteo", "forecast", "stale_cache", (time.perf_counter() - started) * 1000.0)
                    return fallback
            record_source_call("open_meteo", "forecast", "error", (time.perf_counter() - started) * 1000.0)
            return None

    def fetch_ensemble(
        self,
        lat: float,
        lon: float,
        use_fahrenheit: bool = False,
    ) -> Optional[Dict]:
        """
        从 Open-Meteo Ensemble API 获取 51 成员集合预报
        用于计算预报不确定性范围（散度）
        """
        started = time.perf_counter()
        cache_key = (
            f"{round(float(lat), 4)}:{round(float(lon), 4)}:"
            f"{'f' if use_fahrenheit else 'c'}"
        )
        self._maybe_reload_open_meteo_disk_cache()
        now_ts = time.time()
        # ── 429 冷却期检查（所有 Open-Meteo 端点共享）─────────────────
        with self._open_meteo_rl_lock:
            if now_ts < self._open_meteo_rate_limit_until:
                remaining = int(self._open_meteo_rate_limit_until - now_ts)
                logger.debug(f"Open-Meteo Ensemble 冷却期中，跳过请求，还需 {remaining}s")
                with self._ensemble_cache_lock:
                    stale = self._ensemble_cache.get(cache_key)
                    if stale and isinstance(stale.get("data"), dict):
                        record_source_call("open_meteo", "ensemble", "stale_cache", (time.perf_counter() - started) * 1000.0)
                        return dict(stale["data"])
                record_source_call("open_meteo", "ensemble", "cooldown_skip", (time.perf_counter() - started) * 1000.0)
                return None
                
        with self._ensemble_cache_lock:
            cached = self._ensemble_cache.get(cache_key)
            if (
                cached
                and now_ts - float(cached.get("t", 0))
                < self.open_meteo_ensemble_cache_ttl_sec
            ):
                cached_data = cached.get("data")
                if isinstance(cached_data, dict):
                    record_source_call("open_meteo", "ensemble", "cache_hit", (time.perf_counter() - started) * 1000.0)
                    return dict(cached_data)
        try:
            url = "https://ensemble-api.open-meteo.com/v1/ensemble"
            params = {
                "latitude": lat,
                "longitude": lon,
                "daily": "temperature_2m_max",
                "timezone": "auto",
                "forecast_days": 3,
            }
            if use_fahrenheit:
                params["temperature_unit"] = "fahrenheit"
            else:
                params["temperature_unit"] = "celsius"

            self._wait_open_meteo_slot("ensemble")
            response = self._http_get(
                url,
                params=params,
                timeout=self.timeout,
            )
            response.raise_for_status()
            data = response.json()

            daily = data.get("daily", {})
            # 每个成员都会返回一组 temperature_2m_max
            # 格式: {"time": [...], "temperature_2m_max_member01": [...], ...}
            today_highs = []
            for key, values in daily.items():
                if key.startswith("temperature_2m_max") and key != "temperature_2m_max":
                    if values and values[0] is not None:
                        today_highs.append(values[0])

            # 也检查非成员键（有些返回格式不同）
            if not today_highs:
                raw_max = daily.get("temperature_2m_max", [])
                if isinstance(raw_max, list) and raw_max:
                    if isinstance(raw_max[0], list):
                        # 嵌套列表格式: [[member1_day1, member1_day2], [member2_day1, ...]]
                        today_highs = [m[0] for m in raw_max if m and m[0] is not None]
                    elif raw_max[0] is not None:
                        today_highs = [raw_max[0]]

            if len(today_highs) < 3:
                logger.warning(f"Ensemble 数据不足: 仅获取 {len(today_highs)} 个成员")
                record_source_call("open_meteo", "ensemble", "empty", (time.perf_counter() - started) * 1000.0)
                return None

            today_highs.sort()
            n = len(today_highs)
            median = today_highs[n // 2]
            p10 = today_highs[max(0, int(n * 0.1))]
            p90 = today_highs[min(n - 1, int(n * 0.9))]

            result = {
                "source": "ensemble",
                "members": n,
                "median": round(median, 1),
                "p10": round(p10, 1),
                "p90": round(p90, 1),
                "min": round(today_highs[0], 1),
                "max": round(today_highs[-1], 1),
                "unit": "fahrenheit" if use_fahrenheit else "celsius",
            }

            logger.info(
                f"📊 Ensemble ({n} members): median={median:.1f}, "
                f"p10={p10:.1f}, p90={p90:.1f}"
            )
            with self._ensemble_cache_lock:
                self._ensemble_cache[cache_key] = {
                    "t": time.time(),
                    "data": dict(result),
                }
            self._flush_open_meteo_disk_cache()
            record_source_call("open_meteo", "ensemble", "success", (time.perf_counter() - started) * 1000.0)
            return result
        except Exception as e:
            status_code = getattr(getattr(e, "response", None), "status_code", None)
            if status_code == 429:
                retry_after_str = getattr(e.response, "headers", {}).get("Retry-After")
                cooldown_to_use = self._open_meteo_rl_cooldown
                if retry_after_str:
                    try:
                        parsed = int(retry_after_str)
                        if parsed > 0:
                            cooldown_to_use = min(parsed + 60, 3600)
                    except ValueError:
                        pass
                logger.warning(
                    f"Ensemble API rate limited (429), fallback to cache if available: lat={lat}, lon={lon}"
                )
                with self._open_meteo_rl_lock:
                    self._open_meteo_rate_limit_until = time.time() + cooldown_to_use
            else:
                logger.warning(f"Ensemble API 请求失败: {e}")
            with self._ensemble_cache_lock:
                stale = self._ensemble_cache.get(cache_key)
                if stale and isinstance(stale.get("data"), dict):
                    fallback = dict(stale["data"])
                    fallback["stale_cache"] = True
                    record_source_call("open_meteo", "ensemble", "stale_cache", (time.perf_counter() - started) * 1000.0)
                    return fallback
            record_source_call("open_meteo", "ensemble", "error", (time.perf_counter() - started) * 1000.0)
            return None

    def fetch_multi_model(
        self,
        lat: float,
        lon: float,
        city: str = "",
        use_fahrenheit: bool = False,
    ) -> Optional[Dict]:
        """
        从 Open-Meteo 获取多个独立 NWP 模型的预报
        用于真正的多模型共识评分

        模型列表:
        - ECMWF IFS (欧洲中期天气预报中心)
        - GFS (美国 NOAA)
        - ICON (德国气象局 DWD)
        - GEM (加拿大气象局)
        - JMA (日本气象厅)

        返回 3 天的预报数据，支持今日+明日共识分析
        """
        started = time.perf_counter()
        cache_city = str(city or "").strip().lower()
        cache_key = (
            f"{round(float(lat), 4)}:{round(float(lon), 4)}:{cache_city}:"
            f"{'f' if use_fahrenheit else 'c'}:{self.multi_model_cache_version}"
        )
        self._maybe_reload_open_meteo_disk_cache()
        now_ts = time.time()
        # ── 429 冷却期检查（所有 Open-Meteo 端点共享）─────────────────
        with self._open_meteo_rl_lock:
            if now_ts < self._open_meteo_rate_limit_until:
                remaining = int(self._open_meteo_rate_limit_until - now_ts)
                logger.debug(f"Open-Meteo Multi-model 冷却期中，跳过请求，还需 {remaining}s")
                with self._multi_model_cache_lock:
                    stale = self._multi_model_cache.get(cache_key)
                    if stale and isinstance(stale.get("data"), dict):
                        record_source_call("open_meteo", "multi_model", "stale_cache", (time.perf_counter() - started) * 1000.0)
                        return dict(stale["data"])
                record_source_call("open_meteo", "multi_model", "cooldown_skip", (time.perf_counter() - started) * 1000.0)
                return None

        with self._multi_model_cache_lock:
            cached = self._multi_model_cache.get(cache_key)
            if (
                cached
                and now_ts - float(cached.get("t", 0))
                < self.open_meteo_multi_model_cache_ttl_sec
            ):
                cached_data = cached.get("data")
                if isinstance(cached_data, dict):
                    record_source_call("open_meteo", "multi_model", "cache_hit", (time.perf_counter() - started) * 1000.0)
                    return dict(cached_data)
        try:
            url = "https://api.open-meteo.com/v1/forecast"
            models = "ecmwf_ifs025,gfs_seamless,icon_seamless,gem_seamless,jma_seamless"
            params = {
                "latitude": lat,
                "longitude": lon,
                "daily": "temperature_2m_max",
                "models": models,
                "timezone": "auto",
                "forecast_days": 3,
            }
            if use_fahrenheit:
                params["temperature_unit"] = "fahrenheit"

            self._wait_open_meteo_slot("multi-model")
            response = self._http_get(
                url,
                params=params,
                timeout=self.timeout,
            )
            response.raise_for_status()
            data = response.json()

            daily = data.get("daily", {})
            dates = daily.get("time", [])

            model_labels = {
                "ecmwf_ifs025": "ECMWF",
                "gfs_seamless": "GFS",
                "icon_seamless": "ICON",
                "gem_seamless": "GEM",
                "jma_seamless": "JMA",
            }

            # 按天提取每个模型的预报
            daily_forecasts = {}  # {"2026-02-23": {"ECMWF": 7.9, "GFS": 6.5, ...}, ...}
            for day_idx, date_str in enumerate(dates):
                day_data = {}
                for model_key, label in model_labels.items():
                    key = f"temperature_2m_max_{model_key}"
                    values = daily.get(key, [])
                    if day_idx < len(values) and values[day_idx] is not None:
                        day_data[label] = round(values[day_idx], 1)
                if day_data:
                    daily_forecasts[date_str] = day_data

            if not daily_forecasts:
                logger.warning("Multi-model: 无有效模型数据")
                record_source_call("open_meteo", "multi_model", "empty", (time.perf_counter() - started) * 1000.0)
                return None

            # 今天的预报 (向后兼容)
            today_date = dates[0] if dates else None
            forecasts = daily_forecasts.get(today_date, {})

            labels_str = ", ".join([f"{k}={v}" for k, v in forecasts.items()])
            logger.info(
                f"🔬 Multi-model ({len(forecasts)}个, {len(daily_forecasts)}天): {labels_str}"
            )

            result = {
                "source": "multi_model",
                "forecasts": forecasts,  # 今天 {"ECMWF": 12.3, "GFS": 11.8, ...} (向后兼容)
                "daily_forecasts": daily_forecasts,  # 按天 {"2026-02-23": {...}, "2026-02-24": {...}}
                "dates": dates,
                "unit": "fahrenheit" if use_fahrenheit else "celsius",
            }
            with self._multi_model_cache_lock:
                self._multi_model_cache[cache_key] = {
                    "t": time.time(),
                    "data": dict(result),
                }
            self._flush_open_meteo_disk_cache()
            record_source_call("open_meteo", "multi_model", "success", (time.perf_counter() - started) * 1000.0)
            return result
        except Exception as e:
            status_code = getattr(getattr(e, "response", None), "status_code", None)
            if status_code == 429:
                retry_after_str = getattr(e.response, "headers", {}).get("Retry-After")
                cooldown_to_use = self._open_meteo_rl_cooldown
                if retry_after_str:
                    try:
                        parsed = int(retry_after_str)
                        if parsed > 0:
                            cooldown_to_use = min(parsed + 60, 3600)
                    except ValueError:
                        pass
                logger.warning(
                    f"Multi-model API rate limited (429), fallback to cache if available: lat={lat}, lon={lon}"
                )
                with self._open_meteo_rl_lock:
                    self._open_meteo_rate_limit_until = time.time() + cooldown_to_use
            else:
                logger.warning(f"Multi-model API 请求失败: {e}")
            with self._multi_model_cache_lock:
                stale = self._multi_model_cache.get(cache_key)
                if stale and isinstance(stale.get("data"), dict):
                    fallback = dict(stale["data"])
                    fallback["stale_cache"] = True
                    record_source_call("open_meteo", "multi_model", "stale_cache", (time.perf_counter() - started) * 1000.0)
                    return fallback
            record_source_call("open_meteo", "multi_model", "error", (time.perf_counter() - started) * 1000.0)
            return None

