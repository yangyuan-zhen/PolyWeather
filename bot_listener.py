import sys
import os
from datetime import datetime
import telebot
from loguru import logger

# 确保项目根目录在 sys.path 中
project_root = os.path.dirname(os.path.abspath(__file__))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from src.utils.config_loader import load_config
from src.data_collection.weather_sources import WeatherDataCollector
from src.data_collection.city_risk_profiles import get_city_risk_profile, format_risk_warning

def analyze_weather_trend(weather_data, temp_symbol):
    """根据实测与预测分析气温态势，增加峰值时刻预测"""
    insights = []
    
    metar = weather_data.get("metar", {})
    open_meteo = weather_data.get("open-meteo", {})
    mb = weather_data.get("meteoblue", {})
    nws = weather_data.get("nws", {})
    mgm = weather_data.get("mgm", {})
    
    if not metar or not open_meteo:
        return ""
        
    curr_temp = metar.get("current", {}).get("temp")
    max_so_far = metar.get("current", {}).get("max_temp_so_far")  # 今日实测最高
    daily = open_meteo.get("daily", {})
    
    # === 核心：整合多源预报最高温 ===
    forecast_highs = [daily.get("temperature_2m_max", [None])[0]]
    if mb.get("today_high") is not None:
        forecast_highs.append(mb["today_high"])
    if nws.get("today_high") is not None:
        forecast_highs.append(nws["today_high"])
    if mgm.get("today_high") is not None:
        forecast_highs.append(mgm["today_high"])
    
    forecast_highs = [h for h in forecast_highs if h is not None]
    # 取预报中的最高值作为风险防御基准
    forecast_high = max(forecast_highs) if forecast_highs else None
    # 取最低值用于判断是否“已触及预报高位”
    min_forecast_high = min(forecast_highs) if forecast_highs else forecast_high
    
    wind_speed = metar.get("current", {}).get("wind_speed_kt", 0)
    
    # 获取当地时间小时
    local_time_full = open_meteo.get("current", {}).get("local_time", "")
    try:
        local_date_str = local_time_full.split(" ")[0] # YYYY-MM-DD
        local_hour = int(local_time_full.split(" ")[1].split(":")[0])
    except:
        local_date_str = datetime.now().strftime("%Y-%m-%d")
        local_hour = datetime.now().hour

    # === 核心判断：实测是否已超预报 ===
    is_breakthrough = False
    if max_so_far is not None and forecast_high is not None:
        if max_so_far > forecast_high + 0.5:
            is_breakthrough = True
            exceed_by = max_so_far - forecast_high
            insights.append(f"🚨 <b>预报已被击穿</b>：实测最高 {max_so_far}{temp_symbol} 已超所有预报上限 {forecast_high}{temp_symbol} 约 {exceed_by:.1f}°！")
            insights.append(f"💡 <b>建议</b>：市场需重新评估，当前可能存在物理层面的超预期增温。")

    # --- 峰值时刻预测逻辑 (仍以 Open-Meteo 逐小时数据为准) ---
    hourly = open_meteo.get("hourly", {})
    times = hourly.get("time", [])
    temps = hourly.get("temperature_2m", [])
    
    peak_hours = []
    om_high = daily.get("temperature_2m_max", [None])[0]
    if times and temps and om_high is not None:
        for t_str, temp in zip(times, temps):
            if t_str.startswith(local_date_str):
                if abs(temp - om_high) <= 0.2:
                    hour = t_str.split("T")[1][:5]
                    peak_hours.append(hour)
        
        if peak_hours:
            window = f"{peak_hours[0]} - {peak_hours[-1]}" if len(peak_hours) > 1 else peak_hours[0]
            insights.append(f"⏱️ <b>预计峰值时刻</b>：今天 <b>{window}</b> 之间。")
            # 只有在还没进入峰值时段且还没达到预报高点时才给这个建议
            if local_hour < int(peak_hours[0].split(":")[0]) and (max_so_far is None or max_so_far < forecast_high):
                insights.append(f"🎯 <b>博弈建议</b>：关注该时段实测能否站稳 {forecast_high}{temp_symbol}。")

    is_peak_passed = False
    if curr_temp is not None and forecast_high is not None:
        diff_max = forecast_high - curr_temp
        
        # 1. 气温节奏判定 (动态参考峰值时刻)
        last_peak_h = int(peak_hours[-1].split(":")[0]) if peak_hours else 15
        first_peak_h = int(peak_hours[0].split(":")[0]) if peak_hours else 13
        
        if local_hour > last_peak_h:
            # 已经过了预报的峰值时段
            is_peak_passed = True
            if is_breakthrough:
                insights.append(f"🌡️ <b>超常规表现</b>：虽然时间已过预报峰值，但气温击穿上限后仍维持在高位，需警惕降温推迟。")
            # 如果实测已经接近“任一”主流预报的最高温 (使用 min_forecast_high)
            elif max_so_far and max_so_far >= min_forecast_high - 0.5:
                insights.append(f"✅ <b>今日峰值已过</b>：气温已触及或接近预报最高，目前处于高位波动或缓慢回落。")
            else:
                # 虽然时间过了，但离最高温还有差距
                insights.append(f"📉 <b>处于降温期</b>：已过预报峰值时段，且当前气温乏力 ({curr_temp}{temp_symbol})，冲击最高预报 {forecast_high}{temp_symbol} 的概率降低。")
        elif first_peak_h <= local_hour <= last_peak_h:
            # 正在峰值窗口内
            if is_breakthrough:
                insights.append(f"🔥 <b>狂暴拉升</b>：正处于预测峰值时段，实测正以前所未有的态势压制所有预报，上限已失守。")
            elif diff_max <= 0.8:
                insights.append(f"⚖️ <b>高位横盘</b>：正处于预测峰值时段，气温将在当前水平小幅波动。")
            else:
                insights.append(f"⏳ <b>峰值窗口中</b>：虽在预报高点时段，但目前仍有差距，紧盯最后冲刺。")
        elif local_hour < first_peak_h:
            # 还没到峰值窗口
            if diff_max > 1.2:
                insights.append(f"📈 <b>升温进程中</b>：距离峰值时段还有 {first_peak_h - local_hour}h，正向高点冲击。")
            else:
                insights.append(f"🌅 <b>临近峰值</b>：即将进入高点时段，气温已处于预报高位。")
        else:
            # 回退逻辑
            insights.append(f"🌌 <b>夜间/早间</b>：等待日出后的新一轮波动。")

        # 2. 湿度与露点分析 (仅在傍晚以后)
        humidity = metar.get("current", {}).get("humidity")
        dewpoint = metar.get("current", {}).get("dewpoint")
        
        if local_hour >= 18:
            if humidity and humidity > 80:
                insights.append(f"💦 <b>闷热高湿</b>：湿度极高 ({humidity}%)，将显著锁住夜间热量。")
            if dewpoint is not None and curr_temp - dewpoint < 2.0:
                insights.append(f"🌡️ <b>触及露点支撑</b>：气温已跌至露点支撑位，降温将变慢。")

        # 3. 风力
        if wind_speed >= 15:
            insights.append(f"🌬️ <b>大风预判</b>：当前风力较大 ({wind_speed}kt)，气温可能出现非线性波动。")
        elif wind_speed >= 10:
            insights.append(f"🍃 <b>清劲风</b>：空气流动快，虽然有助于散热，但在升温期可能带来暖平流加速。")

        # 4. 云层遮挡分析 (仅在升温期/峰值期有意义)
        clouds = metar.get("current", {}).get("clouds", [])
        if clouds and local_hour <= last_peak_h + 1:
            main_cloud = clouds[-1]
            cover = main_cloud.get("cover", "")
            if cover == "OVC":
                insights.append(f"☁️ <b>全阴锁温</b>：机场上空完全遮挡，阳光增温几乎停滞，很难再冲高点。")
            elif cover == "BKN":
                insights.append(f"🌥️ <b>云层显著</b>：天空大部被遮挡，日照受限，升温斜率受阻。")
            elif cover in ["SKC", "CLR", "FEW"]:
                if not is_peak_passed:
                    insights.append(f"☀️ <b>晴空万里</b>：日照强烈，无云层遮挡，气温有冲向预报上限甚至超出的动能。")

        # 5. 特殊天气现象
        wx_desc = metar.get("current", {}).get("wx_desc")
        if wx_desc:
            if any(x in wx_desc.upper() for x in ["RA", "DZ", "RAIN", "DRIZZLE"]):
                insights.append(f"🌧️ <b>降雨压制</b>：当前有降雨，蒸发吸热将显著抑制升温。")
            elif any(x in wx_desc.upper() for x in ["SN", "SNOW", "GR", "GS"]):
                insights.append(f"❄️ <b>固态降水</b>：正在降雪或冰雹，气温将持续低迷。")
            elif any(x in wx_desc.upper() for x in ["FG", "BR", "HZ", "FOG", "MIST"]):
                insights.append(f"🌫️ <b>能见度受限</b>：当前有雾/霭，阻挡阳光并带来高湿，会大幅延缓升温周期。")

        # 6. 风向平流分析 (仅在未进入降温期前显示)
        if not is_peak_passed or local_hour <= last_peak_h + 2:
            try:
                wind_dir = float(metar.get("current", {}).get("wind_dir", 0))
                # 北半球简化逻辑：北风 cold，南风 warm
                if 315 <= wind_dir or wind_dir <= 45:
                    insights.append(f"🌬️ <b>偏北风</b>：冷空气处于主导地位，午后增温阻力较大。")
                elif 135 <= wind_dir <= 225:
                    # 只有在当前温度离最高预测还有距离时，或者已经击穿但还在上升时，南风才有意义
                    if diff_max > 0.5 or (is_breakthrough and curr_temp >= max_so_far):
                        if is_peak_passed and not is_breakthrough:
                            insights.append(f"🔥 <b>偏南风</b>：存在暖平流支撑，但已过传统峰值时段，冲击上限 {forecast_high}{temp_symbol} 的动能正在衰减。")
                        else:
                            status = "气温仍有向上突围的潜力" if not is_breakthrough else "可能推高击穿后的极端高位"
                            insights.append(f"🔥 <b>偏南风</b>：正从低纬度输送暖平流，{status}。")
            except (TypeError, ValueError):
                pass

        try:
            visibility = metar.get("current", {}).get("visibility_mi")
            if visibility is not None:
                vis_val = float(str(visibility).replace("+", "").replace("-", ""))
                if vis_val < 3 and local_hour <= 11:
                    insights.append(f"🌫️ <b>早晨低见度</b>：能见度极差 ({vis_val}mi)，阳光无法打透，早间升温将非常缓慢。")
        except (TypeError, ValueError):
            pass

        # 7. 模型准确度预警 (针对用户反馈的 MB 偏高问题)
        if is_peak_passed and max_so_far is not None:
            model_checks = []
            if om_high and om_high > max_so_far + 1.5:
                model_checks.append(f"Open-Meteo ({om_high}{temp_symbol})")
            mb_h = mb.get("today_high")
            if mb_h and mb_h > max_so_far + 1.5:
                model_checks.append(f"Meteoblue ({mb_h}{temp_symbol})")
            nws_h = nws.get("today_high")
            if nws_h and nws_h > max_so_far + 1.5:
                model_checks.append(f"NWS ({nws_h}{temp_symbol})")
            
            if model_checks:
                insights.append(f"⚠️ <b>预报偏高</b>：目前实测远低于 " + "、".join(model_checks) + "，判定预报模型今日表现过度乐观。")


    if not insights:
        return ""
        
    return "\n💡 <b>态势分析</b>\n" + "\n".join(insights)

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

    @bot.message_handler(commands=["signal", "portfolio", "status"])
    def disabled_feature(message):
        bot.reply_to(message, "ℹ️ 监控引擎与交易模拟功能已暂停，现仅提供天气查询服务。")

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
            }
            
            # 1. 第一优先级：严格全字匹配
            city_name = STANDARD_MAPPING.get(city_input)
            
            # 2. 第二优先级：如果长度 >= 3，尝试前缀匹配
            if not city_name and len(city_input) >= 3:
                for k, v in STANDARD_MAPPING.items():
                    if k.startswith(city_input):
                        city_name = v
                        break
            
            # 3. 最终回退
            if not city_name:
                city_name = city_input

            bot.send_message(message.chat.id, f"🔍 正在查询 {city_name.title()} 的天气数据...")

            coords = weather.get_coordinates(city_name)
            if not coords:
                bot.reply_to(message, f"❌ 未找到城市: {city_name}")
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

            # --- 4. 核心 实测区 (合并 METAR 和 MGM) ---
            # 基础数据优先用 METAR
            cur_temp = metar.get("current", {}).get("temp") if metar else mgm.get("current", {}).get("temp")
            max_p = metar.get("current", {}).get("max_temp_so_far") if metar else None
            obs_t_str = "N/A"
            main_source = "METAR" if metar else "MGM"
            
            if metar:
                obs_t = metar.get("observation_time", "")
                try:
                    if "T" in obs_t:
                        # 处理 ISO 格式 2026-02-08T09:46:00.000Z
                        from datetime import datetime, timezone, timedelta
                        dt = datetime.fromisoformat(obs_t.replace("Z", "+00:00"))
                        # 转换为当地时间
                        utc_offset = open_meteo.get("utc_offset", 0)
                        local_dt = dt.astimezone(timezone(timedelta(seconds=utc_offset)))
                        obs_t_str = local_dt.strftime("%H:%M")
                    elif " " in obs_t:
                        obs_t_str = obs_t.split(" ")[1][:5]
                    else:
                        obs_t_str = obs_t
                except:
                    obs_t_str = obs_t[:16] # 备选逻辑
            elif mgm:
                m_time = mgm.get("current", {}).get("time", "")
                if "T" in m_time:
                    from datetime import datetime, timezone, timedelta
                    dt = datetime.fromisoformat(m_time.replace("Z", "+00:00"))
                    m_time = dt.astimezone(timezone(timedelta(hours=3))).strftime("%H:%M")
                elif " " in m_time:
                    m_time = m_time.split(" ")[1][:5]
                obs_t_str = m_time

            msg_lines.append(f"\n✈️ <b>实测 ({main_source}): {cur_temp}{temp_symbol}</b>" + (f" (最高: {max_p}{temp_symbol})" if max_p else "") + f" | {obs_t_str}")

            if mgm:
                m_c = mgm.get("current", {})
                # 翻译风向
                wind_dir = m_c.get("wind_dir")
                dir_str = ""
                if wind_dir is not None:
                    dirs = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"]
                    dir_str = dirs[int((float(wind_dir) + 22.5) % 360 / 45)] + "风 "
                
                msg_lines.append(f"   [MGM] 🌡️ 体感: {m_c.get('feels_like')}°C | 💧 {m_c.get('humidity')}%")
                msg_lines.append(f"   [MGM] 🌬️ {dir_str}{wind_dir}° ({m_c.get('wind_speed_ms')} m/s) | 🌧️ {m_c.get('rain_24h') or 0}mm")
            
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

            # --- 5. 态势分析 ---
            trend_insights = analyze_weather_trend(weather_data, temp_symbol)
            if trend_insights:
                clean_insights = trend_insights.replace("💡 <b>态势分析</b>", "").strip()
                if clean_insights:
                    msg_lines.append(f"\n💡 <b>分析</b>:")
                    for line in clean_insights.split("\n"):
                        if line.strip():
                            msg_lines.append(f"- {line.strip()}")

            bot.send_message(message.chat.id, "\n".join(msg_lines), parse_mode="HTML")

        except Exception as e:
            logger.error(f"查询失败: {e}")
            bot.reply_to(message, f"❌ 查询失败: {e}")

    logger.info("🤖 Bot 启动中...")
    bot.infinity_polling()

if __name__ == "__main__":
    start_bot()
