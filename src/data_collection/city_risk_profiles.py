# Polymarket 城市温度市场 - 数据偏差风险档案
# 基于 METAR 机场站与市区实际温度的系统性差异

from src.data_collection.city_registry import CITY_REGISTRY

# Generate profiles from registry
CITY_RISK_PROFILES = {
    cid: {
        "risk_level": info["risk_level"],
        "risk_emoji": info["risk_emoji"],
        "icao": info["icao"],
        "airport_name": info["airport_name"],
        "distance_km": info["distance_km"],
        "warning": info["warning"],
        # Backwards compatibility flags if needed
        "typical_bias_f": info.get("typical_bias_f", 0.0),
        "elevation_diff_m": info.get("elevation_diff_m", 0),
        "bias_direction": info.get("bias_direction", None),
        "season_notes": info.get("season_notes", None),
    }
    for cid, info in CITY_REGISTRY.items()
}


def get_city_risk_profile(city: str) -> dict:
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
