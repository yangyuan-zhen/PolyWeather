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
from src.data_collection.weather_sources import WeatherDataCollector  # type: ignore # noqa: E402
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
        logger.error("鏈壘鍒?TELEGRAM_BOT_TOKEN 鐜鍙橀噺")
        return

    bot = telebot.TeleBot(token)
    db = DBManager()
    weather = WeatherDataCollector(config)
    start_trade_alert_push_loop(bot, config)
    start_polygon_wallet_watch_loop(bot)

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
                f"鉂?绉垎涓嶈冻锛屾棤娉曟墽琛?<b>{label}</b>\n"
                f"褰撳墠绉垎: <code>{balance}</code>\n"
                f"闇€瑕佺Н鍒? <code>{required}</code>\n"
                f"杩樺樊绉垎: <code>{missing}</code>\n\n"
                f"绉垎瑙勫垯锛氭瘡鏃ョ鍒?鏈夋晥鍙戣█婊?{MESSAGE_MIN_LENGTH} 瀛?鑾峰緱 <b>{MESSAGE_POINTS}</b> 绉垎锛?
                f"姣忔棩涓婇檺 {MESSAGE_DAILY_CAP} 鍒嗐€?
            ),
            parse_mode="HTML",
        )
        return False

    @bot.message_handler(commands=["start", "help"])
    def send_welcome(message):
        welcome_text = (
            "馃尅锔?<b>PolyWeather 澶╂皵鏌ヨ鏈哄櫒浜?/b>\n\n"
            "鍙敤鎸囦护:\n"
            f"/city [鍩庡競鍚峕 - 鏌ヨ鍩庡競澶╂皵棰勬祴涓庡疄娴?(娑堣€?{CITY_QUERY_COST} 绉垎)\n"
            f"/deb [鍩庡競鍚峕 - 鏌ョ湅 DEB 铻嶅悎棰勬祴鍑嗙‘鐜?(娑堣€?{DEB_QUERY_COST} 绉垎)\n"
            "/top - 鏌ョ湅绉垎鎺掕姒淺n"
            "/id - 鑾峰彇褰撳墠鑱婂ぉ鐨?Chat ID\n\n"
            "绀轰緥: <code>/city 浼︽暒</code>\n"
            f"馃挕 <i>鎻愮ず: 姣忔棩绛惧埌(鏈夋晥鍙戣█婊?{MESSAGE_MIN_LENGTH} 瀛?鑾峰緱 <b>{MESSAGE_POINTS}</b> 绉垎锛?
            f"姣忔棩涓婇檺 {MESSAGE_DAILY_CAP} 鍒嗐€?/i>"
        )
        bot.reply_to(message, welcome_text, parse_mode="HTML")

    @bot.message_handler(commands=["id"])
    def get_chat_id(message):
        bot.reply_to(
            message,
            f"馃幆 褰撳墠鑱婂ぉ鐨?Chat ID 鏄? <code>{message.chat.id}</code>",
            parse_mode="HTML",
        )

    @bot.message_handler(commands=["top"])
    def show_points(message):
        """鏄剧ず褰撳墠鐢ㄦ埛鐨勭Н鍒嗗強鎺掕姒?""
        user = message.from_user
        db.upsert_user(user.id, _display_name(user))
        user_info = db.get_user(user.id)
        
        leaderboard = db.get_leaderboard(limit=5)
        rank_text = "馃弳 <b>PolyWeather 娲昏穬搴︽帓琛屾</b>\n"
        rank_text += "鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€\n"
        for i, entry in enumerate(leaderboard):
            medal = ["馃", "馃", "馃", "  ", "  "][i] if i < 5 else "  "
            rank_text += f"{medal} {entry['username'][:12]}: <b>{entry['points']}</b> 鐐筡n"
        
        if user_info:
            rank_text += "鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€\n"
            rank_text += (
                f"馃懁 <b>鎴戠殑鐘舵€侊細</b>\n"
                f"鈹?绉垎: <code>{user_info['points']}</code>\n"
                f"鈹?鍙戣█: <code>{user_info['message_count']}</code> 娆n"
                f"鈹?浠婃棩鍙戣█绉垎: <code>{user_info.get('daily_points') or 0}/{MESSAGE_DAILY_CAP}</code>\n"
                f"鈹?/city 娑堣€? <code>{CITY_QUERY_COST}</code> | /deb 娑堣€? <code>{DEB_QUERY_COST}</code>"
            )
        
        bot.send_message(message.chat.id, rank_text, parse_mode="HTML")
    @bot.message_handler(commands=["deb"])
    def deb_accuracy(message):
        """鏌ヨ DEB 铻嶅悎棰勬祴鐨勮繎 7 澶╁噯纭巼銆?""
        try:
            parts = message.text.split(maxsplit=1)
            if len(parts) < 2:
                bot.reply_to(
                    message,
                    "鉂?鐢ㄦ硶: <code>/deb ankara</code>",
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
                    f"鉂?鏆傛棤 {city_name} 鐨勫巻鍙叉暟鎹€?,
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
                f"馃搳 <b>DEB 鍑嗙‘鐜囨姤鍛?- {city_name.title()}</b>",
                "",
                "馃搮 <b>杩?鏃ヨ褰曪細</b>",
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
                    lines.append(f"  {date_str}: 馃搷 浠婂ぉ杩涜涓?(瀹炴祴鏆?{actual:.1f})")
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
                        result_icon = "鉁?
                        err_text = f"鍋忓樊{abs(err):.1f}掳"
                    elif err < 0:
                        result_icon = "鉂?
                        err_text = f"浣庝及{abs(err):.1f}掳"
                    else:
                        result_icon = "鉂?
                        err_text = f"楂樹及{abs(err):.1f}掳"

                    retro = "鈮? if "deb_prediction" not in record else ""
                    lines.append(
                        f"  {date_str}: DEB {retro}{deb_pred:.1f}鈫抺deb_wu} vs 瀹炴祴 {actual:.1f}鈫抺actual_wu} "
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
                    f"馃幆 <b>DEB 鎬绘垬缁╋細</b>WU鍛戒腑 {hits}/{total_days} (<b>{hit_rate:.0f}%</b>) | MAE: {deb_mae:.1f}掳"
                )

                if model_errors:
                    lines.append("")
                    lines.append("馃搱 <b>妯″瀷 MAE 瀵规瘮锛?/b>")
                    model_maes = {m: sum(e) / len(e) for m, e in model_errors.items() if e}
                    sorted_models = sorted(model_maes.items(), key=lambda item: item[1])
                    for model, mae in sorted_models:
                        tag = " 猸? if mae <= deb_mae else ""
                        lines.append(f"  {model}: {mae:.1f}掳{tag}")
                    lines.append(f"  <b>DEB铻嶅悎: {deb_mae:.1f}掳</b>")

                mean_bias = sum(signed_errors) / len(signed_errors)
                underest = sum(1 for e in signed_errors if e < -0.3)
                overest = sum(1 for e in signed_errors if e > 0.3)
                accurate = total_days - underest - overest

                lines.append("")
                lines.append("馃攳 <b>鍋忓樊鍒嗘瀽锛?/b>")
                if abs(mean_bias) > 0.3:
                    bias_label = "绯荤粺鎬т綆浼? if mean_bias < 0 else "绯荤粺鎬ч珮浼?
                    lines.append(f"  鈿狅笍 {bias_label}锛氬钩鍧囧亸宸?{mean_bias:+.1f}掳")
                else:
                    lines.append(f"  鉁?鏁翠綋鏃犳槑鏄剧郴缁熷亸宸細骞冲潎鍋忓樊 {mean_bias:+.1f}掳")
                lines.append(f"  浣庝及 {underest} 娆?| 楂樹及 {overest} 娆?| 鍑嗙‘ {accurate} 娆?)

                lines.append("")
                lines.append("馃挕 <b>寤鸿锛?/b>")
                if underest > overest and abs(mean_bias) > 0.5:
                    lines.append(
                        f"  璇ュ煄甯傛ā鍨嬮泦浣撲綆浼拌秼鍔挎槑鏄撅紙{mean_bias:+.1f}掳锛夛紝瀹為檯鏈€楂樻俯鍙兘姣?DEB 铻嶅悎鍊奸珮 "
                        f"{abs(mean_bias):.0f}-{abs(mean_bias) + 0.5:.0f}掳銆備氦鏄撴椂寤鸿閫傚綋鐪嬮珮銆?
                    )
                elif overest > underest and abs(mean_bias) > 0.5:
                    lines.append(
                        f"  璇ュ煄甯傛ā鍨嬮泦浣撻珮浼拌秼鍔挎槑鏄撅紙{mean_bias:+.1f}掳锛夛紝瀹為檯鏈€楂樻俯鍙兘浣庝簬 DEB 铻嶅悎鍊笺€備氦鏄撴椂娉ㄦ剰杩介珮椋庨櫓銆?
                    )
                elif deb_mae > 1.5:
                    lines.append(f"  杩戞湡妯″瀷娉㈠姩杈冨ぇ锛圡AE {deb_mae:.1f}掳锛夛紝寤鸿闄嶄綆瀵瑰崟涓€鏃ラ娴嬬殑淇′换搴︺€?)
                elif hit_rate >= 60:
                    lines.append("  DEB 杩戞湡琛ㄧ幇绋冲畾锛屽彲缁х画浣滀负涓昏鍙傝€冦€?)
                else:
                    lines.append("  杩戞湡鍑嗙‘鐜囦竴鑸紝寤鸿缁撳悎涓荤珯瀹炴祴涓庡懆杈圭珯鐐瑰叡鍚屽垽鏂€?)

                lines.append("")
                lines.append("馃摑 MAE = 骞冲潎缁濆璇樊锛岃秺灏忚秺鍑嗐€傗瓙 = 浼樹簬 DEB 铻嶅悎銆?)
                lines.append("馃棑 缁熻绐楀彛锛氳繎7澶╂粴鍔ㄦ牱鏈€?)
            else:
                lines.append("")
                lines.append("鈴?杩?澶╁皻鏃犲畬鏁寸殑 DEB 棰勬祴璁板綍銆?)

            lines.append("")
            lines.append(f"馃挸 鏈娑堣€?<code>{DEB_QUERY_COST}</code> 绉垎銆?)
            bot.reply_to(message, "\n".join(lines), parse_mode="HTML")
        except Exception as e:
            bot.reply_to(message, f"鉂?鏌ヨ澶辫触: {e}")

    @bot.message_handler(commands=["city"])

    def get_city_info(message):
        """鏌ヨ鎸囧畾鍩庡競鐨勫ぉ姘旇鎯?""
        try:
            parts = message.text.split(maxsplit=1)
            if len(parts) < 2:
                bot.reply_to(
                    message,
                    "鉂?璇疯緭鍏ュ煄甯傚悕绉癨n\n鐢ㄦ硶: <code>/city chicago</code>",
                    parse_mode="HTML",
                )
                return

            from src.data_collection.city_registry import ALIASES, CITY_REGISTRY
            city_input = parts[1].strip().lower()
            
            # --- 浣跨敤缁熶竴娉ㄥ唽琛ㄨВ鏋愬煄甯?---
            SUPPORTED_CITIES = list(CITY_REGISTRY.keys())

            # 1. 绗竴浼樺厛绾э細鍏ㄧО鎴栧埆鍚嶅畬鍏ㄥ尮閰?
            city_name = ALIASES.get(city_input)
            if not city_name and city_input in SUPPORTED_CITIES:
                city_name = city_input

            # 2. 绗簩浼樺厛绾э細鍓嶇紑妯＄硦鍖归厤
            if not city_name and len(city_input) >= 2:
                # 鎼滃埆鍚?
                for k, v in ALIASES.items():
                    if k.startswith(city_input):
                        city_name = v
                        break
                # 鎼滃煄甯傚叏鍚?
                if not city_name:
                    for full_name in SUPPORTED_CITIES:
                        if full_name.startswith(city_input):
                            city_name = full_name
                            break

            # 3. 鏈壘鍒?鈫?鎶ラ敊
            if not city_name:
                city_list = ", ".join(sorted(SUPPORTED_CITIES))
                bot.reply_to(
                    message,
                    f"鉂?鏈壘鍒板煄甯? <b>{city_input}</b>\n\n"
                    f"鏀寔鐨勫煄甯? {city_list}",
                    parse_mode="HTML",
                )
                return

            if not _ensure_query_points(message, CITY_QUERY_COST, "/city"):
                return

            bot.send_message(
                message.chat.id, f"馃攳 姝ｅ湪鏌ヨ {city_name.title()} 鐨勫ぉ姘旀暟鎹?.."
            )

            coords = weather.get_coordinates(city_name)
            if not coords:
                bot.reply_to(message, f"鉂?鏈壘鍒板煄甯傚潗鏍? {city_name}")
                return

            weather_data = weather.fetch_all_sources(
                city_name, lat=coords["lat"], lon=coords["lon"]
            )
            open_meteo = weather_data.get("open-meteo", {})
            metar = weather_data.get("metar", {})
            mgm = weather_data.get("mgm") or {}

            # 鏁板€煎綊涓€鍖?
            def _sf(v):
                if v is None:
                    return None
                try:
                    return float(v)
                except Exception:
                    return None

            temp_unit = open_meteo.get("unit", "celsius")
            temp_symbol = "掳F" if temp_unit == "fahrenheit" else "掳C"

            # --- 1. 绱у噾 Header (鍩庡競 + 鏃堕棿 + 椋庨櫓鐘舵€? ---
            local_time = open_meteo.get("current", {}).get("local_time", "")
            time_str = local_time.split(" ")[1][:5] if " " in local_time else "N/A"

            risk_profile = get_city_risk_profile(city_name)
            risk_emoji = risk_profile.get("risk_level", "鈿?) if risk_profile else "鈿?

            msg_header = f"馃搷 <b>{city_name.title()}</b> ({time_str}) {risk_emoji}"
            msg_lines = [msg_header]

            # --- 2. 绱у噾 椋庨櫓鎻愮ず ---
            if risk_profile:
                bias = risk_profile.get("bias", "卤0.0")
                msg_lines.append(
                    f"鈿狅笍 {risk_profile.get('airport_name', '')}: {bias}{temp_symbol} | {risk_profile.get('warning', '')}"
                )

            # --- 3. 绱у噾 棰勬祴鍖?---
            daily = open_meteo.get("daily", {})
            dates = daily.get("time", [])[:3]
            max_temps = daily.get("temperature_2m_max", [])[:3]

            nws_high = _sf(weather_data.get("nws", {}).get("today_high"))
            mgm_high = _sf(mgm.get("today_high"))
            mb_high = _sf(weather_data.get("meteoblue", {}).get("today_high"))

            # 浠婂ぉ瀵规瘮
            today_t = max_temps[0] if max_temps else "N/A"
            comp_parts = []
            sources = ["Open-Meteo"]

            if mb_high is not None:
                sources.append("MB")
                comp_parts.append(
                    f"MB: {mb_high:.1f}{temp_symbol}"
                    if isinstance(mb_high, (int, float))
                    else f"MB: {mb_high}"
                )
            if nws_high is not None:
                sources.append("NWS")
                comp_parts.append(
                    f"NWS: {nws_high:.1f}{temp_symbol}"
                    if isinstance(nws_high, (int, float))
                    else f"NWS: {nws_high}"
                )
            if mgm_high is not None:
                sources.append("MGM")
                comp_parts.append(
                    f"馃嚬馃嚪 MGM: {mgm_high:.1f}{temp_symbol}"
                    if isinstance(mgm_high, (int, float))
                    else f"馃嚬馃嚪 MGM: {mgm_high}"
                )

            # 妫€鏌ユ槸鍚︽湁鏄捐憲鍒嗘 (瓒呰繃 5掳F 鎴?2.5掳C)
            divergence_warning = ""
            if mb_high is not None and max_temps:
                diff = abs(mb_high - (_sf(max_temps[0]) or 0))
                threshold = 5.0 if temp_unit == "fahrenheit" else 2.5
                if diff > threshold:
                    divergence_warning = (
                        f" 鈿狅笍 <b>妯″瀷鏄捐憲鍒嗘 ({diff:.1f}{temp_symbol})</b>"
                    )

            comp_str = f" ({' | '.join(comp_parts)})" if comp_parts else ""
            sources_str = " | ".join(sources)

            msg_lines.append(f"\n馃搳 <b>棰勬姤 ({sources_str})</b>")
            msg_lines.append(
                f"馃憠 <b>浠婂ぉ: {today_t}{temp_symbol}{comp_str}</b>{divergence_warning}"
            )

            # 鏄庡悗澶?
            if len(dates) > 1:
                future_forecasts = []
                mgm_daily = mgm.get("daily_forecasts", {}) or {}
                for d, t in zip(dates[1:], max_temps[1:]):
                    # 妫€鏌?MGM 鏄惁鏈夎鏃ユ湡鐨勯鎶?
                    mgm_f = mgm_daily.get(d)
                    if mgm_f is not None:
                        future_forecasts.append(
                            f"{d[5:]}: {t}{temp_symbol} | 馃嚬馃嚪 <b>MGM: {mgm_f}{temp_symbol}</b>"
                        )
                    else:
                        future_forecasts.append(f"{d[5:]}: {t}{temp_symbol}")
                msg_lines.append("馃搮 " + " | ".join(future_forecasts))

            # --- 3.5 鏃ュ嚭鏃ヨ惤 + 鏃ョ収鏃堕暱 ---
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
                sun_line = f"馃寘 鏃ュ嚭 {sunrise_t} | 馃寚 鏃ヨ惤 {sunset_t}"
                if sunshine_durations:
                    sunshine_hours = sunshine_durations[0] / 3600  # 绉?-> 灏忔椂
                    sun_line += f" | 鈽€锔?鏃ョ収 {sunshine_hours:.1f}h"
                msg_lines.append(sun_line)

            # --- 4. 鏍稿績 瀹炴祴鍖?(鍚堝苟 METAR 鍜?MGM) ---
            # 鍩虹鏁版嵁浼樺厛鐢?METAR
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
            metar_age_min = None  # METAR 鏁版嵁骞撮緞锛堝垎閽燂級
            main_source = "METAR" if metar else "MGM"

            if metar:
                obs_t = metar.get("observation_time", "")
                try:
                    if "T" in obs_t:
                        from datetime import datetime, timezone, timedelta

                        dt = datetime.fromisoformat(obs_t.replace("Z", "+00:00"))
                        utc_offset = open_meteo.get("utc_offset", 0)
                        local_dt = dt.astimezone(
                            timezone(timedelta(seconds=utc_offset))
                        )
                        obs_t_str = local_dt.strftime("%H:%M")
                        # 璁＄畻鏁版嵁骞撮緞
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

            # 鏁版嵁骞撮緞鏍囨敞
            age_tag = ""
            if metar_age_min is not None:
                if metar_age_min >= 60:
                    age_tag = f" 鈿狅笍{metar_age_min}鍒嗛挓鍓?
                elif metar_age_min >= 30:
                    age_tag = f" 鈴硔metar_age_min}鍒嗛挓鍓?

            max_str = ""
            if max_p is not None:
                import math

                settled_val = math.floor(max_p + 0.5)
                max_str = f" (鏈€楂? {max_p}{temp_symbol}"
                if max_p_time:
                    max_str += f" @{max_p_time}"
                max_str += f" 鈫?WU {settled_val}{temp_symbol})"

            # --- 澶╂皵鐘跺喌鎬荤粨 ---
            wx_summary = ""
            # 浼樺厛浣跨敤 METAR 澶╂皵鐜拌薄
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
                    wx_summary = "鉀堬笍 闆锋毚"
                elif {"+RA", "+SN"} & wx_tokens:
                    wx_summary = "馃導锔?澶ч洦" if "+RA" in wx_tokens else "鉂勶笍 澶ч洩"
                elif rain_codes & wx_tokens:
                    wx_summary = (
                        "馃導锔?灏忛洦" if {"-RA", "-DZ", "DZ"} & wx_tokens else "馃導锔?涓嬮洦"
                    )
                elif snow_codes & wx_tokens:
                    wx_summary = "鉂勶笍 涓嬮洩"
                elif fog_codes & wx_tokens:
                    wx_summary = "馃尗锔?闆?闇?

            # 濡傛灉 METAR 娌℃湁鐗规畩鐜拌薄锛岀敤浜戦噺鎺ㄦ柇
            if not wx_summary:
                # 浼樺厛 METAR 浜戝眰锛屽洖閫€ MGM
                cover_code = ""
                if metar_clouds:
                    cover_code = metar_clouds[-1].get("cover", "")

                if cover_code in ("SKC", "CLR") or (
                    cover_code == "" and mgm_cloud is not None and mgm_cloud <= 1
                ):
                    wx_summary = "鈽€锔?鏅?
                elif cover_code == "FEW" or (
                    cover_code == "" and mgm_cloud is not None and mgm_cloud <= 2
                ):
                    wx_summary = "馃尋锔?鏅撮棿灏戜簯"
                elif cover_code == "SCT" or (
                    cover_code == "" and mgm_cloud is not None and mgm_cloud <= 4
                ):
                    wx_summary = "鉀?鏅撮棿澶氫簯"
                elif cover_code == "BKN" or (
                    cover_code == "" and mgm_cloud is not None and mgm_cloud <= 6
                ):
                    wx_summary = "馃尌锔?澶氫簯"
                elif cover_code == "OVC" or (
                    cover_code == "" and mgm_cloud is not None and mgm_cloud <= 8
                ):
                    wx_summary = "鈽侊笍 闃村ぉ"
                elif mgm_cloud is not None:
                    cloud_names = {
                        0: "鈽€锔?鏅?,
                        1: "馃尋锔?鏅?,
                        2: "馃尋锔?灏戜簯",
                        3: "鉀?鏁ｄ簯",
                        4: "鉀?鏁ｄ簯",
                        5: "馃尌锔?澶氫簯",
                        6: "馃尌锔?澶氫簯",
                        7: "鈽侊笍 闃?,
                        8: "鈽侊笍 闃村ぉ",
                    }
                    wx_summary = cloud_names.get(mgm_cloud, "")

            wx_display = f" {wx_summary}" if wx_summary else ""
            msg_lines.append(
                f"\n鉁堬笍 <b>瀹炴祴 ({main_source}): {cur_temp}{temp_symbol}</b>{max_str} |{wx_display} | {obs_t_str}{age_tag}"
            )

            if mgm:
                m_c = mgm.get("current", {})
                # 缈昏瘧椋庡悜
                wind_dir = m_c.get("wind_dir")
                wind_speed_ms = m_c.get("wind_speed_ms")
                dir_str = ""
                if wind_dir is not None:
                    dirs = ["鍖?, "涓滃寳", "涓?, "涓滃崡", "鍗?, "瑗垮崡", "瑗?, "瑗垮寳"]
                    dir_str = dirs[int((float(wind_dir) + 22.5) % 360 / 45)] + "椋?"

                # 浣撴劅鍜屾箍搴︼紙璺宠繃缂哄け鏁版嵁锛?
                feels_like = m_c.get("feels_like")
                humidity = m_c.get("humidity")
                if feels_like is not None or humidity is not None:
                    parts = []
                    if feels_like is not None:
                        parts.append(f"馃尅锔?浣撴劅: {feels_like}掳C")
                    
                    # 閽堝瀹夊崱鎷夛紝琛ュ厖甯傚尯(Center)瀹炴祴鍊?
                    ankara_center = next((s for s in weather_data.get("mgm_nearby", []) if "B枚lge/Center" in s.get("name", "")), None)
                    if ankara_center:
                        parts.append(f"Ankara (B枚lge/Center): <b>{ankara_center['temp']}掳C</b>")
                        
                    if humidity is not None:
                        parts.append(f"馃挧 {humidity}%")
                    msg_lines.append(f"   [MGM] {' | '.join(parts)}")

                # 椋庡喌锛堣烦杩囩己澶辨暟鎹級
                if wind_dir is not None and wind_speed_ms is not None:
                    msg_lines.append(
                        f"   [MGM] 馃尙锔?{dir_str}{wind_dir}掳 ({wind_speed_ms} m/s) | 馃挧 闄嶆按: {m_c.get('rain_24h') or 0}mm"
                    )

                # 鏂板锛氭皵鍘嬪拰浜戦噺
                extra_parts = []
                pressure = m_c.get("pressure")
                if pressure is not None:
                    extra_parts.append(f"馃尅 姘斿帇: {pressure}hPa")
                cloud_cover = m_c.get("cloud_cover")
                if cloud_cover is not None:
                    cloud_desc_map = {
                        0: "鏅存湕",
                        1: "灏戜簯",
                        2: "灏戜簯",
                        3: "鏁ｄ簯",
                        4: "鏁ｄ簯",
                        5: "澶氫簯",
                        6: "澶氫簯",
                        7: "寰堝浜?,
                        8: "闃村ぉ",
                    }
                    cloud_text = cloud_desc_map.get(cloud_cover, f"{cloud_cover}/8")
                    extra_parts.append(f"鈽侊笍 浜戦噺: {cloud_text}({cloud_cover}/8)")
                mgm_max = m_c.get("mgm_max_temp")
                if mgm_max is not None:
                    extra_parts.append(f"馃尅锔?MGM鏈€楂? {mgm_max}掳C")
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
                        "BKN": "澶氫簯",
                        "OVC": "闃村ぉ",
                        "FEW": "灏戜簯",
                        "SCT": "鏁ｄ簯",
                        "SKC": "鏅?,
                        "CLR": "鏅?,
                    }
                    main = clouds[-1]
                    cloud_desc = f"鈽侊笍 {c_map.get(main.get('cover'), main.get('cover'))}"

                prefix = "[METAR]" if mgm else "   "
                if not mgm:
                    msg_lines.append(
                        f"   {prefix} 馃挩 {wind or 0}kt ({wind_dir or 0}掳) | 馃憗锔?{vis or 10}mi"
                    )

                if cloud_desc:
                    msg_lines.append(
                        f"   {prefix} {cloud_desc} | 馃憗锔?{vis or 10}mi | 馃挩 {wind or 0}kt"
                    )

            # --- 5. 鎬佸娍鐗瑰緛鎻愬彇 ---
            feature_str, ai_context = analyze_weather_trend(
                weather_data, temp_symbol, city_name
            )
            if feature_str:
                # 浠呭皢鏈€鏍稿績鐨勪俊鎭睍绀虹粰鐢ㄦ埛浣滀负"鎬佸娍鍒嗘瀽"
                # 浣嗗悗闈細鎶婃洿鍏ㄧ殑鏁版嵁浼犵粰 AI
                msg_lines.append("\n馃挕 <b>鍒嗘瀽</b>:")
                for line in feature_str.split("\n"):
                    if line.strip():
                        msg_lines.append(f"- {line.strip()}")

                # --- 6. Groq AI 娣卞害鍒嗘瀽 ---
                try:
                    from src.analysis.ai_analyzer import get_ai_analysis
                    # 鏋勫缓鏇村叏鐨勮儗鏅暟鎹粰 AI

                    # 琛ュ厖澶氭ā鍨嬪垎姝?
                    mm = weather_data.get("multi_model", {})
                    if mm.get("forecasts"):
                        mm_str = " | ".join(
                            [
                                f"{k}:{v}{temp_symbol}"
                                for k, v in mm["forecasts"].items()
                                if v
                            ]
                        )
                        ai_context += f"\n妯″瀷鍒嗘: {mm_str}"

                    ai_result = get_ai_analysis(ai_context, city_name, temp_symbol)
                    if ai_result:
                        msg_lines.append(f"\n{ai_result}")
                except Exception as e:
                    logger.error(f"璋冪敤 Groq AI 鍒嗘瀽澶辫触: {e}")

            msg_lines.append(f"\n馃挸 鏈娑堣€?<b>{CITY_QUERY_COST}</b> 绉垎銆?)
            bot.send_message(message.chat.id, "\n".join(msg_lines), parse_mode="HTML")

        except Exception as e:
            import traceback

            logger.error(f"鏌ヨ澶辫触: {e}\n{traceback.format_exc()}")
            bot.reply_to(message, f"鉂?鏌ヨ澶辫触: {e}")

    @bot.message_handler(func=lambda message: True, content_types=['text'])
    def track_activity(message):
        """鍏ㄩ噺鐩戝惉娑堟伅锛岀敤浜庤褰曠兢鍐呭彂瑷€绉垎(闈炴寚浠ゆ秷鎭?"""
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

    logger.info("馃 Bot 鍚姩涓?..")
    bot.infinity_polling()


if __name__ == "__main__":
    start_bot()

