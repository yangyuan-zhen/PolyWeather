import os
import httpx
import re
import threading
import time
from typing import Optional, Dict, List
from datetime import datetime, timedelta
from loguru import logger
from src.data_collection.open_meteo_cache import OpenMeteoCacheMixin
from src.data_collection.settlement_sources import SettlementSourceMixin
from src.data_collection.metar_sources import MetarSourceMixin
from src.data_collection.mgm_sources import MgmSourceMixin
from src.data_collection.nmc_sources import NmcSourceMixin
from src.data_collection.nws_open_meteo_sources import NwsOpenMeteoSourceMixin


class WeatherDataCollector(OpenMeteoCacheMixin, SettlementSourceMixin, MetarSourceMixin, MgmSourceMixin, NmcSourceMixin, NwsOpenMeteoSourceMixin):
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
        "istanbul": ["LTFM", "LTBA", "LTFJ"],
        "moscow": ["UUWW", "UUEE", "UUDD"],
        "london": ["EGLL", "EGLC", "EGKK", "EGSS", "EGGW"],
        "new york": ["KLGA", "KJFK", "KEWR", "KTEB", "KHPN"],
        "los angeles": ["KLAX", "KBUR", "KLGB", "KSNA", "KVNY"],
        "san francisco": ["KSFO", "KOAK", "KSJC", "KHAF"],
        "aurora": ["KBKF", "KDEN", "KAPA", "KBJC"],
        "austin": ["KAUS", "KEDC", "KSAT"],
        "houston": ["KHOU", "KIAH", "KSGR", "KCXO"],
        "mexico city": ["MMMX", "MMSM", "MMTO"],
        "paris": ["LFPG", "LFPO", "LFPB"],
        "seoul": ["RKSI", "RKSS"],
        "busan": ["RKPK", "RKSS"],
        "hong kong": ["VHHH", "VMMC", "ZGSZ"],
        "taipei": ["RCSS", "RCTP"],
        "chengdu": ["ZUUU", "ZUTF"],
        "chongqing": ["ZUCK", "ZUPS"],
        "shenzhen": ["ZGSZ", "ZGGG"],
        "beijing": ["ZBAA", "ZBAD"],
        "wuhan": ["ZHHH", "ZHES"],
        "shanghai": ["ZSPD", "ZSSS", "ZSNB", "ZSHC"],
        "singapore": ["WSSS", "WSAP", "WMKK"],
        "kuala lumpur": ["WMKK", "WMSA"],
        "jakarta": ["WIHH", "WIII"],
        "tokyo": ["RJTT", "RJAA", "RJAH", "RJTJ"],
        "tel aviv": ["LLBG"],
        "milan": ["LIMC", "LIML", "LIME", "LIPO"],
        "toronto": ["CYYZ", "CYTZ", "CYKF"],
        "warsaw": ["EPWA", "EPMO", "EPLL"],
        "helsinki": ["EFHK", "EETN"],
        "amsterdam": ["EHAM", "EHRD"],
        "panama city": ["MPMG", "MPTO"],
        "madrid": ["LEMD", "LETO", "LEGT"],
        "chicago": ["KORD", "KMDW", "KPWK", "KDPA"],
        "dallas": ["KDAL", "KDFW", "KADS", "KGKY"],
        "atlanta": ["KATL", "KPDK", "KFTY"],
        "miami": ["KMIA", "KOPF", "KTMB"],
        "seattle": ["KSEA", "KBFI", "KPAE"],
        "sao paulo": ["SBGR", "SBSP", "SBKP"],
        "munich": ["EDDM", "EDMO", "EDJA"],
    }

    US_CITIES = {
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
        "aurora",
        "austin",
        "san diego",
        "detroit",
        "cleveland",
        "minneapolis",
        "st. louis",
    }

    TURKISH_PROVINCES = {
        "ankara": ("17128", "Ankara"),
        "istanbul": ("17058", "Istanbul"),
    }

    def __init__(self, config: dict):
        self.config = config

        self.timeout = 30  # 增加超时以支持高延迟 VPS
        self.http_retry_count = max(
            0, int(os.getenv("POLYWEATHER_HTTP_RETRY_COUNT", "1"))
        )
        self.http_retry_backoff_sec = max(
            0.0, float(os.getenv("POLYWEATHER_HTTP_RETRY_BACKOFF_SEC", "0.35"))
        )
        self.session = httpx.Client(
            timeout=self.timeout,
            follow_redirects=True,
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
        )
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
        self.taf_cache_ttl_sec = int(
            os.getenv("TAF_CACHE_TTL_SEC", "900")
        )
        self._taf_cache: Dict[str, Dict] = {}
        self._taf_cache_lock = threading.Lock()
        self.nmc_cache_ttl_sec = int(
            os.getenv("NMC_CACHE_TTL_SEC", "300")
        )
        self._nmc_cache: Dict[str, Dict] = {}
        self._nmc_cache_lock = threading.Lock()
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
            self.session = httpx.Client(
                timeout=self.timeout,
                follow_redirects=True,
                proxy=proxy,
                limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
            )
            logger.info(f"正在使用天气数据代理: {proxy}")

        logger.info("天气数据采集器初始化完成。")

    @staticmethod
    def _is_retryable_status(status_code: int) -> bool:
        return status_code in {408, 500, 502, 503, 504}

    def _http_get(self, url: str, **kwargs) -> httpx.Response:
        if "timeout" not in kwargs:
            kwargs["timeout"] = self.timeout
        last_exc: Optional[Exception] = None
        last_response: Optional[httpx.Response] = None
        attempts = self.http_retry_count + 1
        for attempt in range(attempts):
            try:
                response = self.session.get(url, **kwargs)
                last_response = response
                if (
                    attempt < attempts - 1
                    and self._is_retryable_status(response.status_code)
                ):
                    wait_for = self.http_retry_backoff_sec * (attempt + 1)
                    logger.debug(
                        "HTTP GET retrying url={} status={} attempt={}/{} wait={}s",
                        url,
                        response.status_code,
                        attempt + 1,
                        attempts,
                        round(wait_for, 2),
                    )
                    if wait_for > 0:
                        time.sleep(wait_for)
                    continue
                return response
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                last_exc = exc
                if attempt >= attempts - 1:
                    break
                wait_for = self.http_retry_backoff_sec * (attempt + 1)
                logger.debug(
                    "HTTP GET retrying url={} error={} attempt={}/{} wait={}s",
                    url,
                    type(exc).__name__,
                    attempt + 1,
                    attempts,
                    round(wait_for, 2),
                )
                if wait_for > 0:
                    time.sleep(wait_for)
        if last_exc is not None:
            raise last_exc
        if last_response is not None:
            return last_response
        raise RuntimeError(f"HTTP GET failed without response: {url}")

    def _http_get_json(self, url: str, **kwargs):
        response = self._http_get(url, **kwargs)
        response.raise_for_status()
        return response.json()

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
            current_response = self._http_get(
                current_url,
                params={"q": query, "appid": self.openweather_key, "units": "metric"},
                timeout=self.timeout,
            )
            current_response.raise_for_status()
            current_data = current_response.json()

            # 5-day forecast
            forecast_url = "https://api.openweathermap.org/data/2.5/forecast"
            forecast_response = self._http_get(
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

        except httpx.HTTPError as e:
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
            response = self._http_get(
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

        except httpx.HTTPError as e:
            logger.error(f"Visual Crossing request failed: {e}")
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
            response = self._http_get(
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
            "istanbul": "Istanbul",
            "ist": "Istanbul",
            "ltfm": "Istanbul",
            "moscow": "Moscow",
            "mos": "Moscow",
            "mow": "Moscow",
            "uuww": "Moscow",
            "vnukovo": "Moscow",
            "莫斯科": "Moscow",
            "伊斯坦布尔": "Istanbul",
            "seoul": "Seoul",
            "首尔": "Seoul",
            "busan": "Busan",
            "pusan": "Busan",
            "釜山": "Busan",
            "hong kong": "Hong Kong",
            "hong kong international airport": "Hong Kong",
            "香港": "Hong Kong",
            "shek kong": "Shek Kong",
            "vhsk": "Shek Kong",
            "石岗": "Shek Kong",
            "石崗": "Shek Kong",
            "lau fau shan": "Lau Fau Shan",
            "lfs": "Lau Fau Shan",
            "流浮山": "Lau Fau Shan",
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
            "kuala lumpur": "Kuala Lumpur",
            "sepang": "Kuala Lumpur",
            "吉隆坡": "Kuala Lumpur",
            "jakarta": "Jakarta",
            "雅加达": "Jakarta",
            "雅加達": "Jakarta",
            "helsinki": "Helsinki",
            "vantaa": "Helsinki",
            "赫尔辛基": "Helsinki",
            "赫爾辛基": "Helsinki",
            "amsterdam": "Amsterdam",
            "schiphol": "Amsterdam",
            "阿姆斯特丹": "Amsterdam",
            "panama city": "Panama City",
            "巴拿马城": "Panama City",
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
            city_meta = self.CITY_REGISTRY.get(normalized) or {}
            settlement_source = str(city_meta.get("settlement_source") or "").strip().lower()
            if settlement_source == "hko":
                station_code = (
                    str(city_meta.get("settlement_station_code") or "").strip()
                    or str(city_meta.get("icao") or "").strip()
                    or normalized
                )
                self._settlement_cache.pop(f"hko:{station_code.lower()}", None)
            elif settlement_source == "noaa":
                station_code = (
                    str(city_meta.get("settlement_station_code") or "").strip()
                    or str(city_meta.get("icao") or "").strip()
                    or normalized
                )
                self._settlement_cache.pop(f"noaa:{station_code.lower()}", None)

    def _uses_fahrenheit(self, city_lower: str) -> bool:
        return city_lower in self.US_CITIES

    def _supports_aviationweather(self, city_lower: str) -> bool:
        city_meta = self.CITY_REGISTRY.get(str(city_lower or "").strip().lower(), {}) or {}
        return not bool(city_meta.get("disable_aviationweather"))

    def _log_temperature_unit(self, city: str, use_fahrenheit: bool) -> None:
        unit = "华氏度 (°F)" if use_fahrenheit else "摄氏度 (°C)"
        logger.info(f"🌡️ {city} 使用{unit}")

    def _attach_settlement_sources(self, results: Dict, city_lower: str) -> None:
        settlement_current = self.fetch_settlement_current(city_lower)
        if settlement_current:
            results["settlement_current"] = settlement_current

        city_meta = self.CITY_REGISTRY.get(str(city_lower or "").strip().lower()) or {}
        settlement_source = str(city_meta.get("settlement_source") or "").strip().lower()
        if settlement_source == "hko" or city_lower in ["hong_kong", "hong kong", "香港", "hk"]:
            hko_forecast = self.fetch_hko_forecast()
            if hko_forecast:
                results["hko_forecast"] = hko_forecast

    def _attach_turkish_mgm_data(self, results: Dict, city_lower: str) -> None:
        if city_lower not in self.TURKISH_PROVINCES:
            return
        istno, province = self.TURKISH_PROVINCES[city_lower]
        mgm_data = self.fetch_from_mgm(istno)
        if not mgm_data:
            return
        results["mgm"] = mgm_data
        results["nearby_source"] = "mgm"
        nearby = self.fetch_mgm_nearby_stations(province, root_ist_no=istno)
        if nearby:
            results["mgm_nearby"] = nearby

    def _attach_global_nearby_cluster(
        self, results: Dict, city_lower: str, use_fahrenheit: bool
    ) -> None:
        if city_lower not in self.CITY_METAR_CLUSTERS or "mgm_nearby" in results:
            return
        cluster_icaos = self.CITY_METAR_CLUSTERS[city_lower]
        cluster_data = self.fetch_metar_nearby_cluster(
            cluster_icaos, use_fahrenheit=use_fahrenheit
        )
        if cluster_data:
            results["mgm_nearby"] = cluster_data
            results["nearby_source"] = "metar_cluster"

    def _attach_china_official_nearby(
        self, results: Dict, city_lower: str, use_fahrenheit: bool
    ) -> None:
        if city_lower not in {
            "beijing",
            "chengdu",
            "chongqing",
            "shanghai",
            "shenzhen",
            "wuhan",
        }:
            return
        official_rows = self.fetch_nmc_official_nearby(
            city_lower, use_fahrenheit=use_fahrenheit
        )
        if not official_rows:
            return
        results["nmc_official_nearby"] = official_rows
        if "mgm_nearby" not in results:
            results["mgm_nearby"] = official_rows
        results["nearby_source"] = "nmc"

    def _attach_warsaw_official_nearby(
        self, results: Dict, use_fahrenheit: bool
    ) -> None:
        if "mgm_nearby" in results:
            return

        official_rows = []
        epwa_rows = self.fetch_metar_nearby_cluster(["EPWA"], use_fahrenheit=use_fahrenheit)
        if epwa_rows:
            epwa = dict(epwa_rows[0])
            epwa["name"] = "Warszawa-Okęcie (EPWA)"
            official_rows.append(epwa)

        imgw_row = self.fetch_imgw_synoptic_station_current(
            "Warszawa",
            display_name="Warszawa (IMGW synoptic)",
            use_fahrenheit=use_fahrenheit,
        )
        if imgw_row:
            official_rows.append(imgw_row)

        if official_rows:
            results["mgm_nearby"] = official_rows
            results["nearby_source"] = "official_cluster"

    def _attach_nws_and_models(
        self,
        results: Dict,
        city: str,
        lat: float,
        lon: float,
        use_fahrenheit: bool,
    ) -> None:
        if use_fahrenheit:
            nws_data = self.fetch_nws(lat, lon)
            if nws_data:
                results["nws"] = nws_data

        ensemble_data = self.fetch_ensemble(lat, lon, use_fahrenheit=use_fahrenheit)
        if ensemble_data:
            results["ensemble"] = ensemble_data

        multi_model_data = self.fetch_multi_model(
            lat, lon, city=city, use_fahrenheit=use_fahrenheit
        )
        if multi_model_data:
            results["multi_model"] = multi_model_data

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
        city_lower = city.lower().strip()
        use_fahrenheit = self._uses_fahrenheit(city_lower)
        supports_aviationweather = self._supports_aviationweather(city_lower)

        if force_refresh:
            self._evict_city_caches(
                city=city,
                lat=lat,
                lon=lon,
                use_fahrenheit=use_fahrenheit,
            )
        self._log_temperature_unit(city, use_fahrenheit)
        self._attach_settlement_sources(results, city_lower)

        if lat and lon:
            open_meteo = self.fetch_from_open_meteo(
                lat, lon, use_fahrenheit=use_fahrenheit
            )
            if open_meteo:
                results["open-meteo"] = open_meteo
                # 获取时区偏移以过滤 METAR
                utc_offset = open_meteo.get("utc_offset", 0)
                if supports_aviationweather:
                    metar_data = self.fetch_metar(
                        city, use_fahrenheit=use_fahrenheit, utc_offset=utc_offset
                    )
                    if metar_data:
                        results["metar"] = metar_data
                if supports_aviationweather and city_lower != "hong kong":
                    taf_data = self.fetch_taf(city, utc_offset=utc_offset)
                    if taf_data:
                        results["taf"] = taf_data

                self._attach_turkish_mgm_data(results, city_lower)
                self._attach_china_official_nearby(results, city_lower, use_fahrenheit)
                if city_lower == "warsaw":
                    self._attach_warsaw_official_nearby(results, use_fahrenheit)
                self._attach_global_nearby_cluster(
                    results, city_lower, use_fahrenheit
                )
                self._attach_nws_and_models(
                    results, city, lat, lon, use_fahrenheit
                )
            else:
                fallback_utc_offset = int(
                    self.CITY_REGISTRY.get(city_lower, {}).get("tz_offset", 0)
                )
                if supports_aviationweather:
                    metar_data = self.fetch_metar(
                        city,
                        use_fahrenheit=use_fahrenheit,
                        utc_offset=fallback_utc_offset,
                    )
                    if metar_data:
                        results["metar"] = metar_data
                if supports_aviationweather and city_lower != "hong kong":
                    taf_data = self.fetch_taf(city, utc_offset=fallback_utc_offset)
                    if taf_data:
                        results["taf"] = taf_data

                self._attach_turkish_mgm_data(results, city_lower)
                self._attach_china_official_nearby(results, city_lower, use_fahrenheit)
                if city_lower == "warsaw":
                    self._attach_warsaw_official_nearby(results, use_fahrenheit)
                self._attach_global_nearby_cluster(
                    results, city_lower, use_fahrenheit
                )
                self._attach_nws_and_models(
                    results, city, lat, lon, use_fahrenheit
                )
        else:
            if supports_aviationweather:
                metar_data = self.fetch_metar(city, use_fahrenheit=use_fahrenheit)
                if metar_data:
                    results["metar"] = metar_data
            if supports_aviationweather and city_lower != "hong kong":
                taf_data = self.fetch_taf(city)
                if taf_data:
                    results["taf"] = taf_data

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
