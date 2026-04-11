from __future__ import annotations

import re
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

import httpx
from loguru import logger

from src.utils.metrics import record_source_call


class MetarSourceMixin:
    def get_icao_code(self, city: str) -> Optional[str]:
        """根据城市名获取对应的 ICAO 机场代码"""
        normalized = city.lower().strip()
        if normalized in self.CITY_TO_ICAO:
            return self.CITY_TO_ICAO[normalized]
        for key, icao in self.CITY_TO_ICAO.items():
            if key in normalized or normalized in key:
                return icao
        return None

    def fetch_metar(
        self, city: str, use_fahrenheit: bool = False, utc_offset: int = 0
    ) -> Optional[Dict]:
        """从 NOAA Aviation Weather Center 获取 METAR 航空气象数据。"""
        started = time.perf_counter()
        icao = self.get_icao_code(city)
        if not icao:
            logger.warning(f"未找到城市 {city} 对应的 ICAO 代码")
            record_source_call("metar", "current", "missing_icao", (time.perf_counter() - started) * 1000.0)
            return None

        cache_key = f"{icao}:{utc_offset}:{use_fahrenheit}"
        now_ts = time.time()
        with self._metar_cache_lock:
            cached = self._metar_cache.get(cache_key)
            if cached and now_ts - cached["t"] < self.metar_cache_ttl_sec:
                logger.debug(f"METAR cache hit {icao} age={int(now_ts - cached['t'])}s")
                record_source_call("metar", "current", "cache_hit", (time.perf_counter() - started) * 1000.0)
                return cached["d"]

        try:
            url = "https://aviationweather.gov/api/data/metar"
            params = {
                "ids": icao,
                "format": "json",
                "hours": 24,
                "_t": int(time.time()),
            }
            response = self.session.get(url, params=params, timeout=self.timeout)
            response.raise_for_status()

            data = response.json()
            if not data:
                return None

            latest = data[0]
            temp_c = latest.get("temp")
            dewp_c = latest.get("dewp")

            def _parse_rawob_time(obs):
                raw = obs.get("rawOb", "")
                match = re.search(r"(\d{2})(\d{2})(\d{2})Z", raw)
                if match:
                    _day, hour, minute = (
                        int(match.group(1)),
                        int(match.group(2)),
                        int(match.group(3)),
                    )
                    fallback = obs.get("reportTime", "")
                    try:
                        clean = fallback.replace(" ", "T")
                        if not clean.endswith("Z"):
                            clean += "Z"
                        base_dt = datetime.fromisoformat(clean.replace("Z", "+00:00"))
                        result = base_dt.replace(hour=hour, minute=minute, second=0)
                        if result > base_dt + timedelta(hours=2):
                            result -= timedelta(days=1)
                        return result
                    except Exception:
                        pass
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

            now_utc = datetime.now(timezone.utc)
            local_now = now_utc + timedelta(seconds=utc_offset)
            local_midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
            utc_midnight = local_midnight - timedelta(seconds=utc_offset)

            max_so_far_c = -999
            max_temp_time = None
            for obs in data:
                obs_dt_iter = _parse_rawob_time(obs)
                if obs_dt_iter is None:
                    continue
                try:
                    if obs_dt_iter >= utc_midnight:
                        temp_value = obs.get("temp")
                        if temp_value is not None and temp_value > max_so_far_c:
                            max_so_far_c = temp_value
                            local_report = obs_dt_iter + timedelta(seconds=utc_offset)
                            max_temp_time = local_report.strftime("%H:%M")
                except Exception:
                    continue

            recent_temps_raw = []
            recent_obs_raw = []
            today_obs_raw = []
            cloud_rank_map = {
                "CLR": 0,
                "SKC": 0,
                "FEW": 1,
                "SCT": 2,
                "BKN": 3,
                "OVC": 4,
            }
            for index, obs in enumerate(data):
                obs_temp = obs.get("temp")
                obs_dt_iter = _parse_rawob_time(obs)
                if obs_temp is not None and obs_dt_iter:
                    local_rt = obs_dt_iter + timedelta(seconds=utc_offset)
                    time_str = local_rt.strftime("%H:%M")
                    if obs_dt_iter >= utc_midnight:
                        today_obs_raw.append((time_str, obs_temp))
                    if index < 4:
                        recent_temps_raw.append((time_str, obs_temp))
                        clouds = obs.get("clouds", [])
                        max_cloud_rank = 0
                        for cloud in clouds:
                            rank = cloud_rank_map.get(cloud.get("cover", ""), 0)
                            if rank > max_cloud_rank:
                                max_cloud_rank = rank
                        recent_obs_raw.append(
                            {
                                "time": time_str,
                                "temp": obs_temp,
                                "wdir": obs.get("wdir"),
                                "wspd": obs.get("wspd"),
                                "cloud_rank": max_cloud_rank,
                                "altim": obs.get("altim"),
                            }
                        )

            if use_fahrenheit:
                temp = temp_c * 9 / 5 + 32 if temp_c is not None else None
                max_so_far = max_so_far_c * 9 / 5 + 32 if max_so_far_c > -900 else None
                dewp = dewp_c * 9 / 5 + 32 if dewp_c is not None else None
                unit = "fahrenheit"
                recent_temps = [(t, round(v * 9 / 5 + 32, 1)) for t, v in recent_temps_raw]
                today_obs = [(t, round(v * 9 / 5 + 32, 1)) for t, v in today_obs_raw]
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
                    "max_temp_so_far": round(max_so_far, 1) if max_so_far is not None else None,
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
                "recent_temps": recent_temps,
                "today_obs": today_obs,
                "recent_obs": recent_obs_raw,
                "unit": unit,
            }

            logger.info(
                f"✈️ METAR {icao}: {temp:.1f}°{'F' if use_fahrenheit else 'C'} (obs: {obs_time})"
            )
            with self._metar_cache_lock:
                self._metar_cache[cache_key] = {"d": result, "t": now_ts}
            record_source_call("metar", "current", "success", (time.perf_counter() - started) * 1000.0)
            return result

        except httpx.HTTPError as exc:
            logger.error(f"METAR 请求失败 ({icao}): {exc}")
            with self._metar_cache_lock:
                stale = self._metar_cache.get(cache_key)
                if stale:
                    logger.warning(f"METAR {icao} 请求失败，使用缓存回退")
                    record_source_call("metar", "current", "stale_cache", (time.perf_counter() - started) * 1000.0)
                    return stale["d"]
            record_source_call("metar", "current", "error", (time.perf_counter() - started) * 1000.0)
            return None
        except (KeyError, IndexError, TypeError) as exc:
            logger.error(f"METAR 数据解析失败 ({icao}): {exc}")
            record_source_call("metar", "current", "parse_error", (time.perf_counter() - started) * 1000.0)
            return None

    def fetch_taf(self, city: str, utc_offset: int = 0) -> Optional[Dict]:
        """从 NOAA Aviation Weather Center 获取 TAF 机场终端区预报原文。"""
        started = time.perf_counter()
        icao = self.get_icao_code(city)
        if not icao:
            record_source_call("taf", "current", "missing_icao", (time.perf_counter() - started) * 1000.0)
            return None

        cache_key = f"{icao}:{utc_offset}"
        now_ts = time.time()
        with self._taf_cache_lock:
            cached = self._taf_cache.get(cache_key)
            if cached and now_ts - cached["t"] < self.taf_cache_ttl_sec:
                record_source_call("taf", "current", "cache_hit", (time.perf_counter() - started) * 1000.0)
                return cached["d"]

        try:
            url = "https://aviationweather.gov/api/data/taf"
            params = {
                "ids": icao,
                "format": "json",
                "hours": 24,
                "_t": int(time.time()),
            }
            response = self.session.get(
                url,
                params=params,
                timeout=getattr(self, "metar_timeout_sec", self.timeout),
            )
            response.raise_for_status()
            data = response.json()
            if not data:
                return None

            latest = data[0]
            result = {
                "source": "taf",
                "icao": icao,
                "station_name": latest.get("name", icao),
                "timestamp": datetime.utcnow().isoformat(),
                "issue_time": latest.get("issueTime"),
                "valid_time_from": latest.get("validTimeFrom"),
                "valid_time_to": latest.get("validTimeTo"),
                "raw_taf": latest.get("rawTAF") or latest.get("rawTaf") or latest.get("raw_text") or "",
            }
            with self._taf_cache_lock:
                self._taf_cache[cache_key] = {"d": result, "t": now_ts}
            record_source_call("taf", "current", "success", (time.perf_counter() - started) * 1000.0)
            return result
        except httpx.HTTPError as exc:
            logger.error(f"TAF 请求失败 ({icao}): {exc}")
            with self._taf_cache_lock:
                stale = self._taf_cache.get(cache_key)
                if stale:
                    record_source_call("taf", "current", "stale_cache", (time.perf_counter() - started) * 1000.0)
                    return stale["d"]
            record_source_call("taf", "current", "error", (time.perf_counter() - started) * 1000.0)
            return None
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            logger.error(f"TAF 数据解析失败 ({icao}): {exc}")
            record_source_call("taf", "current", "parse_error", (time.perf_counter() - started) * 1000.0)
            return None

    def fetch_metar_nearby_cluster(self, icaos: List[str], use_fahrenheit: bool = False) -> list:
        """批量获取一组 ICAO 站点的 METAR 数据，用于地图周边显示。"""
        if not icaos:
            return []

        results = []
        try:
            ids_str = ",".join(icaos)
            url = f"https://aviationweather.gov/api/data/metar?ids={ids_str}&format=json"
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            }
            resp = self.session.get(
                url,
                headers=headers,
                timeout=getattr(self, "metar_cluster_timeout_sec", self.timeout),
            )
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
                    display_temp = (temp_c * 9 / 5) + 32 if use_fahrenheit else temp_c
                    name = obs.get("name") or icao
                    name = name.split(" Airport")[0].split(" Intl")[0].split(" International")[0].split(" Arpt")[0].split(",")[0].strip()
                    results.append(
                        {
                            "name": name,
                            "lat": lat,
                            "lon": lon,
                            "temp": round(display_temp, 1),
                            "istNo": icao,
                            "icao": icao,
                            "wind_dir": obs.get("wdir"),
                            "wind_speed": obs.get("wspd"),
                            "wind_speed_kt": obs.get("wspd"),
                            "raw_metar": obs.get("rawOb"),
                        }
                    )

            if results:
                logger.info(f"📍 METAR 集群: 成功抓取 {len(results)} 个参考站数据")
            return results
        except Exception as exc:
            logger.error(f"Failed to fetch METAR cluster {icaos}: {exc}")
            return []
