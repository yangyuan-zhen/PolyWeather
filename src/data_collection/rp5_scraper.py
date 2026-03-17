from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone
from html import unescape
from typing import Any, Dict, List, Optional
from urllib.parse import quote, unquote, urljoin

import requests

DEFAULT_TIMEOUT_SEC = 20
DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

_TABLE_BY_ID_RE = r'(?is)<table\b[^>]*\bid=["\']{table_id}["\'][^>]*>.*?</table>'
_ROW_RE = re.compile(r"(?is)<tr\b[^>]*>.*?</tr>")
_CELL_RE = re.compile(r"(?is)<(td|th)\b([^>]*)>(.*?)</\1>")
_TITLE_RE = re.compile(r"(?is)<title>(.*?)</title>")
_COLSPAN_RE = re.compile(r'(?is)\bcolspan\s*=\s*["\']?(\d+)')
_SPACE_RE = re.compile(r"\s+")
_TAG_RE = re.compile(r"(?is)<[^>]+>")
_NUM_RE = re.compile(r"[+-]?\d+(?:\.\d+)?")

RP5_BASE_URL = "https://rp5.am"
RP5_CITY_URL_OVERRIDES: Dict[str, str] = {
    # City pages that do not resolve correctly via simple /Weather_in_<City>
    "london": "https://rp5.am/Weather_in_London%2C_St._James%27s_Park",
    "paris": "https://rp5.am/Weather_in_Paris,_France",
    "toronto": "https://rp5.am/Weather_in_Toronto,_Canada",
    "new york": "https://rp5.am/Weather_in_New_York,_USA",
    "warsaw": "https://rp5.am/Weather_in_Warsaw%2C_Okecie_%28airport%29",
    "dallas": "https://rp5.am/Weather_in_Dallas%2C_Love_Field_%28airport%29",
    "miami": "https://rp5.am/Weather_in_Miami_%28airport%29%2C_Florida",
    "atlanta": "https://rp5.am/Weather_in_Atlanta%2C_Georgia",
    "sao paulo": "https://rp5.am/Weather_in_Sao_Paulo",
    "hong kong": "https://rp5.am/Weather_in_Hong_Kong_%28airport%29",
    "singapore": "https://rp5.am/Weather_in_Singapore_%28airport%29",
    "shanghai": "https://rp5.am/Weather_in_Shanghai_Pudong_(airport)",
    "madrid": "https://rp5.am/Weather_in_Madrid,_Barajas_(airport)",
}


def _strip_html(raw: str) -> str:
    text = re.sub(r"(?is)<(script|style)\b[^>]*>.*?</\1>", " ", raw)
    text = _TAG_RE.sub(" ", text)
    text = unescape(text).replace("\xa0", " ")
    return _SPACE_RE.sub(" ", text).strip()


def _extract_title(html: str) -> str:
    match = _TITLE_RE.search(html)
    if not match:
        return ""
    return _strip_html(match.group(1))


def _extract_table_html(html: str, table_id: str) -> str:
    pattern = re.compile(_TABLE_BY_ID_RE.format(table_id=re.escape(table_id)))
    match = pattern.search(html)
    return match.group(0) if match else ""


def _parse_cells(row_html: str) -> List[Dict[str, Any]]:
    cells: List[Dict[str, Any]] = []
    for match in _CELL_RE.finditer(row_html):
        attrs = match.group(2) or ""
        inner = match.group(3) or ""
        colspan_match = _COLSPAN_RE.search(attrs)
        colspan = int(colspan_match.group(1)) if colspan_match else 1
        text = _strip_html(inner)
        cells.append({"text": text, "colspan": max(1, colspan)})
    return cells


def _parse_table(table_html: str) -> List[List[Dict[str, Any]]]:
    rows: List[List[Dict[str, Any]]] = []
    for row_match in _ROW_RE.finditer(table_html):
        row_cells = _parse_cells(row_match.group(0))
        if row_cells:
            rows.append(row_cells)
    return rows


def _expand_row_values(cells: List[Dict[str, Any]]) -> List[str]:
    expanded: List[str] = []
    for cell in cells:
        expanded.extend([cell.get("text", "")] * int(cell.get("colspan") or 1))
    return expanded


def _to_float_first(text: str) -> Optional[float]:
    if not text:
        return None
    values = _NUM_RE.findall(text)
    if not values:
        return None
    try:
        return float(values[0])
    except Exception:
        return None


def _to_float_last(text: str) -> Optional[float]:
    if not text:
        return None
    values = _NUM_RE.findall(text)
    if not values:
        return None
    try:
        return float(values[-1])
    except Exception:
        return None


def _find_row(rows: List[List[Dict[str, Any]]], prefix: str) -> List[Dict[str, Any]]:
    low = prefix.lower()
    for row in rows:
        if not row:
            continue
        label = str(row[0].get("text") or "").strip().lower()
        if label.startswith(low):
            return row
    return []


