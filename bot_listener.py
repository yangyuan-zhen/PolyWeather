import sys
import os
from datetime import datetime
from typing import List, Dict, Any, Optional
import telebot  # type: ignore
from loguru import logger  # type: ignore

# 确保项目根目录在 sys.path 中
project_root = os.path.dirname(os.path.abspath(__file__))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from src.utils.config_loader import load_config  # type: ignore
from src.data_collection.weather_sources import WeatherDataCollector  # type: ignore
from src.data_collection.city_risk_profiles import get_city_risk_profile, format_risk_warning  # type: ignore
from src.analysis.deb_algorithm import calculate_dynamic_weights, update_daily_record

def analyze_weather_trend(weather_data, temp_symbol, city_name=None):
    '''根据实测与预测分析气温态势，增加峰值时刻预测'''
    insights: List[str] = []
    ai_features: List[str] = []
    
    metar = weather_data.get("metar", {})
    open_meteo = weather_data.get("open-meteo", {})
    mb = weather_data.get("meteoblue", {})
    nws = weather_data.get("nws", {})
    mgm = weather_data.get("mgm", {})
    
    if not metar or not open_meteo:
        return "", ""

        
    curr_temp = metar.get("current", {}).get("temp")
    max_so_far = metar.get("current", {}).get("max_temp_so_far")  # 今日实测最高
    daily = open_meteo.get("daily", {})
    hourly = open_meteo.get("hourly", {})
    times = hourly.get("time", [])
    temps = hourly.get("temperature_2m", [])
    
    # === 新核心：动态集合权重预报 (DEB) ===
    # 抽取各个确定性预报值构成的字典
    current_forecasts = {}
    if daily.get("temperature_2m_max"):
        current_forecasts["Open-Meteo"] = daily.get("temperature_2m_max")[0]
    if mb.get("today_high") is not None:
        current_forecasts["Meteoblue"] = mb.get("today_high")
    if nws.get("today_high") is not None:
        current_forecasts["NWS"] = nws.get("today_high")
        
    mm_forecasts = weather_data.get("multi_model", {}).get("forecasts", {})
    for m_name, m_val in mm_forecasts.items():
        if m_val is not None:
            current_forecasts[m_name] = m_val
            
    # 从 URL/入参里我们暂时拿不到城名，为了 DEB 追溯我们在后方的总控那里提取。这里的 analyze_weather_trend 主要计算最高预留。
    forecast_highs = [h for h in current_forecasts.values() if h is not None]
    forecast_high = max(forecast_highs) if forecast_highs else None
    min_forecast_high = min(forecast_highs) if forecast_highs else forecast_high
    forecast_median = sorted(forecast_highs)[len(forecast_highs) // 2] if forecast_highs else None
    
    wind_speed = metar.get("current", {}).get("wind_speed_kt", 0)
    
    # 获取当地时间小时和分钟
    local_time_full = open_meteo.get("current", {}).get("local_time", "")
    try:
        local_date_str = local_time_full.split(" ")[0]
        time_parts = local_time_full.split(" ")[1].split(":")
        local_hour = int(time_parts[0])
        local_minute = int(time_parts[1]) if len(time_parts) > 1 else 0
    except:
        from datetime import datetime
        local_date_str = datetime.now().strftime("%Y-%m-%d")
        local_hour = datetime.now().hour
        local_minute = datetime.now().minute
    local_hour_frac = local_hour + local_minute / 60  # 含分钟的精确小时

    # === DEB 融合渲染 ===
    if city_name and current_forecasts:
        blended_high, weight_info = calculate_dynamic_weights(city_name, current_forecasts)
        if blended_high is not None:
            insights.insert(0, f"🧬 <b>DEB 融合预测</b>：<b>{blended_high}{temp_symbol}</b> ({weight_info})")
            ai_features.append(f"🧬 DEB系统已通过历史偏差矫正算出期待点是: {blended_high}{temp_symbol}。")
            
        # 顺便把今天的预测记录下来供之后回测用
        try:
            update_daily_record(city_name, local_date_str, current_forecasts, max_so_far)
        except:
            pass

    # === METAR 趋势分析 (移到前部判断降温) ===
    recent_temps = metar.get("recent_temps", [])
    trend_desc = ""
    if len(recent_temps) >= 2:
        temps_only = [t for _, t in recent_temps]
        latest_val = temps_only[0]
        prev_val = temps_only[1]
        diff = latest_val - prev_val
        if len(temps_only) >= 3:
            all_same = all(t == latest_val for t in temps_only[:3])
            all_rising = all(temps_only[i] >= temps_only[i+1] for i in range(min(3, len(temps_only)) - 1))
            all_falling = all(temps_only[i] <= temps_only[i+1] for i in range(min(3, len(temps_only)) - 1))
            trend_display = " → ".join([f"{t}{temp_symbol}@{tm}" for tm, t in recent_temps[:3]])
            if all_same: trend_desc = f"📉 温度已停滞（{trend_display}），大概率到顶。"
            elif all_rising and diff > 0: trend_desc = f"📈 仍在升温（{trend_display}）。"
            elif all_falling and diff < 0: trend_desc = f"📉 已开始降温（{trend_display}）。"
            else: trend_desc = f"📊 温度波动中（{trend_display}）。"
        elif diff == 0: trend_desc = f"📉 温度持平（最近两条都是 {latest_val}{temp_symbol}）。"
        elif diff > 0: trend_desc = f"📈 仍在升温（{prev_val} → {latest_val}{temp_symbol}）。"
        else: trend_desc = f"📉 已开始降温（{prev_val} → {latest_val}{temp_symbol}）。"

    is_cooling = "降温" in trend_desc



    # === 集合预报区间 (去除了啰嗦的预报验证) ===
    ensemble = weather_data.get("ensemble", {})
    ens_p10 = ensemble.get("p10")
    ens_p90 = ensemble.get("p90")
    ens_median = ensemble.get("median")
    om_today = daily.get("temperature_2m_max", [None])[0]
    if ens_p10 is not None and ens_p90 is not None and ens_median is not None:
        msg1 = f"📊 <b>集合预报</b>：中位数 {ens_median}{temp_symbol}，90% 区间 [{ens_p10}{temp_symbol} - {ens_p90}{temp_symbol}]。"
        if not is_cooling: insights.append(msg1)
        ai_features.append(msg1)

        if om_today is not None:
            if om_today > ens_p90 and (max_so_far is None or max_so_far < om_today - 0.5):
                msg2 = f"⚡ 预报偏高：确定性预报 {om_today}{temp_symbol} 超集合90%上限，更可能接近 {ens_median}{temp_symbol}。"
                ai_features.append(msg2)
            elif om_today < ens_p10 and (max_so_far is None or max_so_far < ens_median):
                msg2 = f"⚡ 预报偏低：确定性预报 {om_today}{temp_symbol} 低于集合90%下限，更可能接近 {ens_median}{temp_symbol}。"
                ai_features.append(msg2)

        # === 数学概率计算（基于集合预报正态分布拟合）===
        import math as _math
        # 用 P10/P90 反推标准差: P10 = median - 1.28*sigma, P90 = median + 1.28*sigma
        sigma = (ens_p90 - ens_p10) / 2.56
        if sigma < 0.1: sigma = 0.1  # 防止除以零
        
        # 分布中心：以 DEB/多模型中位数为主锚（权重 70%），集合中位数为辅（30%）
        # 因为集合中位数经常偏保守，不如确定性模型和 DEB 融合值可靠
        if forecast_median is not None:
            mu = forecast_median * 0.7 + ens_median * 0.3
        else:
            mu = ens_median
        
        # 实时修正：如果实测最高温已经超过了预报的 μ，则向上修正
        if max_so_far is not None and max_so_far > mu:
            if not is_cooling:
                # 还在升温，预期最终比当前再高一点
                mu = max_so_far + 0.3
            else:
                # 已降温，以实测峰值为锚
                mu = max_so_far
        
        # 简化的正态 CDF (不依赖 scipy)
        def _norm_cdf(x, m, s):
            return 0.5 * (1 + _math.erf((x - m) / (s * _math.sqrt(2))))
        
        # 计算每个 WU 整数区间 [N-0.5, N+0.5) 的概率
        center = round(mu)
        candidates = range(center - 2, center + 3)  # 5 个候选整数
        # 如果已有实测最高温，低于该值的 WU 结算整数不可能出现
        min_possible_wu = round(max_so_far) if max_so_far is not None else -999
        
        probs = {}
        for n in candidates:
            if n < min_possible_wu:
                continue  # 已实测超过此温度，不可能结算在这里
            p = _norm_cdf(n + 0.5, mu, sigma) - _norm_cdf(n - 0.5, mu, sigma)
            if p > 0.01:
                probs[n] = p
        
        # 归一化
        total_p = sum(probs.values())
        if total_p > 0:
            probs = {k: v / total_p for k, v in probs.items()}
        
        # 格式化输出（按概率从高到低排列，显示区间）
        sorted_probs = sorted(probs.items(), key=lambda x: x[1], reverse=True)
        prob_parts = [f"{int(t)}{temp_symbol} [{t-0.5}~{t+0.5}) {p*100:.0f}%" for t, p in sorted_probs[:4]]
        if prob_parts:
            prob_str = " | ".join(prob_parts)
            insights.append(f"🎲 <b>结算概率</b> (μ={mu:.1f})：{prob_str}")
            ai_features.append(f"🎲 数学概率分布：{prob_str}")

    # === 实测已超预报 & 趋势输出 ===
    if max_so_far is not None and forecast_high is not None:
        if max_so_far > forecast_high + 0.5:
            exceed_by = max_so_far - forecast_high
            bt_msg = f"🚨 <b>实测已超预报</b>：{max_so_far}{temp_symbol} 超过上限 {forecast_high}{temp_symbol}（+{exceed_by:.1f}°）。"
            insights.append(bt_msg)
            ai_features.append(f"🚨 异常: 实测已冲破所有预报上限 ({max_so_far}{temp_symbol} vs {forecast_high}{temp_symbol})。")
            if trend_desc: ai_features.append(trend_desc)
        else:
            if trend_desc:
                ai_features.append(trend_desc)
    elif trend_desc:
        ai_features.append(trend_desc)

    # === 结算取整分析 ===
    if max_so_far is not None:
        settled = round(max_so_far)
        fractional = max_so_far - int(max_so_far)
        dist_to_boundary = abs(fractional - 0.5)
        if dist_to_boundary <= 0.3:
            if fractional < 0.5:
                msg = f"⚖️ <b>结算边界</b>：当前最高 {max_so_far}{temp_symbol} → WU 结算 <b>{settled}{temp_symbol}</b>，但只差 <b>{0.5 - fractional:.1f}°</b> 就会进位到 {settled + 1}{temp_symbol}！"
            else:
                msg = f"⚖️ <b>结算边界</b>：当前最高 {max_so_far}{temp_symbol} → WU 结算 <b>{settled}{temp_symbol}</b>，刚刚越过进位线，再降 <b>{fractional - 0.5:.1f}°</b> 就会回落到 {settled - 1}{temp_symbol}。"
            insights.append(msg)
            ai_features.append(msg)

    # === 峰值时刻预测 (只在还没过峰值时显示) ===
    peak_hours = []
    if times and temps and om_today is not None:
        for t_str, temp in zip(times, temps):
            if t_str.startswith(local_date_str) and abs(temp - om_today) <= 0.2:
                peak_hours.append(t_str.split("T")[1][:5])
                
    if peak_hours:
        first_peak_h = int(peak_hours[0].split(":")[0])
        last_peak_h = int(peak_hours[-1].split(":")[0])
        window = f"{peak_hours[0]} - {peak_hours[-1]}" if len(peak_hours) > 1 else peak_hours[0]
        
        if local_hour <= last_peak_h:
            if last_peak_h < 6:
                ai_features.append(f"⚠️ <b>提示</b>：预测最热在凌晨，后续气温可能一路走低。")
            elif local_hour < first_peak_h and (max_so_far is None or max_so_far < forecast_high):
                target_temp = om_today if om_today is not None else forecast_high
                ai_features.append(f"🎯 <b>关注重点</b>：看看那个时段能否涨到 {target_temp}{temp_symbol}。")
                
        # 写给AI（使用精确到分钟的时间）
        remain_hrs = first_peak_h - local_hour_frac
        if local_hour_frac > last_peak_h: ai_features.append(f"⏱️ 状态: 预报峰值时段已过 ({window})。")
        elif first_peak_h <= local_hour_frac <= last_peak_h: ai_features.append(f"⏱️ 状态: 正处于预报最热窗口 ({window})内。")
        elif remain_hrs < 1: ai_features.append(f"⏱️ 状态: 距最热时段仅剩约 {int(remain_hrs * 60)} 分钟 ({window})。")
        else: ai_features.append(f"⏱️ 状态: 距最热时段还有约 {remain_hrs:.1f}h ({window})。")
    else:
        first_peak_h, last_peak_h = 13, 15

    # === 其他 AI 专供的事实特征 ===
    # 明确告知 AI 当前实测温度和今日最高温，避免 AI 从趋势数据中误读
    current_temp = metar.get("current", {}).get("temp")
    if current_temp is not None:
        ai_features.append(f"🌡️ 当前实测温度: {current_temp}{temp_symbol}。")
    if max_so_far is not None:
        ai_features.append(f"🏔️ 今日实测最高温: {max_so_far}{temp_symbol} (WU结算={round(max_so_far)}{temp_symbol})。")
    
    # 传递城市的 METAR 取整特性给 AI
    from src.data_collection.city_risk_profiles import get_city_risk_profile
    if city_name:
        _profile = get_city_risk_profile(city_name)
        if _profile and _profile.get("metar_rounding"):
            ai_features.append(f"⚠️ METAR特性: {_profile['metar_rounding']}")
    if wind_speed:
        wind_dir = metar.get("current", {}).get("wind_dir", "未知")
        ai_features.append(f"🌬️ 当下风况: 约 {wind_speed}kt (方向 {wind_dir}°)。")
    humidity = metar.get("current", {}).get("humidity")
    if humidity and humidity > 80: ai_features.append(f"💦 湿度极高 ({humidity}%)。")
    
    clouds = metar.get("current", {}).get("clouds", [])
    if clouds:
        cover = clouds[-1].get("cover", "")
        c_desc = {"OVC": "全阴", "BKN": "多云", "SCT": "散云", "FEW": "少云"}.get(cover, cover)
        ai_features.append(f"☁️ 天空状况: {c_desc}。")

    wx_desc = metar.get("current", {}).get("wx_desc")
    if wx_desc: ai_features.append(f"🌧️ 天气现象: {wx_desc}。")

    max_temp_time_str = metar.get("current", {}).get("max_temp_time", "")
    if max_so_far is not None and max_temp_time_str:
        try:
            max_h = int(max_temp_time_str.split(":")[0])
            max_temp_rad = 0.0
            hourly_rad = hourly.get("shortwave_radiation", [])
            for t_str, rad in zip(times, hourly_rad):
                if t_str.startswith(local_date_str) and int(t_str.split("T")[1][:2]) == max_h:
                    max_temp_rad = rad if rad is not None else 0.0
                    break
            if max_temp_rad < 50:
                ai_features.append(f"🌙 动力事实: 最高温出现在低辐射时段 ({max_temp_time_str}, 辐射{max_temp_rad:.0f}W/m²)。")
        except: pass

    display_str = "\n".join(insights) if insights else ""
    return display_str, "\n".join(ai_features)

def start_bot():
    config = load_config()
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        logger.error("未找到 TELEGRAM_BOT_TOKEN 环境变量")
        return

    bot = telebot.TeleBot(token)
    weather = WeatherDataCollector(config)

    @bot.message_handler(commands=["start", "help"])
    def send_welcome(message):
        welcome_text = (
            "🌡️ <b>PolyWeather 天气查询机器人</b>\n\n"
            "可用指令:\n"
            "/city [城市名] - 查询城市天气预测与实测\n"
            "/id - 获取当前聊天的 Chat ID\n\n"
            "示例: <code>/city 伦敦</code>"
        )
        bot.reply_to(message, welcome_text, parse_mode="HTML")

    @bot.message_handler(commands=["id"])
    def get_chat_id(message):
        bot.reply_to(
            message,
            f"🎯 当前聊天的 Chat ID 是: <code>{message.chat.id}</code>",
            parse_mode="HTML",
        )

    @bot.message_handler(commands=["city"])
    def get_city_info(message):
        """查询指定城市的天气详情"""
        try:
            parts = message.text.split(maxsplit=1)
            if len(parts) < 2:
                bot.reply_to(
                    message,
                    "❓ 请输入城市名称\n\n用法: <code>/city chicago</code>",
                    parse_mode="HTML",
                )
                return

            city_input = parts[1].strip().lower()
            
            # --- 核心标准名称映射表 ---
            # 这里的 Key 是缩写或别名，Value 是 Open-Meteo 识别的标准全称
            STANDARD_MAPPING = {
                "sel": "seoul", "seo": "seoul", "首尔": "seoul",
                "lon": "london", "伦敦": "london",
                "tor": "toronto", "多伦多": "toronto",
                "ank": "ankara", "安卡拉": "ankara",
                "wel": "wellington", "惠灵顿": "wellington",
                "ba": "buenos aires", "布宜诺斯艾利斯": "buenos aires",
                "nyc": "new york", "ny": "new york", "纽约": "new york",
                "chi": "chicago", "芝加哥": "chicago",
                "sea": "seattle", "西雅图": "seattle",
                "mia": "miami", "迈阿密": "miami",
                "atl": "atlanta", "亚特兰大": "atlanta",
                "dal": "dallas", "达拉斯": "dallas",
                "la": "los angeles", "洛杉矶": "los angeles",
                "par": "paris", "巴黎": "paris",
            }
            
            # 支持的城市全名列表（用于模糊匹配）
            SUPPORTED_CITIES = list(set(STANDARD_MAPPING.values()))
            
            # 1. 第一优先级：严格全字匹配（别名/缩写）
            city_name = STANDARD_MAPPING.get(city_input)
            
            # 2. 第二优先级：输入本身就是城市全名
            if not city_name and city_input in SUPPORTED_CITIES:
                city_name = city_input
            
            # 3. 第三优先级：前缀匹配（在别名和城市全名中搜索）
            if not city_name and len(city_input) >= 2:
                # 先搜别名
                for k, v in STANDARD_MAPPING.items():
                    if k.startswith(city_input):
                        city_name = v
                        break
                # 再搜城市全名
                if not city_name:
                    for full_name in SUPPORTED_CITIES:
                        if full_name.startswith(city_input):
                            city_name = full_name
                            break
            
            # 4. 未找到 → 报错，列出支持的城市
            if not city_name:
                city_list = ", ".join(sorted(set(STANDARD_MAPPING.values())))
                bot.reply_to(
                    message,
                    f"❌ 未找到城市: <b>{city_input}</b>\n\n"
                    f"支持的城市: {city_list}\n\n"
                    f"也可以用缩写，如 <code>/city dal</code> 查达拉斯",
                    parse_mode="HTML",
                )
                return

            bot.send_message(message.chat.id, f"🔍 正在查询 {city_name.title()} 的天气数据...")

            coords = weather.get_coordinates(city_name)
            if not coords:
                bot.reply_to(message, f"❌ 未找到城市坐标: {city_name}")
                return

            weather_data = weather.fetch_all_sources(city_name, lat=coords["lat"], lon=coords["lon"])
            open_meteo = weather_data.get("open-meteo", {})
            metar = weather_data.get("metar", {})
            mgm = weather_data.get("mgm", {})
            
            temp_unit = open_meteo.get("unit", "celsius")
            temp_symbol = "°F" if temp_unit == "fahrenheit" else "°C"
            
            # --- 1. 紧凑 Header (城市 + 时间 + 风险状态) ---
            local_time = open_meteo.get("current", {}).get("local_time", "")
            time_str = local_time.split(" ")[1][:5] if " " in local_time else "N/A"
            
            risk_profile = get_city_risk_profile(city_name)
            risk_emoji = risk_profile.get("risk_level", "⚪") if risk_profile else "⚪"
            
            msg_header = f"📍 <b>{city_name.title()}</b> ({time_str}) {risk_emoji}"
            msg_lines = [msg_header]
            
            # --- 2. 紧凑 风险提示 ---
            if risk_profile:
                bias = risk_profile.get("bias", "±0.0")
                msg_lines.append(f"⚠️ {risk_profile.get('airport_name', '')}: {bias}{temp_symbol} | {risk_profile.get('warning', '')}")

            # --- 3. 紧凑 预测区 ---
            daily = open_meteo.get("daily", {})
            dates = daily.get("time", [])[:3]
            max_temps = daily.get("temperature_2m_max", [])[:3]
            
            nws_high = weather_data.get("nws", {}).get("today_high")
            mgm_high = mgm.get("today_high")
            mb_high = weather_data.get("meteoblue", {}).get("today_high")
            
            # 今天对比
            today_t = max_temps[0] if max_temps else "N/A"
            comp_parts = []
            sources = ["Open-Meteo"]
            
            if mb_high is not None:
                sources.append("MB")
                comp_parts.append(f"MB: {mb_high:.1f}{temp_symbol}" if isinstance(mb_high, (int, float)) else f"MB: {mb_high}")
            if nws_high is not None:
                sources.append("NWS")
                comp_parts.append(f"NWS: {nws_high:.1f}{temp_symbol}" if isinstance(nws_high, (int, float)) else f"NWS: {nws_high}")
            if mgm_high is not None:
                sources.append("MGM")
                comp_parts.append(f"MGM: {mgm_high:.1f}{temp_symbol}" if isinstance(mgm_high, (int, float)) else f"MGM: {mgm_high}")
            
            # 检查是否有显著分歧 (超过 5°F 或 2.5°C)
            divergence_warning = ""
            if mb_high is not None and max_temps:
                diff = abs(mb_high - max_temps[0])
                threshold = 5.0 if temp_unit == "fahrenheit" else 2.5
                if diff > threshold:
                    divergence_warning = f" ⚠️ <b>模型显著分歧 ({diff:.1f}{temp_symbol})</b>"
            
            comp_str = f" ({' | '.join(comp_parts)})" if comp_parts else ""
            sources_str = " | ".join(sources)
            
            msg_lines.append(f"\n📊 <b>预报 ({sources_str})</b>")
            msg_lines.append(f"👉 <b>今天: {today_t}{temp_symbol}{comp_str}</b>{divergence_warning}")
            
            # 明后天
            if len(dates) > 1:
                future_forecasts = []
                for d, t in zip(dates[1:], max_temps[1:]):
                    future_forecasts.append(f"{d[5:]}: {t}{temp_symbol}")
                msg_lines.append("📅 " + " | ".join(future_forecasts))

            # --- 3.5 日出日落 + 日照时长 ---
            sunrises = daily.get("sunrise", [])
            sunsets = daily.get("sunset", [])
            sunshine_durations = daily.get("sunshine_duration", [])
            if sunrises and sunsets:
                sunrise_t = sunrises[0].split("T")[1][:5] if "T" in str(sunrises[0]) else sunrises[0]
                sunset_t = sunsets[0].split("T")[1][:5] if "T" in str(sunsets[0]) else sunsets[0]
                sun_line = f"🌅 日出 {sunrise_t} | 🌇 日落 {sunset_t}"
                if sunshine_durations:
                    sunshine_hours = sunshine_durations[0] / 3600  # 秒 -> 小时
                    sun_line += f" | ☀️ 日照 {sunshine_hours:.1f}h"
                msg_lines.append(sun_line)

            # --- 4. 核心 实测区 (合并 METAR 和 MGM) ---
            # 基础数据优先用 METAR
            cur_temp = metar.get("current", {}).get("temp") if metar else mgm.get("current", {}).get("temp")
            max_p = metar.get("current", {}).get("max_temp_so_far") if metar else None
            max_p_time = metar.get("current", {}).get("max_temp_time") if metar else None
            obs_t_str = "N/A"
            metar_age_min = None  # METAR 数据年龄（分钟）
            main_source = "METAR" if metar else "MGM"
            
            if metar:
                obs_t = metar.get("observation_time", "")
                try:
                    if "T" in obs_t:
                        from datetime import datetime, timezone, timedelta
                        dt = datetime.fromisoformat(obs_t.replace("Z", "+00:00"))
                        utc_offset = open_meteo.get("utc_offset", 0)
                        local_dt = dt.astimezone(timezone(timedelta(seconds=utc_offset)))
                        obs_t_str = local_dt.strftime("%H:%M")
                        # 计算数据年龄
                        now_utc = datetime.now(timezone.utc)
                        metar_age_min = int((now_utc - dt).total_seconds() / 60)
                    elif " " in obs_t:
                        obs_t_str = obs_t.split(" ")[1][:5]
                    else:
                        obs_t_str = obs_t
                except:
                    obs_t_str = obs_t[:16]
            elif mgm:
                m_time = mgm.get("current", {}).get("time", "")
                if "T" in m_time:
                    from datetime import datetime, timezone, timedelta
                    dt = datetime.fromisoformat(m_time.replace("Z", "+00:00"))
                    m_time = dt.astimezone(timezone(timedelta(hours=3))).strftime("%H:%M")
                elif " " in m_time:
                    m_time = m_time.split(" ")[1][:5]
                obs_t_str = m_time

            # 数据年龄标注
            age_tag = ""
            if metar_age_min is not None:
                if metar_age_min >= 60:
                    age_tag = f" ⚠️{metar_age_min}分钟前"
                elif metar_age_min >= 30:
                    age_tag = f" ⏳{metar_age_min}分钟前"

            max_str = ""
            if max_p is not None:
                import math
                settled_val = math.floor(max_p + 0.5)
                max_str = f" (最高: {max_p}{temp_symbol}"
                if max_p_time:
                    max_str += f" @{max_p_time}"
                max_str += f" → WU {settled_val}{temp_symbol})"

            # --- 天气状况总结 ---
            wx_summary = ""
            # 优先使用 METAR 天气现象
            metar_wx = metar.get("current", {}).get("wx_desc", "") if metar else ""
            metar_clouds = metar.get("current", {}).get("clouds", []) if metar else []
            mgm_cloud = mgm.get("current", {}).get("cloud_cover") if mgm else None

            if metar_wx:
                wx_upper = metar_wx.upper().strip()
                wx_tokens = set(wx_upper.split())
                rain_codes = {"RA", "DZ", "-RA", "+RA", "-DZ", "+DZ", "TSRA", "SHRA", "FZRA"}
                snow_codes = {"SN", "GR", "GS", "-SN", "+SN", "BLSN"}
                fog_codes = {"FG", "BR", "HZ", "FZFG"}
                ts_codes = {"TS", "TSRA"}
                if ts_codes & wx_tokens:
                    wx_summary = "⛈️ 雷暴"
                elif {"+RA", "+SN"} & wx_tokens:
                    wx_summary = "🌧️ 大雨" if "+RA" in wx_tokens else "❄️ 大雪"
                elif rain_codes & wx_tokens:
                    wx_summary = "🌧️ 小雨" if {"-RA", "-DZ", "DZ"} & wx_tokens else "🌧️ 下雨"
                elif snow_codes & wx_tokens:
                    wx_summary = "❄️ 下雪"
                elif fog_codes & wx_tokens:
                    wx_summary = "🌫️ 雾/霾"

            # 如果 METAR 没有特殊现象，用云量推断
            if not wx_summary:
                # 优先 METAR 云层，回退 MGM
                cover_code = ""
                if metar_clouds:
                    cover_code = metar_clouds[-1].get("cover", "")
                
                if cover_code in ("SKC", "CLR") or (cover_code == "" and mgm_cloud is not None and mgm_cloud <= 1):
                    wx_summary = "☀️ 晴"
                elif cover_code == "FEW" or (cover_code == "" and mgm_cloud is not None and mgm_cloud <= 2):
                    wx_summary = "🌤️ 晴间少云"
                elif cover_code == "SCT" or (cover_code == "" and mgm_cloud is not None and mgm_cloud <= 4):
                    wx_summary = "⛅ 晴间多云"
                elif cover_code == "BKN" or (cover_code == "" and mgm_cloud is not None and mgm_cloud <= 6):
                    wx_summary = "🌥️ 多云"
                elif cover_code == "OVC" or (cover_code == "" and mgm_cloud is not None and mgm_cloud <= 8):
                    wx_summary = "☁️ 阴天"
                elif mgm_cloud is not None:
                    cloud_names = {0: "☀️ 晴", 1: "🌤️ 晴", 2: "🌤️ 少云", 3: "⛅ 散云", 4: "⛅ 散云", 5: "🌥️ 多云", 6: "🌥️ 多云", 7: "☁️ 阴", 8: "☁️ 阴天"}
                    wx_summary = cloud_names.get(mgm_cloud, "")

            wx_display = f" {wx_summary}" if wx_summary else ""
            msg_lines.append(f"\n✈️ <b>实测 ({main_source}): {cur_temp}{temp_symbol}</b>{max_str} |{wx_display} | {obs_t_str}{age_tag}")




            if mgm:
                m_c = mgm.get("current", {})
                # 翻译风向
                wind_dir = m_c.get("wind_dir")
                wind_speed_ms = m_c.get("wind_speed_ms")
                dir_str = ""
                if wind_dir is not None:
                    dirs = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"]
                    dir_str = dirs[int((float(wind_dir) + 22.5) % 360 / 45)] + "风 "
                
                # 体感和湿度（跳过缺失数据）
                feels_like = m_c.get("feels_like")
                humidity = m_c.get("humidity")
                if feels_like is not None or humidity is not None:
                    parts = []
                    if feels_like is not None: parts.append(f"🌡️ 体感: {feels_like}°C")
                    if humidity is not None: parts.append(f"💧 {humidity}%")
                    msg_lines.append(f"   [MGM] {' | '.join(parts)}")
                
                # 风况（跳过缺失数据）
                if wind_dir is not None and wind_speed_ms is not None:
                    msg_lines.append(f"   [MGM] 🌬️ {dir_str}{wind_dir}° ({wind_speed_ms} m/s) | 💧 降水: {m_c.get('rain_24h') or 0}mm")
                
                # 新增：气压和云量
                extra_parts = []
                pressure = m_c.get("pressure")
                if pressure is not None:
                    extra_parts.append(f"🌡 气压: {pressure}hPa")
                cloud_cover = m_c.get("cloud_cover")
                if cloud_cover is not None:
                    cloud_desc_map = {0: "晴朗", 1: "少云", 2: "少云", 3: "散云", 4: "散云", 5: "多云", 6: "多云", 7: "很多云", 8: "阴天"}
                    cloud_text = cloud_desc_map.get(cloud_cover, f"{cloud_cover}/8")
                    extra_parts.append(f"☁️ 云量: {cloud_text}({cloud_cover}/8)")
                mgm_max = m_c.get("mgm_max_temp")
                if mgm_max is not None:
                    extra_parts.append(f"🌡️ MGM最高: {mgm_max}°C")
                if extra_parts:
                    msg_lines.append(f"   [MGM] {' | '.join(extra_parts)}")
            
            if metar:
                m_c = metar.get("current", {})
                wind = m_c.get("wind_speed_kt")
                wind_dir = m_c.get("wind_dir")
                vis = m_c.get("visibility_mi")
                clouds = m_c.get("clouds", [])
                
                cloud_desc = ""
                if clouds:
                    c_map = {"BKN": "多云", "OVC": "阴天", "FEW": "少云", "SCT": "散云", "SKC": "晴", "CLR": "晴"}
                    main = clouds[-1]
                    cloud_desc = f"☁️ {c_map.get(main.get('cover'), main.get('cover'))}"

                prefix = "[METAR]" if mgm else "   "
                if not mgm:
                    msg_lines.append(f"   {prefix} 💨 {wind or 0}kt ({wind_dir or 0}°) | 👁️ {vis or 10}mi")
                
                if cloud_desc:
                    msg_lines.append(f"   {prefix} {cloud_desc} | 👁️ {vis or 10}mi | 💨 {wind or 0}kt")

            # --- 5. 态势特征提取 ---
            feature_str, ai_context = analyze_weather_trend(weather_data, temp_symbol, city_name)
            if feature_str:
                # 仅将最核心的信息展示给用户作为"态势分析"
                # 但后面会把更全的数据传给 AI
                msg_lines.append(f"\n💡 <b>分析</b>:")
                for line in feature_str.split("\n"):
                    if line.strip():
                        msg_lines.append(f"- {line.strip()}")

                # --- 6. Groq AI 深度分析 ---
                try:
                    from src.analysis.ai_analyzer import get_ai_analysis
                    # 构建更全的背景数据给 AI
                    
                    # 补充多模型分歧
                    mm = weather_data.get("multi_model", {})
                    if mm.get("forecasts"):
                        mm_str = " | ".join([f"{k}:{v}{temp_symbol}" for k,v in mm["forecasts"].items() if v])
                        ai_context += f"\n模型分歧: {mm_str}"

                    ai_result = get_ai_analysis(ai_context, city_name, temp_symbol)
                    if ai_result:
                        msg_lines.append(f"\n{ai_result}")
                except Exception as e:
                    logger.error(f"调用 Groq AI 分析失败: {e}")

            bot.send_message(message.chat.id, "\n".join(msg_lines), parse_mode="HTML")

        except Exception as e:
            logger.error(f"查询失败: {e}")
            bot.reply_to(message, f"❌ 查询失败: {e}")

    logger.info("🤖 Bot 启动中...")
    bot.infinity_polling()

if __name__ == "__main__":
    start_bot()
