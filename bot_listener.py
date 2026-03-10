import sys
import os
from typing import List
import telebot  # type: ignore
from loguru import logger  # type: ignore

# 纭繚椤圭洰鏍圭洰褰曞湪 sys.path 涓?
project_root = os.path.dirname(os.path.abspath(__file__))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from src.utils.config_loader import load_config  # type: ignore # noqa: E402
from src.utils.telegram_push import start_trade_alert_push_loop  # type: ignore # noqa: E402
from src.onchain.polygon_wallet_watcher import start_polygon_wallet_watch_loop  # type: ignore # noqa: E402
from src.onchain.polymarket_wallet_activity_watcher import start_polymarket_wallet_activity_loop  # type: ignore # noqa: E402
from src.data_collection.weather_sources import WeatherDataCollector  # type: ignore # noqa: E402
from src.data_collection.city_registry import CITY_REGISTRY  # noqa: E402
from src.data_collection.city_risk_profiles import get_city_risk_profile  # type: ignore # noqa: E402
from src.analysis.deb_algorithm import calculate_dynamic_weights, update_daily_record  # noqa: E402
from src.database.db_manager import DBManager

MESSAGE_POINTS = 4
MESSAGE_DAILY_CAP = 50
MESSAGE_MIN_LENGTH = 2
MESSAGE_COOLDOWN_SEC = 30
CITY_QUERY_COST = 1
DEB_QUERY_COST = 1


def analyze_weather_trend(weather_data, temp_symbol, city_name=None):
    """Thin wrapper 鈥?delegates to shared trend_engine module."""
    from src.analysis.trend_engine import analyze_weather_trend as _analyze
    display_str, ai_context, _structured = _analyze(weather_data, temp_symbol, city_name)
    return display_str, ai_context


