"""Airport and runway observation repository."""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional


class AirportRepo:
    """Repository for airport and runway observation logs."""

    def __init__(self, get_connection):
        self._get_connection = get_connection

    def append_airport_obs(
        self,
        icao: str,
        city: str,
        temp_c: Optional[float] = None,
        wind_kt: Optional[float] = None,
        pressure_hpa: Optional[float] = None,
        obs_time: Optional[str] = None,
    ) -> None:
        with self._get_connection() as conn:
            conn.execute(
                "INSERT INTO airport_obs_log (icao, city, temp_c, wind_kt, pressure_hpa, obs_time) VALUES (?, ?, ?, ?, ?, ?)",
                (str(icao or "").strip().upper(), str(city or "").strip().lower(), temp_c, wind_kt, pressure_hpa, str(obs_time or datetime.now().isoformat()).strip()),
            )

    def append_airport_obs_batch(
        self,
        rows: List[dict],
    ) -> None:
        if not rows:
            return
        with self._get_connection() as conn:
            conn.executemany(
                "INSERT INTO airport_obs_log (icao, city, temp_c, wind_kt, pressure_hpa, obs_time) VALUES (:icao, :city, :temp_c, :wind_kt, :pressure_hpa, :obs_time)",
                rows,
            )

    def get_airport_obs_recent(self, icao: str, minutes: int = 180) -> List[dict]:
        with self._get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM airport_obs_log WHERE icao = ? AND created_at >= datetime('now', ? || ' minutes', '-0 seconds') ORDER BY created_at DESC",
                (str(icao or "").strip().upper(), f"-{int(minutes)}"),
            ).fetchall()
            return [dict(r) for r in rows]

    def append_runway_obs(
        self,
        icao: str,
        city: str,
        runway: str,
        tdz_temp: Optional[float] = None,
        mid_temp: Optional[float] = None,
        end_temp: Optional[float] = None,
        target_runway_max: Optional[float] = None,
        wind_dir: Optional[int] = None,
        wind_speed: Optional[float] = None,
        rvr: Optional[int] = None,
        mor: Optional[float] = None,
        humidity: Optional[float] = None,
        otime_utc: Optional[str] = None,
    ) -> int:
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO runway_obs_log (
                    icao, city, runway,
                    tdz_temp, mid_temp, end_temp, target_runway_max,
                    wind_dir, wind_speed, rvr, mor, humidity,
                    otime_utc
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(icao or "").strip().upper(),
                    str(city or "").strip().lower(),
                    str(runway or "").strip().upper(),
                    tdz_temp,
                    mid_temp,
                    end_temp,
                    target_runway_max,
                    wind_dir,
                    wind_speed,
                    rvr,
                    mor,
                    humidity,
                    str(otime_utc or datetime.now().isoformat()).strip(),
                ),
            )
            return cursor.lastrowid or 0

    def get_runway_obs_recent(self, icao: str, minutes: int = 20) -> List[dict]:
        with self._get_connection() as conn:
            rows = conn.execute(
                """
                SELECT * FROM runway_obs_log
                WHERE icao = ? AND otime_utc >= datetime('now', ? || ' minutes', '-0 seconds')
                ORDER BY otime_utc DESC
                """,
                (str(icao or "").strip().upper(), f"-{int(minutes)}"),
            ).fetchall()
            return [dict(r) for r in rows]
