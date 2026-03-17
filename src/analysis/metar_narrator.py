from __future__ import annotations

import re
from typing import Any, Dict, Iterable, Optional, Tuple

_WIND_TOKEN_RE = re.compile(r"^(VRB|\d{3})(\d{2,3})(G(\d{2,3}))?KT$")
_WIND_VAR_RE = re.compile(r"^(\d{3})V(\d{3})$")
_TEMP_DEW_RE = re.compile(r"^(M?\d{2}|//)/(M?\d{2}|//)$")
_PRESSURE_Q_RE = re.compile(r"^Q(\d{4})$")
_PRESSURE_A_RE = re.compile(r"^A(\d{4})$")
_CLOUD_RE = re.compile(r"^(FEW|SCT|BKN|OVC|VV|SKC|CLR|NSC)(\d{3})?$")
_WX_CODE_RE = re.compile(r"^[-+]?([A-Z]{2,})$")

_WIND_DIR_16 = [
    "北方",
    "北偏东北方向",
    "东北方向",
    "东偏东北方向",
    "东方",
    "东偏东南方向",
    "东南方向",
    "南偏东南方向",
    "南方",
    "南偏西南方向",
    "西南方向",
    "西偏西南方向",
    "西方",
    "西偏西北方向",
    "西北方向",
    "北偏西北方向",
]

_CLOUD_DESC = {
    "CLR": "晴空",
    "SKC": "晴空",
    "NSC": "晴空",
    "FEW": "少云",
    "SCT": "多变云天",
    "BKN": "多云",
    "OVC": "阴天",
    "VV": "低云压顶",
}

_WEATHER_DESC = {
    "RA": "有降雨",
    "DZ": "有毛毛雨",
    "SN": "有降雪",
    "TS": "有雷暴",
    "TSRA": "有雷阵雨",
    "FG": "有雾",
    "BR": "有轻雾",
    "HZ": "有霾",
    "SHRA": "有阵雨",
    "FZRA": "有冻雨",
}


def _safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _parse_metar_signed_temp(raw: str) -> Optional[float]:
    if raw in {"", "//"}:
        return None
    sign = -1.0 if raw.startswith("M") else 1.0
    value = raw[1:] if raw.startswith("M") else raw
    try:
        return sign * float(int(value))
    except Exception:
        return None


def _pick_station(tokens: Iterable[str]) -> str:
    token_list = list(tokens)
    if not token_list:
        return ""
    first = token_list[0]
    if first in {"METAR", "SPECI"} and len(token_list) >= 2:
        first = token_list[1]
    if re.fullmatch(r"[A-Z]{4}", first):
        return first
    return ""