def start_bot():
    config = load_config()
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        logger.error("未找到 TELEGRAM_BOT_TOKEN 环境变量")
        return

    bot = telebot.TeleBot(token)
    db = DBManager()
    weather = WeatherDataCollector(config)
    start_trade_alert_push_loop(bot, config)
    start_polygon_wallet_watch_loop(bot)
    start_polymarket_wallet_activity_loop(bot)

    def _display_name(user) -> str:
        return user.username or user.first_name or f"User_{user.id}"

    def _ensure_query_points(message, cost: int, label: str) -> bool:
        user = message.from_user
        db.upsert_user(user.id, _display_name(user))
        result = db.spend_points(user.id, cost)
        if result.get("ok"):
            return True

        balance = int(result.get("balance") or 0)
        required = int(result.get("required") or cost)
        missing = max(0, required - balance)
        bot.reply_to(
            message,
            (
                f"❌ 积分不足，无法执行 <b>{label}</b>\n"
                f"当前积分: <code>{balance}</code>\n"
                f"需要积分: <code>{required}</code>\n"
                f"还差积分: <code>{missing}</code>\n\n"
                f"积分规则：每日签到（有效发言满 {MESSAGE_MIN_LENGTH} 字）获得 <b>{MESSAGE_POINTS}</b> 积分，"
                f"每日上限 {MESSAGE_DAILY_CAP} 分。"
            ),
            parse_mode="HTML",
        )
        return False

    @bot.message_handler(commands=["start", "help"])
    def send_welcome(message):
        welcome_text = (
            "🚀 <b>PolyWeather 天气查询机器人</b>\n\n"
            "可用指令:\n"
            f"/city [城市名] - 查询城市天气预测与实测 (消耗 {CITY_QUERY_COST} 积分)\n"
            f"/deb [城市名] - 查看 DEB 融合预测准确率 (消耗 {DEB_QUERY_COST} 积分)\n"
            "/top - 查看积分排行榜\n"
            "/id - 获取当前聊天的 Chat ID\n\n"
            "示例: <code>/city 伦敦</code>\n"
            f"💡 <i>提示: 每日签到(有效发言满 {MESSAGE_MIN_LENGTH} 字)获得 <b>{MESSAGE_POINTS}</b> 积分，"
            f"每日上限 {MESSAGE_DAILY_CAP} 分。</i>"
        )
        bot.reply_to(message, welcome_text, parse_mode="HTML")

    @bot.message_handler(commands=["id"])
    def get_chat_id(message):
        bot.reply_to(
            message,
            f"🎯 当前聊天的 Chat ID 是: <code>{message.chat.id}</code>",
            parse_mode="HTML",
        )

    @bot.message_handler(commands=["top"])
    def show_points(message):
        """显示当前用户的积分及排行榜"""
        user = message.from_user
        db.upsert_user(user.id, _display_name(user))
        user_info = db.get_user(user.id)
        
        leaderboard = db.get_leaderboard(limit=5)
        rank_text = "🏆 <b>PolyWeather 活跃度排行榜</b>\n"
        rank_text += "────────────────────\n"
        for i, entry in enumerate(leaderboard):
            medal = ["🥇", "🥈", "🥉", "  ", "  "][i] if i < 5 else "  "
            rank_text += f"{medal} {entry['username'][:12]}: <b>{entry['points']}</b> 点\n"
        
        if user_info:
            rank_text += "────────────────────\n"
            rank_text += (
                f"👤 <b>我的状态：</b>\n"
                f"┣ 积分: <code>{user_info['points']}</code>\n"
                f"┣ 发言: <code>{user_info['message_count']}</code> 次\n"
                f"┣ 今日发言积分: <code>{user_info.get('daily_points') or 0}/{MESSAGE_DAILY_CAP}</code>\n"
                f"┗ /city 消耗: <code>{CITY_QUERY_COST}</code> | /deb 消耗: <code>{DEB_QUERY_COST}</code>"
            )
        
        bot.send_message(message.chat.id, rank_text, parse_mode="HTML")
    @bot.message_handler(commands=["deb"])
    def deb_accuracy(message):
        """查询 DEB 融合预测的近 7 天准确率。"""
        try:
            parts = message.text.split(maxsplit=1)
            if len(parts) < 2:
                bot.reply_to(
                    message,
                    "❌ 用法: <code>/deb ankara</code>",
                    parse_mode="HTML",
                )
                return

            from datetime import datetime as _dt, timedelta as _td
            import os as _os

            from src.analysis.deb_algorithm import load_history
            from src.data_collection.city_registry import ALIASES

            city_input = parts[1].strip().lower()
            city_name = ALIASES.get(city_input, city_input)

            project_root = _os.path.dirname(_os.path.abspath(__file__))
            history_file = _os.path.join(project_root, "data", "daily_records.json")
            data = load_history(history_file)

            if city_name not in data or not data[city_name]:
                bot.reply_to(
                    message,
                    f"❌ 暂无 {city_name} 的历史数据。",
                    parse_mode="HTML",
                )
                return

            if not _ensure_query_points(message, DEB_QUERY_COST, "/deb"):
                return

            city_data = data[city_name]
            today = _dt.now().date()
            today_str = today.strftime("%Y-%m-%d")
            cutoff_date = today - _td(days=6)

            recent_items = []
            for date_str, record in city_data.items():
                try:
                    row_date = _dt.strptime(date_str, "%Y-%m-%d").date()
                except Exception:
                    continue
                if row_date >= cutoff_date:
                    recent_items.append((date_str, record, row_date))

            recent_items.sort(key=lambda item: item[0])

            lines = [
                f"📊 <b>DEB 准确率报告 - {city_name.title()}</b>",
                "",
                "📅 <b>近日记录：</b>",
            ]
            total_days = 0
            hits = 0
            deb_errors = []
            signed_errors = []
            model_errors = {}

            for date_str, record, _row_date in recent_items:
                actual = record.get("actual_high")
                deb_pred = record.get("deb_prediction")
                forecasts = record.get("forecasts", {}) or {}

                if actual is None:
                    continue

                try:
                    actual = float(actual)
                    if deb_pred is not None:
                        deb_pred = float(deb_pred)
                except Exception:
                    continue

                if deb_pred is None and forecasts:
                    valid_preds = [float(v) for v in forecasts.values() if v is not None]
                    if valid_preds:
                        deb_pred = round(sum(valid_preds) / len(valid_preds), 1)

                actual_wu = round(actual)

                if date_str == today_str:
                    lines.append(f"  {date_str}: 📍 今天进行中 (实测暂 {actual:.1f})")
                elif deb_pred is not None:
                    total_days += 1
                    deb_wu = round(deb_pred)
                    hit = deb_wu == actual_wu
                    if hit:
                        hits += 1
                    err = deb_pred - actual
                    deb_errors.append(abs(err))
                    signed_errors.append(err)

                    if hit:
                        result_icon = "✅"
                        err_text = f"偏差{abs(err):.1f}°"
                    elif err < 0:
                        result_icon = "❌"
                        err_text = f"低估{abs(err):.1f}°"
                    else:
                        result_icon = "❌"
                        err_text = f"高估{abs(err):.1f}°"

                    retro = "≈" if "deb_prediction" not in record else ""
                    lines.append(
                        f"  {date_str}: DEB {retro}{deb_pred:.1f}→{deb_wu} vs 实测 {actual:.1f}→{actual_wu} "
                        f"{result_icon} {err_text}"
                    )

                if date_str != today_str and actual is not None:
                    for model, pred in forecasts.items():
                        if pred is None:
                            continue
                        try:
                            model_errors.setdefault(model, []).append(abs(float(pred) - actual))
                        except Exception:
                            continue

            if total_days > 0:
                hit_rate = hits / total_days * 100
                deb_mae = sum(deb_errors) / len(deb_errors)
                lines.append("")
                lines.append(
                    f"🏁 <b>DEB 总战绩：</b>WU命中 {hits}/{total_days} (<b>{hit_rate:.0f}%</b>) | MAE: {deb_mae:.1f}°"
                )

                if model_errors:
                    lines.append("")
                    lines.append("📈 <b>模型 MAE 对比：</b>")
                    model_maes = {m: sum(e) / len(e) for m, e in model_errors.items() if e}
                    sorted_models = sorted(model_maes.items(), key=lambda item: item[1])
                    for model, mae in sorted_models:
                        tag = " ⭐" if mae <= deb_mae else ""
                        lines.append(f"  {model}: {mae:.1f}°{tag}")
                    lines.append(f"  <b>DEB融合: {deb_mae:.1f}°</b>")

                mean_bias = sum(signed_errors) / len(signed_errors)
                underest = sum(1 for e in signed_errors if e < -0.3)
                overest = sum(1 for e in signed_errors if e > 0.3)
                accurate = total_days - underest - overest

                lines.append("")
                lines.append("🔍 <b>偏差分析：</b>")
                if abs(mean_bias) > 0.3:
                    bias_label = "系统性低估" if mean_bias < 0 else "系统性高估"
                    lines.append(f"  ⚠️ {bias_label}：平均偏差 {mean_bias:+.1f}°")
                else:
                    lines.append(f"  ✅ 整体无明显系统偏差：平均偏差 {mean_bias:+.1f}°")
                lines.append(f"  (低估 {underest} 次 | 高估 {overest} 次 | 准确 {accurate} 次)")

                lines.append("")
                lines.append("💡 <b>建议：</b>")
                if underest > overest and abs(mean_bias) > 0.5:
                    lines.append(
                        f"  该城市模型集体低估趋势明显（{mean_bias:+.1f}°），实际最高温可能比 DEB 融合值高 "
                        f"{abs(mean_bias):.0f}-{abs(mean_bias) + 0.5:.0f}°。交易时建议适当看高。"
                    )
                elif overest > underest and abs(mean_bias) > 0.5:
                    lines.append(
                        f"  该城市模型集体高估趋势明显（{mean_bias:+.1f}°），实际最高温可能低于 DEB 融合值。交易时注意追高风险。"
                    )
                elif deb_mae > 1.5:
                    lines.append(f"  近期模型波动较大（MAE {deb_mae:.1f}°），建议降低对单一日预测的信任度。")
                elif hit_rate >= 60:
                    lines.append("  DEB 近期表现稳定，可继续作为主要参考。")
                else:
                    lines.append("  近期准确率一般，建议结合主站实测与周边站点共同判断。")

                lines.append("")
                lines.append("📝 MAE = 平均绝对误差，越小越准。⭐ = 优于 DEB 融合。")
                lines.append("📅 统计窗口：近7天滚动样本。")
            else:
                lines.append("")
                lines.append("🔔 近 7 天尚无完整的 DEB 预测记录。")

            lines.append("")
            lines.append(f"💸 本次消耗 <code>{DEB_QUERY_COST}</code> 积分。")
            bot.reply_to(message, "\n".join(lines), parse_mode="HTML")
        except Exception as e:
            bot.reply_to(message, f"❌ 查询失败: {e}")

    @bot.message_handler(commands=["city"])

    def get_city_info(message):
        """查询指定城市的天气详情"""
        try:
            parts = message.text.split(maxsplit=1)
            if len(parts) < 2:
                bot.reply_to(
                    message,
                    "❌ 请输入城市名称\n\n用法: <code>/city chicago</code>",
                    parse_mode="HTML",
                )
                return

            from src.data_collection.city_registry import ALIASES, CITY_REGISTRY
            city_input = parts[1].strip().lower()
            
            # --- 使用统一注册表解析城市 ---
            SUPPORTED_CITIES = list(CITY_REGISTRY.keys())

            # 1. 第一优先级：全称或别名完全匹配
            city_name = ALIASES.get(city_input)
            if not city_name and city_input in SUPPORTED_CITIES:
                city_name = city_input

            # 2. 第二优先级：前缀模糊匹配
            if not city_name and len(city_input) >= 2:
                # 搜别名
                for k, v in ALIASES.items():
                    if k.startswith(city_input):
                        city_name = v
                        break
                # 搜城市全名
                if not city_name:
                    for full_name in SUPPORTED_CITIES:
                        if full_name.startswith(city_input):
                            city_name = full_name
                            break

            # 3. 未找到 ➔ 报错
            if not city_name:
                city_list = ", ".join(sorted(SUPPORTED_CITIES))
                bot.reply_to(
                    message,
                    f"❌ 未找到城市: <b>{city_input}</b>\n\n"
                    f"支持的城市: {city_list}",
                    parse_mode="HTML",
                )
                return

            if not _ensure_query_points(message, CITY_QUERY_COST, "/city"):
                return

            bot.send_message(
                message.chat.id, f"🔍 正在查询 {city_name.title()} 的天气数据..."
            )

            coords = weather.get_coordinates(city_name)
            if not coords:
                bot.reply_to(message, f"❌ 未找到城市坐标: {city_name}")
                return

            weather_data = weather.fetch_all_sources(
                city_name, lat=coords["lat"], lon=coords["lon"]
            )
            open_meteo = weather_data.get("open-meteo", {})
            metar = weather_data.get("metar", {})
            mgm = weather_data.get("mgm") or {}
            city_meta = CITY_REGISTRY.get(city_name.lower(), {})
            fallback_utc_offset = int(city_meta.get("tz_offset", 0))
            nws_periods = (weather_data.get("nws", {}) or {}).get("forecast_periods", []) or []
            if nws_periods:
                try:
                    from datetime import datetime as _dt

                    first_start = nws_periods[0].get("start_time")
                    if first_start:
                        maybe_dt = _dt.fromisoformat(str(first_start))
                        if maybe_dt.utcoffset() is not None:
                            fallback_utc_offset = int(maybe_dt.utcoffset().total_seconds())
                except Exception:
                    pass

            # 鏁板€煎綊涓€鍖?
            def _sf(v):
                if v is None:
                    return None
                try:
                    return float(v)
                except Exception:
                    return None

            city_is_fahrenheit = city_name.strip().lower() in ["dallas", "new york", "chicago", "miami", "atlanta", "seattle"]
            temp_symbol = "°F" if city_is_fahrenheit else "°C"

            # --- 1. 紧凑 Header (城市 + 时间 + 风险状态) ---
            local_time = open_meteo.get("current", {}).get("local_time", "")
            time_str = local_time.split(" ")[1][:5] if " " in local_time else "N/A"
            if time_str == "N/A":
                metar_obs = metar.get("observation_time", "") if metar else ""
                if "T" in metar_obs:
                    try:
                        from datetime import datetime, timezone, timedelta

                        dt = datetime.fromisoformat(metar_obs.replace("Z", "+00:00"))
                        utc_offset_for_view = open_meteo.get("utc_offset")
                        if utc_offset_for_view is None:
                            utc_offset_for_view = fallback_utc_offset
                        local_dt = dt.astimezone(
                            timezone(timedelta(seconds=int(utc_offset_for_view)))
                        )
                        time_str = local_dt.strftime("%H:%M")
                    except Exception:
                        time_str = metar_obs.split("T")[1][:5]
                elif " " in metar_obs:
                    time_str = metar_obs.split(" ")[1][:5]
                elif metar_obs:
                    time_str = str(metar_obs)[:5]
                else:
                    try:
                        from datetime import datetime, timezone, timedelta

                        local_now = datetime.now(timezone.utc).astimezone(
                            timezone(timedelta(seconds=int(fallback_utc_offset)))
                        )
                        time_str = local_now.strftime("%H:%M")
                    except Exception:
                        pass

            risk_profile = get_city_risk_profile(city_name)
            risk_emoji = risk_profile.get("risk_level", "⚠️") if risk_profile else "⚠️"

            msg_header = f"📍 <b>{city_name.title()}</b> ({time_str}) {risk_emoji}"
            msg_lines = [msg_header]

            # --- 2. 紧凑 风险提示 ---
            if risk_profile:
                bias = risk_profile.get("bias", "±0.0")
                msg_lines.append(
                    f"⚠️ {risk_profile.get('airport_name', '')}: {bias}{temp_symbol} | {risk_profile.get('warning', '')}"
                )

            # --- 3. 紧凑 预测区 ---
            daily = open_meteo.get("daily", {})
            dates = daily.get("time", [])[:3]
            max_temps = daily.get("temperature_2m_max", [])[:3]

            nws_high = _sf(weather_data.get("nws", {}).get("today_high"))
            mgm_high = _sf(mgm.get("today_high"))
            mb_high = _sf(weather_data.get("meteoblue", {}).get("today_high"))
            metar_max_so_far = _sf(metar.get("current", {}).get("max_temp_so_far")) if metar else None

            # 今天对比
            today_t = _sf(max_temps[0]) if max_temps else None
            fallback_source = None
            metar_only_fallback = False
            if today_t is None:
                for source_name, candidate in (
                    ("MB", mb_high),
                    ("NWS", nws_high),
                    ("MGM", mgm_high),
                ):
                    if candidate is not None:
                        today_t = candidate
                        fallback_source = source_name
                        break
            if today_t is None and metar_max_so_far is not None:
                # Last-resort display only: do not treat METAR as a forecast source
                today_t = metar_max_so_far
                metar_only_fallback = True
            today_t_display = (
                f"{today_t:.1f}" if isinstance(today_t, (int, float)) else "N/A"
            )
            comp_parts = []
            sources = ["Open-Meteo"] if max_temps else []

            if mb_high is not None:
                if "MB" not in sources:
                    sources.append("MB")
                # 只在非 fallback（即 Open-Meteo 存在）时显示为对比，否则作为 today_t 已显示
                if fallback_source != "MB":
                    comp_parts.append(
                        f"MB: {mb_high:.1f}{temp_symbol}"
                        if isinstance(mb_high, (int, float))
                        else f"MB: {mb_high}"
                    )
            if nws_high is not None:
                if "NWS" not in sources:
                    sources.append("NWS")
                if fallback_source != "NWS":
                    comp_parts.append(
                        f"NWS: {nws_high:.1f}{temp_symbol}"
                        if isinstance(nws_high, (int, float))
                        else f"NWS: {nws_high}"
                    )
            if mgm_high is not None:
                if "MGM" not in sources:
                    sources.append("MGM")
                if fallback_source != "MGM":
                    comp_parts.append(
                        f"MGM: {mgm_high:.1f}{temp_symbol}"
                        if isinstance(mgm_high, (int, float))
                        else f"MGM: {mgm_high}"
                    )
            if fallback_source and fallback_source not in sources:
                sources.append(fallback_source)
            if metar_only_fallback:
                if not sources:
                    sources = ["Model unavailable"]
                comp_parts.append(f"METAR实测回退: {metar_max_so_far:.1f}{temp_symbol}")
            if not sources:
                sources = ["N/A"]

            # 检查是否有显著分歧 (超过 5°F 或 2.5°C)
            divergence_warning = ""
            base_for_divergence = _sf(max_temps[0]) if max_temps else today_t
            if mb_high is not None and base_for_divergence is not None:
                diff = abs(mb_high - base_for_divergence)
                threshold = 5.0 if temp_unit == "fahrenheit" else 2.5
                if diff > threshold:
                    divergence_warning = (
                        f" ⚠️ <b>模型显著分歧 ({diff:.1f}{temp_symbol})</b>"
                    )

            comp_str = f" ({' | '.join(comp_parts)})" if comp_parts else ""
            sources_str = " | ".join(sources)

            msg_lines.append(f"\n📊 <b>预报 ({sources_str})</b>")
            msg_lines.append(
                f"👉 <b>今天: {today_t_display}{temp_symbol}{comp_str}</b>{divergence_warning}"
            )

            # 明后天
            mgm_daily = mgm.get("daily_forecasts", {}) or {}
            if len(dates) > 1:
                future_forecasts = []
                for d, t in zip(dates[1:], max_temps[1:]):
                    # 检查 MGM 是否有该日期的预报
                    mgm_f = mgm_daily.get(d)
                    if mgm_f is not None:
                        future_forecasts.append(
                            f"{d[5:]}: {t}{temp_symbol} | 🇺🇸 <b>MGM: {mgm_f}{temp_symbol}</b>"
                        )
                    else:
                        future_forecasts.append(f"{d[5:]}: {t}{temp_symbol}")
                msg_lines.append("📅 " + " | ".join(future_forecasts))
            elif mgm_daily:
                # Open-Meteo missing: still show next 2 days from MGM daily forecast
                from datetime import datetime, timezone, timedelta

                local_now = datetime.now(timezone.utc).astimezone(
                    timezone(timedelta(seconds=int(fallback_utc_offset)))
                )
                today_local = local_now.strftime("%Y-%m-%d")
                future_forecasts = []
                for d in sorted(mgm_daily.keys()):
                    if d <= today_local:
                        continue
                    t = mgm_daily.get(d)
                    if t is None:
                        continue
                    future_forecasts.append(f"{d[5:]}: {t}{temp_symbol}")
                    if len(future_forecasts) >= 2:
                        break
                if future_forecasts:
                    msg_lines.append("📅 " + " | ".join(future_forecasts))

            # --- 3.5 日出日落 + 日照时长 ---
            sunrises = daily.get("sunrise", [])
            sunsets = daily.get("sunset", [])
            sunshine_durations = daily.get("sunshine_duration", [])
            if sunrises and sunsets:
                sunrise_t = (
                    sunrises[0].split("T")[1][:5]
                    if "T" in str(sunrises[0])
                    else sunrises[0]
                )
                sunset_t = (
                    sunsets[0].split("T")[1][:5]
                    if "T" in str(sunsets[0])
                    else sunsets[0]
                )
                sun_line = f"🌅 日出 {sunrise_t} | 🌇 日落 {sunset_t}"
                if sunshine_durations:
                    sunshine_hours = sunshine_durations[0] / 3600  # 秒 -> 小时
                    sun_line += f" | ☀️ 日照 {sunshine_hours:.1f}h"
                msg_lines.append(sun_line)

            # --- 4. 核心 实测区 (合并 METAR 和 MGM) ---
            # 基础数据优先用 METAR
            cur_temp = _sf(
                metar.get("current", {}).get("temp")
                if metar
                else mgm.get("current", {}).get("temp")
            )
            max_p = _sf(
                metar.get("current", {}).get("max_temp_so_far") if metar else None
            )
            max_p_time = (
                metar.get("current", {}).get("max_temp_time") if metar else None
            )
            obs_t_str = "N/A"
            metar_age_min = None  # METAR 数据年龄（分钟）
            main_source = "METAR" if metar else "MGM"

            if metar:
                obs_t = metar.get("observation_time", "")
                try:
                    if "T" in obs_t:
                        from datetime import datetime, timezone, timedelta

                        dt = datetime.fromisoformat(obs_t.replace("Z", "+00:00"))
                        utc_offset = open_meteo.get("utc_offset")
                        if utc_offset is None:
                            utc_offset = fallback_utc_offset
                        local_dt = dt.astimezone(
                            timezone(timedelta(seconds=int(utc_offset)))
                        )
                        obs_t_str = local_dt.strftime("%H:%M")
                        # 计算数据年龄
                        now_utc = datetime.now(timezone.utc)
                        metar_age_min = int((now_utc - dt).total_seconds() / 60)
                    elif " " in obs_t:
                        obs_t_str = obs_t.split(" ")[1][:5]
                    else:
                        obs_t_str = obs_t
                except Exception:
                    obs_t_str = obs_t[:16]
            elif mgm:
                m_time = mgm.get("current", {}).get("time", "")
                if "T" in m_time:
                    from datetime import datetime, timezone, timedelta

                    dt = datetime.fromisoformat(m_time.replace("Z", "+00:00"))
                    m_time = dt.astimezone(timezone(timedelta(hours=3))).strftime(
                        "%H:%M"
                    )
                elif " " in m_time:
                    m_time = m_time.split(" ")[1][:5]
                obs_t_str = m_time

            # 数据年龄标注
            age_tag = ""
            if metar_age_min is not None:
                if metar_age_min >= 60:
                    age_tag = f" ⚠️{metar_age_min}分钟前"
                elif metar_age_min >= 30:
                    age_tag = f" 🔔{metar_age_min}分钟前"

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
                rain_codes = {
                    "RA",
                    "DZ",
                    "-RA",
                    "+RA",
                    "-DZ",
                    "+DZ",
                    "TSRA",
                    "SHRA",
                    "FZRA",
                }
                snow_codes = {"SN", "GR", "GS", "-SN", "+SN", "BLSN"}
                fog_codes = {"FG", "BR", "HZ", "FZFG"}
                ts_codes = {"TS", "TSRA"}
                if ts_codes & wx_tokens:
                    wx_summary = "⛈️ 雷暴"
                elif {"+RA", "+SN"} & wx_tokens:
                    wx_summary = "🌧️ 大雨" if "+RA" in wx_tokens else "❄️ 大雪"
                elif rain_codes & wx_tokens:
                    wx_summary = (
                        "🌧️ 小雨" if {"-RA", "-DZ", "DZ"} & wx_tokens else "🌧️ 下雨"
                    )
                elif snow_codes & wx_tokens:
                    wx_summary = "❄️ 下雪"
                elif fog_codes & wx_tokens:
                    wx_summary = "🌫️ 雾 / 霾"

            # 如果 METAR 没有特殊现象，用云量推断
            if not wx_summary:
                # 优先 METAR 云层，回退 MGM
                cover_code = ""
                if metar_clouds:
                    cover_code = metar_clouds[-1].get("cover", "")

                if cover_code in ("SKC", "CLR") or (
                    cover_code == "" and mgm_cloud is not None and mgm_cloud <= 1
                ):
                    wx_summary = "☀️ 晴"
                elif cover_code == "FEW" or (
                    cover_code == "" and mgm_cloud is not None and mgm_cloud <= 2
                ):
                    wx_summary = "🌤️ 晴间少云"
                elif cover_code == "SCT" or (
                    cover_code == "" and mgm_cloud is not None and mgm_cloud <= 4
                ):
                    wx_summary = "⛅ 晴间多云"
                elif cover_code == "BKN" or (
                    cover_code == "" and mgm_cloud is not None and mgm_cloud <= 6
                ):
                    wx_summary = "🌥️ 多云"
                elif cover_code == "OVC" or (
                    cover_code == "" and mgm_cloud is not None and mgm_cloud <= 8
                ):
                    wx_summary = "☁️ 阴天"
                elif mgm_cloud is not None:
                    cloud_names = {
                        0: "☀️ 晴",
                        1: "☀️ 晴",
                        2: "🌤️ 少云",
                        3: "⛅ 散云",
                        4: "⛅ 散云",
                        5: "🌥️ 多云",
                        6: "🌥️ 多云",
                        7: "☁️ 阴",
                        8: "☁️ 阴天",
                    }
                    wx_summary = cloud_names.get(mgm_cloud, "")

            wx_display = f" {wx_summary}" if wx_summary else ""
            msg_lines.append(
                f"\n✈️ <b>实测 ({main_source}): {cur_temp}{temp_symbol}</b>{max_str} |{wx_display} | {obs_t_str}{age_tag}"
            )

            if mgm:
                m_c = mgm.get("current", {})
                # 翻译风向
                wind_dir = m_c.get("wind_dir")
                wind_speed_ms = m_c.get("wind_speed_ms")
                dir_str = ""
                if wind_dir is not None:
                    dirs = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"]
                    dir_str = dirs[int((float(wind_dir) + 22.5) % 360 / 45)] + "风"

                # 体感和湿度（跳过缺失数据）
                feels_like = m_c.get("feels_like")
                humidity = m_c.get("humidity")
                if feels_like is not None or humidity is not None:
                    parts = []
                    if feels_like is not None:
                        parts.append(f"🌡️ 体感: {feels_like}°C")
                    
                    # 针对安卡拉，补充市区(Center)实测值
                    ankara_center = next((s for s in weather_data.get("mgm_nearby", []) if "Bölge/Center" in s.get("name", "")), None)
                    if ankara_center:
                        parts.append(f"Ankara (Bölge/Center): <b>{ankara_center['temp']}°C</b>")
                        
                    if humidity is not None:
                        parts.append(f"💧 {humidity}%")
                    msg_lines.append(f"   [MGM] {' | '.join(parts)}")

                # 风况（跳过缺失数据）
                if wind_dir is not None and wind_speed_ms is not None:
                    msg_lines.append(
                        f"   [MGM] 🌬️ {dir_str}{wind_dir}° ({wind_speed_ms} m/s) | 💧 降水: {m_c.get('rain_24h') or 0}mm"
                    )

                # 新增：气压和云量
                extra_parts = []
                pressure = m_c.get("pressure")
                if pressure is not None:
                    extra_parts.append(f"🌡 气压: {pressure}hPa")
                cloud_cover = m_c.get("cloud_cover")
                if cloud_cover is not None:
                    cloud_desc_map = {
                        0: "晴朗",
                        1: "少云",
                        2: "少云",
                        3: "散云",
                        4: "散云",
                        5: "多云",
                        6: "多云",
                        7: "很多云",
                        8: "阴天",
                    }
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
                    c_map = {
                        "BKN": "多云",
                        "OVC": "阴天",
                        "FEW": "少云",
                        "SCT": "散云",
                        "SKC": "晴",
                        "CLR": "晴",
                    }
                    main = clouds[-1]
                    cloud_desc = f"☁️ {c_map.get(main.get('cover'), main.get('cover'))}"

                prefix = "[METAR]" if mgm else "   "
                if not mgm:
                    msg_lines.append(
                        f"   {prefix} 🌪 {wind or 0}kt ({wind_dir or 0}°) | 👁️ {vis or 10}mi"
                    )

                if cloud_desc:
                    msg_lines.append(
                        f"   {prefix} {cloud_desc} | 👁️ {vis or 10}mi | 🌪 {wind or 0}kt"
                    )

            # --- 5. 态势特征提取 ---
            feature_str, ai_context = analyze_weather_trend(
                weather_data, temp_symbol, city_name
            )
            if feature_str:
                # 仅将最核心的信息展示给用户作为"态势分析"
                # 但后面会把更全的数据传给 AI
                msg_lines.append("\n💡 <b>分析</b>:")
                for line in feature_str.split("\n"):
                    if line.strip():
                        msg_lines.append(f"- {line.strip()}")

                # --- 6. Groq AI 深度分析 ---
                try:
                    from src.analysis.ai_analyzer import get_ai_analysis
                    # 构建更全的背景数据给 AI

                    # 补充多模型分歧
                    mm = weather_data.get("multi_model", {}) or {}
                    if not isinstance(mm, dict):
                        mm = {}
                    if mm.get("forecasts"):
                        mm_str = " | ".join(
                            [
                                f"{k}:{v}{temp_symbol}"
                                for k, v in mm["forecasts"].items()
                                if v
                            ]
                        )
                        ai_context += f"\n模型分歧: {mm_str}"

                    ai_result = get_ai_analysis(ai_context, city_name, temp_symbol)
                    if ai_result:
                        msg_lines.append(f"\n{ai_result}")
                except Exception as e:
                    logger.error(f"调用 Groq AI 分析失败: {e}")

            msg_lines.append(f"\n💸 本次消耗 <b>{CITY_QUERY_COST}</b> 积分。")
            bot.send_message(message.chat.id, "\n".join(msg_lines), parse_mode="HTML")

        except Exception as e:
            import traceback

            logger.error(f"查询失败: {e}\n{traceback.format_exc()}")
            bot.reply_to(message, f"❌ 查询失败: {e}")

    @bot.message_handler(func=lambda message: True, content_types=['text'])
    def track_activity(message):
        """全量监听消息，用于记录群内发言积分(非指令消息)"""
        if message.text.startswith('/'):
            return
        if message.chat.type not in ("group", "supergroup"):
            return

        user = message.from_user
        username = _display_name(user)
        db.upsert_user(user.id, username)

        result = db.add_message_activity(
            user.id,
            text=message.text,
            points_to_add=MESSAGE_POINTS,
            cooldown_sec=MESSAGE_COOLDOWN_SEC,
            daily_cap=MESSAGE_DAILY_CAP,
            min_text_length=MESSAGE_MIN_LENGTH,
        )
        if result.get("awarded"):
            logger.info(
                f"message points awarded user={user.id} points=+{MESSAGE_POINTS} "
                f"daily_points={result.get('daily_points')}/{MESSAGE_DAILY_CAP}"
            )

    logger.info("🤖 Bot 启动中...")
    bot.infinity_polling()


if __name__ == "__main__":
    start_bot()


