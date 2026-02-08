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
    
    if not metar or not open_meteo:
        return ""
        
    curr_temp = metar.get("current", {}).get("temp")
    max_so_far = metar.get("current", {}).get("max_temp_so_far")  # 今日实测最高
    daily = open_meteo.get("daily", {})
    forecast_high = daily.get("temperature_2m_max", [None])[0]
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
    if max_so_far is not None and forecast_high is not None:
        if max_so_far > forecast_high + 0.5:
            # 实测已超预报！
            exceed_by = max_so_far - forecast_high
            insights.append(f"🚨 <b>预报已被击穿</b>：实测最高 {max_so_far}{temp_symbol} 已超预报 {forecast_high}{temp_symbol} 约 {exceed_by:.1f}°！")
            insights.append(f"💡 <b>博弈建议</b>：市场需重新评估，关注更高温度区间。")
            # 直接返回，不再显示过时的建议
            if wind_speed >= 10:
                insights.append(f"🍃 <b>清劲风</b>：空气流动快，可能伴随阵风引起微小波动。")
            return "\n💡 <b>态势分析</b>\n" + "\n".join(insights)

    # --- 峰值时刻预测逻辑 ---
    hourly = open_meteo.get("hourly", {})
    times = hourly.get("time", [])
    temps = hourly.get("temperature_2m", [])
    
    peak_hours = []
    if times and temps and forecast_high is not None:
        for t_str, temp in zip(times, temps):
            if t_str.startswith(local_date_str):
                if abs(temp - forecast_high) <= 0.2:
                    hour = t_str.split("T")[1][:5]
                    peak_hours.append(hour)
        
        if peak_hours:
            window = f"{peak_hours[0]} - {peak_hours[-1]}" if len(peak_hours) > 1 else peak_hours[0]
            insights.append(f"⏱️ <b>预计峰值时刻</b>：今天 <b>{window}</b> 之间。")
            # 只有在实测还没超预报时才给这个建议
            if local_hour < int(peak_hours[0].split(":")[0]) and (max_so_far is None or max_so_far < forecast_high):
                insights.append(f"🎯 <b>博弈建议</b>：关注该时段实测能否站稳 {forecast_high}{temp_symbol}。")

    if curr_temp is not None and forecast_high is not None:
        diff = forecast_high - curr_temp
        
        # 1. 气温节奏判定
        if local_hour >= 17:
            if curr_temp >= forecast_high - 0.5:
                insights.append(f"✅ <b>今日峰值已达</b>：当前已触及预报最高，大概率已定格。")
            else:
                insights.append(f"📉 <b>处于降温期</b>：气温已跌落峰值，今日反弹乏力。")
        elif 10 <= local_hour < 17:
            if diff > 1.2:
                insights.append(f"📈 <b>升温进程中</b>：距离峰值还有约 {diff:.1f}° 空间，正向高点冲击。")
            else:
                insights.append(f"⚖️ <b>高位横盘</b>：气温已在高位，将在当前水平小幅波动。")
        else:
            insights.append(f"🌅 <b>早间爬升</b>：气温正快速起步，等待午后冲击。")

        # 2. 湿度与露点带来的“粘性”分析
        humidity = metar.get("current", {}).get("humidity")
        dewpoint = metar.get("current", {}).get("dewpoint")
        
        if humidity and humidity > 80 and local_hour >= 18:
            insights.append(f"💦 <b>闷热高湿</b>：湿度极高 ({humidity}%)，将显著锁住夜间热量。")
        
        if dewpoint is not None and curr_temp - dewpoint < 2.0 and local_hour >= 18:
            insights.append(f"🌡️ <b>触及露点支撑</b>：气温已跌至露点支撑位，降温将变慢。")

        # 3. 风力
        if wind_speed >= 15:
            insights.append(f"🌬️ <b>大风预判</b>：当前风力较大 ({wind_speed}kt)，气温可能出现非线性波动。")
        elif wind_speed >= 10:
            insights.append(f"🍃 <b>清劲风</b>：空气流动快，虽然有助于散热，但可能伴随阵风引起微小波动。")

        # 4. 云层遮挡分析 (对午后增温影响巨大)
        clouds = metar.get("current", {}).get("clouds", [])
        if clouds and 10 <= local_hour <= 16:
            # 取覆盖范围最大的云层
            main_cloud = clouds[-1] # METAR 通常按高度由低到高排列，最后一层往往代表主要云量
            cover = main_cloud.get("cover", "")
            
            if cover == "OVC":
                insights.append(f"☁️ <b>全阴锁温</b>：机场上空完全遮挡，阳光增温几乎停滞，很难冲破预报高点。")
            elif cover == "BKN":
                insights.append(f"🌥️ <b>云层显著</b>：天空大部被遮挡，日照受限，升温速率将明显放缓。")
            elif cover in ["SKC", "CLR", "FEW"]:
                insights.append(f"☀️ <b>晴空万里</b>：日照强烈，无云层遮挡，气温有冲向预报上限甚至超出的动能。")

        # 5. 特殊天气现象分析
        wx_desc = metar.get("current", {}).get("wx_desc")
        if wx_desc:
            if any(x in wx_desc.upper() for x in ["RA", "DZ", "RAIN", "DRIZZLE"]):
                insights.append(f"🌧️ <b>降雨压制</b>：当前有降雨，蒸发吸热将显著拉低实时气温。")
            elif any(x in wx_desc.upper() for x in ["SN", "SNOW", "GR", "GS"]):
                insights.append(f"❄️ <b>固态降水</b>：正在降雪或冰雹，气温将由于相变吸热而持续低迷。")
            elif any(x in wx_desc.upper() for x in ["FG", "BR", "HZ", "FOG", "MIST"]):
                insights.append(f"🌫️ <b>能见度受限</b>：当前有雾/霭，阻挡阳光并带来高湿，会大幅延缓升温周期。")

        # 6. 风向与能见度
        wind_dir = metar.get("current", {}).get("wind_dir")
        if wind_dir is not None:
            # 北半球简化逻辑：北风冷，南风暖
            if 315 <= wind_dir or wind_dir <= 45:
                insights.append(f"🌬️ <b>偏北风</b>：冷空气处于主导地位，午后增温阻力较大。")
            elif 135 <= wind_dir <= 225:
                insights.append(f"🔥 <b>偏南风</b>：正从低纬度输送暖湿气流，气温有超预期上涨的潜力。")

        visibility = metar.get("current", {}).get("visibility_mi")
        if visibility is not None and visibility < 3 and local_hour <= 11:
            insights.append(f"🌫️ <b>早晨低见度</b>：能见度极差 ({visibility}mi)，阳光无法打透，早间升温将非常缓慢。")

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
            
            # 1. 尝试直接从映射表获取
            city_name = STANDARD_MAPPING.get(city_input)
            
            # 2. 如果没匹配到，尝试前缀匹配 (如输入 "seou")
            if not city_name:
                for k, v in STANDARD_MAPPING.items():
                    if len(city_input) >= 3 and k.startswith(city_input[:3]):
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

            msg_lines = [f"📍 <b>{city_name.title()} 天气详情</b>"]
            
            # 立即显示城市风险档案，防止被淹没
            risk_profile = get_city_risk_profile(city_name)
            if risk_profile:
                risk_warning = format_risk_warning(risk_profile, "°F") # 默认尝试用F显示偏差
                if risk_warning:
                    msg_lines.append(risk_warning)

            msg_lines.append(f"\n⏱️ 生成时间: {datetime.now().strftime('%H:%M:%S')}")
            msg_lines.append("═" * 20)

            open_meteo = weather_data.get("open-meteo", {})
            metar = weather_data.get("metar", {})
            temp_unit = open_meteo.get("unit", "celsius")
            temp_symbol = "°F" if temp_unit == "fahrenheit" else "°C"

            local_time = open_meteo.get("current", {}).get("local_time", "")
            if local_time:
                time_only = local_time.split(" ")[1] if " " in local_time else local_time
                msg_lines.append(f"🕐 当地时间: {time_only}")


            daily = open_meteo.get("daily", {})
            dates = daily.get("time", [])
            max_temps = daily.get("temperature_2m_max", [])
            # 获取当地“今天”的日期
            utc_offset = open_meteo.get("utc_offset", 0)
            from datetime import timedelta, timezone
            city_now = datetime.now(timezone.utc) + timedelta(seconds=utc_offset)
            city_today_str = city_now.strftime("%Y-%m-%d")

            msg_lines.append(f"\n📊 <b>Open-Meteo 7天预测</b>")
            nws = weather_data.get("nws", {})
            nws_high = nws.get("today_high")
            
            for i, (d, t) in enumerate(zip(dates[:7], max_temps[:7])):
                # 跳过无效数据
                if t is None:
                    continue
                    
                day_label = "今天" if d == city_today_str else d[5:]
                indicator = "👉 " if d == city_today_str else "   "
                
                # 如果是今天且有 NWS 数据，显示模型对比
                if d == city_today_str and nws_high is not None:
                    diff = abs(t - nws_high)
                    if diff > 1:
                        msg_lines.append(f"{indicator}{day_label}: 最高 {t}{temp_symbol} ⚠️")
                        msg_lines.append(f"   (NWS官方预报: {nws_high}{temp_symbol}，差异 {diff:.1f}°)")
                    else:
                        msg_lines.append(f"{indicator}{day_label}: 最高 {t}{temp_symbol} (NWS: {nws_high}{temp_symbol})")
                else:
                    msg_lines.append(f"{indicator}{day_label}: 最高 {t}{temp_symbol}")

            if metar:
                icao = metar.get("icao", "")
                metar_temp = metar.get("current", {}).get("temp")
                wind = metar.get("current", {}).get("wind_speed_kt")
                obs = metar.get("observation_time", "")
                
                if obs:
                    try:
                        obs_dt = datetime.fromisoformat(obs.replace("Z", "+00:00"))
                        # 如果有 Open-Meteo 的时区偏移，则转换
                        utc_offset = open_meteo.get("utc_offset", 0)
                        from datetime import timezone, timedelta
                        local_obs_dt = obs_dt.astimezone(timezone(timedelta(seconds=utc_offset)))
                        obs_str = local_obs_dt.strftime("%H:%M") + " (当地)"
                    except:
                        obs_str = obs[:16]
                else:
                    obs_str = "N/A"

                msg_lines.append(f"\n✈️ <b>机场实测 ({icao})</b>")
                if metar_temp is not None:
                    max_sofar = metar.get("current", {}).get("max_temp_so_far")
                    if max_sofar is not None:
                        msg_lines.append(f"   🌡️ {metar_temp}{temp_symbol} (今日最高: {max_sofar}{temp_symbol})")
                    else:
                        msg_lines.append(f"   🌡️ {metar_temp}{temp_symbol}")
                if wind is not None:
                    wind_dir = metar.get("current", {}).get("wind_dir")
                    if wind_dir is not None:
                        # 翻译风向
                        dirs = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"]
                        dir_str = dirs[int((wind_dir + 22.5) % 360 / 45)]
                        msg_lines.append(f"   💨 风力: {wind}kt ({dir_str}风 {wind_dir}°)")
                    else:
                        msg_lines.append(f"   💨 风速: {wind}kt")
                
                vis = metar.get("current", {}).get("visibility_mi")
                if vis is not None:
                    msg_lines.append(f"   👁️ 能见度: {vis}mi")
                
                wx = metar.get("current", {}).get("wx_desc")
                if wx:
                    # 常见天象翻译
                    wx_map = {
                        "RA": "雨", "SN": "雪", "DZ": "毛毛雨", "FG": "雾", 
                        "BR": "薄雾", "HZ": "霾", "TS": "雷暴", "GR": "冰雹",
                        "VC": "附近", "MI": "浅", "BC": "散", "PR": "部分",
                        "BL": "吹", "SH": "阵", "FZ": "冻", "-": "轻微", "+": "强烈"
                    }
                    translated_wx = wx
                    for code, cn in wx_map.items():
                        translated_wx = translated_wx.replace(code, cn)
                    msg_lines.append(f"   🌧️ 天象: {translated_wx}")
                
                # 云层显示
                clouds = metar.get("current", {}).get("clouds", [])
                if clouds:
                    cloud_map = {
                        "SKC": "晴空 (无云)", "CLR": "晴空 (无云)",
                        "FEW": "少云", "SCT": "散云",
                        "BKN": "多云 (有遮挡)", "OVC": "阴天 (全覆盖)",
                        "VV": "垂直能见度受限"
                    }
                    main_cloud = clouds[-1]
                    cover_code = main_cloud.get("cover", "Unknown")
                    base_height = main_cloud.get("base", "")
                    cover_desc = cloud_map.get(cover_code, cover_code)
                    if base_height:
                        msg_lines.append(f"   ☁️ 云层: {cover_desc} ({base_height}ft)")
                    else:
                        msg_lines.append(f"   ☁️ 云层: {cover_desc}")
                
                msg_lines.append(f"   🕐 观测: {obs_str}")
                
            # 3. 添加态势分析
            trend_insights = analyze_weather_trend(weather_data, temp_symbol)
            if trend_insights:
                msg_lines.append(trend_insights)

            bot.send_message(message.chat.id, "\n".join(msg_lines), parse_mode="HTML")

        except Exception as e:
            logger.error(f"查询失败: {e}")
            bot.reply_to(message, f"❌ 查询失败: {e}")

    logger.info("🤖 Bot 启动中...")
    bot.infinity_polling()

if __name__ == "__main__":
    start_bot()
