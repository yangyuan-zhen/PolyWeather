"""Module-level constants for Telegram push."""

from typing import Dict, Set, Tuple

SEVERITY_RANK = {
    "none": 0,
    "low": 1,
    "medium": 2,
    "high": 3,
}

HIGH_FREQ_AIRPORT_CITIES = {
    "seoul", "singapore", "busan", "tokyo", "ankara", "helsinki", "amsterdam",
    "istanbul", "paris", "hong kong", "taipei",
    "beijing", "shanghai", "guangzhou", "qingdao", "chengdu", "chongqing", "wuhan",
    "shenzhen",
    "new york", "los angeles", "chicago", "denver", "atlanta",
    "miami", "san francisco", "houston", "dallas", "austin", "seattle",
    "tel aviv",
}

CHINA_HIGH_FREQ_AIRPORT_CITIES = {
    "beijing", "shanghai", "guangzhou", "qingdao", "chengdu", "chongqing", "wuhan",
}

HIGH_FREQ_AIRPORT_ICAO = {
    "seoul": "RKSI", "singapore": "WSSS", "busan": "RKPK", "tokyo": "44166",
    "ankara": "17128", "helsinki": "EFHK", "amsterdam": "EHAM", "istanbul": "17058",
    "paris": "LFPB", "hong kong": "HKO", "taipei": "466920",
    "beijing": "ZBAA", "shanghai": "ZSPD", "guangzhou": "ZGGG", "qingdao": "ZSQD",
    "chengdu": "ZUUU", "chongqing": "ZUCK", "wuhan": "ZHHH", "shenzhen": "LFS",
    "new york": "KLGA", "los angeles": "KLAX", "chicago": "KORD",
    "denver": "KBKF", "atlanta": "KATL", "miami": "KMIA",
    "san francisco": "KSFO", "houston": "KHOU", "dallas": "KDAL",
    "austin": "KAUS", "seattle": "KSEA",
    "tel aviv": "LLBG",
}

# Settlement runway mapping — matches settlement anchor stations.
# Format: (low_number, high_number) order-independent; stored sorted for lookup.
SETTLEMENT_RUNWAY_PAIRS: Dict[str, Set[Tuple[str, str]]] = {
    "seoul": {("15R", "33L")},
}

SETTLEMENT_RUNWAY_TARGETS: Dict[str, str] = {
}

# All cities with active runway observation data.
RUNWAY_OBSERVATION_CITIES = {
    "seoul", "busan",
}

# Wind regime sectors per airport (approximate, based on runway orientation + coastline).
# Values: {sea_breeze: (from_deg, to_deg), warm_advection: (from_deg, to_deg)}
WIND_REGIME: Dict[str, Dict[str, Tuple[int, int]]] = {
    "seoul": {"sea_breeze": (270, 350), "warm_advection": (150, 230)},
    "busan": {"sea_breeze": (120, 200), "warm_advection": (250, 340)},
}

# Legacy alias for backward compat with existing _select_focus_runway_obs / _focus_runway_pairs_for_city
FOCUS_RUNWAY_PAIRS: Dict[str, Set[Tuple[str, str]]] = SETTLEMENT_RUNWAY_PAIRS  # type: ignore[assignment]

_FUNCTION_HASHTAGS_ZH = {
    "runway": "#跑道观测",
    "airport": "#机场观测",
    "trade": "#交易机会",
}

_FUNCTION_HASHTAGS_EN = {
    "runway": "#RunwayObs",
    "airport": "#AirportObs",
    "trade": "#TradeAlert",
}

# Per-city push interval. The loop wakes every minute, but Telegram should
# read recent city cache instead of acting as an upstream observation producer.
_AIRPORT_PUSH_INTERVAL = {
    city: 600 for city in HIGH_FREQ_AIRPORT_CITIES
}
_AIRPORT_PUSH_INTERVAL.update({
    "seoul": 60,
    "busan": 60,
    **{city: 60 for city in CHINA_HIGH_FREQ_AIRPORT_CITIES},
})

# Per-city temperature window threshold (°C below DEB predicted high)
# Continental airports: wider window (temp rises steadily over land)
# Maritime airports: narrower (sea breeze moderates temp)
# Strong sea breeze: tightest (marine air suppresses peak)
_AIRPORT_HEAT_THRESHOLD = {
    "seoul": 3.0, "ankara": 3.0, "istanbul": 3.0, "paris": 3.0,
    "busan": 2.0, "tokyo": 2.0, "amsterdam": 2.0, "helsinki": 2.0,
    "hong kong": 1.5, "taipei": 1.5,
}

# 部分城市 Open-Meteo 算出的 peak 窗口偏窄，用 fallback 拓宽
# （例如沿海城市受海风影响，高温窗口被压缩）
_AIRPORT_PEAK_FALLBACK = {
    "busan": (12, 16),
}
