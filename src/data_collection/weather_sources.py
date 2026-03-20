import csv
import os
import requests
import re
import time
import threading
from typing import Optional, Dict, List, Any
from datetime import datetime, timedelta, timezone
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
        "hong kong": ["VHHH", "VMMC", "ZGSZ"],
        "taipei": ["RCSS", "RCTP"],
        "chengdu": ["ZUUU", "ZUTF"],
        "chongqing": ["ZUCK", "ZUPS"],
        "shenzhen": ["ZGSZ", "ZGGG"],
        "beijing": ["ZBAA", "ZBAD"],
        "wuhan": ["ZHHH", "ZHES"],
        "shanghai": ["ZSPD", "ZSSS", "ZSNB", "ZSHC"],
        "singapore": ["WSSS", "WSAP", "WMKK"],
        "tokyo": ["RJTT", "RJAA", "RJAH", "RJTJ"],
        "tel aviv": ["LLBG"],
        "milan": ["LIMC", "LIML", "LIME", "LIPO"],
        "toronto": ["CYYZ", "CYTZ", "CYKF"],
        "warsaw": ["EPWA", "EPMO", "EPLL"],
        "madrid": ["LEMD", "LETO", "LEGT"],
        "chicago": ["KORD", "KMDW", "KPWK", "KDPA"],
        "dallas": ["KDAL", "KDFW", "KADS", "KGKY"],
        "atlanta": ["KATL", "KPDK", "KFTY"],
        "miami": ["KMIA", "KOPF", "KTMB"],
        "seattle": ["KSEA", "KBFI", "KPAE"],
        "sao paulo": ["SBGR", "SBSP", "SBKP"],
        "munich": ["EDDM", "EDMO", "EDJA"],
    }

    def __init__(self, config: dict):
        self.config = config
        weather_cfg = config.get("weather", {})
        self.wunderground_key = weather_cfg.get("wunderground_api_key")

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
        self.multi_model_cache_version = str(
            os.getenv("OPEN_METEO_MULTI_MODEL_CACHE_VERSION", "v2")
        ).strip() or "v2"
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
        # Open-Meteo burst control: avoid hammering API with many cities at once.
        self._open_meteo_min_interval_sec: float = float(
            os.getenv("OPEN_METEO_MIN_CALL_INTERVAL_SEC", "3")
        )
        self._open_meteo_last_call_ts: float = 0.0
        self._open_meteo_call_lock = threading.Lock()
        self.metar_cache_ttl_sec = int(
            os.getenv("METAR_CACHE_TTL_SEC", "600")  # 默认 10 分钟
        )
        self._metar_cache: Dict[str, Dict] = {}
        self._metar_cache_lock = threading.Lock()
        self.settlement_cache_ttl_sec = int(
            os.getenv("SETTLEMENT_SOURCE_CACHE_TTL_SEC", "120")
        )
        self._settlement_cache: Dict[str, Dict] = {}
        self._settlement_cache_lock = threading.Lock()
        self.cwa_open_data_auth = (
            os.getenv("CWA_OPEN_DATA_AUTH")
            or os.getenv("CWA_OPEN_DATA_API_KEY")
            or "rdec-key-123-45678-011121314"
        ).strip()

        # 磁盘持久化缓存：重启后即可加载上次的预报数据，避免冷启动请求爆发
        self._disk_cache_path = os.getenv(
            "OPEN_METEO_DISK_CACHE_PATH", "/app/data/open_meteo_cache.json"
        )
        self._disk_cache_max_age_sec = int(
            os.getenv("OPEN_METEO_DISK_CACHE_MAX_AGE_SEC", "86400")
        )
        self._disk_cache_lock = threading.Lock()
        self._disk_cache_last_mtime: float = 0.0
        self._load_open_meteo_disk_cache()
        logger.info(
            f"Open-Meteo 磁盘缓存路径: {self._disk_cache_path} (max_age={self._disk_cache_max_age_sec}s)"
        )

        # 设置代理
        proxy = config.get("proxy")
        if proxy:
            if not proxy.startswith("http"):
                proxy = f"http://{proxy}"
            self.session.proxies = {"http": proxy, "https": proxy}
            logger.info(f"正在使用天气数据代理: {proxy}")

        logger.info("天气数据采集器初始化完成。")

    def _load_open_meteo_disk_cache(self) -> None:
        """启动时从磁盘加载 Open-Meteo 三类缓存，避免重启后冷启动打爆 API"""
        import json as _json
        try:
            path = self._disk_cache_path
            if not os.path.exists(path):
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "w", encoding="utf-8") as f:
                    _json.dump(
                        {
                            "forecast": {},
                            "ensemble": {},
                            "multi_model": {},
                            "saved_at": time.time(),
                        },
                        f,
                    )
                self._disk_cache_last_mtime = os.path.getmtime(path)
                return
            current_mtime = os.path.getmtime(path)
            if current_mtime <= self._disk_cache_last_mtime:
                return
            with open(path, "r", encoding="utf-8") as f:
                saved = _json.load(f)
            now = time.time()
            max_age = max(600, self._disk_cache_max_age_sec)
            loaded = 0
            with self._open_meteo_cache_lock:
                for key, entry in saved.get("forecast", {}).items():
                    if now - float(entry.get("t", 0)) < max_age:
                        old = self._open_meteo_cache.get(key)
                        if old is None or float(entry.get("t", 0)) >= float(old.get("t", 0)):
                            self._open_meteo_cache[key] = entry
                            loaded += 1
            with self._ensemble_cache_lock:
                for key, entry in saved.get("ensemble", {}).items():
                    if now - float(entry.get("t", 0)) < max_age:
                        old = self._ensemble_cache.get(key)
                        if old is None or float(entry.get("t", 0)) >= float(old.get("t", 0)):
                            self._ensemble_cache[key] = entry
                            loaded += 1
            with self._multi_model_cache_lock:
                for key, entry in saved.get("multi_model", {}).items():
                    if now - float(entry.get("t", 0)) < max_age:
                        old = self._multi_model_cache.get(key)
                        if old is None or float(entry.get("t", 0)) >= float(old.get("t", 0)):
                            self._multi_model_cache[key] = entry
                            loaded += 1
            self._disk_cache_last_mtime = current_mtime
            if loaded:
                logger.info(f"✅ 从磁盘加载 Open-Meteo 缓存 {loaded} 条 ({self._disk_cache_path})")
        except Exception as e:
            logger.warning(f"磁盘缓存加载失败（首次启动不影响运行）: {e}")

    def _maybe_reload_open_meteo_disk_cache(self) -> None:
        """跨进程共享缓存：当缓存文件有更新时增量重载到当前进程内存"""
        try:
            path = self._disk_cache_path
            if not os.path.exists(path):
                return
            current_mtime = os.path.getmtime(path)
            if current_mtime <= self._disk_cache_last_mtime:
                return
            self._load_open_meteo_disk_cache()
        except Exception:
            # 不影响主流程
            pass

    def _flush_open_meteo_disk_cache(self) -> None:
        """将三类 Open-Meteo 内存缓存持久化到磁盘"""
        import json as _json
        try:
            os.makedirs(os.path.dirname(self._disk_cache_path), exist_ok=True)
            with self._open_meteo_cache_lock:
                forecast_snapshot = dict(self._open_meteo_cache)
            with self._ensemble_cache_lock:
                ensemble_snapshot = dict(self._ensemble_cache)
            with self._multi_model_cache_lock:
                multi_model_snapshot = dict(self._multi_model_cache)
            payload = {
                "forecast": forecast_snapshot,
                "ensemble": ensemble_snapshot,
                "multi_model": multi_model_snapshot,
                "saved_at": time.time(),
            }
            with self._disk_cache_lock:
                tmp_path = self._disk_cache_path + ".tmp"
                with open(tmp_path, "w", encoding="utf-8") as f:
                    _json.dump(payload, f)
                os.replace(tmp_path, self._disk_cache_path)  # 原子替换，防止写入一半时被读到
            self._disk_cache_last_mtime = os.path.getmtime(self._disk_cache_path)
        except Exception as e:
            logger.warning(f"磁盘缓存写入失败: {e}")


    def _wait_open_meteo_slot(self, endpoint: str) -> None:
        """Simple per-process rate gate for Open-Meteo endpoints."""
        min_interval = self._open_meteo_min_interval_sec
        if min_interval <= 0:
            return
        with self._open_meteo_call_lock:
            now_ts = time.time()
            wait_for = min_interval - (now_ts - self._open_meteo_last_call_ts)
            if wait_for > 0:
                logger.debug(
                    f"Open-Meteo {endpoint} 限流保护：sleep {wait_for:.2f}s (min_interval={min_interval:.2f}s)"
                )
                time.sleep(wait_for)
                now_ts = time.time()
            self._open_meteo_last_call_ts = now_ts

    def _get_settlement_cache(self, key: str) -> Optional[Dict[str, Any]]:
        now_ts = time.time()
        with self._settlement_cache_lock:
            cached = self._settlement_cache.get(key)
            if cached and now_ts - float(cached.get("t", 0)) < self.settlement_cache_ttl_sec:
                return cached.get("d")
        return None

    def _set_settlement_cache(self, key: str, payload: Dict[str, Any]) -> None:
        with self._settlement_cache_lock:
            self._settlement_cache[key] = {"t": time.time(), "d": payload}

    @staticmethod
    def _csv_rows(text: str) -> List[Dict[str, str]]:
        normalized = str(text or "").lstrip("\ufeff")
        if not normalized.strip():
            return []
        return [row for row in csv.DictReader(normalized.splitlines()) if isinstance(row, dict)]

    @staticmethod
    def _hko_parse_local_iso(raw_yyyymmddhhmm: Optional[str]) -> Optional[str]:
        raw = str(raw_yyyymmddhhmm or "").strip()
        if len(raw) != 12 or not raw.isdigit():
            return None
        try:
            dt = datetime.strptime(raw, "%Y%m%d%H%M").replace(
                tzinfo=timezone(timedelta(hours=8))
            )
            return dt.isoformat()
        except Exception:
            return None

    @staticmethod
    def _hko_compass_to_deg(compass: Optional[str]) -> Optional[float]:
        value = str(compass or "").strip().upper()
        if not value:
            return None
        mapping = {
            "N": 0.0,
            "NNE": 22.5,
            "NE": 45.0,
            "ENE": 67.5,
            "E": 90.0,
            "ESE": 112.5,
            "SE": 135.0,
            "SSE": 157.5,
            "S": 180.0,
            "SSW": 202.5,
            "SW": 225.0,
            "WSW": 247.5,
            "W": 270.0,
            "WNW": 292.5,
            "NW": 315.0,
            "NNW": 337.5,
        }
        return mapping.get(value)

    @staticmethod
    def _safe_float(value: Any) -> Optional[float]:
        if value is None:
            return None
        text = str(value).strip()
        if not text or text in {"***", "N/A", "NA"}:
            return None
        try:
            return float(text)
        except Exception:
            return None

    @staticmethod
    def _pick_station_row(rows: List[Dict[str, str]], candidates: List[str]) -> Optional[Dict[str, str]]:
        if not rows:
            return None
        normalized_map = {
            str(name).strip().lower(): row
            for row in rows
            for name in [row.get("Automatic Weather Station")]
            if isinstance(row, dict) and name
        }
        for name in candidates:
            hit = normalized_map.get(str(name).strip().lower())
            if hit:
                return hit
        for row in rows:
            station = str(row.get("Automatic Weather Station") or "").strip().lower()
            if "observatory" in station:
                return row
        return rows[0] if rows else None

    def fetch_hko_settlement_current(self) -> Optional[Dict[str, Any]]:
        """
        香港市场结算源：香港天文台实时数据
        - 当前温度: latest_1min_temperature.csv (HK Observatory)
        - 今日最高: latest_since_midnight_maxmin.csv (HK Observatory)
        """
        cache_key = "hko:hong_kong"
        cached = self._get_settlement_cache(cache_key)
        if cached:
            return cached

        try:
            base = "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather"
            temp_csv = self.session.get(
                f"{base}/latest_1min_temperature.csv",
                timeout=self.timeout,
            )
            temp_csv.raise_for_status()
            maxmin_csv = self.session.get(
                f"{base}/latest_since_midnight_maxmin.csv",
                timeout=self.timeout,
            )
            maxmin_csv.raise_for_status()
            humidity_csv = self.session.get(
                f"{base}/latest_1min_humidity.csv",
                timeout=self.timeout,
            )
            humidity_csv.raise_for_status()
            wind_csv = self.session.get(
                f"{base}/latest_10min_wind.csv",
                timeout=self.timeout,
            )
            wind_csv.raise_for_status()

            temp_rows = self._csv_rows(temp_csv.text)
            maxmin_rows = self._csv_rows(maxmin_csv.text)
            humidity_rows = self._csv_rows(humidity_csv.text)
            wind_rows = self._csv_rows(wind_csv.text)

            station_candidates = ["HK Observatory", "Hong Kong Observatory"]
            temp_row = self._pick_station_row(temp_rows, station_candidates)
            maxmin_row = self._pick_station_row(maxmin_rows, station_candidates)
            humidity_row = self._pick_station_row(humidity_rows, station_candidates)
            wind_row = self._pick_station_row(wind_rows, station_candidates)
            if not temp_row or not maxmin_row:
                return None

            obs_raw = temp_row.get("Date time") or maxmin_row.get("Date time")
            obs_iso = self._hko_parse_local_iso(obs_raw)

            current_temp = self._safe_float(
                temp_row.get("Air Temperature(degree Celsius)")
            )
            max_so_far = self._safe_float(
                maxmin_row.get("Maximum Air Temperature Since Midnight(degree Celsius)")
            )
            min_so_far = self._safe_float(
                maxmin_row.get("Minimum Air Temperature Since Midnight(degree Celsius)")
            )
            humidity = (
                self._safe_float(humidity_row.get("Relative Humidity(percent)"))
                if humidity_row
                else None
            )
            wind_speed_kmh = (
                self._safe_float(wind_row.get("10-Minute Mean Speed(km/hour)"))
                if wind_row
                else None
            )
            wind_speed_kt = (
                round(float(wind_speed_kmh) / 1.852, 1)
                if wind_speed_kmh is not None
                else None
            )
            wind_dir = self._hko_compass_to_deg(
                wind_row.get("10-Minute Mean Wind Direction(Compass points)")
                if wind_row
                else None
            )

            payload: Dict[str, Any] = {
                "source": "hko",
                "source_label": "HKO",
                "station_code": "HKO",
                "station_name": "HK Observatory",
                "observation_time": obs_iso,
                "current": {
                    "temp": round(current_temp, 1) if current_temp is not None else None,
                    "max_temp_so_far": round(max_so_far, 1) if max_so_far is not None else None,
                    "max_temp_time": None,
                    "today_low": round(min_so_far, 1) if min_so_far is not None else None,
                    "humidity": round(humidity, 1) if humidity is not None else None,
                    "wind_speed_kt": wind_speed_kt,
                    "wind_dir": wind_dir,
                },
                "unit": "celsius",
            }
            self._set_settlement_cache(cache_key, payload)
            return payload
        except Exception as exc:
            logger.warning(f"HKO settlement fetch failed: {exc}")
            return None

    def fetch_cwa_taipei_settlement_current(self) -> Optional[Dict[str, Any]]:
        """
        台北市场结算源：交通部中央气象署实时数据 (StationId=466920, 臺北站)
        """
        cache_key = "cwa:taipei:466920"
        cached = self._get_settlement_cache(cache_key)
        if cached:
            return cached

        try:
            url = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001"
            response = self.session.get(
                url,
                params={
                    "Authorization": self.cwa_open_data_auth,
                    "format": "JSON",
                    "StationId": "466920",
                },
                timeout=self.timeout,
            )
            response.raise_for_status()
            data = response.json() if response.content else {}
            stations = (data.get("records") or {}).get("Station") or []
            if isinstance(stations, dict):
                station = stations
            elif isinstance(stations, list) and stations:
                station = stations[0]
            else:
                station = None
            if not isinstance(station, dict):
                return None

            wx = station.get("WeatherElement") or {}
            if not isinstance(wx, dict):
                wx = {}
            daily_extreme = wx.get("DailyExtreme") or {}
            high_info = (((daily_extreme.get("DailyHigh") or {}).get("TemperatureInfo") or {}))
            low_info = (((daily_extreme.get("DailyLow") or {}).get("TemperatureInfo") or {}))
            high_time_raw = (((high_info.get("Occurred_at") or {}).get("DateTime")))
            high_hhmm = None
            if high_time_raw and "T" in str(high_time_raw):
                try:
                    high_hhmm = datetime.fromisoformat(str(high_time_raw)).strftime("%H:%M")
                except Exception:
                    high_hhmm = str(high_time_raw).split("T")[1][:5]

            obs_time_raw = (station.get("ObsTime") or {}).get("DateTime")

            wind_speed_ms = self._safe_float(wx.get("WindSpeed"))
            payload: Dict[str, Any] = {
                "source": "cwa",
                "source_label": "CWA",
                "station_code": str(station.get("StationId") or "466920"),
                "station_name": str(station.get("StationName") or "臺北"),
                "observation_time": str(obs_time_raw or "").strip() or None,
                "current": {
                    "temp": self._safe_float(wx.get("AirTemperature")),
                    "max_temp_so_far": self._safe_float(high_info.get("AirTemperature")),
                    "max_temp_time": high_hhmm,
                    "today_low": self._safe_float(low_info.get("AirTemperature")),
                    "humidity": self._safe_float(wx.get("RelativeHumidity")),
                    "wind_speed_kt": round(float(wind_speed_ms) * 1.943844, 1)
                    if wind_speed_ms is not None
                    else None,
                    "wind_dir": self._safe_float(wx.get("WindDirection")),
                },
                "unit": "celsius",
            }
            self._set_settlement_cache(cache_key, payload)
            return payload
        except Exception as exc:
            logger.warning(f"CWA settlement fetch failed: {exc}")
            return None

    def fetch_hko_forecast(self) -> Optional[float]:
        try:
            url = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc"
            res = self.session.get(url, timeout=self.timeout).json()
            return float(res['weatherForecast'][0]['forecastMaxtemp']['value'])
        except Exception as e:
            logger.warning(f"HKO Forecast request failed: {e}")
            return None

    def fetch_cwa_taipei_forecast(self) -> Optional[float]:
        try:
            if not self.cwa_open_data_auth:
                return None
            url = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-061'
            res = self.session.get(url, params={'Authorization': self.cwa_open_data_auth, 'format': 'JSON', 'elementName': 'MaxT'}, timeout=self.timeout).json()
            locs = res.get('records', {}).get('Locations', [])[0].get('Location', [])
            if not locs: return None
            loc = locs[0]
            for we in loc.get('WeatherElement', []):
                if we.get('ElementName') == 'MaxT':
                    return float(we['Time'][0]['ElementValue'][0]['Temperature'])
            return None
        except Exception as e:
            logger.warning(f"CWA Forecast request failed: {e}")
            return None

    def fetch_settlement_current(self, city: str) -> Optional[Dict[str, Any]]:
        normalized = str(city or "").strip().lower()
        if normalized == "hong kong":
            return self.fetch_hko_settlement_current()
        if normalized == "taipei":
            return self.fetch_cwa_taipei_settlement_current()
        return None

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
                # Guardrail: avoid treating short intraday snippets as full-day highs.
                hourly_rows = results.get("hourly") or []
                parsed_times = []
                for h in hourly_rows:
                    t = str(h.get("time") or "")
                    if "T" not in t:
                        continue
                    try:
                        parsed_times.append(datetime.fromisoformat(t.replace("Z", "+00:00")))
                    except Exception:
                        continue

                horizon_hours = 0.0
                if len(parsed_times) >= 2:
                    parsed_times.sort()
                    horizon_hours = (
                        parsed_times[-1] - parsed_times[0]
                    ).total_seconds() / 3600.0

                if len(hourly_rows) >= 24 or horizon_hours >= 30:
                    from collections import defaultdict

                    daily_max = defaultdict(list)
                    for h in hourly_rows:
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
                else:
                    logger.info(
                        "📋 Skip MGM daily_forecasts hourly fallback: "
                        f"hourly points={len(hourly_rows)}, horizon={horizon_hours:.1f}h"
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

            self._wait_open_meteo_slot("forecast")
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
            self._flush_open_meteo_disk_cache()
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
                        return dict(stale["data"])
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
            self._flush_open_meteo_disk_cache()
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
                    return fallback
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
                        return dict(stale["data"])
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
            self._flush_open_meteo_disk_cache()
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
            "hong kong": "Hong Kong",
            "hong kong international airport": "Hong Kong",
            "香港": "Hong Kong",
            "taipei": "Taipei",
            "台北": "Taipei",
            "臺北": "Taipei",
            "chengdu": "Chengdu",
            "成都": "Chengdu",
            "chongqing": "Chongqing",
            "重庆": "Chongqing",
            "shenzhen": "Shenzhen",
            "深圳": "Shenzhen",
            "beijing": "Beijing",
            "北京": "Beijing",
            "wuhan": "Wuhan",
            "武汉": "Wuhan",
            "shanghai": "Shanghai",
            "上海": "Shanghai",
            "singapore": "Singapore",
            "新加坡": "Singapore",
            "tokyo": "Tokyo",
            "东京": "Tokyo",
            "東京": "Tokyo",
            "milan": "Milan",
            "米兰": "Milan",
            "米蘭": "Milan",
            "madrid": "Madrid",
            "马德里": "Madrid",
            "馬德里": "Madrid",
            "tel aviv": "Tel Aviv",
            "特拉维夫": "Tel Aviv",
            "toronto": "Toronto",
            "多伦多": "Toronto",
            "ankara": "Ankara",
            "安卡拉": "Ankara",
            "wellington": "Wellington",
            "惠灵顿": "Wellington",
            "buenos aires": "Buenos Aires",
            "布宜诺斯艾利斯": "Buenos Aires",
            "warsaw": "Warsaw",
            "华沙": "Warsaw",
            "華沙": "Warsaw",
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

    def _evict_city_caches(
        self,
        city: str,
        lat: Optional[float],
        lon: Optional[float],
        use_fahrenheit: bool,
    ) -> None:
        """Drop in-memory caches for one city before a force-refresh query."""
        if lat is not None and lon is not None:
            base = f"{round(float(lat), 4)}:{round(float(lon), 4)}"
            unit = "f" if use_fahrenheit else "c"
            open_meteo_key = f"{base}:14:{unit}"
            ensemble_key = f"{base}:{unit}"
            cache_city = str(city or "").strip().lower()
            multi_model_key = (
                f"{base}:{cache_city}:{unit}:{self.multi_model_cache_version}"
            )

            with self._open_meteo_cache_lock:
                self._open_meteo_cache.pop(open_meteo_key, None)
            with self._ensemble_cache_lock:
                self._ensemble_cache.pop(ensemble_key, None)
            with self._multi_model_cache_lock:
                self._multi_model_cache.pop(multi_model_key, None)

        icao = self.get_icao_code(city)
        if icao:
            prefix = f"{icao}:"
            with self._metar_cache_lock:
                for key in list(self._metar_cache.keys()):
                    if key.startswith(prefix):
                        self._metar_cache.pop(key, None)
        normalized = str(city or "").strip().lower()
        with self._settlement_cache_lock:
            if normalized == "hong kong":
                self._settlement_cache.pop("hko:hong_kong", None)
            elif normalized == "taipei":
                self._settlement_cache.pop("cwa:taipei:466920", None)

    def fetch_all_sources(
        self,
        city: str,
        lat: float = None,
        lon: float = None,
        country: str = None,
        force_refresh: bool = False,
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

        if force_refresh:
            self._evict_city_caches(
                city=city,
                lat=lat,
                lon=lon,
                use_fahrenheit=use_fahrenheit,
            )

        # Turkish cities: keep MGM model fallback alive when Open-Meteo is rate-limited.
        turkish_provinces = {
            "ankara": ("17128", "Ankara"),  # MGM airport station
            "istanbul": ("17060", "Istanbul"),
        }

        if use_fahrenheit:
            logger.info(f"🌡️ {city} 使用华氏度 (°F)")
        else:
            logger.info(f"🌡️ {city} 使用摄氏度 (°C)")

        settlement_current = self.fetch_settlement_current(city_lower)
        if settlement_current:
            results["settlement_current"] = settlement_current

        if city_lower in ["hong_kong", "hong kong", "香港", "hk"]:
            hko_fcst = self.fetch_hko_forecast()
            if hko_fcst:
                results["hko_forecast"] = hko_fcst
        elif city_lower in ["taipei", "台北", "臺北", "tpe"]:
            cwa_fcst = self.fetch_cwa_taipei_forecast()
            if cwa_fcst:
                results["cwa_forecast"] = cwa_fcst

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
                    "ankara": ("17128", "Ankara"),  # use airport station consistently
                    "istanbul": ("17060", "Istanbul"),
                }
                if city_lower in turkish_provinces:
                    istno, province = turkish_provinces[city_lower]
                    # Use one station for both current conditions and forecasts.
                    mgm_data = self.fetch_from_mgm(istno)

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
                    lat, lon, city=city, use_fahrenheit=use_fahrenheit
                )
                if mm_data:
                    results["multi_model"] = mm_data
            else:
                # Open-Meteo 失败时，仍然尝试获取 METAR 和 NWS
                fallback_utc_offset = int(
                    self.CITY_REGISTRY.get(city_lower, {}).get("tz_offset", 0)
                )
                metar_data = self.fetch_metar(
                    city,
                    use_fahrenheit=use_fahrenheit,
                    utc_offset=fallback_utc_offset,
                )
                if metar_data:
                    results["metar"] = metar_data

                # Turkish fallback: keep MGM forecasts and nearby stations available
                if city_lower in turkish_provinces:
                    istno, province = turkish_provinces[city_lower]
                    mgm_data = self.fetch_from_mgm(istno)
                    if mgm_data:
                        results["mgm"] = mgm_data
                        nearby = self.fetch_mgm_nearby_stations(
                            province, root_ist_no=istno
                        )
                        if nearby:
                            results["mgm_nearby"] = nearby

                # Global nearby fallback from METAR clusters
                if city_lower in self.CITY_METAR_CLUSTERS and "mgm_nearby" not in results:
                    cluster_icaos = self.CITY_METAR_CLUSTERS[city_lower]
                    cluster_data = self.fetch_metar_nearby_cluster(
                        cluster_icaos, use_fahrenheit=use_fahrenheit
                    )
                    if cluster_data:
                        results["mgm_nearby"] = cluster_data

                if use_fahrenheit:
                    nws_data = self.fetch_nws(lat, lon)
                    if nws_data:
                        results["nws"] = nws_data

                # Still try ensemble / multi-model from stale cache while OM is cooling down
                ens_data = self.fetch_ensemble(lat, lon, use_fahrenheit=use_fahrenheit)
                if ens_data:
                    results["ensemble"] = ens_data
                mm_data = self.fetch_multi_model(
                    lat, lon, city=city, use_fahrenheit=use_fahrenheit
                )
                if mm_data:
                    results["multi_model"] = mm_data
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
