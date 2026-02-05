from loguru import logger
from typing import List, Dict, Optional
from src.data_collection.polymarket_api import PolymarketClient

class OnchainTracker:
    """
    追踪 Polymarket 上的大额交易和钱包动向
    主要通过 Polymarket API 获取交易历史，并模拟链上分析逻辑
    """
    def __init__(self, config: dict, client: PolymarketClient):
        self.config = config
        self.client = client
        self.whale_threshold = self.config.get("whale_threshold", 5000) # $5000 以上视为鲸鱼
        logger.info(f"Initializing Onchain Tracker (Whale Threshold: ${self.whale_threshold})")

    def get_large_transactions(self, market_id: str, limit: int = 100) -> List[Dict]:
        """
        获取特定市场的历史大额交易
        """
        trades = self.client.get_trades(market_id=market_id, limit=limit)
        if not trades:
            return []

        # 过滤大额交易 (Polymarket API 返回的格式可能需要根据实际调整)
        # 假设格式: [{"price": 0.9, "size": 10000, "side": "BUY", "maker": "0x...", "taker": "0x..."}]
        large_trades = []
        for trade in trades:
            size = float(trade.get("size", 0))
            price = float(trade.get("price", 0))
            value = size * price
            
            if value >= self.whale_threshold:
                trade["value"] = value
                large_trades.append(trade)

        return large_trades

    def get_whale_positions(self, market_id: str) -> Dict[str, float]:
        """
        估算大户在某个市场的持仓情况
        注意：这只是基于最近交易的估算，真实持仓需要查询链上合约
        """
        trades = self.get_large_transactions(market_id, limit=500)
        whale_holdings = {}
        
        for trade in trades:
            wallet = trade.get("proxyWallet") or trade.get("maker") or "unknown"
            side = trade.get("side", "").upper()
            size = float(trade.get("size", 0))
            
            if side == "BUY":
                whale_holdings[wallet] = whale_holdings.get(wallet, 0) + size
            else:
                whale_holdings[wallet] = whale_holdings.get(wallet, 0) - size
                
        return whale_holdings
