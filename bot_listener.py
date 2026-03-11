import sys
import os
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
from src.database.db_manager import DBManager
from src.analysis.city_query_service import (
    resolve_city_name,
    build_city_query_report,
)

MESSAGE_POINTS = 4
MESSAGE_DAILY_CAP = 50
MESSAGE_MIN_LENGTH = 2
MESSAGE_COOLDOWN_SEC = 30
CITY_QUERY_COST = 1
DEB_QUERY_COST = 1


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

            city_input = parts[1].strip().lower()
            city_name, supported_cities = resolve_city_name(city_input)
            if not city_name:
                city_list = ", ".join(supported_cities)
                bot.reply_to(
                    message,
                    f"❌ 未找到城市: <b>{city_input}</b>\n\n支持的城市: {city_list}",
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
            city_report = build_city_query_report(
                city_name=city_name,
                weather_data=weather_data,
                city_query_cost=CITY_QUERY_COST,
            )
            bot.send_message(message.chat.id, city_report, parse_mode="HTML")
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


