from __future__ import annotations

import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional


def _sf(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None


def _interpolate_hourly_value(
    times: list,
    values: list,
    local_date: str,
    target_hour_frac: float,
) -> Optional[float]:
    points = []
    for ts, raw_value in zip(times or [], values or []):
        if not str(ts).startswith(local_date):
            continue
        value = _sf(raw_value)
        if value is None:
            continue
        try:
            hh_mm = str(ts).split("T")[1]
            hour = int(hh_mm[:2])
            minute = int(hh_mm[3:5]) if len(hh_mm) >= 5 else 0
        except Exception:
            continue
        points.append((hour + minute / 60.0, value))

    if not points:
        return None
    points.sort(key=lambda item: item[0])

    if target_hour_frac <= points[0][0]:
        return float(points[0][1])
    if target_hour_frac >= points[-1][0]:
        return float(points[-1][1])

    for idx in range(1, len(points)):
        left_hour, left_value = points[idx - 1]
        right_hour, right_value = points[idx]
        if target_hour_frac > right_hour:
            continue
        if right_hour == left_hour:
            return float(right_value)
        ratio = (target_hour_frac - left_hour) / (right_hour - left_hour)
        return float(left_value + (right_value - left_value) * ratio)

    return float(points[-1][1])


def _build_deviation_monitor(
    *,
    current_temp: Optional[float],
    deb_prediction: Optional[float],
    om_today: Optional[float],
    hourly_times: list,
    hourly_temps: list,
    local_date: str,
    local_hour_frac: float,
    observation_points: list,
) -> Dict[str, Any]:
    if current_temp is None or deb_prediction is None or om_today is None:
        return {}

    offset = _sf(deb_prediction) - _sf(om_today)
    if offset is None:
        return {}

    expected_now = _interpolate_hourly_value(
        hourly_times,
        [(_sf(value) + offset) if _sf(value) is not None else None for value in hourly_temps],
        local_date,
        local_hour_frac,
    )
    if expected_now is None:
        return {}

    delta = float(current_temp) - expected_now
    abs_delta = abs(delta)
    if abs_delta < 0.8:
        direction = "normal"
        severity = "normal"
    elif delta <= -1.8:
        direction = "cold"
        severity = "strong"
    elif delta >= 1.8:
        direction = "hot"
        severity = "strong"
    elif delta < 0:
        direction = "cold"
        severity = "light"
    else:
        direction = "hot"
        severity = "light"

    deviation_series = []
    for item in observation_points or []:
        if not isinstance(item, dict):
            continue
        obs_temp = _sf(item.get("temp"))
        raw_time = str(item.get("time") or "").strip()
        if obs_temp is None:
            continue
        match = re.search(r"(\d{1,2}):(\d{2})", raw_time)
        if not match:
            continue
        obs_hour_frac = int(match.group(1)) + int(match.group(2)) / 60.0
        ref_temp = _interpolate_hourly_value(
            hourly_times,
            [(_sf(value) + offset) if _sf(value) is not None else None for value in hourly_temps],
            local_date,
            obs_hour_frac,
        )
        if ref_temp is None:
            continue
        deviation_series.append(float(obs_temp) - ref_temp)

    trend = "stable"
    if len(deviation_series) >= 2:
        latest = deviation_series[-1]
        previous = deviation_series[-2]
        if latest * previous > 0:
            if abs(latest) - abs(previous) >= 0.3:
                trend = "expanding"
            elif abs(previous) - abs(latest) >= 0.3:
                trend = "contracting"

    if direction == "normal":
        label_zh = f"正常 ±{abs_delta:.1f}°C"
        label_en = f"Normal ±{abs_delta:.1f}°C"
    elif direction == "cold":
        label_zh = f"偏冷 {delta:.1f}°C"
        label_en = f"Cool bias {delta:.1f}°C"
    else:
        label_zh = f"偏热 +{abs_delta:.1f}°C"
        label_en = f"Warm bias +{abs_delta:.1f}°C"

    trend_zh = {
        "contracting": "收敛中",
        "expanding": "扩大中",
        "stable": "稳定",
    }.get(trend, "稳定")
    trend_en = {
        "contracting": "contracting",
        "expanding": "expanding",
        "stable": "stable",
    }.get(trend, "stable")

    return {
        "available": True,
        "current_delta": round(delta, 1),
        "reference_temp": round(expected_now, 1),
        "direction": direction,
        "severity": severity,
        "trend": trend,
        "label_zh": label_zh,
        "label_en": label_en,
        "trend_label_zh": trend_zh,
        "trend_label_en": trend_en,
    }


def _wind_components(speed: Optional[float], direction: Optional[float]) -> tuple[Optional[float], Optional[float]]:
    if speed is None or direction is None:
        return None, None
    try:
        import math

        rad = math.radians(float(direction))
        spd = float(speed)
        u = -spd * math.sin(rad)
        v = -spd * math.cos(rad)
        return u, v
    except Exception:
        return None, None



def _build_vertical_profile_signal(
    hourly_next_48h: Dict[str, list],
    local_date: str,
    local_hour: int,
    first_peak_h: int,
    last_peak_h: int,
) -> Dict[str, Any]:
    times = hourly_next_48h.get("times") or []
    if not times:
        return {}

    preferred_start = max(local_hour, max(0, first_peak_h - 2))
    preferred_end = min(23, last_peak_h + 1)
    candidate_indexes = [
        index
        for index, ts in enumerate(times)
        if str(ts).startswith(local_date)
        and preferred_start <= int(str(ts).split("T")[1][:2]) <= preferred_end
    ]
    if not candidate_indexes:
        candidate_indexes = [
            index
            for index, ts in enumerate(times)
            if str(ts).startswith(local_date)
        ]
    if not candidate_indexes:
        return {}

    def _series(name: str) -> list:
        values = hourly_next_48h.get(name) or []
        return [values[idx] if idx < len(values) else None for idx in candidate_indexes]

    def _max_numeric(values: list) -> Optional[float]:
        valid = [_sf(value) for value in values if _sf(value) is not None]
        return max(valid) if valid else None

    def _min_numeric(values: list) -> Optional[float]:
        valid = [_sf(value) for value in values if _sf(value) is not None]
        return min(valid) if valid else None

    def _level_label(level: str, locale: str) -> str:
        mapping = {
            "high": {"zh": "高", "en": "high"},
            "medium": {"zh": "中", "en": "medium"},
            "low": {"zh": "低", "en": "low"},
            "strong": {"zh": "强", "en": "strong"},
            "weak": {"zh": "弱", "en": "weak"},
        }
        return mapping.get(level, {}).get(locale, level)

    cape_max = _max_numeric(_series("cape"))
    cin_min = _min_numeric(_series("convective_inhibition"))
    lifted_index_min = _min_numeric(_series("lifted_index"))
    boundary_layer_height_max = _max_numeric(_series("boundary_layer_height"))

    shear_values: list[float] = []
    speed_10m = hourly_next_48h.get("wind_speed_10m") or []
    direction_10m = hourly_next_48h.get("wind_direction_10m") or []
    speed_180m = hourly_next_48h.get("wind_speed_180m") or []
    direction_180m = hourly_next_48h.get("wind_direction_180m") or []
    for idx in candidate_indexes:
        s10 = _sf(speed_10m[idx]) if idx < len(speed_10m) else None
        d10 = _sf(direction_10m[idx]) if idx < len(direction_10m) else None
        s180 = _sf(speed_180m[idx]) if idx < len(speed_180m) else None
        d180 = _sf(direction_180m[idx]) if idx < len(direction_180m) else None
        u10, v10 = _wind_components(s10, d10)
        u180, v180 = _wind_components(s180, d180)
        if None in (u10, v10, u180, v180):
            continue
        import math

        shear_values.append(math.sqrt((u180 - u10) ** 2 + (v180 - v10) ** 2))
    shear_10m_180m_max = max(shear_values) if shear_values else None

    suppression_risk = "low"
    if (cape_max is not None and cape_max >= 700) or (
        cin_min is not None and cin_min <= -50
    ):
        suppression_risk = "high"
    elif (cape_max is not None and cape_max >= 150) or (
        cin_min is not None and cin_min <= -15
    ):
        suppression_risk = "medium"

    trigger_risk = "low"
    if (
        cape_max is not None
        and cape_max >= 550
        and lifted_index_min is not None
        and lifted_index_min <= -1.5
    ):
        trigger_risk = "high"
    elif (
        cape_max is not None
        and cape_max >= 120
        and lifted_index_min is not None
        and lifted_index_min <= 0.5
    ):
        trigger_risk = "medium"

    mixing_strength = "weak"
    if boundary_layer_height_max is not None and boundary_layer_height_max >= 1400:
        mixing_strength = "strong"
    elif boundary_layer_height_max is not None and boundary_layer_height_max >= 700:
        mixing_strength = "medium"

    shear_risk = "low"
    if shear_10m_180m_max is not None and shear_10m_180m_max >= 8:
        shear_risk = "high"
    elif shear_10m_180m_max is not None and shear_10m_180m_max >= 4:
        shear_risk = "medium"

    heating_setup = "neutral"
    heating_score = 0
    if suppression_risk == "high":
        heating_score -= 2
    elif suppression_risk == "medium":
        heating_score -= 1
    if trigger_risk == "high":
        heating_score -= 2
    elif trigger_risk == "medium":
        heating_score -= 1
    if mixing_strength == "strong":
        heating_score += 2
    elif mixing_strength == "medium":
        heating_score += 1
    else:
        heating_score -= 1
    if shear_risk == "high":
        heating_score -= 1

    if heating_score >= 2:
        heating_setup = "supportive"
    elif heating_score <= -2:
        heating_setup = "suppressed"

    has_profile_data = any(
        value is not None
        for value in (
            cape_max,
            cin_min,
            lifted_index_min,
            boundary_layer_height_max,
            shear_10m_180m_max,
        )
    )

    zh_parts = []
    en_parts = []
    if suppression_risk == "high":
        zh_parts.append("午后对流压温风险偏高。")
        en_parts.append("Afternoon convective suppression risk is elevated.")
    elif suppression_risk == "medium":
        zh_parts.append("存在一定云雨压温风险。")
        en_parts.append("There is some cloud and shower suppression risk.")
    elif has_profile_data:
        zh_parts.append("高空对流压温风险暂时不高。")
        en_parts.append("Upper-air suppression risk remains limited for now.")
    if mixing_strength == "strong":
        zh_parts.append("边界层混合较深，若无云雨打断仍有冲高空间。")
        en_parts.append("Deep boundary-layer mixing still supports additional warming if convection stays limited.")
    elif mixing_strength == "medium":
        zh_parts.append("白天混合条件中等。")
        en_parts.append("Daytime mixing potential is moderate.")
    elif has_profile_data:
        zh_parts.append("边界层混合偏浅。")
        en_parts.append("Boundary-layer mixing remains shallow.")
    if shear_risk == "high":
        zh_parts.append("高空风切变较强，午后结构波动可能加大。")
        en_parts.append("Upper-level shear is relatively strong and may increase afternoon volatility.")
    elif shear_risk == "medium":
        zh_parts.append("高空风切变有一定存在感。")
        en_parts.append("Upper-level shear is noticeable.")
    elif has_profile_data:
        zh_parts.append("高空风切变扰动有限。")
        en_parts.append("Upper-level shear disruption remains limited.")
    if trigger_risk == "high":
        zh_parts.append("抬升触发条件较好，需警惕午后云团发展。")
        en_parts.append("Trigger conditions are favorable enough to watch for afternoon convective development.")
    elif trigger_risk == "medium":
        zh_parts.append("午后具备一定触发条件。")
        en_parts.append("There is some afternoon trigger potential.")
    elif has_profile_data:
        zh_parts.append("午后触发条件偏弱。")
        en_parts.append("Afternoon trigger potential remains weak.")
    if not has_profile_data:
        zh_parts.append("高空剖面字段暂缺，当前仅保留基础默认信号。")
        en_parts.append("Upper-air profile fields are currently unavailable, so only a fallback signal is shown.")
    elif not zh_parts:
        zh_parts.append("高空结构整体平稳，暂未看到明显压温信号。")
    if not en_parts:
        en_parts.append("The upper-air structure looks fairly stable, without a strong suppression signal yet.")

    if has_profile_data:
        summary_tokens_zh = []
        summary_tokens_en = []
        window_start = str(times[candidate_indexes[0]]).split("T")[1][:5]
        window_end = str(times[candidate_indexes[-1]]).split("T")[1][:5]
        zh_parts.append(f"判断窗口：{window_start}-{window_end}。")
        en_parts.append(f"Signal window: {window_start}-{window_end}.")
        if cape_max is not None:
            summary_tokens_zh.append(f"CAPE≈{round(cape_max)}")
            summary_tokens_en.append(f"CAPE≈{round(cape_max)}")
        if cin_min is not None:
            summary_tokens_zh.append(f"CIN≈{round(cin_min)}")
            summary_tokens_en.append(f"CIN≈{round(cin_min)}")
        if boundary_layer_height_max is not None:
            summary_tokens_zh.append(f"混合层≈{round(boundary_layer_height_max)}m")
            summary_tokens_en.append(f"mixing≈{round(boundary_layer_height_max)}m")
        if shear_10m_180m_max is not None:
            summary_tokens_zh.append(f"切变≈{shear_10m_180m_max:.1f}")
            summary_tokens_en.append(f"shear≈{shear_10m_180m_max:.1f}")
        zh_parts.append(
            f"压温{_level_label(suppression_risk, 'zh')}、触发{_level_label(trigger_risk, 'zh')}、混合{_level_label(mixing_strength, 'zh')}、切变{_level_label(shear_risk, 'zh')}。"
        )
        en_parts.append(
            f"Suppression { _level_label(suppression_risk, 'en') }, trigger { _level_label(trigger_risk, 'en') }, mixing { _level_label(mixing_strength, 'en') }, shear { _level_label(shear_risk, 'en') }."
        )
        if heating_setup == "supportive":
            zh_parts.append("整体更偏向支持白天冲高。")
            en_parts.append("Overall, the profile is more supportive of daytime heating.")
        elif heating_setup == "suppressed":
            zh_parts.append("整体更偏向抑制午后冲高。")
            en_parts.append("Overall, the profile leans more toward suppressing the afternoon peak.")
        else:
            zh_parts.append("整体更像中性环境，仍需结合地面信号。")
            en_parts.append("Overall, the profile looks fairly neutral and still needs surface confirmation.")
        if summary_tokens_zh:
            zh_parts.append(" / ".join(summary_tokens_zh) + "。")
        if summary_tokens_en:
            en_parts.append(" / ".join(summary_tokens_en) + ".")

    return {
        "source": "open-meteo-gfs",
        "window_start": times[candidate_indexes[0]] if candidate_indexes else None,
        "window_end": times[candidate_indexes[-1]] if candidate_indexes else None,
        "cape_max": cape_max,
        "cin_min": cin_min,
        "lifted_index_min": lifted_index_min,
        "boundary_layer_height_max": boundary_layer_height_max,
        "shear_10m_180m_max": shear_10m_180m_max,
        "suppression_risk": suppression_risk,
        "trigger_risk": trigger_risk,
        "mixing_strength": mixing_strength,
        "shear_risk": shear_risk,
        "heating_setup": heating_setup,
        "heating_score": heating_score,
        "summary_zh": "".join(zh_parts),
        "summary_en": " ".join(en_parts),
    }



def _build_taf_signal(
    taf_data: Dict[str, Any],
    city: str,
    local_date: str,
    utc_offset: int,
    first_peak_h: int,
    last_peak_h: int,
) -> Dict[str, Any]:
    if str(city or "").strip().lower() == "hong kong":
        return {}
    raw_taf = re.sub(r"\s+", " ", str((taf_data or {}).get("raw_taf") or "").upper().strip())
    if not raw_taf:
        return {}

    issue_raw = str((taf_data or {}).get("issue_time") or "").strip()
    issue_dt = None
    if issue_raw:
        try:
            issue_dt = datetime.fromisoformat(issue_raw.replace("Z", "+00:00"))
        except Exception:
            issue_dt = None
    if issue_dt is None:
        issue_dt = datetime.now(timezone.utc)

    local_tz = timezone(timedelta(seconds=int(utc_offset or 0)))
    valid_match = re.search(r"\b(\d{2})(\d{2})/(\d{2})(\d{2})\b", raw_taf)
    tokens = raw_taf.split()
    if not valid_match:
        return {}

    def _infer_utc(day: int, hour: int, minute: int = 0) -> datetime:
        base = issue_dt
        year = base.year
        month = base.month
        day_offset = 0
        normalized_hour = hour
        if normalized_hour >= 24:
            day_offset += normalized_hour // 24
            normalized_hour = normalized_hour % 24
        candidate = datetime(
            year,
            month,
            day,
            normalized_hour,
            minute,
            tzinfo=timezone.utc,
        )
        if day_offset:
            candidate += timedelta(days=day_offset)
        if candidate < base - timedelta(days=20):
            if month == 12:
                candidate = datetime(
                    year + 1,
                    1,
                    day,
                    normalized_hour,
                    minute,
                    tzinfo=timezone.utc,
                ) + timedelta(days=day_offset)
            else:
                candidate = datetime(
                    year,
                    month + 1,
                    day,
                    normalized_hour,
                    minute,
                    tzinfo=timezone.utc,
                ) + timedelta(days=day_offset)
        elif candidate > base + timedelta(days=20):
            if month == 1:
                candidate = datetime(
                    year - 1,
                    12,
                    day,
                    normalized_hour,
                    minute,
                    tzinfo=timezone.utc,
                ) + timedelta(days=day_offset)
            else:
                candidate = datetime(
                    year,
                    month - 1,
                    day,
                    normalized_hour,
                    minute,
                    tzinfo=timezone.utc,
                ) + timedelta(days=day_offset)
        return candidate

    def _parse_period(token: str) -> tuple[Optional[datetime], Optional[datetime]]:
        match = re.match(r"^(\d{2})(\d{2})/(\d{2})(\d{2})$", token)
        if not match:
            return None, None
        start = _infer_utc(int(match.group(1)), int(match.group(2)))
        end = _infer_utc(int(match.group(3)), int(match.group(4)))
        if end <= start:
            end += timedelta(days=1)
        return start, end

    valid_start_utc, valid_end_utc = _parse_period(valid_match.group(0))
    if valid_start_utc is None or valid_end_utc is None:
        return {}

    segment_indexes: list[int] = []
    for idx, token in enumerate(tokens):
        if re.match(r"^FM\d{6}$", token) or token in {"TEMPO", "BECMG", "PROB30", "PROB40"}:
            segment_indexes.append(idx)

    base_start_idx = 0
    for idx, token in enumerate(tokens):
        if token == valid_match.group(0):
            base_start_idx = idx + 1
            break

    segments: list[Dict[str, Any]] = []
    first_segment_idx = segment_indexes[0] if segment_indexes else len(tokens)
    if base_start_idx < first_segment_idx:
        segments.append(
            {
                "type": "BASE",
                "start_utc": valid_start_utc,
                "end_utc": valid_end_utc,
                "tokens": tokens[base_start_idx:first_segment_idx],
            }
        )

    idx_pos = 0
    while idx_pos < len(segment_indexes):
        start_idx = segment_indexes[idx_pos]
        end_idx = segment_indexes[idx_pos + 1] if idx_pos + 1 < len(segment_indexes) else len(tokens)
        token = tokens[start_idx]
        seg_type = token
        seg_start = valid_start_utc
        seg_end = valid_end_utc
        payload_start = start_idx + 1

        if re.match(r"^FM(\d{2})(\d{2})(\d{2})$", token):
            match = re.match(r"^FM(\d{2})(\d{2})(\d{2})$", token)
            seg_type = "FM"
            seg_start = _infer_utc(int(match.group(1)), int(match.group(2)), int(match.group(3)))
            if idx_pos + 1 < len(segment_indexes):
                next_token = tokens[segment_indexes[idx_pos + 1]]
                next_match = re.match(r"^FM(\d{2})(\d{2})(\d{2})$", next_token)
                if next_match:
                    seg_end = _infer_utc(int(next_match.group(1)), int(next_match.group(2)), int(next_match.group(3)))
                else:
                    seg_end = valid_end_utc
            else:
                seg_end = valid_end_utc
        elif token in {"TEMPO", "BECMG"}:
            seg_type = token
            if payload_start < len(tokens):
                seg_start, seg_end = _parse_period(tokens[payload_start])
                payload_start += 1
        elif token in {"PROB30", "PROB40"}:
            seg_type = token
            if payload_start < len(tokens) and tokens[payload_start] == "TEMPO":
                seg_type = f"{token} TEMPO"
                payload_start += 1
            if payload_start < len(tokens):
                seg_start, seg_end = _parse_period(tokens[payload_start])
                payload_start += 1

        if seg_start is None or seg_end is None:
            idx_pos += 1
            continue
        if seg_end <= seg_start:
            seg_end = seg_start + timedelta(hours=1)

        segments.append(
            {
                "type": seg_type,
                "start_utc": seg_start,
                "end_utc": seg_end,
                "tokens": tokens[payload_start:end_idx],
            }
        )
        idx_pos += 1

    peak_window_start = datetime.strptime(f"{local_date} {max(0, first_peak_h - 2):02d}:00", "%Y-%m-%d %H:%M").replace(tzinfo=local_tz)
    peak_window_end = datetime.strptime(f"{local_date} {min(23, last_peak_h + 1):02d}:00", "%Y-%m-%d %H:%M").replace(tzinfo=local_tz)

    precip_rank = {"low": 0, "medium": 1, "high": 2}
    suppression_level = "low"
    disruption_level = "low"
    low_ceiling_ft = None
    ceiling_cover = None
    wind_regimes: list[str] = []
    markers: list[Dict[str, Any]] = []
    active_segments: list[Dict[str, Any]] = []

    def _segment_precip_level(tokens_block: list[str]) -> str:
        joined = " ".join(tokens_block)
        if re.search(r"\b(?:-|\+)?(?:TSRA|TS|VCTS|SHRA|SHSN|SHGS)\b", joined):
            return "high"
        if re.search(r"\b(?:-|\+)?(?:RA|DZ|SN)\b", joined):
            return "medium"
        return "low"

    for segment in segments:
        start_local = segment["start_utc"].astimezone(local_tz)
        end_local = segment["end_utc"].astimezone(local_tz)
        overlap_start = max(start_local, peak_window_start)
        overlap_end = min(end_local, peak_window_end)
        if overlap_end <= overlap_start:
            continue
        active_segments.append(segment)
        joined = " ".join(segment["tokens"])
        level = _segment_precip_level(segment["tokens"])
        if precip_rank[level] > precip_rank[suppression_level]:
            suppression_level = level

        cloud_matches = re.findall(r"\b(FEW|SCT|BKN|OVC)(\d{3})\b", joined)
        for cover, base in cloud_matches:
            if cover not in {"BKN", "OVC"}:
                continue
            try:
                base_ft = int(base) * 100
            except Exception:
                continue
            if low_ceiling_ft is None or base_ft < low_ceiling_ft:
                low_ceiling_ft = base_ft
                ceiling_cover = cover
        if low_ceiling_ft is not None and low_ceiling_ft <= 4000 and suppression_level == "low":
            suppression_level = "medium"

        wind_matches = re.findall(r"\b(\d{3}|VRB)(\d{2,3})(?:G\d{2,3})?KT\b", joined)
        segment_regimes = []
        for direction, _speed in wind_matches:
            if direction == "VRB":
                segment_regimes.append("variable")
                continue
            deg = int(direction)
            if 135 <= deg <= 225:
                segment_regimes.append("southerly")
            elif deg >= 315 or deg <= 45:
                segment_regimes.append("northerly")
            else:
                segment_regimes.append("cross")
        for item in segment_regimes:
            if item not in wind_regimes:
                wind_regimes.append(item)

        if segment["type"] in {"TEMPO", "BECMG", "PROB30", "PROB40", "PROB30 TEMPO", "PROB40 TEMPO"}:
            disruption_level = "medium" if disruption_level == "low" else disruption_level
        if segment["type"] in {"PROB30 TEMPO", "PROB40 TEMPO"} or level == "high":
            disruption_level = "high"

        marker_time_local = overlap_start
        marker_hour = marker_time_local.strftime("%H:00")
        hazards = []
        if level != "low":
            hazards.append(level)
        if low_ceiling_ft is not None and segment_regimes is not None:
            hazards.append("cloud")
        if segment_regimes:
            hazards.append("wind")
        summary_zh = (
            f"{segment['type']} {overlap_start.strftime('%H:%M')}-{overlap_end.strftime('%H:%M')} "
            f"{'有阵雨/雷暴扰动' if level == 'high' else '有云雨扰动' if level == 'medium' else '以稳定为主'}"
        )
        summary_en = (
            f"{segment['type']} {overlap_start.strftime('%H:%M')}-{overlap_end.strftime('%H:%M')} "
            f"{'shows shower/thunder disruption' if level == 'high' else 'shows cloud/rain disruption' if level == 'medium' else 'stays relatively stable'}"
        )
        markers.append(
            {
                "label_time": marker_hour,
                "marker_type": segment["type"],
                "start_local": overlap_start.strftime("%H:%M"),
                "end_local": overlap_end.strftime("%H:%M"),
                "suppression_level": level,
                "summary_zh": summary_zh,
                "summary_en": summary_en,
            }
        )

    wind_shift = len(wind_regimes) >= 2 or "variable" in wind_regimes
    peak_window = f"{peak_window_start.strftime('%H:%M')}-{peak_window_end.strftime('%H:%M')}"

    if suppression_level == "high":
        summary_zh = f"TAF 在峰值窗口（{peak_window}）提示阵雨或雷暴扰动，机场最高温可能被云雨压低。"
        summary_en = f"TAF flags shower or thunderstorm disruption around the peak window ({peak_window}), airport high may get capped by showers/storms."
    elif suppression_level == "medium":
        summary_zh = f"TAF 在峰值窗口（{peak_window}）提示云量或弱降水扰动，需要防峰值被压低。"
        summary_en = f"TAF points to cloud or light-precip disruption around the peak window ({peak_window}); the airport high may be capped."
    else:
        summary_zh = f"TAF 在峰值窗口（{peak_window}）暂未提示明显云雨压温。"
        summary_en = f"TAF does not flag a strong cloud/rain suppression signal around the peak window ({peak_window})."
    if wind_shift:
        summary_zh += " 同时机场预报风向存在阶段性切换。"
        summary_en += " Airport wind direction also shifts by regime during the window."

    return {
        "available": True,
        "source": "aviationweather-taf",
        "raw_taf": raw_taf,
        "issue_time": (taf_data or {}).get("issue_time"),
        "valid_time_from": (taf_data or {}).get("valid_time_from"),
        "valid_time_to": (taf_data or {}).get("valid_time_to"),
        "peak_window": peak_window,
        "segments": [
            {
                "type": seg["type"],
                "start_local": seg["start_utc"].astimezone(local_tz).strftime("%H:%M"),
                "end_local": seg["end_utc"].astimezone(local_tz).strftime("%H:%M"),
                "tokens": seg["tokens"],
            }
            for seg in active_segments
        ],
        "markers": markers,
        "low_ceiling_ft": low_ceiling_ft,
        "ceiling_cover": ceiling_cover,
        "wind_regimes": wind_regimes,
        "wind_shift": wind_shift,
        "suppression_level": suppression_level,
        "disruption_level": disruption_level,
        "summary_zh": summary_zh,
        "summary_en": summary_en,
    }
