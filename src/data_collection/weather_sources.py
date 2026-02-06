import requests
import re
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
    """

    def __init__(self, config: dict):
        self.config = config
        self.wunderground_key = config.get("wunderground_api_key")

        self.timeout = 10
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
                "daily": "temperature_2m_max,apparent_temperature_max",
                "timezone": "auto",
                "forecast_days": forecast_days,
            }

            # 对于美国市场，使用华氏度
            if use_fahrenheit:
                params["temperature_unit"] = "fahrenheit"

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

            # 计算精确的当地时间而不是气象站 bucket 时间
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
                "daily": data.get("daily", {}),
                "unit": "fahrenheit" if use_fahrenheit else "celsius",
            }
        except Exception as e:
            logger.error(f"Open-Meteo forecast failed: {e}")
            return None

    def extract_date_from_title(self, title: str) -> Optional[str]:
        """
        从标题中提取日期并标准化为 YYYY-MM-DD
        例如: "Highest temperature in Seattle on February 6?" -> "2026-02-06"
        """
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
                    # 简单处理跨年逻辑：如果提取到的月份小于当前月份太多，可能是指明年
                    # 但对于天气预报通常只看近期几天
                    return f"{year}-{month_val}-{day:02d}"
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
        从 Polymarket 问题描述中提取城市名称
        支持多种描述方式:
        - "Highest temperature in Ankara on February 5?"
        - "Will the temperature in London be..."
        - "Temp in New York..."
        """
        q = question.lower()

        # 移除常见的干扰词
        for noise in ["highest ", "the ", "will ", "lowest "]:
            if q.startswith(noise):
                q = q[len(noise) :]

        # 处理 "temperature in [City]" | "temp in [City]"
        triggers = ["temperature in ", "temp in ", "weather in "]
        for trigger in triggers:
            if trigger in q:
                part = q.split(trigger)[1]
                # 截断日期和其他后缀
                # 按照 "on", "at", "above", "below", "?", " ", "be", "is" 分割
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
        # 检查城市名是否在美国城市列表中（支持完全匹配或包含关系）
        use_fahrenheit = city_lower in us_cities or any(
            us_city in city_lower for us_city in us_cities
        )

        if use_fahrenheit:
            logger.info(f"🌡️ {city} 使用华氏度 (°F)")
        else:
            logger.info(f"🌡️ {city} 使用摄氏度 (°C)")

        # Open-Meteo (Primary Free Source - No Key)
        if lat and lon:
            open_meteo = self.fetch_from_open_meteo(
                lat, lon, use_fahrenheit=use_fahrenheit
            )
            if open_meteo:
                results["open-meteo"] = open_meteo

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
