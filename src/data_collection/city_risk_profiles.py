# Polymarket 城市温度市场 - 数据偏差风险档案
# 基于 METAR 机场站与市区实际温度的系统性差异

CITY_RISK_PROFILES = {
    # 🔴 高危城市 - 数据偏差大，容易误判
    "seoul": {
        "risk_level": "high",
        "risk_emoji": "🔴",
        "icao": "RKSI",
        "airport_name": "仁川国际机场",
        "distance_km": 48.8,
        "elevation_diff_m": 0,
        "typical_bias_f": 5.8,
        "bias_direction": "机场靠海偏暖，市区内陆更冷",
        "warning": "距离太远，根本不是同一个天气区",
        "season_notes": None,
    },
    "chicago": {
        "risk_level": "high",
        "risk_emoji": "🔴",
        "icao": "KORD",
        "airport_name": "O'Hare 国际机场",
        "distance_km": 25.3,
        "elevation_diff_m": 42,
        "typical_bias_f": 4.0,
        "bias_direction": "密歇根湖效应：风向变化时湖边vs内陆可差10°F+",
        "warning": "冬天温差最不稳定",
        "season_notes": "冬季",
    },
    # 🟡 中危城市 - 存在系统偏差，需注意
    "ankara": {
        "risk_level": "medium",
        "risk_emoji": "🟡",
        "icao": "LTAC",
        "airport_name": "Esenboğa 机场",
        "distance_km": 24.5,
        "elevation_diff_m": 65,
        "typical_bias_f": 2.0,
        "bias_direction": "机场海拔更高",
        "warning": "内陆高原城市，昼夜温差大（可达15°C+）",
        "season_notes": "下午最高温时偏差会放大",
        "metar_rounding": "激进取整：METAR 报告的温度偏高，例如实际 3.4°C 可能报告为 4°C，这意味着 METAR 显示的整数温度往往已接近下一个 WU 结算值。",
    },
    "london": {
        "risk_level": "low",
        "risk_emoji": "🟢",
        "icao": "EGLC",
        "airport_name": "London City 机场",
        "distance_km": 12.7,
        "elevation_diff_m": 4,
        "typical_bias_f": 0.5,
        "bias_direction": "河水调节效应：泰晤士河 Royal Docks 使得夏天偏凉，冬天偏暖",
        "warning": "极端天气日（热浪/寒潮）偏差会显著放大",
        "season_notes": None,
    },
    "dallas": {
        "risk_level": "medium",
        "risk_emoji": "🟡",
        "icao": "KDAL",
        "airport_name": "Dallas Love Field 机场",
        "distance_km": 11.2,
        "elevation_diff_m": 0,
        "typical_bias_f": 1.1,
        "bias_direction": "比 DFW 更接近市中心，数据更准",
        "warning": "城市热岛效应在夏季午后会使温度略高于郊区",
        "season_notes": None,
    },
    "buenos aires": {
        "risk_level": "medium",
        "risk_emoji": "🟡",
        "icao": "SAEZ",
        "airport_name": "Ezeiza 国际机场",
        "distance_km": 28.1,
        "elevation_diff_m": 0,
        "typical_bias_f": 1.2,
        "bias_direction": "夏天城区可比郊区高2-3°C",
        "warning": "距离远但地形平坦，偏差稳定可预测",
        "season_notes": "夏季",
    },
    "paris": {
        "risk_level": "medium",
        "risk_emoji": "🟡",
        "icao": "LFPG",
        "airport_name": "Charles de Gaulle 机场",
        "distance_km": 25.2,
        "elevation_diff_m": 26,
        "typical_bias_f": 1.5,
        "bias_direction": "城市热岛效应：市区比机场偏暖1-2°C",
        "warning": "机场在北郊，冬季北风时比市区更冷",
        "season_notes": "夏季热浪期间偏差最大",
    },
    # 🟢 低危城市 - 数据相对靠谱
    "toronto": {
        "risk_level": "low",
        "risk_emoji": "🟢",
        "icao": "CYYZ",
        "airport_name": "Pearson 国际机场",
        "distance_km": 19.6,
        "elevation_diff_m": 0,
        "typical_bias_f": 0.3,
        "bias_direction": None,
        "warning": "冬季湖效应偶尔炸裂",
        "season_notes": "冬季",
    },
    "new york": {
        "risk_level": "low",
        "risk_emoji": "🟢",
        "icao": "KLGA",
        "airport_name": "LaGuardia 机场",
        "distance_km": 14.5,
        "elevation_diff_m": 0,
        "typical_bias_f": 0.7,
        "bias_direction": "相比 JFK 更靠近曼哈顿",
        "warning": "东河水汽可能在春季产生微小的降温效果",
        "season_notes": None,
    },
    "seattle": {
        "risk_level": "low",
        "risk_emoji": "🟢",
        "icao": "KSEA",
        "airport_name": "Sea-Tac 国际机场",
        "distance_km": 17.4,
        "elevation_diff_m": 0,
        "typical_bias_f": 0.6,
        "bias_direction": "微气候差异存在但较小",
        "warning": None,
        "season_notes": None,
    },
    "atlanta": {
        "risk_level": "low",
        "risk_emoji": "🟢",
        "icao": "KATL",
        "airport_name": "Hartsfield-Jackson 机场",
        "distance_km": 12.6,
        "elevation_diff_m": 0,
        "typical_bias_f": 0.5,
        "bias_direction": None,
        "warning": None,
        "season_notes": None,
    },
    "miami": {
        "risk_level": "low",
        "risk_emoji": "🟢",
        "icao": "KMIA",
        "airport_name": "Miami 国际机场",
        "distance_km": 10.3,
        "elevation_diff_m": 0,
        "typical_bias_f": 0.3,
        "bias_direction": None,
        "warning": None,
        "season_notes": None,
    },
    "wellington": {
        "risk_level": "low",
        "risk_emoji": "🟢",
        "icao": "NZWN",
        "airport_name": "Wellington 机场",
        "distance_km": 5.1,
        "elevation_diff_m": 0,
        "typical_bias_f": 0.2,
        "bias_direction": None,
        "warning": "12城最近，数据最靠谱",
        "season_notes": None,
    },
}


def get_city_risk_profile(city_name: str) -> dict:
    """获取城市的风险档案"""
    city_lower = city_name.lower().strip()

    city_key = city_lower
    return CITY_RISK_PROFILES.get(city_key)


def format_risk_warning(profile: dict, temp_symbol: str) -> str:
    """格式化风险警告信息"""
    if not profile:
        return ""

    lines = []

    # 风险等级标题
    risk_labels = {"high": "高危", "medium": "中危", "low": "低危"}
    risk_label = risk_labels.get(profile["risk_level"], "未知")
    lines.append(f"⚠️ <b>数据偏差风险</b>: {profile['risk_emoji']} {risk_label}")

    # 机场信息
    lines.append(f"   📍 机场: {profile['airport_name']} ({profile['icao']})")
    lines.append(f"   📏 距市区: {profile['distance_km']}km")

    # 典型偏差
    if profile["typical_bias_f"] >= 1.0:
        lines.append(f"   📊 偏差: ±{profile['typical_bias_f']}{temp_symbol}")

    # 偏差方向说明
    if profile["bias_direction"]:
        lines.append(f"   💡 {profile['bias_direction']}")

    # 特别警告
    if profile["warning"]:
        lines.append(f"   🚨 {profile['warning']}")

    return "\n".join(lines)
