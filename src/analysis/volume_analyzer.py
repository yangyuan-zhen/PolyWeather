import numpy as np
from loguru import logger

class VolumeAnalyzer:
    """
    交易量异常检测 - 识别聪明钱和市场转折点
    """
    
    def __init__(self, config=None):
        self.config = config or {}
        self.volume_threshold = self.config.get("volume_threshold", 2.0)  # 2倍标准差
        self.large_order_threshold = self.config.get("large_order_threshold", 1000)  # $1000
        logger.info("Initializing Volume Analyzer...")

    def detect_volume_spike(self, volume_history: list) -> dict:
        """
        检测成交量异常放大
        
        Args:
            volume_history: 历史成交量列表
            
        Returns:
            dict: 包含信号和置信度
        """
        if len(volume_history) < 24:
            return {"signal": "INSUFFICIENT_DATA", "score": 0.5}
        
        recent_volume = np.array(volume_history[-24:])  # 最近24小时
        historical_volume = np.array(volume_history[:-24])
        
        if len(historical_volume) == 0:
            return {"signal": "INSUFFICIENT_DATA", "score": 0.5}
        
        avg_volume = np.mean(historical_volume)
        std_volume = np.std(historical_volume)
        
        recent_avg = np.mean(recent_volume)
        
        # 计算Z-score
        if std_volume > 0:
            z_score = (recent_avg - avg_volume) / std_volume
        else:
            z_score = 0
        
        logger.debug(f"Volume Z-score: {z_score:.2f}")
        
        if z_score > self.volume_threshold:
            return {
                "signal": "VOLUME_SPIKE",
                "score": min(0.9, 0.5 + z_score * 0.1),
                "z_score": z_score,
                "interpretation": "成交量异常放大，可能有新信息进入市场"
            }
        elif z_score < -self.volume_threshold:
            return {
                "signal": "VOLUME_DRY",
                "score": 0.3,
                "z_score": z_score,
                "interpretation": "成交量萎缩，市场观望"
            }
        
        return {"signal": "NORMAL", "score": 0.5, "z_score": z_score}

    def detect_large_orders(self, transactions: list) -> dict:
        """
        检测大额订单 (聪明钱信号)
        
        Args:
            transactions: 交易列表，每个包含 size, side, price
            
        Returns:
            dict: 大额订单分析结果
        """
        large_buys = []
        large_sells = []
        
        for tx in transactions:
            size = tx.get("size", 0)
            side = tx.get("side", "").upper()
            
            if size >= self.large_order_threshold:
                if side == "BUY":
                    large_buys.append(tx)
                elif side == "SELL":
                    large_sells.append(tx)
        
        total_large_buy = sum(t.get("size", 0) for t in large_buys)
        total_large_sell = sum(t.get("size", 0) for t in large_sells)
        
        logger.debug(f"Large buys: ${total_large_buy:.2f}, Large sells: ${total_large_sell:.2f}")
        
        if total_large_buy > total_large_sell * 2:
            return {
                "signal": "SMART_MONEY_BUY",
                "score": 0.8,
                "large_buy_volume": total_large_buy,
                "large_sell_volume": total_large_sell,
                "interpretation": "大户在积极买入，跟随机会"
            }
        elif total_large_sell > total_large_buy * 2:
            return {
                "signal": "SMART_MONEY_SELL",
                "score": 0.2,
                "large_buy_volume": total_large_buy,
                "large_sell_volume": total_large_sell,
                "interpretation": "大户在抛售，风险警告"
            }
        
        return {
            "signal": "NEUTRAL",
            "score": 0.5,
            "large_buy_volume": total_large_buy,
            "large_sell_volume": total_large_sell
        }

    def analyze(self, volume_history: list, transactions: list = None) -> dict:
        """
        综合分析交易量
        """
        volume_signal = self.detect_volume_spike(volume_history)
        
        if transactions:
            order_signal = self.detect_large_orders(transactions)
        else:
            order_signal = {"signal": "NO_DATA", "score": 0.5}
        
        # 综合评分
        combined_score = (volume_signal.get("score", 0.5) * 0.6 + 
                         order_signal.get("score", 0.5) * 0.4)
        
        return {
            "volume_signal": volume_signal,
            "order_signal": order_signal,
            "combined_score": combined_score
        }
