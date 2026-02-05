from loguru import logger

class OrderbookAnalyzer:
    """
    分析目标: 评估市场供需平衡和流动性
    """
    def __init__(self, config=None):
        self.config = config or {}
        self.wall_threshold = self.config.get("wall_threshold", 500)  # 单笔订单超过此值为墙
        logger.info("Initializing Orderbook Analyzer...")

    def analyze(self, orderbook):
        """
        订单簿分析决策
        
        Args:
            orderbook: dict 包含 'bids' 和 'asks' 列表
        """
        bids = orderbook.get('bids', [])
        asks = orderbook.get('asks', [])

        if not bids or not asks:
            return {"signal": "NEUTRAL", "confidence": 0.5, "reason": "Empty orderbook"}

        # 1. 计算买卖力量对比 (Imbalance)
        # Polymarket API 返回的通常是 [{"price": "0.90", "size": "100"}, ...]
        bid_volume = sum([float(b.get('size', 0)) for b in bids])
        ask_volume = sum([float(a.get('size', 0)) for a in asks])
        
        imbalance = bid_volume / ask_volume if ask_volume > 0 else 0

        # 2. 识别墙单
        max_bid = max([float(b.get('size', 0)) for b in bids]) if bids else 0
        max_ask = max([float(a.get('size', 0)) for a in asks]) if asks else 0

        # 3. 计算价差 (Spread)
        best_bid = float(bids[0].get('price', 0))
        best_ask = float(asks[0].get('price', 0))
        spread = (best_ask - best_bid) / best_ask if best_ask > 0 else 0

        result = {
            "imbalance": imbalance,
            "bid_volume": bid_volume,
            "ask_volume": ask_volume,
            "max_bid_wall": max_bid,
            "max_ask_wall": max_ask,
            "spread": spread,
            "signal": "NEUTRAL",
            "confidence": 0.5
        }

        # 4. 决策逻辑
        if imbalance > 2.0:
            result["signal"] = "BULLISH"
            result["confidence"] = min(0.9, 0.5 + (imbalance - 1) / 4)
        elif imbalance < 0.5:
            result["signal"] = "BEARISH"
            result["confidence"] = min(0.9, 0.5 + (1 / imbalance - 1) / 4)

        if max_bid > self.wall_threshold and bid_volume > ask_volume:
            result["signal"] = "STRONG_BUY"
            result["confidence"] = 0.85
        elif max_ask > self.wall_threshold and ask_volume > bid_volume:
            result["signal"] = "STRONG_SELL"
            result["confidence"] = 0.85

        # 5. 流动性警告
        if spread > 0.05:  # 价差超过5%
            result["warning"] = "LOW_LIQUIDITY"
            result["confidence"] *= 0.8 # 降低置信度

        return result

def analyze_orderbook(orderbook):
    """兼容旧接口的便捷函数"""
    analyzer = OrderbookAnalyzer()
    return analyzer.analyze(orderbook)
