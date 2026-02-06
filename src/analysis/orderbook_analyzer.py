from loguru import logger

class OrderbookAnalyzer:
    """
    分析目标: 评估市场供需平衡和流动性
    """
    def __init__(self, config=None):
        self.config = config or {}
        self.wall_threshold = self.config.get("wall_threshold", 500)  # 单笔订单超过此值为墙
        logger.info("Initializing Orderbook Analyzer...")

    def assess_liquidity(self, orderbook, side="ask"):
        """
        分析流动性深度 (基于前 3 档)
        """
        orders = orderbook.get('asks' if side == "ask" else 'bids', [])
        if not orders:
            return "枯竭", 0

        # 前 3 档总量 (Polymarket 通常返回价格字符串)
        depth = sum(float(o.get("size", 0)) for o in orders[:3])

        if depth < 50:
            return "稀薄", depth
        elif depth < 500:
            return "正常", depth
        else:
            return "充裕", depth

    def analyze(self, orderbook):
        """
        增强版订单簿分析：集成深度与 Spread 评估
        """
        bids = orderbook.get('bids', [])
        asks = orderbook.get('asks', [])

        if not bids or not asks:
            return {
                "signal": "NEUTRAL", 
                "confidence": 0.0, 
                "tradeable": False,
                "reason": "缺乏双边报价",
                "liquidity": "枯竭",
                "spread": 1.0
            }

        # 1. 计算核心指标
        best_bid = float(bids[0].get('price', 0))
        best_ask = float(asks[0].get('price', 0))
        spread = abs(best_ask - best_bid)
        mid_price = (best_ask + best_bid) / 2
        
        # 2. 评估流动性
        ask_liq, ask_depth = self.assess_liquidity(orderbook, "ask")
        bid_liq, bid_depth = self.assess_liquidity(orderbook, "bid")
        
        # 3. 交易可行性判定 (Spread <= 10c 且 深度 >= $50)
        is_tradeable = (spread <= 0.10) and (ask_depth >= 50 or bid_depth >= 50)

        # 4. Imbalance 计算
        bid_volume = sum([float(b.get('size', 0)) for b in bids])
        ask_volume = sum([float(a.get('size', 0)) for a in asks])
        imbalance = bid_volume / ask_volume if ask_volume > 0 else 0

        result = {
            "best_bid": best_bid,
            "best_ask": best_ask,
            "mid_price": mid_price,
            "spread": round(spread, 4),
            "ask_depth": round(ask_depth, 2),
            "bid_depth": round(bid_depth, 2),
            "liquidity": ask_liq if ask_depth < bid_depth else bid_liq,
            "tradeable": is_tradeable,
            "imbalance": imbalance,
            "signal": "NEUTRAL",
            "confidence": 0.5
        }

        # 5. 信号修正
        if is_tradeable:
            if imbalance > 2.5:
                result["signal"] = "BULLISH"
                result["confidence"] = 0.75
            elif imbalance < 0.4:
                result["signal"] = "BEARISH"
                result["confidence"] = 0.75
        else:
            result["confidence"] = 0.1 # 不建议交易

        return result

def analyze_orderbook(orderbook):
    """兼容旧接口的便捷函数"""
    analyzer = OrderbookAnalyzer()
    return analyzer.analyze(orderbook)
