import sys
import os
from typing import List
import telebot  # type: ignore
from loguru import logger  # type: ignore

# 确保项目根目录在 sys.path 中
project_root = os.path.dirname(os.path.abspath(__file__))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from src.utils.config_loader import load_config  # type: ignore # noqa: E402
from src.data_collection.weather_sources import WeatherDataCollector  # type: ignore # noqa: E402
from src.data_collection.city_risk_profiles import get_city_risk_profile  # type: ignore # noqa: E402
from src.analysis.deb_algorithm import calculate_dynamic_weights, update_daily_record  # noqa: E402


def analyze_weather_trend(weather_data, temp_symbol, city_name=None):
    """根据实测与预测分析气温态势，增加峰值时刻预测"""
    insights: List[str] = []
    ai_features: List[str] = []

    metar = weather_data.get("metar", {})
    open_meteo = weather_data.get("open-meteo", {})
    mb = weather_data.get("meteoblue", {})
    nws = weather_data.get("nws", {})
    weather_data.get("mgm", {})

    if not metar or not open_meteo:
        return "", ""

    # 数值归一化：防止 JSON 反序列化后的 str 类型炸数学运算
    def _sf(v):
        """safe float"""
        if v is None:
            return None
        try:
            return float(v)
        except Exception:
            return None

    _sf(metar.get("current", {}).get("temp"))
    max_so_far = _sf(metar.get("current", {}).get("max_temp_so_far"))
    daily = open_meteo.get("daily", {})
    hourly = open_meteo.get("hourly", {})
    times = hourly.get("time", [])
    temps = hourly.get("temperature_2m", [])

    # === 新核心：动态集合权重预报 (DEB) ===
    # 抽取各个确定性预报值构成的字典
    current_forecasts = {}
    if daily.get("temperature_2m_max"):
        current_forecasts["Open-Meteo"] = _sf(daily.get("temperature_2m_max")[0])
    if mb.get("today_high") is not None:
        current_forecasts["Meteoblue"] = _sf(mb.get("today_high"))
    if nws.get("today_high") is not None:
        current_forecasts["NWS"] = _sf(nws.get("today_high"))

    mm_forecasts = weather_data.get("multi_model", {}).get("forecasts", {})
    for m_name, m_val in mm_forecasts.items():
        if m_val is not None:
            current_forecasts[m_name] = _sf(m_val)

    # 从 URL/入参里我们暂时拿不到城名，为了 DEB 追溯我们在后方的总控那里提取。这里的 analyze_weather_trend 主要计算最高预留。
    forecast_highs = [h for h in current_forecasts.values() if h is not None]
    forecast_high = max(forecast_highs) if forecast_highs else None
    min(forecast_highs) if forecast_highs else forecast_high
    forecast_median = (
        sorted(forecast_highs)[len(forecast_highs) // 2] if forecast_highs else None
    )

    wind_speed = metar.get("current", {}).get("wind_speed_kt", 0)

    # 获取当地时间小时和分钟
    local_time_full = open_meteo.get("current", {}).get("local_time", "")
    try:
        local_date_str = local_time_full.split(" ")[0]
        time_parts = local_time_full.split(" ")[1].split(":")
        local_hour = int(time_parts[0])
        local_minute = int(time_parts[1]) if len(time_parts) > 1 else 0
    except Exception:
        from datetime import datetime

        local_date_str = datetime.now().strftime("%Y-%m-%d")
        local_hour = datetime.now().hour
        local_minute = datetime.now().minute
    local_hour_frac = local_hour + local_minute / 60  # 含分钟的精确小时

    # === DEB 融合渲染 ===
    if city_name and current_forecasts:
        blended_high, weight_info = calculate_dynamic_weights(
            city_name, current_forecasts
        )
        if blended_high is not None:
            insights.insert(
                0,
                f"🧬 <b>DEB 融合预测</b>：<b>{blended_high}{temp_symbol}</b> ({weight_info})",
            )
            ai_features.append(
                f"🧬 DEB系统已通过历史偏差矫正算出期待点是: {blended_high}{temp_symbol}。"
            )

        # 顺便把今天的预测记录下来供之后回测用
        try:
            update_daily_record(
                city_name,
                local_date_str,
                current_forecasts,
                max_so_far,
                deb_prediction=blended_high,
            )
        except Exception:
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
            all_rising = all(
                temps_only[i] >= temps_only[i + 1]
                for i in range(min(3, len(temps_only)) - 1)
            )
            all_falling = all(
                temps_only[i] <= temps_only[i + 1]
                for i in range(min(3, len(temps_only)) - 1)
            )
            trend_display = " → ".join(
                [f"{t}{temp_symbol}@{tm}" for tm, t in recent_temps[:3]]
            )
            if all_same:
                trend_desc = f"📉 温度已停滞（{trend_display}），大概率到顶。"
            elif all_rising and diff > 0:
                trend_desc = f"📈 仍在升温（{trend_display}）。"
            elif all_falling and diff < 0:
                trend_desc = f"📉 已开始降温（{trend_display}）。"
            else:
                trend_desc = f"📊 温度波动中（{trend_display}）。"
        elif diff == 0:
            trend_desc = f"📉 温度持平（最近两条都是 {latest_val}{temp_symbol}）。"
        elif diff > 0:
            trend_desc = f"📈 仍在升温（{prev_val} → {latest_val}{temp_symbol}）。"
        else:
            trend_desc = f"📉 已开始降温（{prev_val} → {latest_val}{temp_symbol}）。"

    is_cooling = "降温" in trend_desc

    om_today = daily.get("temperature_2m_max", [None])[0]

    # === 峰值时刻预测（提前计算，供概率引擎使用）===
    # 只在白天时段 (8:00-19:00) 内搜索，避免夜间温差小时把凌晨误判为峰值
    peak_hours = []
    if times and temps and om_today is not None:
        for t_str, temp in zip(times, temps):
            if t_str.startswith(local_date_str) and abs(temp - om_today) <= 0.2:
                hour = int(t_str.split("T")[1][:2])
                if 8 <= hour <= 19:  # 只考虑白天
                    peak_hours.append(t_str.split("T")[1][:5])
    if peak_hours:
        first_peak_h = int(peak_hours[0].split(":")[0])
        last_peak_h = int(peak_hours[-1].split(":")[0])
    else:
        first_peak_h, last_peak_h = 13, 15

    # === 集合预报区间 ===
    ensemble = weather_data.get("ensemble", {})
    ens_p10 = _sf(ensemble.get("p10"))
    ens_p90 = _sf(ensemble.get("p90"))
    ens_median = _sf(ensemble.get("median"))
    if ens_p10 is not None and ens_p90 is not None and ens_median is not None:
        msg1 = f"📊 <b>集合预报</b>：中位数 {ens_median}{temp_symbol}，90% 区间 [{ens_p10}{temp_symbol} - {ens_p90}{temp_symbol}]。"
        if not is_cooling:
            insights.append(msg1)
        ai_features.append(msg1)

        if om_today is not None:
            if om_today > ens_p90 and (
                max_so_far is None or max_so_far < om_today - 0.5
            ):
                msg2 = f"⚡ 预报偏高：确定性预报 {om_today}{temp_symbol} 超集合90%上限，更可能接近 {ens_median}{temp_symbol}。"
                ai_features.append(msg2)
            elif om_today < ens_p10 and (max_so_far is None or max_so_far < ens_median):
                msg2 = f"⚡ 预报偏低：确定性预报 {om_today}{temp_symbol} 低于集合90%下限，更可能接近 {ens_median}{temp_symbol}。"
                ai_features.append(msg2)

        # === 数学概率计算（基于集合预报正态分布拟合）===
        import math as _math

        # 用 P10/P90 反推标准差: P10 = median - 1.28*sigma, P90 = median + 1.28*sigma
        sigma = (ens_p90 - ens_p10) / 2.56
        if sigma < 0.1:
            sigma = 0.1  # 防止除以零

        # 用 DEB 历史 MAE 作为 σ 的下限
        # 如果模型过去的平均误差远大于集合预报的 σ，说明集合低估了真实不确定性
        if city_name:
            from src.analysis.deb_algorithm import get_deb_accuracy

            acc = get_deb_accuracy(city_name)
            if acc:
                _, hist_mae, _, _ = acc
                if hist_mae > sigma:
                    sigma = hist_mae

        # === Shock Score: 气象突变软评分 (0~1) ===
        # 用近 4 条 METAR 的风向/云量/气压变化评估环境稳定性
        # 越高 = 越不稳定 = σ 放宽
        shock_score = 0.0
        recent_obs = metar.get("recent_obs", [])
        if len(recent_obs) >= 2:
            oldest = recent_obs[-1]  # 最早
            newest = recent_obs[0]  # 最新

            # ① 风向变化项 (0~0.4)
            # 角度差 × 风速放大系数（风速 > 10kt 时权重高，弱风忽略噪声）
            wdir_old = _sf(oldest.get("wdir"))
            wdir_new = _sf(newest.get("wdir"))
            wspd_new = _sf(newest.get("wspd")) or 0
            if wdir_old is not None and wdir_new is not None:
                angle_diff = abs(wdir_new - wdir_old)
                if angle_diff > 180:
                    angle_diff = 360 - angle_diff
                wind_weight = min(wspd_new / 15.0, 1.0)
                wind_shock = min(angle_diff / 90.0, 1.0) * wind_weight * 0.4
                shock_score += wind_shock

            # ② 云量阶跃项 (0~0.35)
            # CLR=0, FEW=1, SCT=2, BKN=3, OVC=4
            cloud_old = oldest.get("cloud_rank", 0)
            cloud_new = newest.get("cloud_rank", 0)
            cloud_jump = abs(cloud_new - cloud_old)
            cloud_shock = min(cloud_jump / 3.0, 1.0) * 0.35
            shock_score += cloud_shock

            # ③ 气压变化项 (0~0.25)
            # 2h 内气压变化超过 2hPa 视为异常
            altim_old = _sf(oldest.get("altim"))
            altim_new = _sf(newest.get("altim"))
            if altim_old is not None and altim_new is not None:
                press_diff = abs(altim_new - altim_old)
                press_shock = min(press_diff / 4.0, 1.0) * 0.25
                shock_score += press_shock

        # 应用 shock_score: 放宽 σ
        if shock_score > 0.05:
            sigma *= 1 + 0.5 * shock_score

        # 时间修正：根据当前时间距峰值的位置调整 σ
        # 峰值前：σ 不变（不确定性最大）
        # 峰值窗口内：σ 缩小 30%（正在定型）
        # 峰值后：σ 缩小 70%（基本确定）
        if local_hour_frac > last_peak_h:
            sigma *= 0.3  # 峰值已过，结果基本锁定
        elif first_peak_h <= local_hour_frac <= last_peak_h:
            sigma *= 0.7  # 正在峰值窗口
    # === 判定是否为“死盘” (Dead Market) ===
    # 逻辑：深夜且气温大幅回落，或者已过峰值时段且明显降温
    is_dead_market = False
    current_temp = _sf(metar.get("current", {}).get("temp"))
    if max_so_far is not None and current_temp is not None:
        # 深夜死盘：21:00 后，回落超过 3°C
        if local_hour >= 21 and max_so_far - current_temp >= 3.0:
            is_dead_market = True
        # 峰值后死盘：已过最热窗口，回落超过 1.5°C
        elif local_hour > last_peak_h and max_so_far - current_temp >= 1.5:
            is_dead_market = True

    if ens_p10 is not None and ens_p90 is not None and not is_dead_market:
        # --- Reality-anchored μ ---
        # Determine peak status
        if local_hour_frac > last_peak_h:
            _peak_status = "past"
        elif first_peak_h <= local_hour_frac <= last_peak_h:
            _peak_status = "in_window"
        else:
            _peak_status = "before"

        # Compute forecast miss magnitude
        forecast_miss_deg = 0
        if max_so_far is not None and forecast_median is not None:
            forecast_miss_deg = round(forecast_median - max_so_far, 1)

        # If peak is past/in_window AND actual max is significantly below
        # forecasts, anchor μ on actual max, not on failed predictions
        if (
            max_so_far is not None
            and forecast_median is not None
            and _peak_status in ("past", "in_window")
            and max_so_far < forecast_median - 2.0
        ):
            if is_cooling or _peak_status == "past":
                mu = max_so_far
            else:
                mu = max_so_far + 0.5
        else:
            mu = (
                forecast_median * 0.7 + ens_median * 0.3
                if forecast_median is not None
                else ens_median
            )
            if max_so_far is not None and max_so_far > mu:
                mu = max_so_far + (0.3 if not is_cooling else 0.0)

        # Inject forecast miss severity for AI
        if forecast_miss_deg > 2.0 and _peak_status in ("past", "in_window"):
            if forecast_miss_deg > 5.0:
                severity = "重"
            elif forecast_miss_deg > 3.0:
                severity = "中"
            else:
                severity = "轻"
            min_fc = min(
                (v for v in forecast_highs if v is not None), default=None
            )
            _trend_dir = "降温" if is_cooling else ("停滞" if "停滞" in trend_desc else "升温")
            ai_features.append(
                f"🚨 预报崩盘 [{severity}级失准]: 最低预报 {min_fc}{temp_symbol} vs 实测最高 {max_so_far}{temp_symbol}，"
                f"偏差 {forecast_miss_deg}°。当前趋势: {_trend_dir}。"
            )

        def _norm_cdf(x, m, s):
            return 0.5 * (1 + _math.erf((x - m) / (s * _math.sqrt(2))))

        min_possible_wu = round(max_so_far) if max_so_far is not None else -999
        probs = {}
        for n in range(round(mu) - 2, round(mu) + 3):
            if n < min_possible_wu:
                continue
            p = _norm_cdf(n + 0.5, mu, sigma) - _norm_cdf(n - 0.5, mu, sigma)
            if p > 0.01:
                probs[n] = p

        total_p = sum(probs.values())
        if total_p > 0:
            probs = {k: v / total_p for k, v in probs.items()}
            sorted_probs = sorted(probs.items(), key=lambda x: x[1], reverse=True)
            prob_parts = [
                f"{int(t)}{temp_symbol} [{t - 0.5}~{t + 0.5}) {p * 100:.0f}%"
                for t, p in sorted_probs[:4]
            ]
            if prob_parts:
                prob_str = " | ".join(prob_parts)
                insights.append(f"🎲 <b>结算概率</b> (μ={mu:.1f})：{prob_str}")
                ai_features.append(f"🎲 数学概率分布：{prob_str}")
    elif is_dead_market:
        settled_wu = round(max_so_far) if max_so_far is not None else "N/A"
        dead_msg = f"🎲 <b>结算预测</b>：已锁定 {settled_wu}{temp_symbol} (死盘确认)"
        insights.append(dead_msg)
        ai_features.append("🎲 状态: 确认死盘，结算已无悬念。")

    # === 实测已超预报 & 趋势输出 ===
    if max_so_far is not None and forecast_high is not None:
        if max_so_far > forecast_high + 0.5:
            exceed_by = max_so_far - forecast_high
            bt_msg = f"🚨 <b>实测已超预报</b>：{max_so_far}{temp_symbol} 超过上限 {forecast_high}{temp_symbol}（+{exceed_by:.1f}°）。"
            insights.append(bt_msg)
            ai_features.append(
                f"🚨 异常: 实测已冲破所有预报上限 ({max_so_far}{temp_symbol} vs {forecast_high}{temp_symbol})。"
            )
            if trend_desc:
                ai_features.append(trend_desc)
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

    # === 峰值时刻 AI 提示 ===
    if peak_hours:
        window = (
            f"{peak_hours[0]} - {peak_hours[-1]}"
            if len(peak_hours) > 1
            else peak_hours[0]
        )

        if local_hour <= last_peak_h:
            if last_peak_h < 6:
                ai_features.append(
                    "⚠️ <b>提示</b>：预测最热在凌晨，后续气温可能一路走低。"
                )
            elif local_hour < first_peak_h and (
                max_so_far is None or max_so_far < forecast_high
            ):
                target_temp = om_today if om_today is not None else forecast_high
                ai_features.append(
                    f"🎯 <b>关注重点</b>：看看那个时段能否涨到 {target_temp}{temp_symbol}。"
                )

        # 写给AI（使用精确到分钟的时间）
        remain_hrs = first_peak_h - local_hour_frac
        if local_hour_frac > last_peak_h:
            ai_features.append(f"⏱️ 状态: 预报峰值时段已过 ({window})。")
        elif first_peak_h <= local_hour_frac <= last_peak_h:
            remain_in_window = last_peak_h - local_hour_frac
            if remain_in_window < 1:
                ai_features.append(
                    f"⏱️ 状态: 正处于预报最热窗口 ({window})内，距窗口结束约 {int(remain_in_window * 60)} 分钟。"
                )
            else:
                ai_features.append(
                    f"⏱️ 状态: 正处于预报最热窗口 ({window})内，距窗口结束约 {remain_in_window:.1f}h。"
                )
        elif remain_hrs < 1:
            ai_features.append(
                f"⏱️ 状态: 距最热时段开始还有约 {int(remain_hrs * 60)} 分钟 ({window})，尚未进入峰值窗口。"
            )
        else:
            ai_features.append(
                f"⏱️ 状态: 距最热时段开始还有约 {remain_hrs:.1f}h ({window})。"
            )

    # === 其他 AI 专供的事实特征 ===
    # 明确告知 AI 当前实测温度和今日最高温，避免 AI 从趋势数据中误读
    current_temp = metar.get("current", {}).get("temp")
    if current_temp is not None:
        ai_features.append(f"🌡️ 当前实测温度: {current_temp}{temp_symbol}。")
    if max_so_far is not None:
        ai_features.append(
            f"🏔️ 今日实测最高温: {max_so_far}{temp_symbol} (WU结算={round(max_so_far)}{temp_symbol})。"
        )

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
    if humidity and humidity > 80:
        ai_features.append(f"💦 湿度极高 ({humidity}%)。")

    clouds = metar.get("current", {}).get("clouds", [])
    if clouds:
        cover = clouds[-1].get("cover", "")
        c_desc = {"OVC": "全阴", "BKN": "多云", "SCT": "散云", "FEW": "少云"}.get(
            cover, cover
        )
        ai_features.append(f"☁️ 天空状况: {c_desc}。")

    wx_desc = metar.get("current", {}).get("wx_desc")
    if wx_desc:
        ai_features.append(f"🌧️ 天气现象: {wx_desc}。")

    max_temp_time_str = metar.get("current", {}).get("max_temp_time", "")
    if max_so_far is not None and max_temp_time_str:
        try:
            max_h = int(max_temp_time_str.split(":")[0])
            max_temp_rad = 0.0
            hourly_rad = hourly.get("shortwave_radiation", [])
            for t_str, rad in zip(times, hourly_rad):
                if (
                    t_str.startswith(local_date_str)
                    and int(t_str.split("T")[1][:2]) == max_h
                ):
                    max_temp_rad = rad if rad is not None else 0.0
                    break
            if max_temp_rad < 50:
                ai_features.append(
                    f"🌙 动力事实: 最高温出现在低辐射时段 ({max_temp_time_str}, 辐射{max_temp_rad:.0f}W/m²)。"
                )
        except Exception:
            pass

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
            "/deb [城市名] - 查看 DEB 融合预测准确率\n"
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

    @bot.message_handler(commands=["deb"])
    def deb_accuracy(message):
        """查询 DEB 融合预测的历史准确率"""
        try:
            parts = message.text.split(maxsplit=1)
            if len(parts) < 2:
                bot.reply_to(
                    message, "❓ 用法: <code>/deb ankara</code>", parse_mode="HTML"
                )
                return

            city_input = parts[1].strip().lower()
            # 复用城市名映射
            city_aliases = {
                "ank": "ankara",
                "lon": "london",
                "par": "paris",
                "nyc": "new york",
                "chi": "chicago",
                "dal": "dallas",
                "mia": "miami",
                "atl": "atlanta",
                "sea": "seattle",
                "tor": "toronto",
                "sel": "seoul",
                "ba": "buenos aires",
                "wel": "wellington",
            }
            city_name = city_aliases.get(city_input, city_input)

            from src.analysis.deb_algorithm import load_history
            import os as _os

            # 获取详细历史数据
            project_root = _os.path.dirname(_os.path.abspath(__file__))
            history_file = _os.path.join(project_root, "data", "daily_records.json")
            data = load_history(history_file)

            if city_name not in data or not data[city_name]:
                bot.reply_to(
                    message, f"❌ 暂无 {city_name} 的历史数据", parse_mode="HTML"
                )
                return

            city_data = data[city_name]
            from datetime import datetime as _dt

            today_str = _dt.now().strftime("%Y-%m-%d")

            lines = [f"📊 <b>DEB 准确率报告 - {city_name.title()}</b>\n"]

            # 逐日明细
            lines.append("<b>📅 逐日记录：</b>")
            total_days = 0
            hits = 0
            deb_errors = []
            signed_errors = []  # 有正负的误差 (DEB - 实测)
            model_errors = {}

            for date_str in sorted(city_data.keys()):
                record = city_data[date_str]
                actual = record.get("actual_high")
                deb_pred = record.get("deb_prediction")
                forecasts = record.get("forecasts", {})

                if actual is None:
                    continue
                try:
                    actual = float(actual)
                    if deb_pred is not None:
                        deb_pred = float(deb_pred)
                except Exception:
                    continue

                # 如果没有存 DEB 预测值，用当天各模型平均值回算
                if deb_pred is None and forecasts:
                    valid_preds = [
                        float(v) for v in forecasts.values() if v is not None
                    ]
                    if valid_preds:
                        deb_pred = round(sum(valid_preds) / len(valid_preds), 1)

                actual_wu = round(actual)

                # DEB 命中判断
                if deb_pred is not None and date_str != today_str:
                    total_days += 1
                    deb_wu = round(deb_pred)
                    hit = deb_wu == actual_wu
                    if hit:
                        hits += 1
                    err = deb_pred - actual
                    deb_errors.append(abs(err))
                    signed_errors.append(err)
                    icon = "✅" if hit else "❌"
                    retro = "≈" if "deb_prediction" not in record else ""
                    # 错误类型标签
                    if not hit:
                        err_label = (
                            f" 低估{abs(err):.1f}°"
                            if err < 0
                            else f" 高估{abs(err):.1f}°"
                        )
                    else:
                        err_label = f" 偏差{abs(err):.1f}°"
                    lines.append(
                        f"  {date_str}: DEB {retro}{deb_pred}→<b>{deb_wu}</b> vs 实测 {actual}→<b>{actual_wu}</b> {icon}{err_label}"
                    )
                elif date_str == today_str:
                    lines.append(f"  {date_str}: 📍 今天进行中 (实测暂 {actual})")

                # 各模型误差统计
                if date_str != today_str and actual is not None:
                    for model, pred in forecasts.items():
                        if pred is not None:
                            if model not in model_errors:
                                model_errors[model] = []
                            model_errors[model].append(abs(float(pred) - actual))

            # 汇总
            if total_days > 0:
                hit_rate = hits / total_days * 100
                deb_mae = sum(deb_errors) / len(deb_errors)
                lines.append(
                    f"\n🎯 <b>DEB 总战绩</b>：WU命中 {hits}/{total_days} (<b>{hit_rate:.0f}%</b>) | MAE: {deb_mae:.1f}°"
                )

                # 和各模型 MAE 对比
                if model_errors:
                    lines.append("\n📈 <b>模型 MAE 对比</b>：")
                    model_maes = {
                        m: sum(e) / len(e) for m, e in model_errors.items() if e
                    }
                    sorted_models = sorted(model_maes.items(), key=lambda x: x[1])
                    for m, mae in sorted_models:
                        tag = " ⭐" if mae <= deb_mae else ""
                        lines.append(f"  {m}: {mae:.1f}°{tag}")
                    lines.append(f"  <b>DEB融合: {deb_mae:.1f}°</b>")

                # 偏差模式分析
                mean_bias = sum(signed_errors) / len(signed_errors)
                underest = sum(1 for e in signed_errors if e < -0.3)
                overest = sum(1 for e in signed_errors if e > 0.3)

                lines.append("\n🔍 <b>偏差分析</b>：")
                if abs(mean_bias) > 0.3:
                    bias_dir = "低估" if mean_bias < 0 else "高估"
                    lines.append(f"  ⚠️ 系统性{bias_dir}：平均偏差 {mean_bias:+.1f}°")
                else:
                    lines.append(f"  ✅ 无明显系统偏差（平均 {mean_bias:+.1f}°）")
                lines.append(
                    f"  低估 {underest} 次 | 高估 {overest} 次 | 准确 {total_days - underest - overest} 次"
                )

                # 可操作建议
                lines.append("\n💡 <b>建议</b>：")
                if underest > overest and abs(mean_bias) > 0.5:
                    lines.append(
                        f"  该城市模型集体低估趋势明显（{mean_bias:+.1f}°），实际最高温可能比 DEB 融合值高 {abs(mean_bias):.0f}-{abs(mean_bias) + 0.5:.0f}°。交易时建议适当看高。"
                    )
                elif overest > underest and abs(mean_bias) > 0.5:
                    lines.append(
                        f"  该城市模型集体高估趋势明显（{mean_bias:+.1f}°），实际最高温可能比 DEB 融合值低。交易时建议适当看低。"
                    )
                elif deb_mae > 1.5:
                    lines.append(
                        f"  该城市预报波动大 (MAE {deb_mae:.1f}°)，建议观望或轻仓。"
                    )
                elif hit_rate >= 60:
                    lines.append("  DEB 表现良好，可作为主要参考。")
                else:
                    lines.append("  数据积累中，建议结合 AI 分析综合判断。")

                lines.append("\n📝 MAE = 平均绝对误差，越小越准。⭐ = 优于 DEB 融合。")
            else:
                lines.append("\n⏳ 尚无完整的 DEB 预测记录，明天起开始统计。")

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
                    "❓ 请输入城市名称\n\n用法: <code>/city chicago</code>",
                    parse_mode="HTML",
                )
                return

            city_input = parts[1].strip().lower()

            # --- 核心标准名称映射表 ---
            # 这里的 Key 是缩写或别名，Value 是 Open-Meteo 识别的标准全称
            STANDARD_MAPPING = {
                "sel": "seoul",
                "seo": "seoul",
                "首尔": "seoul",
                "lon": "london",
                "伦敦": "london",
                "tor": "toronto",
                "多伦多": "toronto",
                "ank": "ankara",
                "安卡拉": "ankara",
                "wel": "wellington",
                "惠灵顿": "wellington",
                "ba": "buenos aires",
                "布宜诺斯艾利斯": "buenos aires",
                "nyc": "new york",
                "ny": "new york",
                "纽约": "new york",
                "chi": "chicago",
                "芝加哥": "chicago",
                "sea": "seattle",
                "西雅图": "seattle",
                "mia": "miami",
                "迈阿密": "miami",
                "atl": "atlanta",
                "亚特兰大": "atlanta",
                "dal": "dallas",
                "达拉斯": "dallas",
                "la": "los angeles",
                "洛杉矶": "los angeles",
                "par": "paris",
                "巴黎": "paris",
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
            mgm = weather_data.get("mgm", {})

            # 数值归一化
            def _sf(v):
                if v is None:
                    return None
                try:
                    return float(v)
                except Exception:
                    return None

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

            # 今天对比
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
                    f"MGM: {mgm_high:.1f}{temp_symbol}"
                    if isinstance(mgm_high, (int, float))
                    else f"MGM: {mgm_high}"
                )

            # 检查是否有显著分歧 (超过 5°F 或 2.5°C)
            divergence_warning = ""
            if mb_high is not None and max_temps:
                diff = abs(mb_high - (_sf(max_temps[0]) or 0))
                threshold = 5.0 if temp_unit == "fahrenheit" else 2.5
                if diff > threshold:
                    divergence_warning = (
                        f" ⚠️ <b>模型显著分歧 ({diff:.1f}{temp_symbol})</b>"
                    )

            comp_str = f" ({' | '.join(comp_parts)})" if comp_parts else ""
            sources_str = " | ".join(sources)

            msg_lines.append(f"\n📊 <b>预报 ({sources_str})</b>")
            msg_lines.append(
                f"👉 <b>今天: {today_t}{temp_symbol}{comp_str}</b>{divergence_warning}"
            )

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
                        utc_offset = open_meteo.get("utc_offset", 0)
                        local_dt = dt.astimezone(
                            timezone(timedelta(seconds=utc_offset))
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
                    wx_summary = "🌫️ 雾/霾"

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
                        1: "🌤️ 晴",
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
                    dir_str = dirs[int((float(wind_dir) + 22.5) % 360 / 45)] + "风 "

                # 体感和湿度（跳过缺失数据）
                feels_like = m_c.get("feels_like")
                humidity = m_c.get("humidity")
                if feels_like is not None or humidity is not None:
                    parts = []
                    if feels_like is not None:
                        parts.append(f"🌡️ 体感: {feels_like}°C")
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
                        f"   {prefix} 💨 {wind or 0}kt ({wind_dir or 0}°) | 👁️ {vis or 10}mi"
                    )

                if cloud_desc:
                    msg_lines.append(
                        f"   {prefix} {cloud_desc} | 👁️ {vis or 10}mi | 💨 {wind or 0}kt"
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
                    mm = weather_data.get("multi_model", {})
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

            bot.send_message(message.chat.id, "\n".join(msg_lines), parse_mode="HTML")

        except Exception as e:
            import traceback

            logger.error(f"查询失败: {e}\n{traceback.format_exc()}")
            bot.reply_to(message, f"❌ 查询失败: {e}")

    logger.info("🤖 Bot 启动中...")
    bot.infinity_polling()


if __name__ == "__main__":
    start_bot()