def _direction_desc(direction_deg: float) -> str:
    idx = int(((direction_deg % 360) + 11.25) // 22.5) % 16
    return _WIND_DIR_16[idx]


def _wind_level_desc(ms: float) -> str:
    if ms < 0.3:
        return "静风"
    if ms < 1.6:
        return "软风"
    if ms < 3.4:
        return "轻风"
    if ms < 5.5:
        return "微风"
    if ms < 8.0:
        return "和风"
    if ms < 10.8:
        return "清劲风"
    if ms < 13.9:
        return "强风"
    if ms < 17.2:
        return "疾风"
    return "大风"


def _format_temp(temp: float, symbol: str) -> str:
    rounded = round(temp, 1)
    if abs(rounded - round(rounded)) < 0.05:
        body = str(int(round(rounded)))
    else:
        body = f"{rounded:.1f}"
    if rounded > 0:
        body = f"+{body}"
    return f"{body}{symbol}"


def _format_ms(ms: float) -> str:
    rounded = round(ms, 1)
    if abs(rounded - round(rounded)) < 0.05:
        return str(int(round(rounded)))
    return f"{rounded:.1f}"


def _pressure_desc(hpa: float) -> str:
    hp = round(hpa)
    if hp < 1000:
        return f"偏低气压({hp} hPa)"
    if hp > 1030:
        return f"偏高气压({hp} hPa)"
    return f"在正常范围内的大气压({hp} hPa)"


def _best_cloud_code(tokens: Iterable[str], fallback_clouds: Any) -> str:
    best = ""
    rank = {"CLR": 0, "SKC": 0, "NSC": 0, "FEW": 1, "SCT": 2, "BKN": 3, "OVC": 4, "VV": 5}
    best_rank = -1

    for token in tokens:
        m = _CLOUD_RE.match(token)
        if not m:
            continue
        code = m.group(1)
        score = rank.get(code, -1)
        if score > best_rank:
            best_rank = score
            best = code

    if best:
        return best

    if isinstance(fallback_clouds, list):
        for row in fallback_clouds:
            if not isinstance(row, dict):
                continue
            code = str(row.get("cover") or "").upper().strip()
            if not code:
                continue
            score = rank.get(code, -1)
            if score > best_rank:
                best_rank = score
                best = code
    return best


def describe_metar_report(
    raw_metar: str,
    temp_symbol: str = "°C",
    fallback: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Convert METAR bulletin into deterministic human-language description.
    Style is inspired by rp5 bulletin narration: temperature, cloud, pressure, wind.
    """
    fallback = fallback or {}
    raw = str(raw_metar or "").strip().upper()
    tokens = [token for token in raw.split() if token]
    if not tokens and not fallback:
        return ""

    station = _pick_station(tokens) or str(fallback.get("icao") or "").upper().strip()
    station_name = str(fallback.get("station_name") or "").strip()

    wind_dir = _safe_float(fallback.get("wind_dir"))
    wind_kt = _safe_float(fallback.get("wind_speed_kt"))
    wind_var: Optional[Tuple[float, float]] = None
    for token in tokens:
        m = _WIND_TOKEN_RE.match(token)
        if not m:
            continue
        dir_token = m.group(1)
        spd_token = m.group(2)
        if dir_token != "VRB":
            wind_dir = _safe_float(dir_token)
        wind_kt = _safe_float(spd_token)
        break
    for token in tokens:
        mv = _WIND_VAR_RE.match(token)
        if mv:
            left = _safe_float(mv.group(1))
            right = _safe_float(mv.group(2))
            if left is not None and right is not None:
                wind_var = (left, right)
            break

    temp_c = None
    for token in tokens:
        tm = _TEMP_DEW_RE.match(token)
        if tm:
            temp_c = _parse_metar_signed_temp(tm.group(1))
            break
    fallback_temp = _safe_float(fallback.get("temp"))
    if temp_c is None and fallback_temp is not None:
        temp_c = fallback_temp if temp_symbol == "°C" else (fallback_temp - 32.0) * 5.0 / 9.0

    pressure_hpa = None
    for token in tokens:
        qm = _PRESSURE_Q_RE.match(token)
        if qm:
            pressure_hpa = _safe_float(qm.group(1))
            break
        am = _PRESSURE_A_RE.match(token)
        if am:
            inhg = _safe_float(am.group(1))
            if inhg is not None:
                pressure_hpa = (inhg / 100.0) * 33.8639
            break
    if pressure_hpa is None:
        altim = _safe_float(fallback.get("altimeter"))
        if altim is not None:
            pressure_hpa = altim * 33.8639 if altim < 200 else altim

    cloud_code = _best_cloud_code(tokens, fallback.get("clouds"))
    cloud_desc = _CLOUD_DESC.get(cloud_code, "")

    wx_desc = ""
    wx_raw = str(fallback.get("wx_desc") or "").upper().strip()
    if wx_raw:
        for key, value in _WEATHER_DESC.items():
            if key in wx_raw:
                wx_desc = value
                break
    if not wx_desc:
        for token in tokens:
            if not _WX_CODE_RE.match(token):
                continue
            for key, value in _WEATHER_DESC.items():
                if key in token:
                    wx_desc = value
                    break
            if wx_desc:
                break

    station_label = ""
    if station:
        station_label = f"{station} 机场"
    elif station_name:
        station_label = station_name
    else:
        station_label = "机场"

    parts = []
    if temp_c is not None:
        display_temp = temp_c if temp_symbol == "°C" else temp_c * 9.0 / 5.0 + 32.0
        parts.append(f"{station_label} {_format_temp(display_temp, temp_symbol)}")
    else:
        parts.append(station_label)

    if cloud_desc:
        parts.append(cloud_desc)

    if pressure_hpa is not None:
        parts.append(_pressure_desc(pressure_hpa))

    if wind_kt is not None:
        wind_ms = float(wind_kt) * 0.514444
        wind_level = _wind_level_desc(wind_ms)
        if wind_dir is not None:
            wind_sentence = (
                f"从{_direction_desc(wind_dir)}吹来的{wind_level}"
                f"({_format_ms(wind_ms)}米/秒)"
            )
        else:
            wind_sentence = f"{wind_level}({_format_ms(wind_ms)}米/秒)"
        if wind_var is not None:
            left, right = wind_var
            wind_sentence += (
                f"，风向在{_direction_desc(left)}与{_direction_desc(right)}之间摆动"
            )
        parts.append(wind_sentence)

    if wx_desc:
        parts.append(wx_desc)

    if "NOSIG" in tokens:
        parts.append("短时无显著变化")

    text = "，".join([p for p in parts if str(p or "").strip()])
    return f"{text}。" if text else ""
