from __future__ import annotations

import hashlib
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional
from xml.etree import ElementTree as ET

from loguru import logger

from src.utils.metrics import record_source_call


def _aeroweb_obs_time_from_parts(
    day: Optional[int],
    hour: Optional[int],
    minute: Optional[int],
    *,
    now_utc: Optional[datetime] = None,
) -> Optional[str]:
    if day is None or hour is None or minute is None:
        return None

    base = now_utc or datetime.now(timezone.utc)
    if base.tzinfo is None:
        base = base.replace(tzinfo=timezone.utc)
    else:
        base = base.astimezone(timezone.utc)

    def _candidate(year: int, month: int) -> Optional[datetime]:
        try:
            return datetime(year, month, int(day), int(hour), int(minute), tzinfo=timezone.utc)
        except (TypeError, ValueError):
            return None

    obs_dt = _candidate(base.year, base.month)
    if obs_dt and obs_dt - base > timedelta(hours=18):
        previous_month = (base.replace(day=1) - timedelta(days=1)).date()
        obs_dt = _candidate(previous_month.year, previous_month.month) or obs_dt
    if not obs_dt:
        return None
    return obs_dt.isoformat().replace("+00:00", "Z")


class AerowebSourceMixin:
    """Fetch realtime METAR from Météo-France AEROWEB.

    AEROWEB (https://aviation.meteo.fr) delivers METAR/TAF directly from
    Météo-France's aviation network.  Reports typically appear within
    2 minutes of issue time — faster than NOAA's aviationweather.gov.

    Auth flow:
      1. GET  login.php → receive PHPSESSID cookie
      2. POST ajax/login_valid.php  (login=<user>&password=<md5(pass)>)
      3. GET  ajax/ajax_trajet_get_stations.php  (with PHPSESSID)

    Env vars:
      AEROWEB_USERNAME  — login name
      AEROWEB_PASSWORD  — plain-text password (MD5 hashed before sending)
    """

    AEROWEB_BASE = "https://aviation.meteo.fr"
    # Tight bounding box around LFPB (Paris Le Bourget) in WGS84 degrees.
    # The WFS endpoint uses SRS=EPSG:900913 but accepts lat/lon in practice.
    LFPB_BBOX = "2.42,48.95,2.46,48.99"

    def _aeroweb_creds(self) -> Optional[tuple]:
        user = os.getenv("AEROWEB_USERNAME", "").strip()
        pwd = os.getenv("AEROWEB_PASSWORD", "").strip()
        if not user or not pwd:
            return None
        return (user, pwd)

    def _aeroweb_session(self) -> Optional[str]:
        """Return a valid PHPSESSID, logging in if necessary."""
        creds = self._aeroweb_creds()
        if not creds:
            logger.warning("AEROWEB credentials not configured (AEROWEB_USERNAME / AEROWEB_PASSWORD)")
            return None

        user, pwd = creds
        now = time.time()

        # Check cached session
        cached = getattr(self, "_aeroweb_sid", None)
        cached_ts = getattr(self, "_aeroweb_sid_ts", 0)
        # Re-login every 20 minutes to keep the session alive
        if cached and (now - cached_ts) < 1200:
            return cached

        try:
            # Step 1: get a fresh PHPSESSID
            # Use the shared httpx session so cookies persist across requests.
            resp = self.session.get(
                f"{self.AEROWEB_BASE}/login.php", timeout=self.timeout
            )
            # httpx stores cookies on the session; grab PHPSESSID from there.
            sid = self.session.cookies.get("PHPSESSID")
            if not sid:
                # Fallback: parse Set-Cookie header directly
                set_cookie = resp.headers.get("set-cookie", "")
                for part in set_cookie.replace(",", ";").split(";"):
                    part = part.strip()
                    if part.startswith("PHPSESSID="):
                        sid = part.split("=", 1)[1]
                        break
            if not sid:
                logger.error("AEROWEB: could not obtain PHPSESSID from login page")
                return None

            # Step 2: authenticate (httpx session POST directly)
            pwd_hash = hashlib.md5(pwd.encode()).hexdigest()
            login_url = f"{self.AEROWEB_BASE}/ajax/login_valid.php"
            login_resp = self.session.post(
                login_url,
                data={"login": user, "password": pwd_hash},
                cookies={"PHPSESSID": sid},
                timeout=self.timeout,
            )
            if login_resp.text.strip() != "ok":
                logger.error("AEROWEB login failed: {}", login_resp.text.strip()[:100])
                return None

            logger.info("AEROWEB login OK, sid={}...", sid[:8])
            self._aeroweb_sid = sid
            self._aeroweb_sid_ts = now
            return sid

        except Exception:
            logger.exception("AEROWEB login error")
            return None

    def fetch_from_aeroweb(self) -> Optional[Dict]:
        """Fetch latest METAR for LFPB from AEROWEB."""
        started = datetime.now()

        def _elapsed_ms() -> float:
            return (datetime.now() - started).total_seconds() * 1000.0

        sid = self._aeroweb_session()
        if not sid:
            record_source_call("aeroweb", "station", "noauth", _elapsed_ms())
            return None

        try:
            url = (
                f"{self.AEROWEB_BASE}/ajax/ajax_trajet_get_stations.php"
                f"?reseau=&type=oaci&SERVICE=WFS&VERSION=1.0.0"
                f"&REQUEST=GetFeature&SRS=EPSG:900913"
                f"&BBOX={self.LFPB_BBOX}&LEVEL=8"
            )
            resp = self._http_get(
                url,
                cookies={"PHPSESSID": sid},
                timeout=self.timeout,
            )
            # If redirected to login page, session expired — clear and retry once
            if "login.php" in str(resp.url) or resp.status_code == 302:
                logger.info("AEROWEB session expired, re-logging in")
                self._aeroweb_sid = None
                sid = self._aeroweb_session()
                if not sid:
                    record_source_call("aeroweb", "station", "auth_error", _elapsed_ms())
                    return None
                resp = self._http_get(
                    url,
                    cookies={"PHPSESSID": sid},
                    timeout=self.timeout,
                )

            if resp.status_code != 200:
                logger.warning("AEROWEB API returned HTTP {}", resp.status_code)
                record_source_call("aeroweb", "station", "error", _elapsed_ms())
                return None

            root = ET.fromstring(resp.text)
            # Find LFPB metar element
            metar_el = root.find(".//opmet[@id='LFPB']/messages/metar")
            if metar_el is None:
                record_source_call("aeroweb", "station", "empty", _elapsed_ms())
                return None

            def _attr_int(name: str) -> Optional[int]:
                v = metar_el.get(name)
                return int(v) if v and v.strip() else None

            def _attr_float(name: str) -> Optional[float]:
                v = metar_el.get(name)
                return float(v) if v and v.strip() else None

            temp = _attr_float("tempe")
            td = _attr_float("td")
            wind_dir = _attr_float("dd")
            wind_kt = _attr_float("ff")
            qnh = metar_el.get("qnh", "").strip().replace(" HPA", "")
            pressure = float(qnh) if qnh else None
            visibility = _attr_int("visi")
            raw = (metar_el.text or "").strip()
            is_auto = metar_el.get("auto") == "1"

            # Build observation time from day/hour/minute attributes
            day = _attr_int("day")
            hour = _attr_int("hour")
            minute = _attr_int("minute")
            obs_time = _aeroweb_obs_time_from_parts(day, hour, minute)

            result: Dict = {
                "current": {
                    "temp": temp,
                    "dew_point": td,
                    "wind_dir": wind_dir,
                    "wind_speed_kt": wind_kt,
                    "pressure": pressure,
                    "visibility_m": visibility,
                    "raw_metar": raw,
                    "is_auto": is_auto,
                },
                "obs_time": obs_time,
                "station_id": "LFPB",
                "station_label": "Paris Le Bourget (AEROWEB)",
                "lat": 48.9695,
                "lon": 2.4415,
            }
            record_source_call("aeroweb", "station", "success", _elapsed_ms())
            logger.info(
                "AEROWEB LFPB {}:{}Z: temp={}°C dew={}°C wind={}kt@{:03.0f}° QNH={}hPa",
                day,
                f"{hour:02d}{minute:02d}",
                temp,
                td,
                wind_kt,
                wind_dir or 0,
                pressure,
            )
            return result

        except ET.ParseError:
            logger.exception("AEROWEB XML parse error")
            record_source_call("aeroweb", "station", "parse_error", _elapsed_ms())
            return None
        except Exception:
            logger.exception("AEROWEB fetch failed")
            record_source_call("aeroweb", "station", "error", _elapsed_ms())
            return None
