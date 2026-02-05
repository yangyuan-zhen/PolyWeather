import sys
import time
import os
import json
from datetime import datetime
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
from src.utils.notifier import TelegramNotifier


def main():
    """
    Polymarket 交易系统主循环 - 监控与推送模式
    """
    # 1. 设置日志
    setup_logger()
    logger.info("正在启动 Polymarket 天气交易信号监控系统...")

    # 2. 加载配置
    try:
        config_data = load_config()
        logger.info("配置加载成功。")
    except Exception as e:
        logger.error(f"配置加载失败: {e}")
        sys.exit(1)

    # 3. 初始化组件
    polymarket = PolymarketClient(config_data["polymarket"])
    weather = WeatherDataCollector(config_data["weather"])
    onchain = OnchainTracker(config_data["polymarket"], polymarket)
    notifier = TelegramNotifier(config_data["telegram"])

    predictor = TemperaturePredictor()
    volume_analyzer = VolumeAnalyzer()
    orderbook_analyzer = OrderbookAnalyzer()
    tech_indicators = TechnicalIndicators()
    whale_tracker = WhaleTracker(config_data, onchain)

    decision_engine = DecisionEngine(config_data)
    risk_manager = RiskManager(config_data)

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

            # 2. 批量同步盘口价格 (优化：一次请求获取所有市场的 Buy Yes/No)
            token_price_map = {}
            price_requests = []
            for m in all_weather_markets:
                ts = m.get("tokens", [])
                if isinstance(ts, str):
                    try:
                        ts = json.loads(ts)
                    except:
                        ts = []
                if ts and len(ts) >= 2:
                    price_requests.append({"token_id": ts[0], "side": "ask"})  # Buy Yes
                    price_requests.append({"token_id": ts[1], "side": "ask"})  # Buy No

            if price_requests:
                logger.info(f"正在同步 {len(price_requests)} 个档位的盘口价格...")
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
                if ts and len(ts) >= 2:
                    m["buy_yes_live"] = token_price_map.get(ts[0])
                    m["buy_no_live"] = token_price_map.get(ts[1])

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

                    logger.info(
                        f"☁️ {city} 当前气温: {consensus['average_temp']}°C | 监控合约: {len(city_markets)}"
                    )

                    # --- 本城市汇总预警缓存 ---
                    city_alerts = []
                    city_local_time = None

                    # B. 遍历该城市所有合约
                    for market in city_markets:
                        market_id = market.get("condition_id")
                        question = market.get("question", "未知市场")
                        event_title = market.get("event_title", "")

                        # (日期处理逻辑保持不变...)
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

                        # --- 价格获取逻辑 ---
                        buy_yes_price = market.get("buy_yes_live")
                        buy_no_price = market.get("buy_no_live")
                        current_price = 0.5
                        gamma_prices = market.get("prices", [])
                        if isinstance(gamma_prices, str):
                            try:
                                gamma_prices = json.loads(gamma_prices)
                            except:
                                gamma_prices = []
                        if gamma_prices and len(gamma_prices) > 0:
                            current_price = float(gamma_prices[0])

                        if buy_yes_price is None:
                            buy_yes_price = current_price
                        if buy_no_price is None:
                            buy_no_price = 1.0 - current_price

                        # C. 准备缓存
                        temp_unit = weather_data.get("open-meteo", {}).get(
                            "unit", "celsius"
                        )
                        temp_symbol = "°F" if temp_unit == "fahrenheit" else "°C"
                        city_local_time = (
                            weather_data.get("open-meteo", {})
                            .get("current", {})
                            .get("local_time")
                        )

                        cache_entry = {
                            "city": city,
                            "full_title": event_title,
                            "option": question,
                            "prediction": f"{ref_temp}{temp_symbol}",
                            "price": int(current_price * 100),
                            "buy_yes": int(buy_yes_price * 100),
                            "buy_no": int(buy_no_price * 100),
                            "url": f"https://polymarket.com/event/{market.get('slug')}",
                            "local_time": city_local_time,
                            "target_date": target_date,
                            "score": 0,
                            "rationale": "ACTIVE",
                        }

                        if buy_yes_price <= 0.01 or buy_yes_price >= 0.99:
                            cache_entry["rationale"] = "ENDED"
                            all_markets_cache[market_id] = cache_entry
                            continue

                        # D. 评分
                        signal = decision_engine.calculate_signal(
                            model_prediction=predictor.predict_ensemble([ref_temp]),
                            market_data={
                                "orderbook": {},
                                "price_history": [current_price],
                                "transactions": [],
                            },
                            weather_consensus={"average_temp": ref_temp},
                            whale_activity=whale_tracker.analyze_market_whales(
                                market_id
                            ),
                        )
                        cache_entry["score"] = signal["final_score"]
                        cache_entry["rationale"] = signal.get("recommendation", "N/A")
                        all_markets_cache[market_id] = cache_entry

                        # --- 预警收集 ---
                        # 1. 价格预警
                        if (0.85 <= buy_yes_price <= 0.95) or (
                            0.85 <= buy_no_price <= 0.95
                        ):
                            alert_key = f"alert_{market_id}_range_85_95"
                            if alert_key not in pushed_signals:
                                trigger_side = (
                                    "Buy Yes" if buy_yes_price >= 0.85 else "Buy No"
                                )
                                trigger_price = (
                                    int(buy_yes_price * 100)
                                    if trigger_side == "Buy Yes"
                                    else int(buy_no_price * 100)
                                )
                                city_alerts.append(
                                    {
                                        "type": "price",
                                        "market": f"{question} ({target_date or '今日'})",
                                        "msg": f"{trigger_side}进入锁定区间 {trigger_price}¢",
                                    }
                                )
                                pushed_signals[alert_key] = time.time()

                        # 2. 市场异常
                        whale_sig = signal["factor_details"].get("whale", {})
                        volume_sig = signal["factor_details"].get("volume", {})
                        if (
                            whale_sig.get("signal")
                            in ["STRONG_ACCUMULATION", "STRONG_DISTRIBUTION"]
                            or volume_sig.get("volume_signal", {}).get("signal")
                            == "VOLUME_SPIKE"
                        ):
                            anomaly_key = f"anomaly_{market_id}"
                            if anomaly_key not in pushed_signals:
                                msg = (
                                    "检测到异常交易流"
                                    if volume_sig.get("score", 0) > 0.7
                                    else "大户入场"
                                )
                                city_alerts.append(
                                    {
                                        "type": "anomaly",
                                        "market": f"{question} ({target_date or '今日'})",
                                        "msg": f"{msg} (当前 {int(buy_yes_price * 100)}¢)",
                                    }
                                )
                                pushed_signals[anomaly_key] = time.time()

                        # 3. 信号暂存
                        cached_signals[market_id] = cache_entry

                    # --- 循环结束后统一推送本城市汇总 ---
                    if city_alerts:
                        notifier.send_combined_alert(
                            city, city_alerts, local_time=city_local_time
                        )

                except Exception as e:
                    logger.error(f"分析城市 {city} 时出错: {e}")
                    continue
                except Exception as e:
                    logger.error(f"分析城市 {city} 时出错: {e}")
                    continue

                # --- 每处理完一个城市，立即更新 JSON 文件 ---
                try:
                    # 1. 更新活跃信号缓存 (合并旧数据避免扫描中途变空)
                    final_signals = {}
                    if os.path.exists("data/active_signals.json"):
                        try:
                            with open(
                                "data/active_signals.json", "r", encoding="utf-8"
                            ) as f:
                                final_signals = json.load(f)
                        except:
                            pass

                    final_signals.update(cached_signals)

                    with open("data/active_signals.json", "w", encoding="utf-8") as f:
                        json.dump(final_signals, f, ensure_ascii=False, indent=2)

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

                except Exception as e:
                    logger.error(f"即时保存数据失败: {e}")

            # 4. 每日概览已移除

            logger.info("本轮扫描结束。等待 5 分钟...")
            time.sleep(300)

    except KeyboardInterrupt:
        logger.info("收到关机指令，正在退出...")
    except Exception as e:
        logger.exception(f"系统运行出错: {e}")


if __name__ == "__main__":
    main()
