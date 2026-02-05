from loguru import logger
from typing import List, Dict
from src.data_collection.onchain_tracker import OnchainTracker

class WhaleTracker:
    """
    大户行为分析模块
    """
    def __init__(self, config: dict, tracker: OnchainTracker):
        self.config = config
        self.tracker = tracker
        logger.info("Initializing Whale Tracker...")

    def analyze_market_whales(self, market_id: str) -> Dict:
        """
        分析特定市场的鲸鱼行为
        """
        large_trades = self.tracker.get_large_transactions(market_id)
        
        if not large_trades:
            return {"bullish": False, "signal": "NEUTRAL", "reason": "No whale activity detected"}

        buy_value = 0
        sell_value = 0
        
        for trade in large_trades:
            side = trade.get("side", "").upper()
            value = trade.get("value", 0)
            
            if side == "BUY":
                buy_value += value
            else:
                sell_value += value

        # 判断情绪
        if buy_value > sell_value * 2:
            return {
                "bullish": True,
                "signal": "STRONG_ACCUMULATION",
                "buy_value": buy_value,
                "sell_value": sell_value,
                "reason": "Whales are heavily buying"
            }
        elif sell_value > buy_value * 2:
            return {
                "bullish": False,
                "signal": "STRONG_DISTRIBUTION",
                "buy_value": buy_value,
                "sell_value": sell_value,
                "reason": "Whales are heavily selling"
            }
        
        return {
            "bullish": buy_value > sell_value,
            "signal": "MODERATE",
            "buy_value": buy_value,
            "sell_value": sell_value,
            "reason": "Mixed whale activity"
        }
