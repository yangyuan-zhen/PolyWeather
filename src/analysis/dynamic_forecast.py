"""Dynamic intraday forecast adjustment layered on top of the static DEB blend.

Takes the DEB normal-probability payload as the *initial* forecast and reshapes
it with live airport-report (METAR) evidence:

1. Hard floor  -- buckets strictly below ceil(max_so_far - 0.5) are impossible
   (the observed high already exceeds them); their probability mass is
   redistributed to the floor bucket and above.
2. Trend rate  -- the last two METAR today-obs points give a warming/cooling
   slope (deg/hour); it nudges mu toward the peak-time extrapolation.
3. Weather suppress -- rain / thunderstorm / heavy cloud compresses upside
   probability (> mu + 0.5) so a wet afternoon cannot keep inflated top
   buckets alive.

The original DEB payload is never mutated; callers receive a new dict with
``dynamic_adjusted`` markers alongside the reshaped distribution.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple



def _sf(v: Any) -> Optional[float]:
    try:
        f = float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _obs_datetime(raw: Any) -> Optional[datetime]:
    text = str(raw or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M"):
        try:
            dt = datetime.strptime(text.replace("Z", "+00:00"), fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except ValueError:
            continue
    return None


def compute_trend_rate(
    today_obs: List[Any],
    *,
    now_utc: Optional[datetime] = None,
    tz_offset_seconds: int = 0,
) -> Optional[float]:
    """Return the recent temperature slope in degrees Celsius per hour.

    Uses the latest two observation points from the airport report series.
    Returns None when fewer than two usable points exist or the window spans
    more than 3 hours (too stale to be meaningful).
    """
    pts: List[Tuple[datetime, float]] = []
    for item in today_obs or []:
        if isinstance(item, dict):
            t_raw, v_raw = item.get("time"), item.get("temp")
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            t_raw, v_raw = item[0], item[1]
        else:
            continue
        temp = _sf(v_raw)
        if temp is None:
            continue
        dt = _obs_datetime(t_raw)
        if dt is None:
            hhmm = str(t_raw or "")
            if len(hhmm) >= 4 and hhmm[2] == ":" and now_utc is not None:
                try:
                    hh, mm = (int(x) for x in hhmm.split(":")[:2])
                    base = now_utc.replace(minute=mm, hour=hh, second=0, microsecond=0)
                    if base > now_utc:
                        base -= timedelta(hours=12)
                    pts.append((base, temp))
                except ValueError:
                    continue
            continue
        pts.append((dt, temp))

    pts.sort(key=lambda p: p[0])
    if len(pts) < 2:
        return None
    (t0, v0), (t1, v1) = pts[-2], pts[-1]
    hours = (t1 - t0).total_seconds() / 3600.0
    if hours <= 0 or hours > 3.0:
        return None
    return round((v1 - v0) / hours, 3)


def weather_suppression_factor(
    wx_desc: Any,
    cloud_cover: Any = None,
    taf_signal: Any = None,
) -> Optional[float]:
    """Return an upside-suppression factor in (0, 1] based on live weather.

    Rain / showers / thunderstorm shrink upside buckets hardest; thick cloud
    adds a milder penalty. ``None`` means no suppression signal was present.
    """
    desc = str(wx_desc or "").upper()
    factor = 1.0
    signaled = False
    tokens = set(desc.split())
    if {"TS", "TSRA", "+TS"} & tokens:
        factor *= 0.55
        signaled = True
    elif {"RA", "SHRA", "FZRA", "DZ"} & tokens:
        factor *= 0.70
        signaled = True

    clouds = _sf(cloud_cover)
    if clouds is not None and clouds >= 6:
        factor *= 0.85
        signaled = True

    try:
        taf_text = json.dumps(taf_signal, ensure_ascii=False).upper() if taf_signal else ""
    except (TypeError, ValueError):
        taf_text = ""
    if taf_text and ("TS" in taf_text or " RA" in taf_text):
        factor *= 0.90
        signaled = True

    return round(factor, 3) if signaled else None


def apply_dynamic_forecast(
    probability_payload: Dict[str, Any],
    *,
    max_so_far: Optional[float],
    trend_rate_c_per_hour: Optional[float],
    hours_to_peak: Optional[float],
    suppression_factor: Optional[float],
) -> Dict[str, Any]:
    """Reshape a deb_normal probability payload with live airport evidence.

    Steps (order matters):
      1. Hard floor: buckets below ceil(max_so_far - 0.5) are zeroed; their
         mass is spread evenly across the remaining buckets >= floor.
      2. Trend shift: mu moves by trend_rate * hours_to_peak * 0.5 (damped
         extrapolation -- the raw slope rarely persists to the peak).
      3. Upside suppression: buckets above mu + 0.5 are multiplied by the
         weather suppression factor; freed mass is renormalized.

    The input payload is NOT mutated.
    """
    out = dict(probability_payload or {})
    probabilities_all: List[Dict[str, Any]] = [
        dict(b) for b in (out.get("probabilities_all") or [])
    ]
    if not probabilities_all:
        return out

    notes: List[str] = []

    # ── 1. Hard floor (requires max_so_far) ──
    if max_so_far is not None:
        floor_tau = int(math.ceil(max_so_far - 0.5))
        kept = [b for b in probabilities_all if float(b["value"]) >= floor_tau]
        removed = [b for b in probabilities_all if float(b["value"]) < floor_tau]
        if removed:
            freed = sum(float(b["probability"]) for b in removed)
            if kept and freed > 0:
                spread = freed / len(kept)
                for b in kept:
                    b["probability"] = round(b["probability"] + spread, 4)
            notes.append(f"hard_floor>={floor_tau}")
            probabilities_all = kept

        total = sum(float(b["probability"]) for b in probabilities_all)
        if total <= 0:
            return out
        for b in probabilities_all:
            b["probability"] = round(float(b["probability"]) / total, 4)

    # ── 2. Trend shift on mu ──
    mu = _sf(out.get("mu"))
    trend_shift = 0.0
    if (
        trend_rate_c_per_hour is not None
        and hours_to_peak is not None
        and hours_to_peak > 0
        and mu is not None
    ):
        trend_shift = round(
            max(-1.5, min(1.5, float(trend_rate_c_per_hour) * float(hours_to_peak) * 0.5)),
            2,
        )
        if abs(trend_shift) > 0.05:
            mu = round(mu + trend_shift, 2)
            out["mu"] = mu
            notes.append(f"trend_shift={trend_shift:+.2f}")

    # ── 3. Upside suppression ──
    if suppression_factor is not None and suppression_factor < 1.0 and mu is not None:
        upside_threshold = mu + 0.5
        for b in probabilities_all:
            tau = float(b["value"])
            if tau > upside_threshold:
                b["probability"] = round(float(b["probability"]) * suppression_factor, 4)
        notes.append(f"suppress_x{suppression_factor}")

    # Renormalize after suppression.
    total = sum(float(b["probability"]) for b in probabilities_all)
    if total > 0:
        for b in probabilities_all:
            b["probability"] = round(float(b["probability"]) / total, 4)
        probabilities_all = [b for b in probabilities_all if b["probability"] > 0]

    out["probabilities_all"] = probabilities_all
    top = sorted(probabilities_all, key=lambda x: x["probability"], reverse=True)[:4]
    out["probabilities"] = top
    out["dynamic_adjusted"] = True
    out["dynamic_notes"] = notes
    return out


def build_dynamic_forecast_payload(
    probability_payload: Optional[Dict[str, Any]],
    *,
    max_so_far: Optional[float] = None,
    metar_today_obs: Optional[List[Any]] = None,
    wx_desc: Any = None,
    cloud_cover: Any = None,
    taf_signal: Any = None,
    peak_first_hour: Any = None,
    peak_last_hour: Any = None,
    local_hour: Any = None,
    is_dead_market: bool = False,
) -> Optional[Dict[str, Any]]:
    """Convenience wrapper: derive inputs then apply the dynamic adjustment.

    Returns None when ``probability_payload`` is None (caller keeps its own
    fallback path). ``is_dead_market`` short-circuits adjustment because the
    settlement is already decided upstream.
    """
    if probability_payload is None or is_dead_market:
        return None

    def _hhmm_hours(value: Any) -> Optional[Tuple[int, int]]:
        text = str(value or "").strip()
        if "T" in text:
            text = text.split("T")[1][:5]
        if len(text) >= 4 and ":" in text[:3]:
            parts = text.split(":")
            try:
                return int(parts[0]), int(parts[1])
            except ValueError:
                return None
        return None

    obs_points: List[Tuple[int, int, float]] = []
    for item in metar_today_obs or []:
        if isinstance(item, dict):
            t_raw, v_raw = item.get("time"), item.get("temp")
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            t_raw, v_raw = item[0], item[1]
        else:
            continue
        temp = _sf(v_raw)
        hm = _hhmm_hours(t_raw)
        if temp is not None and hm is not None:
            obs_points.append((hm[0], hm[1], temp))

    trend_rate: Optional[float] = None
    if len(obs_points) >= 2:
        (h0, m0, v0), (h1, m1, v1) = obs_points[-2], obs_points[-1]
        minutes = (h1 * 60 + m1) - (h0 * 60 + m0)
        if minutes > 0 and minutes <= 180:
            trend_rate = round((v1 - v0) / (minutes / 60.0), 3)

    hours_to_peak: Optional[float] = None
    first = _sf(peak_first_hour)
    last = _sf(peak_last_hour)
    hour_now = _sf(local_hour)
    if first is not None and last is not None and hour_now is not None:
        if hour_now < first:
            hours_to_peak = max(0.0, first - hour_now)
        elif hour_now <= last:
            hours_to_peak = 0.5
        else:
            hours_to_peak = 0.0

    suppress = weather_suppression_factor(wx_desc, cloud_cover, taf_signal)
    return apply_dynamic_forecast(
        probability_payload,
        max_so_far=max_so_far,
        trend_rate_c_per_hour=trend_rate,
        hours_to_peak=hours_to_peak,
        suppression_factor=suppress,
    )
