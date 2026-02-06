import sys
import time
import os
import json
import re
from datetime import datetime, timedelta
from loguru import logger

from src.utils.config_loader import load_config
from src.utils.logger import setup_logger
from src.data_collection.polymarket_api import PolymarketClient
from src.data_collection.weather_sources import WeatherDataCollector
from src.data_collection.onchain_tracker import OnchainTracker
from src.models.statistical_model import TemperaturePredictor
from src.analysis.volume_analyzer import VolumeAnalyzer
from src.analysis.orderbook_analyzer import OrderbookAnalyzer
from src.analysis.technical_indicators import TechnicalIndicators
from src.analysis.whale_tracker import WhaleTracker
from src.strategy.decision_engine import DecisionEngine
from src.strategy.risk_manager import RiskManager
from src.trading.paper_trader import PaperTrader
from src.utils.notifier import TelegramNotifier


def main():
    # 1. 初始化配置与日志
    config_data = load_config()
    setup_logger(config_data.get("app", {}).get("log_level", "INFO"))

    logger.info("🌟 PolyWeather 监控引擎启动中...")

    # 2. 初始化核心组件
    polymarket = PolymarketClient(config_data["polymarket"])
    weather = WeatherDataCollector(config_data["weather"])
    onchain = OnchainTracker(config_data["polymarket"], polymarket)
    notifier = TelegramNotifier(config_data["telegram"])

    # 3. 初始化分析与交易组件
    predictor = TemperaturePredictor()
    risk_manager = RiskManager(config_data.get("config", {}))
    orderbook_analyzer = OrderbookAnalyzer(config_data.get("config", {}))
    decision_engine = DecisionEngine(config_data.get("config", {}))
    whale_tracker = WhaleTracker(config_data.get("config", {}), onchain)
    paper_trader = PaperTrader()

    # 发送启动通知
    notifier._send_message(
        "🚀 <b>Polymarket 天气监控系统启动成功</b>\n正在扫描 12 个核心城市的最高温市场..."
    )

    # 信号记忆（持久化到文件）
    pushed_signals = {}
    SIGNALS_FILE = "data/pushed_signals.json"
    if os.path.exists(SIGNALS_FILE):
        try:
            with open(SIGNALS_FILE, "r", encoding="utf-8") as f:
                pushed_signals = json.load(f)
            logger.info(f"已加载历史推送记录，共 {len(pushed_signals)} 条")
        except:
            pushed_signals = {}

    # 确保data目录存在
    if not os.path.exists("data"):
        os.makedirs("data")

    location_cache = {}

    # 价格历史追踪（用于计算趋势）
    PRICE_HISTORY_FILE = "data/price_history.json"
    price_history = {}
    if os.path.exists(PRICE_HISTORY_FILE):
        try:
            with open(PRICE_HISTORY_FILE, "r", encoding="utf-8") as f:
                price_history = json.load(f)
        except:
            price_history = {}

    try:
        while True:
            logger.info("--- 开启新一轮全量动态监控 (自动搜寻所有天气市场) ---")
            cached_signals = {}
            all_markets_cache = {}

            # 1. 直接从 Polymarket 获取所有天气合约
            all_weather_markets = polymarket.get_weather_markets()

            # 1.5 尝试通过slug获取可能遗漏的市场（如部分结算的市场）
            special_slugs = []

            for slug in special_slugs:
                event = polymarket.get_event_by_slug(slug)
                if event:
                    title = event.get("title", "")
                    logger.info(f"通过slug找到特殊事件: {title}")

                    # 提取城市名
                    city = weather.extract_city_from_question(title)
                    if not city:
                        city = "Unknown"

                    # 将该事件的所有市场添加到列表
                    for m in event.get("markets", []):
                        # 检查是否已存在
                        c_id = m.get("conditionId")
                        if not any(
                            existing.get("condition_id") == c_id
                            for existing in all_weather_markets
                        ):
                            all_weather_markets.append(
                                {
                                    "condition_id": c_id,
                                    "question": m.get("groupItemTitle")
                                    or m.get("question"),
                                    "active_token_id": m.get("activeTokenId"),
                                    "tokens": m.get("clobTokenIds"),
                                    "prices": m.get("outcomePrices"),
                                    "event_title": title,
                                    "slug": slug,
                                    "city": city,  # 提前标记城市
                                }
                            )
                            logger.debug(f"添加特殊市场: {m.get('groupItemTitle')}")

            if not all_weather_markets:
                logger.warning("当前 Polymarket 似乎没有任何活跃的天气市场，等待中...")
                time.sleep(300)
                continue

            # 2. 批量同步盘口价格 (优化：为每个档位获取其对应的真实 Token 价格)
            token_price_map = {}
            price_requests = []
            for m in all_weather_markets:
                ts = m.get("tokens", [])
                if isinstance(ts, str):
                    try:
                        ts = json.loads(ts)
                    except:
                        ts = []

                active_tid = m.get("active_token_id")

                # 如果是多选一市场（比如 Dallas 76-77°F）
                if len(ts) > 2 and active_tid:
                    # 获取该档位的买入价 (Ask)
                    price_requests.append({"token_id": active_tid, "side": "ask"})
                    # 获取该档位的买入“否”价所需的 Bid 价
                    price_requests.append({"token_id": active_tid, "side": "bid"})
                # 如果是传统的 Yes/No 二选一市场
                elif len(ts) == 2:
                    price_requests.append({"token_id": ts[0], "side": "ask"})  # Buy Yes
                    price_requests.append({"token_id": ts[1], "side": "ask"})  # Buy No

            if price_requests:
                logger.info(f"正在同步 {len(price_requests)} 个档位的真实盘口价格...")
                token_price_map = polymarket.get_multiple_prices(price_requests)
                logger.info(f"价格同步完成，成功获取 {len(token_price_map)} 个实时报价")

            # 3. 按城市分组（按condition_id去重）
            markets_by_city = {}
            seen_condition_ids = set()

            for i, m in enumerate(all_weather_markets):
                c_id = m.get("condition_id")
                if c_id in seen_condition_ids:
                    continue  # 跳过重复
                seen_condition_ids.add(c_id)

                # 注入实时批量价格
                ts = m.get("tokens", [])
                if isinstance(ts, str):
                    try:
                        ts = json.loads(ts)
                    except:
                        ts = []

                active_tid = m.get("active_token_id")

                # 多选一市场逻辑
                if len(ts) > 2 and active_tid:
                    m["buy_yes_live"] = token_price_map.get(f"{active_tid}:ask")
                    # 买入“否”的价格 = 1 - 该档位的 Bid
                    bid_val = token_price_map.get(f"{active_tid}:bid")
                    if bid_val:
                        m["buy_no_live"] = 1.0 - bid_val
                # 二选一市场逻辑
                elif len(ts) == 2:
                    m["buy_yes_live"] = token_price_map.get(f"{ts[0]}:ask")
                    m["buy_no_live"] = token_price_map.get(f"{ts[1]}:ask")

                # 优先使用发现阶段已经识别出的城市名
                city = m.get("city")

                # 如果发现阶段没识别出，再尝试从问题文本提取
                if not city or city == "Unknown":
                    full_context = f"{m.get('event_title', '')} {m.get('question', '')}"
                    city = weather.extract_city_from_question(full_context)

                if i < 5:
                    logger.debug(
                        f"分析合约 {i}: City='{city}' | Title='{m.get('event_title')}"
                    )

                if not city:
                    continue

                if city not in markets_by_city:
                    markets_by_city[city] = []
                markets_by_city[city].append(m)

            logger.info(
                f"动态发现 {len(markets_by_city)} 个受监控城市，共 {len(all_weather_markets)} 个合约"
            )

            # 3. 逐个城市分析
            for city, city_markets in markets_by_city.items():
                try:
                    # 获取/缓存坐标
                    if city not in location_cache:
                        coords = weather.get_coordinates(city)
                        if not coords:
                            continue
                        location_cache[city] = coords
                        logger.info(
                            f"📍 城市定位成功: {city} -> ({coords['lat']}, {coords['lon']})"
                        )

                    loc = location_cache[city]

                    # A. 获取实时天气共识
                    weather_data = weather.fetch_all_sources(
                        city, lat=loc["lat"], lon=loc["lon"]
                    )
                    consensus = weather.check_consensus(weather_data)

                    if not consensus.get("consensus"):
                        continue

                    temp_unit = weather_data.get("open-meteo", {}).get(
                        "unit", "celsius"
                    )
                    temp_symbol = "°F" if temp_unit == "fahrenheit" else "°C"
                    logger.info(
                        f"☁️ {city} 当前气温: {consensus['average_temp']}{temp_symbol} | 监控合约: {len(city_markets)}"
                    )

                    # --- 本城市汇总预警缓存 ---
                    city_alerts = []
                    city_local_time = None
                    city_total_vol = 0
                    city_pred_high = None
                    city_target_date = None
                    city_strategy_tips = []

                    # B. 遍历该城市所有合约
                    for market in city_markets:
                        market_id = market.get("condition_id")
                        question = market.get("question", "未知市场")
                        event_title = market.get("event_title", "")

                        # 累计城市总成交量
                        vol_raw = market.get("volume", 0)
                        if isinstance(vol_raw, str):
                            try:
                                vol_raw = float(
                                    vol_raw.replace("$", "").replace(",", "")
                                )
                            except:
                                vol_raw = 0
                        city_total_vol += vol_raw

                        # 识别该合约的目标日期
                        target_date = weather.extract_date_from_title(
                            event_title
                        ) or weather.extract_date_from_title(question)
                        ref_temp = consensus["average_temp"]
                        if target_date:
                            daily_data = weather_data.get("open-meteo", {}).get(
                                "daily", {}
                            )
                            if daily_data:
                                dates = daily_data.get("time", [])
                                max_temps = daily_data.get("temperature_2m_max", [])
                                for idx, d_str in enumerate(dates):
                                    if target_date == d_str:
                                        ref_temp = max_temps[idx]
                                        break

                        # --- 价格获取逻辑 (增强版) ---
                        # 使用 token_price_map 获取实时数据
                        active_tid = market.get("active_token_id")
                        ts = market.get("tokens", [])
                        if isinstance(ts, str):
                            ts = json.loads(ts)

                        buy_yes_price = None
                        buy_no_price = None
                        bid_yes_price = None

                        if len(ts) == 2:
                            # 传统二选一市场 (Yes/No Token 独立)
                            buy_yes_price = token_price_map.get(f"{ts[0]}:ask")
                            buy_no_price = token_price_map.get(f"{ts[1]}:ask")
                            bid_yes_price = token_price_map.get(f"{ts[0]}:bid")
                        elif active_tid:
                            # 多选一市场 (单 Token 对应一个档位)
                            buy_yes_price = token_price_map.get(f"{active_tid}:ask")
                            bid_yes_price = token_price_map.get(f"{active_tid}:bid")
                            if bid_yes_price is not None:
                                buy_no_price = 1.0 - bid_yes_price

                        # 兜底概率计算
                        current_prob = (
                            (buy_yes_price + bid_yes_price) / 2
                            if (buy_yes_price and bid_yes_price)
                            else (buy_yes_price or 0.5)
                        )
                        if buy_no_price is None:
                            buy_no_price = 1.0 - current_prob

                        # 计算价格趋势
                        prev_data = price_history.get(market_id, {})
                        prev_prob = prev_data.get("price", current_prob)
                        prob_change = (current_prob - prev_prob) * 100
                        trend_str = (
                            f"▲{abs(prob_change):.0f}%"
                            if prob_change > 0.5
                            else (
                                f"▼{abs(prob_change):.0f}%"
                                if prob_change < -0.5
                                else ""
                            )
                        )

                        # 更新历史缓存
                        price_history[market_id] = {
                            "price": current_prob,
                            "timestamp": datetime.now().isoformat(),
                        }

                        # --- 预警收集 (自动推送逻辑) ---
                        # 触发阈值: 价格处于 85-95 锁死区间，或者概率异动 > 10%
                        is_price_locked = (
                            current_prob >= 0.85 or (1 - current_prob) >= 0.85
                        )
                        is_big_move = abs(prob_change) >= 10

                        if is_price_locked or is_big_move:
                            alert_key = f"alert_{market_id}_{int(current_prob * 100)}"
                            if alert_key not in pushed_signals:
                                # 深度分析订单簿
                                ob_data = (
                                    polymarket.get_orderbook(active_tid)
                                    if active_tid
                                    else None
                                )
                                ob_analysis = (
                                    orderbook_analyzer.analyze(ob_data)
                                    if ob_data
                                    else {
                                        "tradeable": False,
                                        "liquidity": "枯竭",
                                        "spread": 0,
                                        "mid_price": current_prob,
                                    }
                                )

                                # 预测偏差分析
                                if ref_temp:
                                    city_pred_high = ref_temp  # 记录到城市概览
                                    temp_match = re.search(
                                        r"(\d+)(?:-(\d+))?°[FC]", question
                                    )
                                    if temp_match:
                                        low_b = int(temp_match.group(1))
                                        high_b = (
                                            int(temp_match.group(2))
                                            if temp_match.group(2)
                                            else low_b
                                        )
                                        diff = ref_temp - ((low_b + high_b) / 2)
                                        msg += f"\n📐 预测偏差: {diff:+.1f}{temp_symbol} (预测 {ref_temp}{temp_symbol})"

                                        # 生成策略建议：仅保留模型一致提示
                                        if abs(diff) < 2 and current_prob > 0.7:
                                            city_strategy_tips.append(
                                                f"预测温度{ref_temp}{temp_symbol}落在{question}区间，市场与模型一致"
                                            )

                                # 模拟下单 - 使用 Ask 价格（实际可成交价格）
                                if buy_yes_price and buy_yes_price > 0.5:
                                    trigger_side = "Buy Yes"
                                    trigger_price = int(buy_yes_price * 100)
                                else:
                                    trigger_side = "Buy No"
                                    trigger_price = (
                                        int(buy_no_price * 100)
                                        if buy_no_price
                                        else int((1 - current_prob) * 100)
                                    )

                                success = paper_trader.open_position(
                                    market_id=market_id,
                                    city=city,
                                    option=question,
                                    price=trigger_price,
                                    side="YES" if trigger_side == "Buy Yes" else "NO",
                                    amount_usd=5.0,
                                    target_date=target_date,
                                    predicted_temp=ref_temp,
                                )

                                city_alerts.append(
                                    {
                                        "market": target_date or "今日",
                                        "msg": msg,
                                        "bought": success,
                                        "amount": 5.0,
                                        "confidence": "动态",
                                    }
                                )
                                pushed_signals[alert_key] = time.time()
                                if target_date:
                                    city_target_date = target_date

                        # C. 准备缓存数据
                        temp_unit = weather_data.get("open-meteo", {}).get(
                            "unit", "celsius"
                        )
                        temp_symbol = "°F" if temp_unit == "fahrenheit" else "°C"
                        city_local_time = (
                            weather_data.get("open-meteo", {})
                            .get("current", {})
                            .get("local_time")
                        )

                        current_price = buy_yes_price if buy_yes_price else 0.5

                        # 计算价格趋势
                        prev_data = price_history.get(market_id, {})
                        prev_price = prev_data.get("price", current_price)
                        price_change_pct = (
                            ((current_price - prev_price) / prev_price * 100)
                            if prev_price > 0
                            else 0
                        )

                        # 更新价格历史缓存
                        price_history[market_id] = {
                            "price": current_price,
                            "timestamp": datetime.now().isoformat(),
                        }

                        cache_entry = {
                            "city": city,
                            "full_title": event_title,
                            "option": question,
                            "prediction": f"{ref_temp}{temp_symbol}",
                            "price": int(current_price * 100),
                            "buy_yes": int(buy_yes_price * 100) if buy_yes_price else 0,
                            "buy_no": int(buy_no_price * 100) if buy_no_price else 0,
                            "url": f"https://polymarket.com/event/{market.get('slug')}",
                            "local_time": city_local_time,
                            "target_date": target_date,
                            "score": 0,
                            "rationale": "ACTIVE",
                            "trend": round(price_change_pct, 1),
                        }

                        # --- 最终过滤器 (拦截垃圾信号) ---

                        # 1. 过滤已锁定价格 (>= 98.5c)
                        if (buy_yes_price and buy_yes_price >= 0.985) or (
                            buy_no_price and buy_no_price >= 0.985
                        ):
                            cache_entry["rationale"] = "ENDED"
                            all_markets_cache[market_id] = cache_entry
                            continue

                        # 2. 过滤已过期日期 (对比当前日期: 2026-02-06)
                        current_today = "2026-02-06"
                        if target_date and target_date < current_today:
                            cache_entry["rationale"] = "EXPIRED"
                            all_markets_cache[market_id] = cache_entry
                            continue

                        # 3. 评分计算
                        try:
                            signal = decision_engine.calculate_signal(
                                model_prediction=predictor.predict_ensemble([ref_temp]),
                                market_data={
                                    "orderbook": {},
                                    "price_history": [current_price],
                                    "transactions": [],
                                },
                                weather_consensus={"average_temp": ref_temp},
                                whale_activity=None,
                            )
                            cache_entry["score"] = signal.get("final_score", 0)
                            cache_entry["rationale"] = signal.get(
                                "recommendation", "ACTIVE"
                            )
                        except Exception as e:
                            logger.error(f"计算信号失败 [{market_id}]: {e}")
                            cache_entry["score"] = 0
                            cache_entry["rationale"] = "ERROR"

                        all_markets_cache[market_id] = cache_entry

                        # --- 预警收集 (自动推送逻辑) ---
                        if (buy_yes_price and 0.85 <= buy_yes_price <= 0.95) or (
                            buy_no_price and 0.85 <= buy_no_price <= 0.95
                        ):
                            alert_key = f"alert_{market_id}_range_85_95"
                            if alert_key not in pushed_signals:
                                # --- 基础参数识别 ---
                                is_categorical = len(ts) > 2 and active_tid
                                if is_categorical:
                                    # 语义转换逻辑保持一致
                                    if buy_no_price and buy_no_price >= 0.85:
                                        trigger_side = "Sell Yes"
                                        trigger_price = int(
                                            buy_no_price * 100
                                        )  # 预估价
                                    else:
                                        trigger_side = "Buy Yes"
                                        trigger_price = int(buy_yes_price * 100)
                                else:
                                    trigger_side = (
                                        "Buy Yes" if buy_yes_price >= 0.85 else "Buy No"
                                    )
                                    trigger_price = (
                                        int(buy_yes_price * 100)
                                        if trigger_side == "Buy Yes"
                                        else int(buy_no_price * 100)
                                    )

                                # --- 深度流动性与 Spread 检查 ---
                                target_tid = (
                                    active_tid
                                    if is_categorical
                                    else (ts[0] if trigger_side == "Buy Yes" else ts[1])
                                )
                                ob_data = (
                                    polymarket.get_orderbook(target_tid)
                                    if target_tid
                                    else None
                                )

                                ob_analysis = {
                                    "tradeable": True,
                                    "liquidity": "未知",
                                    "spread": 0,
                                    "mid_price": trigger_price / 100,
                                }
                                if ob_data:
                                    ob_analysis = orderbook_analyzer.analyze(ob_data)

                                if not ob_analysis.get("tradeable", True):
                                    confidence_tag = (
                                        f"🔴不可交易 ({ob_analysis.get('liquidity')})"
                                    )
                                    if not is_categorical:
                                        logger.warning(
                                            f"跳过不可交易信号 (Spread {ob_analysis.get('spread')}): {city} {question}"
                                        )
                                        continue

                                # 更新实时数据显示
                                mid_c = round(ob_analysis.get("mid_price", 0) * 100, 1)
                                spr_c = round(ob_analysis.get("spread", 0) * 100, 1)
                                depth = ob_analysis.get(
                                    "ask_depth"
                                    if trigger_side.startswith("Buy")
                                    else "bid_depth",
                                    0,
                                )

                                # 流动性图标
                                liq_map = {
                                    "充裕": "✅ 充裕",
                                    "正常": "🟡 正常",
                                    "稀薄": "🟠 稀薄",
                                    "枯竭": "🔴 枯竭",
                                }
                                liq_status = liq_map.get(
                                    ob_analysis.get("liquidity", "未知"), "❓ 未知"
                                )

                                if is_categorical:
                                    ask_str = (
                                        "--"
                                        if trigger_side == "Sell Yes"
                                        else f"{trigger_price}¢"
                                    )
                                    bid_str = (
                                        f"{trigger_price}¢"
                                        if trigger_side == "Sell Yes"
                                        else "--"
                                    )

                                    display_side = (
                                        f"📊 <b>{question}</b>\n"
                                        f"Ask: {ask_str} | Bid: {bid_str} | Mid: {mid_c}¢\n"
                                        f"Spread: {spr_c}¢ | 深度: ${depth}\n"
                                        f"流动性: {liq_status}"
                                    )
                                else:
                                    display_side = (
                                        f"📊 <b>{question}</b>\n"
                                        f"报价: {trigger_side} {trigger_price}¢ | Mid: {mid_c}¢\n"
                                        f"Spread: {spr_c}¢ | 深度: ${depth}\n"
                                        f"流动性: {liq_status}"
                                    )

                                # --- 智能动态仓位计算 ---
                                # 1. 获取 Open-Meteo 对目标日期的最高温预测
                                predicted_high = None
                                weather_supports = False
                                daily_data = weather_data.get("open-meteo", {}).get(
                                    "daily", {}
                                )
                                if daily_data and target_date:
                                    dates = daily_data.get("time", [])
                                    max_temps = daily_data.get("temperature_2m_max", [])
                                    for idx, d_str in enumerate(dates):
                                        if target_date == d_str and idx < len(
                                            max_temps
                                        ):
                                            predicted_high = max_temps[idx]
                                            break

                                # 2. 判断天气预测是否支持当前方向
                                if predicted_high is not None:
                                    # 解析选项的温度范围 (例如 "40-41°F" 或 "32°F or below")
                                    temp_match = re.search(
                                        r"(\d+)(?:-(\d+))?°[FC]", question
                                    )
                                    if temp_match:
                                        low_bound = int(temp_match.group(1))
                                        high_bound = (
                                            int(temp_match.group(2))
                                            if temp_match.group(2)
                                            else low_bound
                                        )

                                        # 如果买 NO，天气预测应该在这个区间之外
                                        if trigger_side == "Buy No":
                                            weather_supports = (
                                                predicted_high < low_bound - 2
                                            ) or (predicted_high > high_bound + 2)
                                        else:  # 买 YES
                                            weather_supports = (
                                                low_bound - 2
                                                <= predicted_high
                                                <= high_bound + 2
                                            )

                                # 3. 获取成交量信息
                                market_volume = market.get("volume", 0)
                                if isinstance(market_volume, str):
                                    try:
                                        market_volume = float(
                                            market_volume.replace("$", "").replace(
                                                ",", ""
                                            )
                                        )
                                    except:
                                        market_volume = 0
                                high_volume = market_volume >= 5000  # $5000+ 算高成交量

                                # --- Pro 级仓位决策系统 ---
                                # 1. 计算离结算剩余小时数 (假设气温市场在目标日期晚上 23:59 结算)
                                hours_to_settle = 24.0
                                if target_date:
                                    try:
                                        settle_dt = datetime.strptime(
                                            f"{target_date} 23:59:59",
                                            "%Y-%m-%d %H:%M:%S",
                                        )
                                        now_utc = datetime.utcnow()
                                        diff = settle_dt - now_utc
                                        hours_to_settle = diff.total_seconds() / 3600.0
                                    except:
                                        pass

                                # 2. 计算相对成交量比例
                                total_daily_vol = sum(
                                    [
                                        float(
                                            str(m.get("volume", 0))
                                            .replace("$", "")
                                            .replace(",", "")
                                        )
                                        for m in city_markets
                                        if (
                                            weather.extract_date_from_title(
                                                m.get("event_title", "")
                                            )
                                            or weather.extract_date_from_title(
                                                m.get("question", "")
                                            )
                                        )
                                        == target_date
                                    ]
                                )
                                market_vol = float(
                                    str(market.get("volume", 0))
                                    .replace("$", "")
                                    .replace(",", "")
                                )
                                is_rel_high_vol = (
                                    (market_vol / total_daily_vol > 0.3)
                                    if total_daily_vol > 0
                                    else False
                                )

                                # 3. 基础意向仓位 (基于置信度)
                                base_pos = 3.0  # 默认探路
                                confidence_tag = "💡试探"
                                if (
                                    trigger_price >= 90
                                    and weather_supports
                                    and high_volume
                                ):
                                    base_pos, confidence_tag = 10.0, "🔥高置信"
                                elif trigger_price >= 90 and weather_supports:
                                    base_pos, confidence_tag = 7.0, "⭐中置信"
                                elif trigger_price >= 92:
                                    base_pos, confidence_tag = 5.0, "📌价格锁定"

                                # 4. 四层过滤决策
                                amount_usd, risk_reason = (
                                    risk_manager.calculate_position_size(
                                        base_confidence_usd=base_pos,
                                        depth=depth,
                                        hours_to_settle=hours_to_settle,
                                        is_high_relative_volume=is_rel_high_vol,
                                    )
                                )

                                logger.info(
                                    f"【Pro仓位】{city} {question} | "
                                    f"基础:{base_pos}$ -> 最终:{amount_usd}$ | 原因:{risk_reason} | "
                                    f"深度:${depth} | 剩:{hours_to_settle:.1f}h"
                                )

                                # --- 模拟交易触发逻辑 ---
                                if amount_usd > 0:
                                    side = "YES" if trigger_side == "Buy Yes" else "NO"
                                    success = paper_trader.open_position(
                                        market_id=market_id,
                                        city=city,
                                        option=question,
                                        price=trigger_price,
                                        side=side,
                                        amount_usd=amount_usd,
                                        target_date=target_date,
                                        predicted_temp=predicted_high,
                                    )
                                    if success:
                                        risk_manager.record_trade(amount_usd)
                                else:
                                    # 如果被风控拦截（金额为0），则不进行任何推送，避免刷屏
                                    success = False
                                    logger.info(
                                        f"Skipping alert for {question}: {risk_reason}"
                                    )
                                    continue

                                # 构建预测温度显示文本
                                temp_unit = weather_data.get("open-meteo", {}).get(
                                    "unit", "celsius"
                                )
                                temp_symbol = (
                                    "°F" if temp_unit == "fahrenheit" else "°C"
                                )
                                forecast_text = (
                                    f"{predicted_high}{temp_symbol}"
                                    if predicted_high
                                    else "N/A"
                                )

                                # 构建简约版消息: ⚡ {question} ({date}): {side} {price}¢ | 预测:{forecast} [🛒 ${amount} {tag}]
                                side_display = (
                                    "Buy No" if trigger_side == "Buy No" else "Buy Yes"
                                )
                                msg = (
                                    f"⚡ {question} ({target_date}): {side_display} {trigger_price}¢ | "
                                    f"预测:{forecast_text} [🛒 ${amount_usd} {confidence_tag}]"
                                )

                                city_alerts.append(
                                    {
                                        "type": "price",
                                        "market": f"{target_date or '今日'}",
                                        "msg": msg,
                                        "bought": success,
                                        "amount": amount_usd,
                                        "confidence": confidence_tag,
                                    }
                                )
                                pushed_signals[alert_key] = time.time()

                        # 3. 信号暂存
                        cached_signals[market_id] = cache_entry

                    # E. 统一发送城市汇总通知 (使用新 Pro 模板)
                    if city_alerts:
                        # 去重策略建议
                        unique_tips = list(dict.fromkeys(city_strategy_tips))
                        notifier.send_combined_alert(
                            city=city,
                            alerts=city_alerts,
                            local_time=city_local_time,
                            forecast_temp=f"{city_pred_high}{temp_symbol}"
                            if city_pred_high
                            else "N/A",
                            total_volume=city_total_vol,
                            brackets_count=len(city_markets),
                            strategy_tips=unique_tips,
                        )

                except Exception as e:
                    logger.error(f"分析城市 {city} 时出错: {e}")
                # --- 每处理完一个城市，立即更新 JSON 文件 ---
                try:
                    # --- 周期性结算：保存高价值信号 ---
                    active_signals = []
                    for mid, entry in all_markets_cache.items():
                        # 核心过滤：只有 ACTIVE 且 价格未锁定、日期未过期的才进入 signals 列表
                        if entry.get("rationale") not in ["ENDED", "EXPIRED", "ERROR"]:
                            # 再次双重检查日期 (硬核拦截 2026-02-06)
                            target_dt = entry.get("target_date")
                            if target_dt and target_dt < "2026-02-06":
                                continue
                            active_signals.append(entry)

                    # 按分数排序
                    active_signals.sort(key=lambda x: x.get("score", 0), reverse=True)

                    with open("data/active_signals.json", "w", encoding="utf-8") as f:
                        json.dump(active_signals, f, ensure_ascii=False, indent=4)

                    logger.info(
                        f"已更新活跃信号库，包含 {len(active_signals)} 个有效信号。"
                    )

                    # 2. 更新全量市场缓存
                    try:
                        with open("data/all_markets.json", "r", encoding="utf-8") as f:
                            existing_markets = json.load(f)
                    except:
                        existing_markets = {}

                    existing_markets.update(all_markets_cache)

                    # 清理过期日期
                    today_str = datetime.now().strftime("%Y-%m-%d")
                    cleaned_markets = {}
                    for k, v in existing_markets.items():
                        t_date = v.get("target_date")
                        if not t_date or t_date >= today_str:
                            cleaned_markets[k] = v

                    with open("data/all_markets.json", "w", encoding="utf-8") as f:
                        json.dump(cleaned_markets, f, ensure_ascii=False, indent=2)

                    # 3. 保存推送记录
                    with open("data/pushed_signals.json", "w", encoding="utf-8") as f:
                        json.dump(pushed_signals, f, ensure_ascii=False)

                    # 3.5 保存价格历史（用于趋势计算）
                    with open(PRICE_HISTORY_FILE, "w", encoding="utf-8") as f:
                        json.dump(price_history, f, ensure_ascii=False)

                    # --- 4. 更新模拟仓位盈亏 ---
                    price_snapshot = {}
                    for mid, entry in all_markets_cache.items():
                        price_snapshot[mid] = {"price": entry["price"]}
                    paper_trader.update_pnl(price_snapshot)

                    # --- 5. 每日收益总结推送 (北京时间 23:55 - 00:05 之间发送) ---
                    now_bj = datetime.utcnow() + timedelta(hours=8)
                    if now_bj.hour == 23 and now_bj.minute >= 50:
                        summary_key = f"daily_pnl_{now_bj.strftime('%Y%m%d')}"
                        if summary_key not in pushed_signals:
                            # 构造总结消息
                            total_cost = 0
                            total_pnl = 0
                            data = paper_trader._load_data()
                            pos_list = data.get("positions", {})

                            if pos_list:
                                report = [
                                    f"📊 <b>每日模拟仓结算总结 ({now_bj.strftime('%Y-%m-%d')})</b>\n"
                                    + "═" * 15
                                ]
                                for p in pos_list.values():
                                    if p["status"] == "OPEN":
                                        total_cost += p["cost_usd"]
                                        total_pnl += p.get("pnl_usd", 0)

                                report.append(
                                    f"💳 可用余额: <b>${data.get('balance', 0):.2f}</b>"
                                )
                                report.append(
                                    f"💰 今日累计投入: <b>${total_cost:.2f}</b>"
                                )
                                report.append(
                                    f"📈 累计浮动盈亏: <b>{total_pnl:+.2f}$</b>"
                                )
                                notifier._send_message("\n".join(report))
                                pushed_signals[summary_key] = time.time()

                except Exception as e:
                    logger.error(f"即时保存数据失败: {e}")

            logger.info("本轮扫描结束。等待 5 分钟...")
            time.sleep(300)

    except KeyboardInterrupt:
        logger.info("收到关机指令，正在退出...")
    except Exception as e:
        logger.exception(f"系统运行出错: {e}")


if __name__ == "__main__":
    main()