def _build_timeseries(rows: List[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    if len(rows) < 2:
        return []

    header_row = rows[0]
    local_row = _find_row(rows, "Local time")
    if not header_row or not local_row:
        return []

    day_slots = _expand_row_values(header_row)
    time_slots = _expand_row_values(local_row[1:])
    slot_count = min(len(day_slots), len(time_slots))
    if slot_count <= 0:
        return []

    day_slots = day_slots[:slot_count]
    time_slots = time_slots[:slot_count]

    temp_row = _find_row(rows, "Temperature")
    pressure_row = _find_row(rows, "Pressure")
    wind_speed_row = _find_row(rows, "Wind: speed")
    wind_dir_row = _find_row(rows, "direction")
    humidity_row = _find_row(rows, "Humidity")
    precip_row = _find_row(rows, "Precipitation")

    temp_values = _expand_row_values(temp_row[1:])[:slot_count] if temp_row else [""] * slot_count
    pressure_values = _expand_row_values(pressure_row[1:])[:slot_count] if pressure_row else [""] * slot_count
    wind_speed_values = _expand_row_values(wind_speed_row[1:])[:slot_count] if wind_speed_row else [""] * slot_count
    wind_dir_values = _expand_row_values(wind_dir_row[1:])[:slot_count] if wind_dir_row else [""] * slot_count
    humidity_values = _expand_row_values(humidity_row[1:])[:slot_count] if humidity_row else [""] * slot_count
    precip_values = _expand_row_values(precip_row[1:])[:slot_count] if precip_row else [""] * slot_count

    out: List[Dict[str, Any]] = []
    for idx in range(slot_count):
        entry = {
            "day_label": day_slots[idx],
            "local_time": time_slots[idx],
            "temp_c": _to_float_first(temp_values[idx]),
            "pressure_hpa": _to_float_last(pressure_values[idx]),
            "wind_mps": _to_float_first(wind_speed_values[idx]),
            "wind_dir": (wind_dir_values[idx] or "").strip() or None,
            "humidity_pct": _to_float_first(humidity_values[idx]),
            "precip_mm": _to_float_first(precip_values[idx]),
        }
        out.append(entry)
    return out


def _extract_summary(html: str) -> str:
    block = re.search(
        r"(?is)<b\b[^>]*>\s*Today we expect.*?</b>",
        html,
    )
    if block:
        return _strip_html(block.group(0))

    idx = html.find("Today we expect")
    if idx < 0:
        return ""
    chunk = html[idx : idx + 1400]
    text = _strip_html(chunk)
    match = re.search(r"Today we expect.*?(?:Tomorrow:.*?$)", text, re.I)
    if match:
        return match.group(0).strip()
    return ""


def _extract_weather_links(html: str) -> List[str]:
    links = re.findall(r'(?is)href=["\'](/Weather_in_[^"\']+)["\']', html)
    seen = set()
    out = []
    for link in links:
        if link in seen:
            continue
        seen.add(link)
        out.append(link)
    return out


def _normalize_for_match(value: str) -> str:
    text = unquote(str(value or "")).lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _score_weather_link(link: str, city_hint: str) -> int:
    low_raw = unquote(str(link or "")).lower()
    low = _normalize_for_match(link)
    city_norm = _normalize_for_match(city_hint)
    words = [w for w in city_norm.split() if len(w) >= 3]
    matched = sum(1 for w in words if w in low)
    exact_phrase = bool(city_norm and city_norm in low)
    starts_with_city = bool(city_norm and low.startswith(f"weather in {city_norm}"))
    tokens = set(low.split())
    has_airport = "airport" in tokens

    if words and matched == 0:
        return -300

    score = 0
    score += matched * 30
    if exact_phrase:
        score += 20
    if starts_with_city:
        score += 20
    if has_airport:
        score += 35 if matched > 0 else -60
    if "_region" in low_raw:
        score -= 20
    if "_district" in low_raw:
        score -= 25
    if "_county" in low_raw or "_province" in low_raw:
        score -= 15
    for bad in [
        "weather_in_the_world",
        "weather_in_russia",
        "weather_in_ukraine",
        "weather_in_belarus",
        "weather_in_lithuania",
    ]:
        if bad in low_raw:
            score -= 120
    return score


def build_rp5_city_url_candidates(city_name: str, city_key: str = "") -> List[str]:
    key = str(city_key or city_name).strip().lower()
    name = str(city_name or city_key).strip()
    out: List[str] = []

    if key in RP5_CITY_URL_OVERRIDES:
        out.append(RP5_CITY_URL_OVERRIDES[key])

    if name:
        tokens = [name.replace(" ", "_"), name]
        for token in tokens:
            out.append(f"{RP5_BASE_URL}/Weather_in_{quote(token)}")

    # Keep order, deduplicate.
    seen = set()
    unique: List[str] = []
    for item in out:
        if item in seen:
            continue
        seen.add(item)
        unique.append(item)
    return unique


def scrape_rp5_forecast(
    url: str,
    timeout_sec: int = DEFAULT_TIMEOUT_SEC,
    city_hint: str = "",
    max_hops: int = 2,
) -> Dict[str, Any]:
    sess = requests.Session()
    headers = {
        "User-Agent": DEFAULT_UA,
        "Accept-Language": "en-US,en;q=0.9",
    }
    visited = set()
    current_url = url
    last_payload: Dict[str, Any] = {}

    for _ in range(max(1, int(max_hops))):
        if current_url in visited:
            break
        visited.add(current_url)

        resp = sess.get(current_url, timeout=timeout_sec, headers=headers)
        resp.raise_for_status()
        html = resp.text

        table_html = _extract_table_html(html, "forecastTable")
        rows = _parse_table(table_html) if table_html else []
        points = _build_timeseries(rows)

        last_payload = {
            "source": "rp5_html",
            "url": url,
            "resolved_url": resp.url,
            "fetched_at_utc": datetime.now(timezone.utc).isoformat(),
            "title": _extract_title(html),
            "summary": _extract_summary(html),
            "points": points,
        }
        if points:
            return last_payload

        links = _extract_weather_links(html)
        if not links:
            break
        ranked = sorted(
            links,
            key=lambda item: _score_weather_link(item, city_hint),
            reverse=True,
        )
        best = ranked[0]
        if _score_weather_link(best, city_hint) < 1:
            break
        current_url = urljoin(resp.url, best)

    return last_payload or {
        "source": "rp5_html",
        "url": url,
        "resolved_url": url,
        "fetched_at_utc": datetime.now(timezone.utc).isoformat(),
        "title": "",
        "summary": "",
        "points": [],
    }
