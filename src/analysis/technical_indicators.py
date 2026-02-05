import numpy as np
from loguru import logger

class TechnicalIndicators:
    """
    技术指标计算 - RSI, 布林带等
    """
    
    def __init__(self):
        logger.info("Initializing Technical Indicators...")

    def calculate_rsi(self, prices: list, period: int = 14) -> float:
        """
        计算相对强弱指标 (RSI)
        
        Args:
            prices: 价格历史列表
            period: RSI周期，默认14
            
        Returns:
            float: RSI值 (0-100)
        """
        if len(prices) < period + 1:
            logger.warning("Insufficient data for RSI calculation")
            return 50.0  # 返回中性值
        
        prices = np.array(prices)
        deltas = np.diff(prices)
        
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)
        
        avg_gain = np.mean(gains[-period:])
        avg_loss = np.mean(losses[-period:])
        
        if avg_loss == 0:
            return 100.0
        
        rs = avg_gain / avg_loss
        rsi = 100 - (100 / (1 + rs))
        
        logger.debug(f"RSI({period}): {rsi:.2f}")
        return rsi

    def calculate_bollinger_bands(self, prices: list, period: int = 20, std_dev: float = 2.0) -> dict:
        """
        计算布林带
        
        Args:
            prices: 价格历史列表
            period: 移动平均周期
            std_dev: 标准差倍数
            
        Returns:
            dict: 包含上轨、中轨、下轨
        """
        if len(prices) < period:
            logger.warning("Insufficient data for Bollinger Bands")
            return {"upper": None, "middle": None, "lower": None}
        
        prices = np.array(prices[-period:])
        middle = np.mean(prices)
        std = np.std(prices)
        
        upper = middle + std_dev * std
        lower = middle - std_dev * std
        
        return {
            "upper": upper,
            "middle": middle,
            "lower": lower,
            "std": std
        }

    def calculate_momentum(self, prices: list, period: int = 10) -> float:
        """
        计算价格动量
        
        Args:
            prices: 价格历史
            period: 动量周期
            
        Returns:
            float: 动量值 (当前价格 / N周期前价格 - 1)
        """
        if len(prices) < period + 1:
            return 0.0
        
        current = prices[-1]
        past = prices[-period - 1]
        
        if past == 0:
            return 0.0
        
        momentum = (current / past) - 1
        return momentum

    def get_signal(self, prices: list) -> dict:
        """
        综合技术指标信号
        
        Returns:
            dict: 包含信号和分数
        """
        rsi = self.calculate_rsi(prices)
        bb = self.calculate_bollinger_bands(prices)
        momentum = self.calculate_momentum(prices)
        
        # RSI信号
        if rsi > 70:
            rsi_signal = "OVERBOUGHT"
            rsi_score = 0.3  # 超买，看跌
        elif rsi < 30:
            rsi_signal = "OVERSOLD"
            rsi_score = 0.8  # 超卖，看涨
        else:
            rsi_signal = "NEUTRAL"
            rsi_score = 0.5
        
        # 布林带信号
        if bb["upper"] and len(prices) > 0:
            current_price = prices[-1]
            if current_price > bb["upper"]:
                bb_signal = "ABOVE_UPPER"
                bb_score = 0.7  # 突破上轨，强势
            elif current_price < bb["lower"]:
                bb_signal = "BELOW_LOWER"
                bb_score = 0.3  # 跌破下轨，弱势
            else:
                bb_signal = "WITHIN_BANDS"
                bb_score = 0.5
        else:
            bb_signal = "NO_DATA"
            bb_score = 0.5
        
        # 综合分数
        combined_score = (rsi_score * 0.5 + bb_score * 0.3 + 
                         (0.5 + momentum * 2) * 0.2)  # momentum 转换为 0-1
        combined_score = max(0, min(1, combined_score))
        
        return {
            "rsi": {"value": rsi, "signal": rsi_signal, "score": rsi_score},
            "bollinger": {"bands": bb, "signal": bb_signal, "score": bb_score},
            "momentum": momentum,
            "combined_score": combined_score
        }
