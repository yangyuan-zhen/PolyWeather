import requests
import re
import time
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

    # Polymarket 12 个天气市场对应的 ICAO 机场代码
    # 这些是 Weather Underground 结算源使用的气象站
    CITY_TO_ICAO = {
        "seattle": "KSEA",  # Seattle-Tacoma Airport
        "london": "EGLC",  # London City Airport
        "dallas": "KDAL",  # Dallas Love Field
        "miami": "KMIA",  # Miami International
        "atlanta": "KATL",  # Hartsfield-Jackson
        "chicago": "KORD",  # O'Hare International
        "new york": "KLGA",  # LaGuardia Airport
        "nyc": "KLGA",  # Alias
        "seoul": "RKSI",  # Incheon International
        "ankara": "LTAC",  # Esenboğa International
        "toronto": "CYYZ",  # Toronto Pearson
        "wellington": "NZWN",  # Wellington International
        "buenos aires": "SAEZ",  # Ezeiza International
        "paris": "LFPG",  # Charles de Gaulle
    }

    def __init__(self, config: dict):
        self.config = config
        weather_cfg = config.get("weather", {})
        self.wunderground_key = weather_cfg.get("wunderground_api_key")
        self.meteoblue_key = weather_cfg.get("meteoblue_api_key")

        self.timeout = 30  # 增加超时以支持高延迟 VPS
        self.session = requests.Session()

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

    def fetch_metar(self, city: str, use_fahrenheit: bool = False, utc_offset: int = 0) -> Optional[Dict]:
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
                headers={"Cache-Control": "no-cache", "Pragma": "no-cache"},
                timeout=self.timeout
            )
            response.raise_for_status()

            data = response.json()
            if not data:
                return None

            # 1. 取最新的观测作为当前状态
            latest = data[0]
            temp_c = latest.get("temp")
            dewp_c = latest.get("dewp")
            obs_time = latest.get("reportTime", "")

            # 2. 精确计算“当地今天”的最高温
            from datetime import timezone, timedelta
            now_utc = datetime.now(timezone.utc)
            local_now = now_utc + timedelta(seconds=utc_offset)
            local_midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
            utc_midnight = local_midnight - timedelta(seconds=utc_offset)

            max_so_far_c = -999
            max_temp_time = None
            for obs in data:
                obs_report_time = obs.get("reportTime", "")
                try:
                    clean_time = obs_report_time.replace(" ", "T")
                    if not clean_time.endswith("Z"): clean_time += "Z"
                    report_dt = datetime.fromisoformat(clean_time.replace("Z", "+00:00"))
                    
                    if report_dt >= utc_midnight:
                        t = obs.get("temp")
                        if t is not None and t > max_so_far_c:
                            max_so_far_c = t
                            # 转为当地时间并记录
                            local_report = report_dt + timedelta(seconds=utc_offset)
                            max_temp_time = local_report.strftime("%H:%M")
                except:
                    continue

            # 转换为单位
            if use_fahrenheit:
                temp = temp_c * 9 / 5 + 32 if temp_c is not None else None
                max_so_far = max_so_far_c * 9 / 5 + 32 if max_so_far_c > -900 else None
                dewp = dewp_c * 9 / 5 + 32 if dewp_c is not None else None
                unit = "fahrenheit"
            else:
                temp = temp_c
                max_so_far = max_so_far_c if max_so_far_c > -900 else None
                dewp = dewp_c
                unit = "celsius"

            result = {
                "source": "metar",
                "icao": icao,
                "station_name": latest.get("name", icao),
                "timestamp": datetime.utcnow().isoformat(),
                "observation_time": obs_time,
                "current": {
                    "temp": round(temp, 1) if temp is not None else None,
                    "max_temp_so_far": round(max_so_far, 1) if max_so_far is not None else None,
                    "max_temp_time": max_temp_time,
                    "dewpoint": round(dewp, 1) if dewp is not None else None,
                    "humidity": latest.get("rh"),
                    "wind_speed_kt": latest.get("wspd"),
                    "wind_dir": latest.get("wdir"),
                    "visibility_mi": latest.get("visib"),
                    "wx_desc": latest.get("wxString"),
                    "altimeter": latest.get("altim"),
                    "clouds": latest.get("clouds", []),
                },
                "unit": unit,
            }

            logger.info(
                f"✈️ METAR {icao}: {temp:.1f}°{'F' if use_fahrenheit else 'C'} "
                f"(obs: {obs_time})"
            )

            return result

        except requests.exceptions.RequestException as e:
            logger.error(f"METAR 请求失败 ({icao}): {e}")
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
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        results = {}
        
        try:
            # 1. 实时数据 (添加时间戳防止 CDN 缓存)
            import time
            obs_resp = self.session.get(
                f"{base_url}/sondurumlar?istno={istno}&_={int(time.time()*1000)}", 
                headers=headers, 
                timeout=self.timeout
            )
            if obs_resp.status_code == 200:
                data = obs_resp.json()
                if data:
                    latest = data[0] if isinstance(data, list) else data
                    # MGM 数据字段映射
                    # ruzgarHiz 实测为 km/h，转为 m/s 需要除以 3.6
                    ruz_hiz_kmh = latest.get("ruzgarHiz", 0)
                    results["current"] = {
                        "temp": latest.get("sicaklik"),
                        "feels_like": latest.get("hissedilenSicaklik") or latest.get("sicaklik"),
                        "humidity": latest.get("nem"),
                        "wind_speed_ms": round(ruz_hiz_kmh / 3.6, 1) if ruz_hiz_kmh is not None else None,
                        "wind_speed_kt": round(ruz_hiz_kmh / 1.852, 1) if ruz_hiz_kmh is not None else None,
                        "wind_dir": latest.get("ruzgarYon"),
                        "rain_24h": latest.get("toplamYagis"),
                        "pressure": latest.get("aktuelBasinc"),
                        "cloud_cover": latest.get("kapalilik"),  # 0-8 八分位云量
                        "mgm_max_temp": latest.get("maxSicaklik"),  # MGM 官方实测最高温
                        "time": latest.get("veriZamani"), # 观测时间
                        "station_name": latest.get("istasyonAd") or latest.get("adi") or latest.get("merkezAd") or "Ankara Esenboğa"
                    }
            
            # 2. 每日预报
            daily_resp = self.session.get(f"{base_url}/tahminler/gunluk?istno={istno}", headers=headers, timeout=self.timeout)
            if daily_resp.status_code == 200:
                forecasts = daily_resp.json()
                if forecasts and isinstance(forecasts, list):
                    today = forecasts[0]
                    results["today_high"] = today.get("enYuksekGun1")
                    results["today_low"] = today.get("enDusukGun1")
            
            return results if "current" in results else None
        except Exception as e:
            logger.error(f"MGM API 请求失败 ({istno}): {e}")
            return None

    def fetch_nws(self, lat: float, lon: float) -> Optional[Dict]:
        """
        从 NWS (美国国家气象局) 获取高精度预报
        仅适用于美国城市，全球 VPS 均可访问
        """
        try:
            # 1. 获取网格点
            points_url = f"https://api.weather.gov/points/{lat},{lon}"
            headers = {"User-Agent": "PolyWeather/1.0 (weather-bot)"}
            
            points_resp = self.session.get(points_url, headers=headers, timeout=self.timeout)
            points_resp.raise_for_status()
            points_data = points_resp.json()
            
            forecast_url = points_data.get("properties", {}).get("forecast")
            if not forecast_url:
                return None
            
            # 2. 获取预报
            forecast_resp = self.session.get(forecast_url, headers=headers, timeout=self.timeout)
            forecast_resp.raise_for_status()
            forecast_data = forecast_resp.json()
            
            periods = forecast_data.get("properties", {}).get("periods", [])
            if not periods:
                return None
            
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
        try:
            url = "https://api.open-meteo.com/v1/forecast"
            params = {
                "latitude": lat,
                "longitude": lon,
                "current_weather": "true",
                "hourly": "temperature_2m",
                "daily": "temperature_2m_max,apparent_temperature_max,sunrise,sunset",
                "timezone": "auto",
                "forecast_days": forecast_days,
                "_t": int(time.time()),  # 禁用缓存，强制刷新
            }

            # 显式指定单位，防止 API 默认行为漂移
            if use_fahrenheit:
                params["temperature_unit"] = "fahrenheit"
            else:
                params["temperature_unit"] = "celsius"

            response = self.session.get(
                url,
                params=params,
                headers={"Cache-Control": "no-cache", "Pragma": "no-cache"},
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
                    "hrrr": hrrr_max[0] if hrrr_max else None
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
                hourly_data["temperature_2m"] = hourly_data["temperature_2m_ncep_hrrr_conus"]

            # 计算精确的当地时间
            now_utc = datetime.utcnow()
            local_now = now_utc + timedelta(seconds=utc_offset)
            local_time_str = local_now.strftime("%Y-%m-%d %H:%M")

            return {
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
        except Exception as e:
            logger.error(f"Open-Meteo forecast failed: {e}")
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
        """
        if not self.meteoblue_key:
            logger.warning("Meteoblue API Key 未配置，跳过抓取。")
            return None

        try:
            # 1. 调用官方 API (使用 basic-day 包，它是多模型 ML 融合结果)
            # 格式: https://my.meteoblue.com/packages/basic-day?apikey=KEY&lat=LAT&lon=LON&format=json
            url = "https://my.meteoblue.com/packages/basic-day"
            params = {
                "apikey": self.meteoblue_key,
                "lat": lat,
                "lon": lon,
                "format": "json",
                "as_daylight": "true"
            }
            
            response = self.session.get(
                url,
                params=params,
                timeout=self.timeout
            )
            response.raise_for_status()
            data = response.json()
            
            day_data = data.get("data_day", {})
            max_temps = day_data.get("temperature_max", [])
            
            if not max_temps:
                logger.warning(f"Meteoblue API 返回数据中找不到最高温 (坐标: {lat},{lon})")
                return None

            # 2. 转换单位
            def c_to_f(c):
                return round((c * 9/5) + 32, 1)

            result = {
                "source": "meteoblue",
                "today_high": None,
                "daily_highs": [],
                "unit": "fahrenheit" if use_fahrenheit else "celsius",
                "url": f"https://www.meteoblue.com/en/weather/week/{lat}N{lon}E" # 仅供参考
            }

            # 提取今日最高
            mb_today_c = max_temps[0]
            result["today_high"] = c_to_f(mb_today_c) if use_fahrenheit else mb_today_c
            
            # 提取接下来几天的最高温
            if use_fahrenheit:
                result["daily_highs"] = [c_to_f(t) for t in max_temps]
            else:
                result["daily_highs"] = max_temps

            logger.info(f"✅ Meteoblue API 获取成功 ({lat},{lon}): 今天 {result['today_high']}{result['unit']}")
            return result
        except Exception as e:
            logger.error(f"Meteoblue API fetch failed: {e}")
            return None

    def extract_date_from_title(self, title: str) -> Optional[str]:
        """
        从标题中提取日期并标准化为 YYYY-MM-DD
        支持: "February 6", "2月6日", "2-6" 等
        """
        # 1. 尝试英文月份
        months = {
            "January": "01", "February": "02", "March": "03", "April": "04",
            "May": "05", "June": "06", "July": "07", "August": "08",
            "September": "09", "October": "10", "November": "11", "December": "12",
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
        # 预设常用城市坐标，避免网络波动导致启动失败
        static_coords = {
            "london": {"lat": 51.5074, "lon": -0.1278},
            "new york": {"lat": 40.7128, "lon": -74.0060},
            "new york's central park": {"lat": 40.7812, "lon": -73.9665},
            "nyc": {"lat": 40.7128, "lon": -74.0060},
            "seattle": {"lat": 47.6062, "lon": -122.3321},
            "chicago": {"lat": 41.8781, "lon": -87.6298},
            "dallas": {"lat": 32.7767, "lon": -96.7970},
            "miami": {"lat": 25.7617, "lon": -80.1918},
            "atlanta": {"lat": 33.7490, "lon": -84.3880},
            "seoul": {"lat": 37.5665, "lon": 126.9780},
            "toronto": {"lat": 43.6532, "lon": -79.3832},
            "ankara": {"lat": 39.9334, "lon": 32.8597},
            "wellington": {"lat": -41.2865, "lon": 174.7762},
            "buenos aires": {"lat": -34.6037, "lon": -58.3816},
        }

        normalized_city = city.lower().strip()
        if normalized_city in static_coords:
            return static_coords[normalized_city]

        # 模糊匹配映射 (针对包含城市名的情况)
        for key in static_coords:
            if key in normalized_city:
                logger.debug(f"地理编码命中模糊映射: {city} -> {key}")
                return static_coords[key]

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
            "london": "London", "伦敦": "London",
            "new york": "New York", "new york's central park": "New York", "nyc": "New York", "纽约": "New York",
            "seattle": "Seattle", "西雅图": "Seattle",
            "chicago": "Chicago", "芝加哥": "Chicago",
            "dallas": "Dallas", "达拉斯": "Dallas",
            "miami": "Miami", "迈阿密": "Miami",
            "atlanta": "Atlanta", "亚特兰大": "Atlanta",
            "seoul": "Seoul", "首尔": "Seoul",
            "toronto": "Toronto", "多伦多": "Toronto",
            "ankara": "Ankara", "安卡拉": "Ankara",
            "wellington": "Wellington", "惠灵顿": "Wellington",
            "buenos aires": "Buenos Aires", "布宜诺斯艾利斯": "Buenos Aires"
        }
        
        for key, val in known_cities.items():
            if key in q:
                return val

        # 2. 从英文模板中提取
        triggers = ["temperature in ", "temp in ", "weather in ", "highest-temperature-in-", "temperature-in-"]
        for trigger in triggers:
            if trigger in q:
                part = q.split(trigger)[1]
                delimiters = [" on ", " at ", " above ", " below ", " be ", " is ", " will ", " has ", " reached ", "?", " (", ", ", "-"]
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
                metar_data = self.fetch_metar(city, use_fahrenheit=use_fahrenheit, utc_offset=utc_offset)
                if metar_data:
                    results["metar"] = metar_data
                
                # 对安卡拉，额外获取 MGM 官方数据
                if city_lower == "ankara":
                    mgm_data = self.fetch_from_mgm("17128")
                    if mgm_data:
                        results["mgm"] = mgm_data
                
                # 对伦敦，获取 Meteoblue 预测 (公认最准)
                if city_lower == "london":
                    mb_data = self.fetch_from_meteoblue(
                        lat, lon, 
                        timezone_name=open_meteo.get("timezone", "UTC"),
                        use_fahrenheit=use_fahrenheit
                    )
                    if mb_data:
                        results["meteoblue"] = mb_data

                # 对美国城市，额外获取 NWS 高精预报
                if use_fahrenheit:
                    nws_data = self.fetch_nws(lat, lon)
                    if nws_data:
                        results["nws"] = nws_data
            else:
                # Open-Meteo 失败时，仍然尝试获取 METAR 和 NWS
                metar_data = self.fetch_metar(city, use_fahrenheit=use_fahrenheit)
                if metar_data:
                    results["metar"] = metar_data
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
