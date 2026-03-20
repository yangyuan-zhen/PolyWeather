from __future__ import annotations

from datetime import datetime, timedelta
from typing import Dict, Optional

from loguru import logger


class MgmSourceMixin:
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
                except Exception:
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

