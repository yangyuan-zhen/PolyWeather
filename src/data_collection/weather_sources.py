import csv
import os
import requests
import re
import time
import threading
from typing import Optional, Dict, List
from datetime import datetime, timedelta
from loguru import logger


class WeatherDataCollector:
    """
    Multi-source weather data collector

    Supports:
    - OpenWeatherMap (free, fast updates)
    - Weather Underground (Polymarket settlement source)
    - Visual Crossing (rich historical data)
    - NOAA Aviation Weather (METAR - airport observations)
    """

    from src.data_collection.city_registry import CITY_REGISTRY
    CITY_TO_ICAO = {cid: info["icao"] for cid, info in CITY_REGISTRY.items()}
    # Alias
    CITY_TO_ICAO["nyc"] = "KLGA"

    # 城市周边 METAR 集群（用于在全球城市模拟类似安卡拉的多测站地图分布）
    CITY_METAR_CLUSTERS = {
        "buenos aires": ["SAEZ", "SABE", "SADP", "SADF", "SADL", "SADJ"],
        "london": ["EGLL", "EGLC", "EGKK", "EGSS", "EGGW"],
        "new york": ["KLGA", "KJFK", "KEWR", "KTEB", "KHPN"],
        "paris": ["LFPG", "LFPO", "LFPB"],
        "seoul": ["RKSI", "RKSS"],
        "toronto": ["CYYZ", "CYTZ", "CYKF"],
        "chicago": ["KORD", "KMDW", "KPWK", "KDPA"],
        "dallas": ["KDAL", "KDFW", "KADS", "KGKY"],
        "atlanta": ["KATL", "KPDK", "KFTY"],
        "miami": ["KMIA", "KOPF", "KTMB"],
        "seattle": ["KSEA", "KBFI", "KPAE"],
        "sao paulo": ["SBGR", "SBSP", "SBKP"],
        "munich": ["EDDM", "EDMO", "EDJA"],
    }

    # Meteoblue 仅在增益最大的城市启用（减少配额消耗与冗余请求）
    METEOBLUE_PRIORITY_CITIES = {
        "ankara",
        "london",
        "paris",
        "seoul",
        "toronto",
        "buenos aires",
        "wellington",
        "lucknow",
        "sao paulo",
        "munich",
    }

    def __init__(self, config: dict):
        self.config = config
        weather_cfg = config.get("weather", {})
        self.wunderground_key = weather_cfg.get("wunderground_api_key")
        self.meteoblue_key = weather_cfg.get("meteoblue_api_key")

        self.timeout = 30  # 增加超时以支持高延迟 VPS
        self.session = requests.Session()
        self.open_meteo_cache_ttl_sec = int(
            os.getenv("OPEN_METEO_CACHE_TTL_SEC", "900")
        )
        self.open_meteo_ensemble_cache_ttl_sec = int(
            os.getenv("OPEN_METEO_ENSEMBLE_CACHE_TTL_SEC", "900")
        )
        self.open_meteo_multi_model_cache_ttl_sec = int(
            os.getenv("OPEN_METEO_MULTI_MODEL_CACHE_TTL_SEC", "900")
        )
        self._open_meteo_cache: Dict[str, Dict] = {}
        self._ensemble_cache: Dict[str, Dict] = {}
        self._multi_model_cache: Dict[str, Dict] = {}
        self._open_meteo_cache_lock = threading.Lock()
        self._ensemble_cache_lock = threading.Lock()
        self._multi_model_cache_lock = threading.Lock()
        # Open-Meteo 共享 429 冷却计时器：触发限流后所有 OM 端点暂停请求
        self._open_meteo_rate_limit_until: float = 0.0
        self._open_meteo_rl_cooldown: int = int(
            os.getenv("OPEN_METEO_RATE_LIMIT_COOLDOWN_SEC", "900")  # 默认 15 分钟
        )
        self._open_meteo_rl_lock = threading.Lock()
        self.meteoblue_cache_ttl_sec = int(
            os.getenv("METEOBLUE_CACHE_TTL_SEC", "7200")
        )
        self._meteoblue_cache: Dict[str, Dict] = {}
        self._meteoblue_cache_lock = threading.Lock()
        self.metar_cache_ttl_sec = int(
            os.getenv("METAR_CACHE_TTL_SEC", "600")  # 默认 10 分钟
        )
        self._metar_cache: Dict[str, Dict] = {}
        self._metar_cache_lock = threading.Lock()

        # 设置代理
        proxy = config.get("proxy")
        if proxy:
            if not proxy.startswith("http"):
                proxy = f"http://{proxy}"
            self.session.proxies = {"http": proxy, "https": proxy}
            logger.info(f"正在使用天气数据代理: {proxy}")

        logger.info("天气数据采集器初始化完成。")

    def fetch_from_openweather(self, city: str, country: str = None) -> Optional[Dict]:
        """
        Fetch current weather and forecast from OpenWeatherMap

        Args:
            city: City name
            country: Country code (optional)

        Returns:
            dict: Weather data
        """
        if not getattr(self, "openweather_key", None):
            return None

        query = f"{city},{country}" if country else city

        try:
            # Current weather
            current_url = "https://api.openweathermap.org/data/2.5/weather"
            current_response = self.session.get(
                current_url,
                params={"q": query, "appid": self.openweather_key, "units": "metric"},
                timeout=self.timeout,
            )
            current_response.raise_for_status()
            current_data = current_response.json()

            # 5-day forecast
            forecast_url = "https://api.openweathermap.org/data/2.5/forecast"
            forecast_response = self.session.get(
                forecast_url,
                params={"q": query, "appid": self.openweather_key, "units": "metric"},
                timeout=self.timeout,
            )
            forecast_response.raise_for_status()
            forecast_data = forecast_response.json()

            return {
                "source": "openweathermap",
                "timestamp": datetime.utcnow().isoformat(),
                "current": {
                    "temp": current_data["main"]["temp"],
                    "feels_like": current_data["main"]["feels_like"],
                    "temp_min": current_data["main"]["temp_min"],
                    "temp_max": current_data["main"]["temp_max"],
                    "humidity": current_data["main"]["humidity"],
                    "pressure": current_data["main"]["pressure"],
                    "wind_speed": current_data["wind"]["speed"],
                    "clouds": current_data["clouds"]["all"],
                    "description": current_data["weather"][0]["description"],
                },
                "forecast": self._parse_openweather_forecast(forecast_data),
            }

        except requests.exceptions.RequestException as e:
            logger.error(f"OpenWeatherMap request failed: {e}")
            return None

    def _parse_openweather_forecast(self, data: dict) -> List[Dict]:
        """Parse OpenWeatherMap forecast data"""
        forecasts = []
        for item in data.get("list", []):
            forecasts.append(
                {
                    "datetime": item["dt_txt"],
                    "temp": item["main"]["temp"],
                    "temp_min": item["main"]["temp_min"],
                    "temp_max": item["main"]["temp_max"],
                    "humidity": item["main"]["humidity"],
                    "description": item["weather"][0]["description"],
                }
            )
        return forecasts

    def fetch_from_visualcrossing(
        self, city: str, start_date: str = None, end_date: str = None
    ) -> Optional[Dict]:
        """
        Fetch historical weather data from Visual Crossing

        Args:
            city: City name
            start_date: Start date (YYYY-MM-DD)
            end_date: End date (YYYY-MM-DD)

        Returns:
            dict: Historical weather data
        """
        if not getattr(self, "visualcrossing_key", None):
            return None

        # Default to last 30 days if no dates provided
        if not end_date:
            end_date = datetime.now().strftime("%Y-%m-%d")
        if not start_date:
            start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")

        try:
            url = f"https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/{city}/{start_date}/{end_date}"
            response = self.session.get(
                url,
                params={
                    "unitGroup": "metric",
                    "key": self.visualcrossing_key,
                    "contentType": "json",
                    "include": "days",
                },
                timeout=self.timeout,
            )
            response.raise_for_status()
            data = response.json()

            return {
                "source": "visualcrossing",
                "timestamp": datetime.utcnow().isoformat(),
                "location": data.get("resolvedAddress"),
                "timezone": data.get("timezone"),
                "days": [
                    {
                        "date": day["datetime"],
                        "temp_max": day.get("tempmax"),
                        "temp_min": day.get("tempmin"),
                        "temp_avg": day.get("temp"),
                        "humidity": day.get("humidity"),
                        "precip": day.get("precip"),
                        "conditions": day.get("conditions"),
                    }
                    for day in data.get("days", [])
                ],
            }

        except requests.exceptions.RequestException as e:
            logger.error(f"Visual Crossing request failed: {e}")
            return None

    def get_icao_code(self, city: str) -> Optional[str]:
        """
        根据城市名获取对应的 ICAO 机场代码
        """
        normalized = city.lower().strip()

        # 直接匹配
        if normalized in self.CITY_TO_ICAO:
            return self.CITY_TO_ICAO[normalized]

        # 模糊匹配
        for key, icao in self.CITY_TO_ICAO.items():
            if key in normalized or normalized in key:
                return icao

        return None

    def fetch_metar(
        self, city: str, use_fahrenheit: bool = False, utc_offset: int = 0
    ) -> Optional[Dict]:
        """
        从 NOAA Aviation Weather Center 获取 METAR 航空气象数据

        这是 Polymarket 天气市场的结算数据源 (Weather Underground) 使用的相同气象站

        Args:
            city: 城市名称
            use_fahrenheit: 是否转换为华氏度

        Returns:
            dict: METAR 数据，包含温度、露点、风速等
        """
        icao = self.get_icao_code(city)
        if not icao:
            logger.warning(f"未找到城市 {city} 对应的 ICAO 代码")
            return None

        cache_key = f"{icao}:{utc_offset}:{use_fahrenheit}"
        now_ts = time.time()
        with self._metar_cache_lock:
            cached = self._metar_cache.get(cache_key)
            if cached and now_ts - cached["t"] < self.metar_cache_ttl_sec:
                logger.debug(f"METAR cache hit {icao} age={int(now_ts - cached['t'])}s")
                return cached["d"]

        try:
            # NOAA Aviation Weather API (免费，无需 Key)
            url = "https://aviationweather.gov/api/data/metar"
            params = {
                "ids": icao,
                "format": "json",
                "hours": 24,  # 抓取 24 小时数据以计算今日最高
                "_t": int(time.time()),
            }

            response = self.session.get(
                url,
                params=params,
                timeout=self.timeout,
            )
            response.raise_for_status()

            data = response.json()
            if not data:
                return None


            # 1. 取最新的观测作为当前状态
            latest = data[0]
            temp_c = latest.get("temp")
            dewp_c = latest.get("dewp")

            # 从 rawOb 中提取真实观测时间（比 reportTime 更准确，reportTime 会被取整）
            # rawOb 格式: "METAR EGLC 271150Z AUTO ..." → "271150Z" → 27日11:50 UTC
            def _parse_rawob_time(obs):
                """从 rawOb 中提取精确的 UTC 观测时间"""
                raw = obs.get("rawOb", "")
                import re as _re

                m = _re.search(r"\b(\d{2})(\d{2})(\d{2})Z\b", raw)
                if m:
                    _day, hour, minute = (
                        int(m.group(1)),
                        int(m.group(2)),
                        int(m.group(3)),
                    )
                    # 用 reportTime 的日期部分 + rawOb 的时分
                    fallback = obs.get("reportTime", "")
                    try:
                        clean = fallback.replace(" ", "T")
                        if not clean.endswith("Z"):
                            clean += "Z"
                        base_dt = datetime.fromisoformat(clean.replace("Z", "+00:00"))
                        result = base_dt.replace(hour=hour, minute=minute, second=0)
                        # 处理跨日（如 rawOb 是23:50但 reportTime 已经是次日00:00）
                        if result > base_dt + timedelta(hours=2):
                            result -= timedelta(days=1)
                        return result
                    except Exception:
                        pass
                # fallback 到 reportTime
                fallback = obs.get("reportTime", "")
                try:
                    clean = fallback.replace(" ", "T")
                    if not clean.endswith("Z"):
                        clean += "Z"
                    return datetime.fromisoformat(clean.replace("Z", "+00:00"))
                except Exception:
                    return None

            obs_dt = _parse_rawob_time(latest)
            obs_time = (
                obs_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
                if obs_dt
                else latest.get("reportTime", "")
            )

            # 2. 精确计算"当地今天"的最高温
            from datetime import timezone, timedelta

            now_utc = datetime.now(timezone.utc)
            local_now = now_utc + timedelta(seconds=utc_offset)
            local_midnight = local_now.replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            utc_midnight = local_midnight - timedelta(seconds=utc_offset)

            max_so_far_c = -999
            max_temp_time = None
            for obs in data:
                obs_dt_iter = _parse_rawob_time(obs)
                if obs_dt_iter is None:
                    continue
                try:
                    if obs_dt_iter >= utc_midnight:
                        t = obs.get("temp")
                        if t is not None and t > max_so_far_c:
                            max_so_far_c = t
                            local_report = obs_dt_iter + timedelta(seconds=utc_offset)
                            max_temp_time = local_report.strftime("%H:%M")
                except Exception:
                    continue

            # 3. 提取最近 4 条报文的多维数据（温度 + 风/云/压强，用于趋势和 shock_score）
            recent_temps_raw = []  # [(local_time_str, temp_c), ...]
            recent_obs_raw = []  # [{time, temp, wdir, wspd, clouds, altim}, ...]
            today_obs_raw = []  # [(local_time_str, temp_c), ...] 今天全部观测
            cloud_rank_map = {
                "CLR": 0, "SKC": 0, "FEW": 1, "SCT": 2, "BKN": 3, "OVC": 4,
            }
            for i_obs, obs in enumerate(data):  # data 已按时间倒序
                obs_temp = obs.get("temp")
                obs_dt_iter = _parse_rawob_time(obs)
                if obs_temp is not None and obs_dt_iter:
                    local_rt = obs_dt_iter + timedelta(seconds=utc_offset)
                    time_str = local_rt.strftime("%H:%M")

                    # 收集今天全部观测点（用于图表叠加）
                    if obs_dt_iter >= utc_midnight:
                        today_obs_raw.append((time_str, obs_temp))

                    # 只取前4条用于趋势分析和 shock_score
                    if i_obs < 4:
                        recent_temps_raw.append((time_str, obs_temp))
                        clouds = obs.get("clouds", [])
                        max_cloud_rank = 0
                        for c in clouds:
                            rank = cloud_rank_map.get(c.get("cover", ""), 0)
                            if rank > max_cloud_rank:
                                max_cloud_rank = rank
                        recent_obs_raw.append(
                            {
                                "time": time_str,
                                "temp": obs_temp,
                                "wdir": obs.get("wdir"),
                                "wspd": obs.get("wspd"),
                                "cloud_rank": max_cloud_rank,  # 0~4
                                "altim": obs.get("altim"),
                            }
                        )

            # 转换为单位
            if use_fahrenheit:
                temp = temp_c * 9 / 5 + 32 if temp_c is not None else None
                max_so_far = max_so_far_c * 9 / 5 + 32 if max_so_far_c > -900 else None
                dewp = dewp_c * 9 / 5 + 32 if dewp_c is not None else None
                unit = "fahrenheit"
                recent_temps = [
                    (t, round(v * 9 / 5 + 32, 1)) for t, v in recent_temps_raw
                ]
                today_obs = [
                    (t, round(v * 9 / 5 + 32, 1)) for t, v in today_obs_raw
                ]
            else:
                temp = temp_c
                max_so_far = max_so_far_c if max_so_far_c > -900 else None
                dewp = dewp_c
                unit = "celsius"
                recent_temps = [(t, v) for t, v in recent_temps_raw]
                today_obs = [(t, v) for t, v in today_obs_raw]

            result = {
                "source": "metar",
                "icao": icao,
                "station_name": latest.get("name", icao),
                "timestamp": datetime.utcnow().isoformat(),
                "observation_time": obs_time,
                "report_time": latest.get("reportTime"),
                "receipt_time": latest.get("receiptTime"),
                "obs_time_epoch": latest.get("obsTime"),
                "current": {
                    "temp": round(temp, 1) if temp is not None else None,
                    "max_temp_so_far": round(max_so_far, 1)
                    if max_so_far is not None
                    else None,
                    "max_temp_time": max_temp_time,
                    "dewpoint": round(dewp, 1) if dewp is not None else None,
                    "humidity": latest.get("rh"),
                    "wind_speed_kt": latest.get("wspd"),
                    "wind_dir": latest.get("wdir"),
                    "visibility_mi": latest.get("visib"),
                    "wx_desc": latest.get("wxString"),
                    "altimeter": latest.get("altim"),
                    "raw_metar": latest.get("rawOb"),
                    "clouds": latest.get("clouds", []),
                },
                "recent_temps": recent_temps,  # 最近4条: [("15:00", 5), ("14:20", 5), ...]
                "today_obs": today_obs,  # 今天全部观测: [("00:00", 3), ("01:00", 2.5), ...]
                "recent_obs": recent_obs_raw,  # 最近4条多维数据（风/云/压强）
                "unit": unit,
            }

            logger.info(
                f"✈️ METAR {icao}: {temp:.1f}°{'F' if use_fahrenheit else 'C'} "
                f"(obs: {obs_time})"
            )
            with self._metar_cache_lock:
                self._metar_cache[cache_key] = {"d": result, "t": now_ts}
            return result

        except requests.exceptions.RequestException as e:
            logger.error(f"METAR 请求失败 ({icao}): {e}")
            with self._metar_cache_lock:
                stale = self._metar_cache.get(cache_key)
                if stale:
                    logger.warning(f"METAR {icao} 请求失败，使用缓存回退")
                    return stale["d"]
            return None
        except (KeyError, IndexError, TypeError) as e:
            logger.error(f"METAR 数据解析失败 ({icao}): {e}")
            return None

    def fetch_from_mgm(self, istno: str) -> Optional[Dict]:
        """
        从土耳其气象局 (MGM) 获取实时数据和预测 (由用户提供其内部 API)
        """
        base_url = "https://servis.mgm.gov.tr/web"
        # 必须带 Origin，否则会被反爬拦截
        headers = {
            "Origin": "https://www.mgm.gov.tr",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }
        results = {}

        try:
            # 1. 实时数据 (添加时间戳防止 CDN 缓存)
            import time

            obs_resp = self.session.get(
                f"{base_url}/sondurumlar?istno={istno}&_={int(time.time() * 1000)}",
                headers=headers,
                timeout=self.timeout,
            )
            if obs_resp.status_code == 200:
                data = obs_resp.json()
                if data:
                    latest = data[0] if isinstance(data, list) else data
                    # MGM 数据字段映射
                    # ruzgarHiz 实测为 km/h，转为 m/s 需要除以 3.6
                    ruz_hiz_kmh = latest.get("ruzgarHiz", 0)

                    # MGM 返回 -9999 表示数据缺失，需要过滤
                    def _valid(v):
                        return v is not None and v > -9000

                    results["current"] = {
                        "temp": latest.get("sicaklik")
                        if _valid(latest.get("sicaklik"))
                        else None,
                        "feels_like": latest.get("hissedilenSicaklik")
                        if _valid(latest.get("hissedilenSicaklik"))
                        else None,
                        "humidity": latest.get("nem")
                        if _valid(latest.get("nem"))
                        else None,
                        "wind_speed_ms": round(ruz_hiz_kmh / 3.6, 1)
                        if _valid(ruz_hiz_kmh)
                        else None,
                        "wind_speed_kt": round(ruz_hiz_kmh / 1.852, 1)
                        if _valid(ruz_hiz_kmh)
                        else None,
                        "wind_dir": latest.get("ruzgarYon")
                        if _valid(latest.get("ruzgarYon"))
                        else None,
                        "rain_24h": latest.get("toplamYagis")
                        if _valid(latest.get("toplamYagis"))
                        else None,
                        "pressure": latest.get("aktuelBasinc")
                        if _valid(latest.get("aktuelBasinc"))
                        else None,
                        "cloud_cover": latest.get("kapalilik"),  # 0-8 八分位云量
                        "mgm_max_temp": latest.get("maxSicaklik")
                        if _valid(latest.get("maxSicaklik"))
                        else None,
                        "time": latest.get("veriZamani"),
                        "station_name": latest.get("istasyonAd")
                        or latest.get("adi")
                        or latest.get("merkezAd")
                        or "Ankara Bölge",
                    }

            # 2. 每日预报（尝试两个可能的 API 路径）
            forecast_urls = [
                f"{base_url}/tahminler/gunluk?istno={istno}",
                f"https://servis.mgm.gov.tr/api/tahminler/gunluk?istno={istno}",
            ]
            for forecast_url in forecast_urls:
                try:
                    daily_resp = self.session.get(
                        forecast_url, headers=headers, timeout=self.timeout
                    )
                    if daily_resp.status_code == 200:
                        forecasts = daily_resp.json()
                        if forecasts and isinstance(forecasts, list):
                            # Store today extra clearly
                            today = forecasts[0]
                            high_val = today.get("enYuksekGun1")
                            low_val = today.get("enDusukGun1")
                            if high_val is not None:
                                results["today_high"] = high_val
                                results["today_low"] = low_val
                                logger.info(f"📋 MGM 每日预报: 今天的最高温 {high_val}°C")
                            
                            # Store all 5 days for multi_model_daily
                            results["daily_forecasts"] = {}
                            for i, day in enumerate(forecasts[:5]):
                                d_high = day.get("enYuksekGun1")
                                if d_high is not None:
                                    # Calculate date (today + offset)
                                    target_date = (datetime.now() + timedelta(days=i)).strftime("%Y-%m-%d")
                                    results["daily_forecasts"][target_date] = d_high
                            break
                    else:
                        logger.debug(
                            f"MGM forecast URL {forecast_url} returned {daily_resp.status_code}"
                        )
                except Exception as e:
                    logger.debug(f"MGM forecast URL {forecast_url} failed: {e}")

            # 3. 小时预报
            try:
                hourly_resp = self.session.get(
                    f"{base_url}/tahminler/saatlik?istno={istno}",
                    headers=headers,
                    timeout=self.timeout
                )
                if hourly_resp.status_code == 200:
                    h_data = hourly_resp.json()
                    if h_data and isinstance(h_data, list):
                        tahmin_list = h_data[0].get("tahmin", [])
                        results["hourly"] = []
                        for t_data in tahmin_list:
                            if "tarih" in t_data and "sicaklik" in t_data:
                                results["hourly"].append({
                                    "time": t_data["tarih"],
                                    "temp": t_data["sicaklik"]
                                })
            except Exception as e:
                logger.debug(f"MGM hourly failed: {e}")

            # 4. Fallback for today_high (if daily forecast is missing it)
            if "today_high" not in results:
                # Try from current max
                cur_max = results.get("current", {}).get("mgm_max_temp")
                if cur_max is not None:
                    results["today_high"] = cur_max
                    logger.info(f"📋 MGM 每日预报: 使用当前测站最高温作为今日预报回退: {cur_max}°C")
                elif "hourly" in results and results["hourly"]:
                    # Try from hourly
                    h_max = max((h["temp"] for h in results["hourly"] if h["temp"] is not None), default=None)
                    if h_max is not None:
                        results["today_high"] = h_max
                        logger.info(f"📋 MGM 每日预报: 使用小时预报最高温作为今日预报回退: {h_max}°C")

            # 5. Fallback for daily_forecasts from hourly data
            if not results.get("daily_forecasts") and results.get("hourly"):
                from collections import defaultdict
                daily_max = defaultdict(list)
                for h in results["hourly"]:
                    t = h.get("time", "")
                    temp = h.get("temp")
                    if t and temp is not None:
                        # Extract date from ISO timestamp like "2026-03-05T12:00:00.000Z"
                        date_str = t[:10]
                        daily_max[date_str].append(temp)
                if daily_max:
                    results["daily_forecasts"] = {}
                    for d, temps in sorted(daily_max.items()):
                        results["daily_forecasts"][d] = max(temps)
                    logger.info(
                        f"📋 MGM daily_forecasts (from hourly fallback): "
                        f"{dict(results['daily_forecasts'])}"
                    )

            return results if "current" in results else None
        except Exception as e:
            logger.error(f"MGM API 请求失败 ({istno}): {e}")
            return None

    def fetch_mgm_nearby_stations(self, province: str, root_ist_no: str = None) -> list:
        """
        获取一个土耳其省份内所有气象站的当前温度及经纬度
        使用多线程辅助抓取，因为直接通过 il={province} 往往只返回 1 个站。
        """
        base_url = "https://servis.mgm.gov.tr/web"
        headers = {
            "Origin": "https://www.mgm.gov.tr",
            "User-Agent": "Mozilla/5.0",
        }
        import time
        from concurrent.futures import ThreadPoolExecutor

        results = []
        try:
            # 1. 加载测站元数据 (缓存到实例中)，用于过滤属于该省份的站点
            if not getattr(self, "mgm_stations_meta", None):
                meta_resp = self.session.get(f"{base_url}/istasyonlar", headers=headers, timeout=self.timeout)
                if meta_resp.status_code == 200:
                    meta_json = meta_resp.json()
                    if isinstance(meta_json, list):
                        self.mgm_stations_meta = {s["istNo"]: s for s in meta_json if "istNo" in s}
                else:
                    self.mgm_stations_meta = {}

            metadata = getattr(self, "mgm_stations_meta", {})
            
            # 2. 找出属于该省份的所有站点 istNo
            province_upper = province.upper()
            province_ist_nos = [
                ist_no for ist_no, s in metadata.items() 
                if (s.get("il") or "").upper() == province_upper
            ]

            if not province_ist_nos:
                logger.warning(f"MGM 找不到省份 {province} 的站点元数据")
                return []

            # 同时确保我们关心的几个核心站一定在里面
            target_ist_nos = [str(i) for i in province_ist_nos[:25]]
            # 17130: 安卡拉总站 (市区核心)
            if 17130 in province_ist_nos or "17130" in province_ist_nos:
                if "17130" not in target_ist_nos:
                    target_ist_nos.append("17130")
            # 17128: 机场官方站
            if 17128 in province_ist_nos or "17128" in province_ist_nos:
                if "17128" not in target_ist_nos:
                    target_ist_nos.append("17128")
            if root_ist_no:
                rs = str(root_ist_no)
                if rs not in target_ist_nos:
                    target_ist_nos.append(rs)

            # 3. 多线程获取每个站点的最新观测 (sondurumlar)
            def fetch_single_station(ist_no):
                try:
                    # sondurumlar?istno={ist_no} 是目前最稳的获取多站数据的办法
                    url = f"{base_url}/sondurumlar?istno={ist_no}&_={int(time.time() * 1000)}"
                    resp = self.session.get(url, headers=headers, timeout=5)
                    if resp.status_code == 200:
                        obs_list = resp.json()
                        if obs_list:
                            obs = obs_list[0] if isinstance(obs_list, list) else obs_list
                            temp = obs.get("sicaklik")
                            wind_speed = obs.get("ruzgarHiz")
                            wind_dir = obs.get("ruzgarYon")
                            if temp is not None and temp > -9000:
                                return ist_no, {"temp": temp, "wind_speed": wind_speed, "wind_dir": wind_dir}
                except:
                    pass
                return None, None

            # 并发抓取
            station_temps = {}
            with ThreadPoolExecutor(max_workers=10) as executor:
                fetch_results = list(executor.map(fetch_single_station, target_ist_nos))
                for ist_no, data in fetch_results:
                    if ist_no is not None:
                        station_temps[ist_no] = data

            # 4. 组装最终结果
            for ist_no, temp in station_temps.items():
                sid = str(ist_no)
                # metadata 可能使用 int 或 str 作为 key
                meta = metadata.get(sid) or metadata.get(int(sid))
                if not meta:
                    continue
                
                lat = meta.get("enlem")
                lon = meta.get("boylam")
                # 优先显示区县名，地图更清晰
                display_name = (meta.get("ilce") or meta.get("istAd") or f"Station {ist_no}").title()
                
                # 特殊处理核心站点的显示名称
                sid = str(ist_no)
                if sid == "17130":
                    display_name = "Ankara (Bölge/Center)"
                elif sid == "17128":
                    display_name = "Airport (MGM/17128)"
                
                results.append({
                    "name": display_name,
                    "lat": lat,
                    "lon": lon,
                    "temp": temp.get("temp") if isinstance(temp, dict) else temp,
                    "wind_speed": temp.get("wind_speed") if isinstance(temp, dict) else None,
                    "wind_dir": temp.get("wind_dir") if isinstance(temp, dict) else None,
                    "istNo": ist_no
                })

            logger.info(f"📍 MGM 周边测站: 成功并发抓取 {len(results)} 个 {province} 站点的实时气温")
            return results
        except Exception as e:
            logger.error(f"Failed to fetch MGM nearby stations for {province}: {e}")
            return []

    def fetch_metar_nearby_cluster(self, icaos: List[str], use_fahrenheit: bool = False) -> list:
        """
        批量获取一组 ICAO 站点的 METAR 数据，用于地图周边显示
        """
        if not icaos:
            return []
        
        results = []
        try:
            ids_str = ",".join(icaos)
            # AviationWeather API 支持批量请求 IDs
            url = f"https://aviationweather.gov/api/data/metar?ids={ids_str}&format=json"
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            }
            resp = self.session.get(url, headers=headers, timeout=self.timeout)
            if resp.status_code != 200:
                logger.warning(f"METAR cluster fetch HTTP {resp.status_code} for {icaos}")
                return []
            
            data = resp.json()
            if not isinstance(data, list):
                return []

            for obs in data:
                icao = obs.get("icaoId")
                lat = obs.get("lat")
                lon = obs.get("lon")
                temp_c = obs.get("temp")
                if icao and lat and lon and temp_c is not None:
                    # 温度单位转换
                    display_temp = temp_c
                    if use_fahrenheit:
                        display_temp = (temp_c * 9 / 5) + 32
                    
                    # 站名处理：去除末尾的 " Airport" 或 " Intl" 使地图更简洁
                    name = obs.get("name") or icao
                    name = name.split(" Airport")[0].split(" Intl")[0].split(" International")[0].split(" Arpt")[0].split(",")[0].strip()

                    results.append({
                        "name": name,
                        "lat": lat,
                        "lon": lon,
                        "temp": round(display_temp, 1),
                        "istNo": icao,  # 用 ICAO ID 作为标识
                        "icao": icao,
                        "wind_dir": obs.get("wdir"),
                        "wind_speed": obs.get("wspd"),
                        "wind_speed_kt": obs.get("wspd"),
                        "raw_metar": obs.get("rawOb"),
                    })
            
            if results:
                logger.info(f"📍 METAR 集群: 成功抓取 {len(results)} 个参考站数据")
            return results
        except Exception as e:
            logger.error(f"Failed to fetch METAR cluster {icaos}: {e}")
            return []

    def fetch_nws(self, lat: float, lon: float) -> Optional[Dict]:
        """
        从 NWS (美国国家气象局) 获取高精度预报
        仅适用于美国城市，全球 VPS 均可访问
        """
        try:
            # 1. 获取网格点
            points_url = f"https://api.weather.gov/points/{lat},{lon}"
            headers = {"User-Agent": "PolyWeather/1.0 (weather-bot)"}

            points_resp = self.session.get(
                points_url, headers=headers, timeout=self.timeout
            )
            points_resp.raise_for_status()
            points_data = points_resp.json()

            properties = points_data.get("properties", {})
            forecast_url = properties.get("forecast")
            hourly_url = properties.get("forecastHourly")
            if not forecast_url:
                return None

            # 2. 获取预报
            forecast_resp = self.session.get(
                forecast_url, headers=headers, timeout=self.timeout
            )
            forecast_resp.raise_for_status()
            forecast_data = forecast_resp.json()

            periods = forecast_data.get("properties", {}).get("periods", [])
            if not periods:
                return None

            hourly_periods = []
            if hourly_url:
                hourly_resp = self.session.get(
                    hourly_url, headers=headers, timeout=self.timeout
                )
                hourly_resp.raise_for_status()
                hourly_data = hourly_resp.json()
                hourly_periods = hourly_data.get("properties", {}).get("periods", [])[:48]

            active_alerts = []
            try:
                alerts_resp = self.session.get(
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

            return {
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
        except Exception as e:
            logger.warning(f"NWS 请求失败: {e}")
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
        cache_key = (
            f"{round(float(lat), 4)}:{round(float(lon), 4)}:"
            f"{forecast_days}:{'f' if use_fahrenheit else 'c'}"
        )
        now_ts = time.time()
        # ── 429 冷却期检查（所有 Open-Meteo 端点共享）─────────────────
        with self._open_meteo_rl_lock:
            if now_ts < self._open_meteo_rate_limit_until:
                remaining = int(self._open_meteo_rate_limit_until - now_ts)
                logger.debug(f"Open-Meteo 冷却期中，跳过请求，还需 {remaining}s")
                with self._open_meteo_cache_lock:
                    stale = self._open_meteo_cache.get(cache_key)
                    if stale and isinstance(stale.get("data"), dict):
                        return dict(stale["data"])
                return None
        with self._open_meteo_cache_lock:
            cached = self._open_meteo_cache.get(cache_key)
            if (
                cached
                and now_ts - float(cached.get("t", 0)) < self.open_meteo_cache_ttl_sec
            ):
                cached_data = cached.get("data")
                if isinstance(cached_data, dict):
                    return dict(cached_data)
        try:
            url = "https://api.open-meteo.com/v1/forecast"
            params = {
                "latitude": lat,
                "longitude": lon,
                "current_weather": "true",
                "hourly": "temperature_2m,shortwave_radiation,dew_point_2m,pressure_msl,wind_speed_10m,wind_direction_10m,precipitation_probability,cloud_cover",
                "daily": "temperature_2m_max,apparent_temperature_max,sunrise,sunset,sunshine_duration",
                "timezone": "auto",
                "forecast_days": forecast_days,
            }

            # 显式指定单位，防止 API 默认行为漂移
            if use_fahrenheit:
                params["temperature_unit"] = "fahrenheit"
            else:
                params["temperature_unit"] = "celsius"

            response = self.session.get(
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
            return result
        except Exception as e:
            status_code = getattr(getattr(e, "response", None), "status_code", None)
            if status_code == 429:
                logger.warning(
                    f"Open-Meteo rate limited (429), fallback to cache if available: lat={lat}, lon={lon}"
                )
                # 设置全局冷却期，避免短时内重复触发 429
                with self._open_meteo_rl_lock:
                    self._open_meteo_rate_limit_until = time.time() + self._open_meteo_rl_cooldown
                    logger.warning(f"Open-Meteo 触发限流，设置 {self._open_meteo_rl_cooldown}s 冷却期")
            else:
                logger.error(f"Open-Meteo forecast failed: {e}")
            with self._open_meteo_cache_lock:
                stale = self._open_meteo_cache.get(cache_key)
                if stale and isinstance(stale.get("data"), dict):
                    fallback = dict(stale["data"])
                    fallback["stale_cache"] = True
                    return fallback
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
        cache_key = (
            f"{round(float(lat), 4)}:{round(float(lon), 4)}:"
            f"{'f' if use_fahrenheit else 'c'}"
        )
        now_ts = time.time()
        with self._ensemble_cache_lock:
            cached = self._ensemble_cache.get(cache_key)
            if (
                cached
                and now_ts - float(cached.get("t", 0))
                < self.open_meteo_ensemble_cache_ttl_sec
            ):
                cached_data = cached.get("data")
                if isinstance(cached_data, dict):
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

            response = self.session.get(
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
            return result
        except Exception as e:
            status_code = getattr(getattr(e, "response", None), "status_code", None)
            if status_code == 429:
                logger.warning(
                    f"Ensemble API rate limited (429), fallback to cache if available: lat={lat}, lon={lon}"
                )
            else:
                logger.warning(f"Ensemble API 请求失败: {e}")
            with self._ensemble_cache_lock:
                stale = self._ensemble_cache.get(cache_key)
                if stale and isinstance(stale.get("data"), dict):
                    fallback = dict(stale["data"])
                    fallback["stale_cache"] = True
                    return fallback
            return None

    def fetch_multi_model(
        self,
        lat: float,
        lon: float,
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
        cache_key = (
            f"{round(float(lat), 4)}:{round(float(lon), 4)}:"
            f"{'f' if use_fahrenheit else 'c'}"
        )
        now_ts = time.time()
        with self._multi_model_cache_lock:
            cached = self._multi_model_cache.get(cache_key)
            if (
                cached
                and now_ts - float(cached.get("t", 0))
                < self.open_meteo_multi_model_cache_ttl_sec
            ):
                cached_data = cached.get("data")
                if isinstance(cached_data, dict):
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

            response = self.session.get(
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
            return result
        except Exception as e:
            status_code = getattr(getattr(e, "response", None), "status_code", None)
            if status_code == 429:
                logger.warning(
                    f"Multi-model API rate limited (429), fallback to cache if available: lat={lat}, lon={lon}"
                )
            else:
                logger.warning(f"Multi-model API 请求失败: {e}")
            with self._multi_model_cache_lock:
                stale = self._multi_model_cache.get(cache_key)
                if stale and isinstance(stale.get("data"), dict):
                    fallback = dict(stale["data"])
                    fallback["stale_cache"] = True
                    return fallback
            return None

    def fetch_from_meteoblue(
        self,
        lat: float,
        lon: float,
        timezone_name: str = "UTC",
        use_fahrenheit: bool = False,
    ) -> Optional[Dict]:
        """
        通过 Meteoblue 官方 API 获取高精度预测数据
        带本地缓存，避免频繁请求触发 429。
        """
        if not self.meteoblue_key:
            logger.warning("Meteoblue API Key 未配置，跳过抓取。")
            return None

        cache_key = f"{round(float(lat), 4)}:{round(float(lon), 4)}:{'f' if use_fahrenheit else 'c'}"
        now_ts = time.time()
        with self._meteoblue_cache_lock:
            cached = self._meteoblue_cache.get(cache_key)
            if (
                cached
                and now_ts - float(cached.get("t", 0)) < self.meteoblue_cache_ttl_sec
            ):
                cached_data = cached.get("data")
                if isinstance(cached_data, dict):
                    return dict(cached_data)

        try:
            # 1. 调用官方 API (使用 basic-day 包，它是多模型 ML 融合结果)
            # 格式: https://my.meteoblue.com/packages/basic-day?apikey=KEY&lat=LAT&lon=LON&format=json
            url = "https://my.meteoblue.com/packages/basic-day"
            params = {
                "apikey": self.meteoblue_key,
                "lat": lat,
                "lon": lon,
                "format": "json",
                "as_daylight": "true",
            }

            response = self.session.get(url, params=params, timeout=self.timeout)
            response.raise_for_status()
            data = response.json()

            day_data = data.get("data_day", {})
            max_temps = day_data.get("temperature_max", [])

            if not max_temps:
                logger.warning(
                    f"Meteoblue API 返回数据中找不到最高温 (坐标: {lat},{lon})"
                )
                return None

            # 2. 转换单位
            def c_to_f(c):
                return round((c * 9 / 5) + 32, 1)

            result = {
                "source": "meteoblue",
                "today_high": None,
                "daily_highs": [],
                "unit": "fahrenheit" if use_fahrenheit else "celsius",
                "url": f"https://www.meteoblue.com/en/weather/week/{lat}N{lon}E",  # 仅供参考
            }

            # 提取今日最高
            mb_today_c = max_temps[0]
            result["today_high"] = c_to_f(mb_today_c) if use_fahrenheit else mb_today_c

            # 提取接下来几天的最高温
            if use_fahrenheit:
                result["daily_highs"] = [c_to_f(t) for t in max_temps]
            else:
                result["daily_highs"] = max_temps

            with self._meteoblue_cache_lock:
                self._meteoblue_cache[cache_key] = {
                    "t": now_ts,
                    "data": dict(result),
                }

            logger.info(
                f"✅ Meteoblue API 获取成功 ({lat},{lon}): 今天 {result['today_high']}{result['unit']}"
            )
            return result
        except Exception as e:
            status_code = getattr(getattr(e, "response", None), "status_code", None)
            if status_code == 429:
                logger.warning("Meteoblue API 限流(429)，尝试使用本地缓存回退。")
            else:
                logger.error(f"Meteoblue API fetch failed: {e}")

            with self._meteoblue_cache_lock:
                stale = self._meteoblue_cache.get(cache_key)
                if stale and isinstance(stale.get("data"), dict):
                    fallback = dict(stale["data"])
                    fallback["stale_cache"] = True
                    return fallback
            return None

    def extract_date_from_title(self, title: str) -> Optional[str]:
        """
        从标题中提取日期并标准化为 YYYY-MM-DD
        支持: "February 6", "2月6日", "2-6" 等
        """
        # 1. 尝试英文月份
        months = {
            "January": "01",
            "February": "02",
            "March": "03",
            "April": "04",
            "May": "05",
            "June": "06",
            "July": "07",
            "August": "08",
            "September": "09",
            "October": "10",
            "November": "11",
            "December": "12",
        }
        for month_name, month_val in months.items():
            if month_name in title:
                match = re.search(f"{month_name}\\s+(\\d+)", title)
                if match:
                    day = int(match.group(1))
                    year = datetime.now().year
                    return f"{year}-{month_val}-{day:02d}"

        # 2. 尝试中文格式 "2月7日" 或 "02月07日"
        zh_match = re.search(r"(\d{1,2})月(\d{1,2})日", title)
        if zh_match:
            month = int(zh_match.group(1))
            day = int(zh_match.group(2))
            year = datetime.now().year
            return f"{year}-{month:02d}-{day:02d}"

        # 3. 尝试 ISO 格式 YYYY-MM-DD
        iso_match = re.search(r"(\d{4})-(\d{2})-(\d{2})", title)
        if iso_match:
            return iso_match.group(0)

        return None

    def get_coordinates(self, city: str) -> Optional[Dict[str, float]]:
        """
        使用 Open-Meteo Geocoding API 获取城市坐标 (免费, 无需 Key)
        """
        from src.data_collection.city_registry import CITY_REGISTRY
        normalized_city = city.lower().strip()

        # 1. Check registry first (Source of Truth)
        if normalized_city in CITY_REGISTRY:
            info = CITY_REGISTRY[normalized_city]
            return {"lat": info["lat"], "lon": info["lon"]}

        # 2. Hardcoded specific cases or aliases
        static_aliases = {
            "new york's central park": "new york",
            "nyc": "new york"
        }
        if normalized_city in static_aliases:
            root_city = static_aliases[normalized_city]
            info = CITY_REGISTRY[root_city]
            return {"lat": info["lat"], "lon": info["lon"]}

        for key in CITY_REGISTRY:
            if key in normalized_city:
                logger.debug(f"地理编码命中模糊映射: {city} -> {key}")
                info = CITY_REGISTRY[key]
                return {"lat": info["lat"], "lon": info["lon"]}

        try:
            url = "https://geocoding-api.open-meteo.com/v1/search"
            response = self.session.get(
                url,
                params={"name": city, "count": 1, "language": "en", "format": "json"},
                timeout=15,  # 增加超时时间到 15s
            )
            response.raise_for_status()
            results = response.json().get("results", [])
            if results:
                res = results[0]
                return {
                    "lat": res.get("latitude"),
                    "lon": res.get("longitude"),
                    "name": res.get("name"),
                    "country": res.get("country"),
                }
        except Exception as e:
            logger.error(f"地理编码失败 ({city}): {e}")
        return None

    def extract_city_from_question(self, question: str) -> Optional[str]:
        """
        从 Polymarket 问题描述或 Slug 中提取城市名称
        """
        q = question.lower()

        # 1. 优先尝试已知城市列表 (硬编码匹配)
        known_cities = {
            "london": "London",
            "伦敦": "London",
            "new york": "New York",
            "new york's central park": "New York",
            "nyc": "New York",
            "纽约": "New York",
            "seattle": "Seattle",
            "西雅图": "Seattle",
            "chicago": "Chicago",
            "芝加哥": "Chicago",
            "dallas": "Dallas",
            "达拉斯": "Dallas",
            "miami": "Miami",
            "迈阿密": "Miami",
            "atlanta": "Atlanta",
            "亚特兰大": "Atlanta",
            "seoul": "Seoul",
            "首尔": "Seoul",
            "toronto": "Toronto",
            "多伦多": "Toronto",
            "ankara": "Ankara",
            "安卡拉": "Ankara",
            "wellington": "Wellington",
            "惠灵顿": "Wellington",
            "buenos aires": "Buenos Aires",
            "布宜诺斯艾利斯": "Buenos Aires",
        }

        for key, val in known_cities.items():
            if key in q:
                return val

        # 2. 从英文模板中提取
        triggers = [
            "temperature in ",
            "temp in ",
            "weather in ",
            "highest-temperature-in-",
            "temperature-in-",
        ]
        for trigger in triggers:
            if trigger in q:
                part = q.split(trigger)[1]
                delimiters = [
                    " on ",
                    " at ",
                    " above ",
                    " below ",
                    " be ",
                    " is ",
                    " will ",
                    " has ",
                    " reached ",
                    "?",
                    " (",
                    ", ",
                    "-",
                ]
                city = part
                for d in delimiters:
                    if d in city:
                        city = city.split(d)[0]
                return city.strip().title()

        return None

    def fetch_all_sources(
        self, city: str, lat: float = None, lon: float = None, country: str = None
    ) -> Dict:
        """
        Fetch weather data from all available sources
        """
        results = {}

        # 判断是否为美国市场（使用华氏度）
        us_cities = {
            "dallas",
            "nyc",
            "new york",
            "seattle",
            "miami",
            "atlanta",
            "chicago",
            "los angeles",
            "san francisco",
            "washington",
            "boston",
            "houston",
            "phoenix",
            "philadelphia",
            "new york's central park",
            "portland",
            "denver",
            "austin",
            "san diego",
            "detroit",
            "cleveland",
            "minneapolis",
            "st. louis",
        }
        city_lower = city.lower().strip()
        # 严格判断是否为美国市场（必须完全匹配列表或缩写）
        use_fahrenheit = city_lower in us_cities

        if use_fahrenheit:
            logger.info(f"🌡️ {city} 使用华氏度 (°F)")
        else:
            logger.info(f"🌡️ {city} 使用摄氏度 (°C)")

        if lat and lon:
            open_meteo = self.fetch_from_open_meteo(
                lat, lon, use_fahrenheit=use_fahrenheit
            )
            if open_meteo:
                results["open-meteo"] = open_meteo
                # 获取时区偏移以过滤 METAR
                utc_offset = open_meteo.get("utc_offset", 0)
                metar_data = self.fetch_metar(
                    city, use_fahrenheit=use_fahrenheit, utc_offset=utc_offset
                )
                if metar_data:
                    results["metar"] = metar_data

                # 对土耳其城市，额外获取 MGM 官方数据与周边测站
                turkish_provinces = {
                    "ankara": ("17128", "Ankara"),  # 使用机场站 (Esenboğa Havalimanı) 作为结算参考主站
                    "istanbul": ("17060", "Istanbul"),
                }
                if city_lower in turkish_provinces:
                    istno, province = turkish_provinces[city_lower]
                    # 核心逻辑：实测用 istno (17128), 预报强制去 17130 拿
                    mgm_data = self.fetch_from_mgm(istno)
                    
                    # 如果当前是机场站 (17128)，我们额外去 17130 拿一次预报
                    if istno == "17128":
                        mgm_city_center = self.fetch_from_mgm("17130")
                        if mgm_city_center and mgm_data:
                            # 用市中心的预报覆盖机场可能缺失的预报
                            mgm_data["today_high"] = mgm_city_center.get("today_high")
                            mgm_data["daily_forecasts"] = mgm_city_center.get("daily_forecasts")
                            logger.info("⚡ 已同步 MGM 安卡拉总部 (17130) 的官方最高温预报")
                    
                    if mgm_data:
                        results["mgm"] = mgm_data
                        nearby = self.fetch_mgm_nearby_stations(province, root_ist_no=istno)
                        if nearby:
                            results["mgm_nearby"] = nearby
                
                # 全球通用：对有预定义集群的城市，抓取周边 METAR 参考站
                if city_lower in self.CITY_METAR_CLUSTERS and "mgm_nearby" not in results:
                    cluster_icaos = self.CITY_METAR_CLUSTERS[city_lower]
                    cluster_data = self.fetch_metar_nearby_cluster(
                        cluster_icaos, use_fahrenheit=use_fahrenheit
                    )
                    if cluster_data:
                        results["mgm_nearby"] = cluster_data

                if open_meteo:
                    results["open-meteo"] = open_meteo
                    # 获取时区偏移以过滤 METAR
                    utc_offset = open_meteo.get("utc_offset", 0)

                if city_lower in self.METEOBLUE_PRIORITY_CITIES:
                    mb_data = self.fetch_from_meteoblue(
                        lat,
                        lon,
                        timezone_name=open_meteo.get("timezone", "UTC"),
                        use_fahrenheit=use_fahrenheit,
                    )
                    if mb_data:
                        results["meteoblue"] = mb_data

                # 对美国城市，额外获取 NWS 高精预报
                if use_fahrenheit:
                    nws_data = self.fetch_nws(lat, lon)
                    if nws_data:
                        results["nws"] = nws_data

                # 集合预报 (所有城市通用，用于不确定性分析)
                ens_data = self.fetch_ensemble(lat, lon, use_fahrenheit=use_fahrenheit)
                if ens_data:
                    results["ensemble"] = ens_data

                # 多模型预报 (所有城市通用，用于共识评分)
                mm_data = self.fetch_multi_model(
                    lat, lon, use_fahrenheit=use_fahrenheit
                )
                if mm_data:
                    results["multi_model"] = mm_data
            else:
                # Open-Meteo 失败时，仍然尝试获取 METAR 和 NWS
                metar_data = self.fetch_metar(city, use_fahrenheit=use_fahrenheit)
                if metar_data:
                    results["metar"] = metar_data
                if city_lower in self.METEOBLUE_PRIORITY_CITIES:
                    mb_data = self.fetch_from_meteoblue(
                        lat,
                        lon,
                        timezone_name="UTC",
                        use_fahrenheit=use_fahrenheit,
                    )
                    if mb_data:
                        results["meteoblue"] = mb_data
                if use_fahrenheit:
                    nws_data = self.fetch_nws(lat, lon)
                    if nws_data:
                        results["nws"] = nws_data
        else:
            # 降级方案（无经纬度）
            metar_data = self.fetch_metar(city, use_fahrenheit=use_fahrenheit)
            if metar_data:
                results["metar"] = metar_data

        return results

    def check_consensus(self, forecasts: Dict) -> Dict:
        """
        Check consensus across multiple weather sources

        Args:
            forecasts: Dict of forecasts from different sources

        Returns:
            dict: Consensus analysis
        """
        predictions = []
        for source, data in forecasts.items():
            if data and "current" in data:
                predictions.append({"source": source, "temp": data["current"]["temp"]})

        if len(predictions) == 0:
            return {"consensus": False, "reason": "No weather data available"}

        temps = [p["temp"] for p in predictions]
        avg_temp = sum(temps) / len(temps)

        # If only one source, consensus is implicitly true
        if len(predictions) == 1:
            return {
                "consensus": True,
                "average_temp": avg_temp,
                "max_difference": 0.0,
                "predictions": predictions,
                "note": "Single source only",
            }

        max_diff = max(abs(t - avg_temp) for t in temps)
        # Consensus if all predictions within 2.5°C
        is_consensus = max_diff <= 2.5

        return {
            "consensus": is_consensus,
            "average_temp": avg_temp,
            "max_difference": max_diff,
            "predictions": predictions,
        }
