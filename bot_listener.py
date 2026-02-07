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

def analyze_weather_trend(weather_data, temp_symbol):
    """根据实测与预测分析气温态势"""
    insights = []
    
    metar = weather_data.get("metar", {})
    open_meteo = weather_data.get("open-meteo", {})
    
    if not metar or not open_meteo:
        return ""
        
    curr_temp = metar.get("current", {}).get("temp")
    forecast_high = open_meteo.get("daily", {}).get("temperature_2m_max", [None])[0]
    wind_speed = metar.get("current", {}).get("wind_speed_kt", 0)
    
    # 获取当地时间小时
    local_time_str = open_meteo.get("current", {}).get("local_time", "")
    try:
        local_hour = int(local_time_str.split(" ")[1].split(":")[0])
    except:
        local_hour = datetime.now().hour # 降级方案
        
    if curr_temp is not None and forecast_high is not None:
        diff = forecast_high - curr_temp
        
        # 1. 峰值判断
        if local_hour >= 16:
            if curr_temp >= forecast_high - 0.5:
                insights.append(f"✅ <b>今日峰值已达</b> ({curr_temp}{temp_symbol})，预计开始缓慢回落。")
            else:
                insights.append(f"📉 <b>处于降温期</b>：当前 {curr_temp}{temp_symbol} 已低于预报最高值，大概率不会再突破。")
        elif 11 <= local_hour < 16:
            if diff > 1.5:
                insights.append(f"📈 <b>升温进程中</b>：距离预报最高温还有 {diff:.1f}° 空间，仍有上升动力。")
            else:
                insights.append(f"⚖️ <b>处于高位盘整</b>：接近预报峰值，变动幅度预计收窄。")
        else:
            insights.append(f"🌅 <b>早间时段</b>：气温正在起步，重点观察午后 14:00-15:00 表现。")

        # 2. 剧烈变动预警
        if wind_speed >= 15:
            insights.append(f"🌬️ <b>大风预警 ({wind_speed}kt)</b>：风力较强，可能伴随锋面过境，气温或有剧烈起伏。")
        elif wind_speed >= 10:
            insights.append(f"🍃 <b>清劲风 ({wind_speed}kt)</b>：空气流动快，体感温度可能略低于实测。")

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
            city_aliases = {
                "nyc": "new york", "ny": "new york", "la": "los angeles",
                "chi": "chicago", "atl": "atlanta", "sea": "seattle",
                "dal": "dallas", "mia": "miami", "tor": "toronto",
                "ank": "ankara", "sel": "seoul", "wel": "wellington",
                "ba": "buenos aires", "伦敦": "london", "纽约": "new york",
                "西雅图": "seattle", "芝加哥": "chicago", "多伦多": "toronto",
                "首尔": "seoul", "惠灵顿": "wellington", "达拉斯": "dallas",
                "亚特兰大": "atlanta"
            }
            city_name = city_aliases.get(city_input, city_input)

            bot.send_message(message.chat.id, f"🔍 正在查询 {city_name.title()} 的天气数据...")

            coords = weather.get_coordinates(city_name)
            if not coords:
                bot.reply_to(message, f"❌ 未找到城市: {city_name}")
                return

            weather_data = weather.fetch_all_sources(city_name, lat=coords["lat"], lon=coords["lon"])

            msg_lines = [f"📍 <b>{city_name.title()} 天气详情</b>"]
            msg_lines.append(f"⏱️ 生成时间: {datetime.now().strftime('%H:%M:%S')}")
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
            today_str = datetime.now().strftime("%Y-%m-%d")

            msg_lines.append(f"\n📊 <b>Open-Meteo 7天预测</b>")
            for i, (d, t) in enumerate(zip(dates[:7], max_temps[:7])):
                day_label = "今天" if d == today_str else d[5:]
                indicator = "👉 " if d == today_str else "   "
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
                    msg_lines.append(f"   🌡️ {metar_temp}{temp_symbol}")
                if wind is not None:
                    msg_lines.append(f"   💨 风速: {wind}kt")
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
