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

def analyze_weather_trend(weather_data, temp_symbol):
    """根据实测与预测分析气温态势，增加峰值时刻预测"""
    insights: List[str] = []
    
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
<<<<<<< HEAD
    if mgm.get("today_high") is not None:
        forecast_highs.append(mgm["today_high"])
=======
    # 加入多模型预报 (ECMWF, GFS, ICON, GEM, JMA)
    for mv in weather_data.get("multi_model", {}).get("forecasts", {}).values():
        if mv is not None:
            forecast_highs.append(mv)
>>>>>>> e575440acfd8b5f1e8c30e83dfcb972d26175729
    
    forecast_highs = [h for h in forecast_highs if h is not None]
    # 取预报中的最高值作为风险防御基准
    forecast_high = max(forecast_highs) if forecast_highs else None
    # 取最低值用于判断是否“已触及预报高位”
    min_forecast_high = min(forecast_highs) if forecast_highs else forecast_high
<<<<<<< HEAD
=======
    # 取中位数作为用户可见的"预期值"（避免极端模型误导）
    forecast_median = None
    if forecast_highs:
        sorted_fh = sorted(forecast_highs)
        forecast_median = sorted_fh[len(sorted_fh) // 2]
>>>>>>> e575440acfd8b5f1e8c30e83dfcb972d26175729
    
    wind_speed = metar.get("current", {}).get("wind_speed_kt", 0)
    
    # 获取当地时间小时
    local_time_full = open_meteo.get("current", {}).get("local_time", "")
    try:
        local_date_str = local_time_full.split(" ")[0] # YYYY-MM-DD
        local_hour = int(local_time_full.split(" ")[1].split(":")[0])
    except:
        local_date_str = datetime.now().strftime("%Y-%m-%d")
        local_hour = datetime.now().hour

    # === 模型共识评分 ===
    # 主要来源: 多模型预报 (ECMWF, GFS, ICON, GEM, JMA)
    multi_model = weather_data.get("multi_model", {})
    mm_forecasts = multi_model.get("forecasts", {})
    
    labeled_forecasts = []
    for model_name, model_val in mm_forecasts.items():
        if model_val is not None:
            labeled_forecasts.append((model_name, model_val))
    
    # 额外独立源 (如有)
    if mb.get("today_high") is not None:
        labeled_forecasts.append(("MB", mb["today_high"]))
    if nws.get("today_high") is not None:
        labeled_forecasts.append(("NWS", nws["today_high"]))
    
    # Open-Meteo 确定性预报（用于后续偏差检测，不重复加入共识）
    om_today = daily.get("temperature_2m_max", [None])[0]
    
    # 集合预报数据 (仅用于不确定性区间展示)
    ensemble = weather_data.get("ensemble", {})
    ens_median = ensemble.get("median")

    consensus_level = "unknown"
    consensus_spread = None
    if len(labeled_forecasts) >= 2:
        f_values = [v for _, v in labeled_forecasts]
        f_max = max(f_values)
        f_min = min(f_values)
        consensus_spread = f_max - f_min
        f_avg = sum(f_values) / len(f_values)

        # 动态阈值：华氏度场景用更大的容差
        is_f = (temp_symbol == "°F")
        tight_threshold = 1.5 if is_f else 0.8   # 高共识
        mid_threshold = 3.0 if is_f else 1.5      # 中共识

        parts = " | ".join([f"{name} {val}{temp_symbol}" for name, val in labeled_forecasts])
        
        if consensus_spread <= tight_threshold:
            consensus_level = "high"
            insights.append(
                f"🎯 <b>模型共识：高 ({len(labeled_forecasts)}/{len(labeled_forecasts)})</b> — "
                f"{parts}，极差仅 {consensus_spread:.1f}°，预报高度一致。"
            )
        elif consensus_spread <= mid_threshold:
            consensus_level = "medium"
            insights.append(
                f"⚖️ <b>模型共识：中 ({len(labeled_forecasts)}源)</b> — "
                f"{parts}，极差 {consensus_spread:.1f}°，有轻微分歧。"
            )
        else:
            consensus_level = "low"
            # 找出最高和最低的源
            highest = max(labeled_forecasts, key=lambda x: x[1])
            lowest = min(labeled_forecasts, key=lambda x: x[1])
            insights.append(
                f"⚠️ <b>模型共识：低 ({len(labeled_forecasts)}源)</b> — "
                f"{parts}，极差 {consensus_spread:.1f}°！"
                f"{highest[0]} 最高 ({highest[1]}{temp_symbol}) vs {lowest[0]} 最低 ({lowest[1]}{temp_symbol})，不确定性大。"
            )
    elif len(labeled_forecasts) == 1:
        name, val = labeled_forecasts[0]
        insights.append(
            f"📡 <b>仅1个预报源 ({name} {val}{temp_symbol})</b> — 无法交叉验证，共识评分不可用。"
        )

    # 集合预报区间 (独立于共识评分显示)
    ens_p10 = ensemble.get("p10")
    ens_p90 = ensemble.get("p90")
    if ens_p10 is not None and ens_p90 is not None and ens_median is not None:
        ens_range = ens_p90 - ens_p10
        insights.append(
            f"📊 <b>集合预报</b>：中位数 {ens_median}{temp_symbol}，"
            f"90% 区间 [{ens_p10}{temp_symbol} - {ens_p90}{temp_symbol}]，"
            f"波动幅度 {ens_range:.1f}°。"
        )
        # 确定性预报 vs 集合分布偏差检测
        if om_today is not None:
            actual_reached = max_so_far is not None and max_so_far >= om_today - 0.5
            if om_today > ens_p90:
                if actual_reached:
                    # 实测已达到预报值 → 确定性预报是对的，集合偏保守
                    insights.append(
                        f"✅ <b>预报验证</b>：确定性预报 {om_today}{temp_symbol} 已被实测验证 "
                        f"(实测最高 {max_so_far}{temp_symbol})，集合预报偏保守。"
                    )
                else:
                    # 还没到最高温，存在偏高风险
                    delta = om_today - ens_median
                    insights.append(
                        f"⚡ <b>预报偏高警告</b>：确定性预报 {om_today}{temp_symbol} "
                        f"超过了集合 90% 上限 ({ens_p90}{temp_symbol})，"
                        f"比中位数高 {delta:.1f}°。实际高温更可能接近 {ens_median}{temp_symbol}。"
                    )
            elif om_today < ens_p10:
                if max_so_far is not None and max_so_far >= ens_median:
                    # 实测已超过中位数 → 确定性预报偏低，集合更准
                    insights.append(
                        f"✅ <b>预报验证</b>：实测最高 {max_so_far}{temp_symbol} "
                        f"已超过确定性预报 {om_today}{temp_symbol}，集合中位数 {ens_median}{temp_symbol} 更准确。"
                    )
                else:
                    delta = ens_median - om_today
                    insights.append(
                        f"⚡ <b>预报偏低警告</b>：确定性预报 {om_today}{temp_symbol} "
                        f"低于集合 90% 下限 ({ens_p10}{temp_symbol})，"
                        f"比中位数低 {delta:.1f}°。实际高温更可能接近 {ens_median}{temp_symbol}。"
                    )

    # === 核心判断：实测是否已超预报 ===
    is_breakthrough = False
    if max_so_far is not None and forecast_high is not None:
        if max_so_far > forecast_high + 0.5:
<<<<<<< HEAD
            # 实测已超所有预报！
            exceed_by = max_so_far - forecast_high
            insights.append(f"🚨 <b>预报已被击穿</b>：实测最高 {max_so_far}{temp_symbol} 已超所有预报上限 {forecast_high}{temp_symbol} 约 {exceed_by:.1f}°！")
            insights.append(f"💡 <b>博弈建议</b>：市场需重新评估，当前可能存在极端异常增温。")
            return "\n💡 <b>态势分析</b>\n" + "\n".join(insights)

=======
            is_breakthrough = True
            exceed_by = max_so_far - forecast_high
            insights.append(f"🚨 <b>实测已超预报</b>：实测最高 {max_so_far}{temp_symbol} 超过了所有预报的天花板 {forecast_high}{temp_symbol}，多了 {exceed_by:.1f}°！")
            insights.append(f"💡 <b>建议</b>：预报已经不准了，实际温度比所有模型预测的都高，需要重新判断。")

    # === 结算取整分析 (Wunderground 四舍五入到整数) ===
    if max_so_far is not None:
        settled = round(max_so_far)
        fractional = max_so_far - int(max_so_far)
        # 离取整边界的距离
        dist_to_boundary = abs(fractional - 0.5)
        
        if dist_to_boundary <= 0.3:
            # 在边界附近 (X.2 ~ X.8)，取整结果可能随时翻转
            if fractional < 0.5:
                insights.append(
                    f"⚖️ <b>结算边界</b>：当前最高 {max_so_far}{temp_symbol} → "
                    f"WU 结算 <b>{settled}{temp_symbol}</b>，"
                    f"但只差 <b>{0.5 - fractional:.1f}°</b> 就会进位到 {settled + 1}{temp_symbol}！"
                )
            else:
                insights.append(
                    f"⚖️ <b>结算边界</b>：当前最高 {max_so_far}{temp_symbol} → "
                    f"WU 结算 <b>{settled}{temp_symbol}</b>，"
                    f"刚刚越过进位线，再降 <b>{fractional - 0.5:.1f}°</b> 就会回落到 {settled - 1}{temp_symbol}。"
                )

>>>>>>> e575440acfd8b5f1e8c30e83dfcb972d26175729
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
        
<<<<<<< HEAD
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
            # 如果实测已经接近“任一”主流预报的最高温 (使用 min_forecast_high)
            if max_so_far and max_so_far >= min_forecast_high - 0.5:
                insights.append(f"✅ <b>今日峰值已过</b>：气温已触及或接近预报最高，目前处于高位波动或缓慢回落。")
            else:
                # 虽然时间过了，但离最高温还有差距
                insights.append(f"📉 <b>处于降温期</b>：已过预报峰值时段，且当前气温乏力 ({curr_temp}{temp_symbol})，冲击最高预报 {forecast_high}{temp_symbol} 的概率降低。")
        elif first_peak_h <= local_hour <= last_peak_h:
            # 正在峰值窗口内
            if diff_max <= 0.8:
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

=======
    # 确定用于逻辑判断的峰值小时
    if peak_hours:
        first_peak_h = int(peak_hours[0].split(":")[0])
        last_peak_h = int(peak_hours[-1].split(":")[0])
        
        window = f"{peak_hours[0]} - {peak_hours[-1]}" if len(peak_hours) > 1 else peak_hours[0]
        insights.append(f"⏱️ <b>预计最热时段</b>：今天 <b>{window}</b>。")
        
        if last_peak_h < 6:
            insights.append(f"⚠️ <b>提示</b>：预测最热在凌晨，后续气温可能一路走低。")
        elif local_hour < first_peak_h and (max_so_far is None or max_so_far < forecast_high):
            target_temp = forecast_median if forecast_median is not None else forecast_high
            insights.append(f"🎯 <b>关注重点</b>：看看那个时段温度能不能真的到 {target_temp}{temp_symbol}。")
    else:
        # 兜底默认值
        first_peak_h, last_peak_h = 13, 15

    is_peak_passed = False
    if curr_temp is not None and forecast_high is not None:
        diff_max = forecast_high - curr_temp
        
        # 1. 气温节奏判定 (动态参考峰值时刻)
        if local_hour > last_peak_h:
            # 已经过了预报的峰值时段
            is_peak_passed = True
            if is_breakthrough:
                insights.append(f"🌡️ <b>异常高温</b>：最热的时间已经过了，但温度还是比预报高，降温可能会来得比较晚。")
            # 如果实测已经接近"任一"主流预报的最高温 (使用 min_forecast_high)
            elif max_so_far and min_forecast_high is not None and max_so_far >= min_forecast_high - 0.5:
                insights.append(f"✅ <b>今天最热已过</b>：温度已经到了预报最高值附近，接下来会慢慢降温了。")
            else:
                # 虽然时间过了，但离最高温还有差距
                insights.append(f"📉 <b>开始降温</b>：最热时段已过，现在 {curr_temp}{temp_symbol}，看起来很难再涨到预报的 {forecast_high}{temp_symbol} 了。")
        elif first_peak_h <= local_hour <= last_peak_h:
            # 正在峰值窗口内
            if is_breakthrough:
                insights.append(f"🔥 <b>极端升温</b>：正处于最热时段，温度已经超过所有预报，还在继续往上走！")
            elif max_so_far is not None and forecast_high - max_so_far <= 0.8:
                insights.append(f"⚖️ <b>到顶了</b>：正处于最热时段，温度基本到位，接下来会在这个水平上下浮动。")
            else:
                insights.append(f"⏳ <b>最热时段进行中</b>：虽然在最热时段了，但离预报最高温还差一些，继续观察。")
        elif local_hour < first_peak_h:
            # 还没到峰值窗口
            gap_to_high = forecast_high - (max_so_far if max_so_far is not None else curr_temp)
            if gap_to_high > 1.2:
                insights.append(f"📈 <b>还在升温</b>：离最热时段还有 {first_peak_h - local_hour} 小时，温度还会继续往上走。")
            else:
                insights.append(f"🌅 <b>快到最热了</b>：马上就要进入最热时段，温度已经接近预报高位了。")

        else:
            # 回退逻辑
            insights.append(f"🌌 <b>夜间</b>：等明天太阳出来后再看新一轮升温。")

>>>>>>> e575440acfd8b5f1e8c30e83dfcb972d26175729
        # 2. 湿度与露点分析 (仅在傍晚以后)
        humidity = metar.get("current", {}).get("humidity")
        dewpoint = metar.get("current", {}).get("dewpoint")
        
        if local_hour >= 18:
            if humidity and humidity > 80:
<<<<<<< HEAD
                insights.append(f"💦 <b>闷热高湿</b>：湿度极高 ({humidity}%)，将显著锁住夜间热量。")
            if dewpoint is not None and curr_temp - dewpoint < 2.0:
                insights.append(f"🌡️ <b>触及露点支撑</b>：气温已跌至露点支撑位，降温将变慢。")
=======
                insights.append(f"💦 <b>湿度很高</b>：湿度 {humidity}%，空气很潮湿，夜里热量散不掉，降温会很慢。")
            if dewpoint is not None and curr_temp - dewpoint < 2.0:
                insights.append(f"🌡️ <b>降温快到底了</b>：温度已经接近露点（空气中水汽开始凝结的温度），再往下降会很困难。")
>>>>>>> e575440acfd8b5f1e8c30e83dfcb972d26175729

        # 3. 风力
        if wind_speed >= 15:
            insights.append(f"🌬️ <b>风很大</b>：风速 {wind_speed}kt，温度可能会忽高忽低。")
        elif wind_speed >= 10:
<<<<<<< HEAD
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
=======
            insights.append(f"🍃 <b>有风</b>：风速适中 ({wind_speed}kt)，会加速空气流动，具体影响看风向。")

        # 4. 云层遮挡分析 (仅在升温期/峰值期有意义)
        clouds = metar.get("current", {}).get("clouds", [])
        if clouds and not is_peak_passed:
            main_cloud = clouds[-1]
            cover = main_cloud.get("cover", "")
            if cover == "OVC":
                insights.append(f"☁️ <b>阴天</b>：天完全被云盖住了，太阳照不进来，温度很难再往上涨了。")
            elif cover == "BKN":
                insights.append(f"🌥️ <b>云比较多</b>：天空大部分被云挡住了，日照不足，升温会比较慢。")
            elif cover in ["SKC", "CLR", "FEW"]:
                insights.append(f"☀️ <b>大晴天</b>：阳光直射，没什么云，有利于温度继续往上冲。")
>>>>>>> e575440acfd8b5f1e8c30e83dfcb972d26175729

        # 5. 特殊天气现象
        wx_desc = metar.get("current", {}).get("wx_desc")
        has_mgm = bool(mgm.get("current"))
        mgm_rain = mgm.get("current", {}).get("rain_24h")
        if wx_desc:
<<<<<<< HEAD
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
                    # 只有在当前温度离最高预测还有距离时，南风才有意义
                    if diff_max > 0.5:
                        if is_peak_passed:
                            insights.append(f"🔥 <b>偏南风</b>：存在暖平流支撑，但已过传统峰值时段，冲击上限 {forecast_high}{temp_symbol} 的动能正在衰减。")
                        else:
                            insights.append(f"🔥 <b>偏南风</b>：正从低纬度输送暖平流，气温仍有向上突围的潜力。")
            except (TypeError, ValueError):
                pass
=======
            wx_upper = wx_desc.upper().strip()
            wx_tokens = wx_upper.split()
            # 用分词匹配，避免 "METAR" 中的 "RA" 误判
            rain_codes = {"RA", "DZ", "-RA", "+RA", "-DZ", "+DZ", "TSRA", "SHRA", "FZRA", "RAIN", "DRIZZLE"}
            snow_codes = {"SN", "GR", "GS", "-SN", "+SN", "BLSN", "SNOW"}
            fog_codes = {"FG", "BR", "HZ", "MIST", "FOG", "FZFG"}
            
            if rain_codes & set(wx_tokens):
                if has_mgm and mgm_rain and mgm_rain > 0:
                    insights.append(f"🌧️ <b>在下雨</b>：已累计 {mgm_rain}mm，雨水蒸发会吸收热量，温度很难涨上去。")
                else:
                    insights.append(f"🌧️ <b>在下雨</b>：METAR 探测到降水，雨水蒸发会吸收热量，升温会受阻。")
            elif snow_codes & set(wx_tokens):
                insights.append(f"❄️ <b>在下雪/冰雹</b>：温度会一直低迷。")
            elif fog_codes & set(wx_tokens):
                insights.append(f"🌫️ <b>有雾/霾</b>：阳光被挡住了，湿度也高，升温会很慢。")

        # 6. 风向分析（始终显示，风向是重要参考信息）
        try:
            # 优先 METAR，回退 MGM
            metar_wind = metar.get("current", {}).get("wind_dir")
            mgm_wind = mgm.get("current", {}).get("wind_dir")
            
            if metar_wind is not None:
                analysis_wind = float(metar_wind)
                wind_source = "METAR"
            elif mgm_wind is not None:
                analysis_wind = float(mgm_wind)
                wind_source = "MGM"
            else:
                analysis_wind = None
                wind_source = None
            
            # 两源矛盾检测
            if metar_wind is not None and mgm_wind is not None:
                metar_f = float(metar_wind)
                mgm_f = float(mgm_wind)
                diff_angle = abs(metar_f - mgm_f)
                if diff_angle > 180:
                    diff_angle = 360 - diff_angle
                if diff_angle > 90:
                    dirs_name = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"]
                    m_name = dirs_name[int((metar_f + 22.5) % 360 / 45)]
                    g_name = dirs_name[int((mgm_f + 22.5) % 360 / 45)]
                    insights.append(f"⚠️ <b>风向矛盾</b>：METAR 测到{m_name}风({metar_f:.0f}°)，MGM 测到{g_name}风({mgm_f:.0f}°)，相差较大，风向不稳定。")
            
            if analysis_wind is not None:
                wd = analysis_wind
                if 315 <= wd or wd <= 45:
                    insights.append(f"🌬️ <b>吹北风</b>（{wind_source} {wd:.0f}°）：从北方来的冷空气，会压制升温。")
                elif 135 <= wd <= 225:
                    gap_to_forecast = forecast_high - (max_so_far if max_so_far is not None else curr_temp)
                    if is_peak_passed and not is_breakthrough:
                        insights.append(f"🔥 <b>吹南风</b>（{wind_source} {wd:.0f}°）：南方的暖空气还在吹过来，但最热时段已过，后劲不足了。")
                    elif gap_to_forecast > 0.5 or is_breakthrough:
                        status = "温度还有继续上涨的空间" if not is_breakthrough else "可能把温度推得更高"
                        insights.append(f"🔥 <b>吹南风</b>（{wind_source} {wd:.0f}°）：南方的暖空气正在吹过来，{status}。")
                    else:
                        insights.append(f"🔥 <b>吹南风</b>（{wind_source} {wd:.0f}°）：南方的暖空气正在吹过来，但温度已接近预报峰值。")
                elif 225 < wd < 315:
                    if wd <= 260:
                        insights.append(f"🌬️ <b>吹西南风</b>（{wind_source} {wd:.0f}°）：带有一定暖湿气流，对升温有轻微帮助。")
                    elif wd >= 280:
                        insights.append(f"🌬️ <b>吹西北风</b>（{wind_source} {wd:.0f}°）：偏冷的气流，会拖慢升温。")
                    else:
                        insights.append(f"🌬️ <b>吹西风</b>（{wind_source} {wd:.0f}°）：对温度影响不大，主要取决于日照和云量。")
                elif 45 < wd < 135:
                    insights.append(f"🌬️ <b>吹东风</b>（{wind_source} {wd:.0f}°）：对温度影响较小，主要看日照和云量。")
        except (TypeError, ValueError):
            pass
>>>>>>> e575440acfd8b5f1e8c30e83dfcb972d26175729

        try:
            visibility = metar.get("current", {}).get("visibility_mi")
            if visibility is not None:
                vis_val = float(str(visibility).replace("+", "").replace("-", ""))
                if vis_val < 3 and local_hour <= 11:
                    insights.append(f"🌫️ <b>早上能见度差</b>：只能看到 {vis_val} 英里远，阳光穿不透，上午升温会很慢。")
        except (TypeError, ValueError):
            pass

<<<<<<< HEAD
        # 7. 模型准确度预警 (针对用户反馈的 MB 偏高问题)
        if is_peak_passed and max_so_far is not None:
            model_checks = []
            if om_high and om_high > max_so_far + 1.5:
                model_checks.append(f"Open-Meteo ({om_high}{temp_symbol})")
            mb_h = mb.get("today_high")
            if mb_h and mb_h > max_so_far + 1.5:
                model_checks.append(f"Meteoblue ({mb_h}{temp_symbol})")
=======
        # 7. 模型准确度预警（使用多模型数据）
        if is_peak_passed and max_so_far is not None:
            model_checks = []
            for m_name, m_val in mm_forecasts.items():
                if m_val is not None and m_val > max_so_far + 1.5:
                    model_checks.append(f"{m_name} ({m_val}{temp_symbol})")
            # 附加源也查一下
            mb_h = mb.get("today_high")
            if mb_h and mb_h > max_so_far + 1.5:
                model_checks.append(f"MB ({mb_h}{temp_symbol})")
>>>>>>> e575440acfd8b5f1e8c30e83dfcb972d26175729
            nws_h = nws.get("today_high")
            if nws_h and nws_h > max_so_far + 1.5:
                model_checks.append(f"NWS ({nws_h}{temp_symbol})")
            
            if model_checks:
<<<<<<< HEAD
                insights.append(f"⚠️ <b>预报偏高</b>：目前实测远低于 " + "、".join(model_checks) + "，判定预报模型今日表现过度乐观。")

=======
                insights.append(f"⚠️ <b>预报偏高了</b>：实测远低于 " + "、".join(model_checks) + "，这些模型今天报高了。")

        # 8. MGM 气压分析 (仅安卡拉)
        mgm_pressure = mgm.get("current", {}).get("pressure")
        if mgm_pressure is not None and not is_peak_passed:
            if mgm_pressure < 900:
                insights.append(f"📉 <b>气压偏低</b>：{mgm_pressure}hPa，可能有暖湿气流过境，有利于温度上升。")

        # 9. MGM 官方最高温交叉验证
        mgm_max = mgm.get("current", {}).get("mgm_max_temp")
        if mgm_max is not None and max_so_far is not None:
            if abs(mgm_max - max_so_far) > 1.5:
                insights.append(f"📊 <b>数据差异</b>：MGM 官方记录最高 {mgm_max}{temp_symbol}，METAR 记录 {max_so_far}{temp_symbol}，相差 {abs(mgm_max - max_so_far):.1f}°。")

        # 10. 太阳辐射分析 (Open-Meteo shortwave_radiation)
        hourly_rad = hourly.get("shortwave_radiation", [])
        sunshine_durations = daily.get("sunshine_duration", [])
        if hourly_rad and times:
            # 计算今天已经过去的小时的累计辐射 vs 全天预测总辐射
            today_total_rad = 0.0
            today_so_far_rad = 0.0
            today_peak_rad = 0.0
            today_peak_hour = ""
            for t_str, rad in zip(times, hourly_rad):
                if t_str.startswith(local_date_str) and rad is not None:
                    today_total_rad += rad
                    hour_val = int(t_str.split("T")[1][:2])
                    if hour_val <= local_hour:
                        today_so_far_rad += rad
                    if rad > today_peak_rad:
                        today_peak_rad = rad
                        today_peak_hour = t_str.split("T")[1][:5]

            if today_total_rad > 0:
                rad_pct = today_so_far_rad / today_total_rad * 100

                if not is_peak_passed and local_hour >= 8:
                    # 白天升温期：报告太阳能量进度
                    if rad_pct < 30 and local_hour >= 12:
                        insights.append(f"🌤️ <b>日照不足</b>：到目前为止只吸收了全天 {rad_pct:.0f}% 的太阳能量，云层可能在严重削弱日照。")

                # 检测"暖平流型"高温：峰值温度出现在太阳辐射极低的时段
                max_temp_time_str = metar.get("current", {}).get("max_temp_time", "")
                if max_so_far is not None and max_temp_time_str:
                    try:
                        max_h = int(max_temp_time_str.split(":")[0])
                        # 找到最高温时段对应的辐射值
                        max_temp_rad = 0.0
                        for t_str, rad in zip(times, hourly_rad):
                            if t_str.startswith(local_date_str) and rad is not None:
                                h = int(t_str.split("T")[1][:2])
                                if h == max_h:
                                    max_temp_rad = rad
                                    break
                        if max_temp_rad < 50 and today_peak_rad > 200:
                            insights.append(
                                f"🌙 <b>暖平流驱动</b>：最高温出现在 {max_temp_time_str}，"
                                f"当时太阳辐射仅 {max_temp_rad:.0f} W/m²（峰值 {today_peak_rad:.0f} W/m²），"
                                f"说明气温是被暖空气推高的，而不是被太阳晒热的。"
                            )
                    except (ValueError, IndexError):
                        pass

        # 11. 入场时机信号
        hours_to_peak = first_peak_h - local_hour if local_hour < first_peak_h else 0
        
        # 综合评分：距离峰值越近 + 共识越高 + 实测越接近预报 → 越适合入场
        timing_score = 0
        timing_factors = []
        
        if is_peak_passed:
            timing_score += 3
            timing_factors.append("最热已过")
        elif hours_to_peak <= 2:
            timing_score += 2
            timing_factors.append(f"距峰值{hours_to_peak}h")
        elif hours_to_peak <= 4:
            timing_score += 1
            timing_factors.append(f"距峰值{hours_to_peak}h")
        else:
            timing_factors.append(f"距峰值{hours_to_peak}h")
        
        if consensus_level == "high":
            timing_score += 2
            timing_factors.append("模型一致")
        elif consensus_level == "medium":
            timing_score += 1
            timing_factors.append("模型小分歧")
        elif consensus_level == "low":
            timing_factors.append("模型分歧大")
        else:
            # unknown: 数据源不足，无法评估共识
            timing_factors.append("仅单源")
        
        if max_so_far is not None and forecast_high is not None and (is_peak_passed or hours_to_peak <= 3):
            gap = abs(max_so_far - forecast_high)
            if gap <= 0.5:
                timing_score += 2
                timing_factors.append("实测≈预报")
            elif gap <= 1.5:
                timing_score += 1
                timing_factors.append(f"差{gap:.1f}°")
            else:
                timing_factors.append(f"差{gap:.1f}°")
        
        factors_str = "，".join(timing_factors)
        if timing_score >= 5:
            insights.append(f"⏰ <b>入场时机：理想</b> — {factors_str}。不确定性低，适合下注。")
        elif timing_score >= 3:
            insights.append(f"⏰ <b>入场时机：较好</b> — {factors_str}。可以考虑小仓位入场。")
        elif timing_score >= 2:
            insights.append(f"⏰ <b>入场时机：谨慎</b> — {factors_str}。建议继续观察。")
        else:
            insights.append(f"⏰ <b>入场时机：不建议</b> — {factors_str}。不确定性大，等更多数据。")
>>>>>>> e575440acfd8b5f1e8c30e83dfcb972d26175729

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
            
<<<<<<< HEAD
            # 1. 第一优先级：严格全字匹配
            city_name = STANDARD_MAPPING.get(city_input)
            
            # 2. 第二优先级：如果长度 >= 3，尝试前缀匹配
            if not city_name and len(city_input) >= 3:
=======
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
>>>>>>> e575440acfd8b5f1e8c30e83dfcb972d26175729
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

            max_str = ""
            if max_p is not None:
                settled_val = round(max_p)
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
                    # 纯数字回退
                    cloud_names = {0: "☀️ 晴", 1: "🌤️ 晴", 2: "🌤️ 少云", 3: "⛅ 散云", 4: "⛅ 散云", 5: "🌥️ 多云", 6: "🌥️ 多云", 7: "☁️ 阴", 8: "☁️ 阴天"}
                    wx_summary = cloud_names.get(mgm_cloud, "")

            wx_display = f" {wx_summary}" if wx_summary else ""
            msg_lines.append(f"\n✈️ <b>实测 ({main_source}): {cur_temp}{temp_symbol}</b>{max_str} |{wx_display} | {obs_t_str}")

            if mgm:
                m_c = mgm.get("current", {})
                # 翻译风向
                wind_dir = m_c.get("wind_dir")
                dir_str = ""
                if wind_dir is not None:
                    dirs = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"]
                    dir_str = dirs[int((float(wind_dir) + 22.5) % 360 / 45)] + "风 "
                
                msg_lines.append(f"   [MGM] 🌡️ 体感: {m_c.get('feels_like')}°C | 💧 {m_c.get('humidity')}%")
                msg_lines.append(f"   [MGM] 🌬️ {dir_str}{wind_dir}° ({m_c.get('wind_speed_ms')} m/s) | 💧 降水: {m_c.get('rain_24h') or 0}mm")
                
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
