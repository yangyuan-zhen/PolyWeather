from loguru import logger

class PositionManager:
    """
    仓位管理 - Kelly公式动态仓位计算
    """
    
    def __init__(self, config=None):
        self.config = config or {}
        self.max_position_ratio = self.config.get("max_position_ratio", 0.25)  # 最大单笔25%
        self.max_total_exposure = self.config.get("max_total_exposure", 0.80)  # 最大总仓位80%
        self.min_trade_size = self.config.get("min_trade_size", 10)  # 最小交易额$10
        logger.info("Initializing Position Manager...")

    def kelly_criterion(self, win_prob: float, odds: float) -> float:
        """
        Kelly公式计算最优投资比例
        
        f = (bp - q) / b
        f: 应投资的资金比例
        b: 赔率 (盈利/亏损)
        p: 胜率
        q: 败率 (1-p)
        
        Args:
            win_prob: 预测胜率 (0-1)
            odds: 赔率
            
        Returns:
            float: 建议投资比例 (0-1)
        """
        if win_prob <= 0 or win_prob >= 1 or odds <= 0:
            return 0.0
        
        q = 1 - win_prob
        f = (win_prob * odds - q) / odds
        
        # 限制最大仓位
        f = max(0, min(f, self.max_position_ratio))
        
        logger.debug(f"Kelly ratio: {f:.4f} (win_prob={win_prob:.2f}, odds={odds:.2f})")
        return f

    def calculate_position_size(self, 
                                total_capital: float,
                                win_prob: float,
                                market_price: float,
                                current_exposure: float = 0) -> dict:
        """
        计算建议仓位大小
        
        Args:
            total_capital: 总资金
            win_prob: 模型预测胜率
            market_price: 当前市场价格 (0-1)
            current_exposure: 当前已有仓位占比
            
        Returns:
            dict: 包含建议仓位大小和相关信息
        """
        # 计算赔率
        if market_price <= 0 or market_price >= 1:
            return {"size": 0, "error": "Invalid market price"}
        
        odds = (1 - market_price) / market_price
        
        # Kelly计算
        kelly_ratio = self.kelly_criterion(win_prob, odds)
        
        # 检查总仓位限制
        available_ratio = self.max_total_exposure - current_exposure
        if available_ratio <= 0:
            return {
                "size": 0,
                "kelly_ratio": kelly_ratio,
                "reason": "Max exposure reached"
            }
        
        # 实际使用比例
        actual_ratio = min(kelly_ratio, available_ratio)
        
        # 计算金额
        position_size = total_capital * actual_ratio
        
        # 检查最小交易额
        if position_size < self.min_trade_size:
            return {
                "size": 0,
                "kelly_ratio": kelly_ratio,
                "reason": f"Below minimum trade size (${self.min_trade_size})"
            }
        
        return {
            "size": position_size,
            "kelly_ratio": kelly_ratio,
            "actual_ratio": actual_ratio,
            "odds": odds,
            "expected_return": (win_prob * odds - (1 - win_prob)) * position_size
        }

    def should_exit(self, 
                    entry_price: float,
                    current_price: float,
                    current_prediction: float,
                    stop_loss: float = 0.15,
                    take_profit: float = 0.30) -> dict:
        """
        判断是否应该平仓
        
        Args:
            entry_price: 入场价格
            current_price: 当前价格
            current_prediction: 当前模型预测
            stop_loss: 止损比例
            take_profit: 止盈比例
            
        Returns:
            dict: 退出建议
        """
        if entry_price <= 0:
            return {"should_exit": False}
        
        pnl_ratio = (current_price - entry_price) / entry_price
        
        # 止损
        if pnl_ratio < -stop_loss:
            return {
                "should_exit": True,
                "reason": "STOP_LOSS",
                "pnl_ratio": pnl_ratio
            }
        
        # 止盈
        if pnl_ratio > take_profit:
            return {
                "should_exit": True,
                "reason": "TAKE_PROFIT",
                "pnl_ratio": pnl_ratio
            }
        
        # 模型预测反转
        if current_prediction < 0.4:  # 预测胜率下降
            return {
                "should_exit": True,
                "reason": "PREDICTION_REVERSAL",
                "pnl_ratio": pnl_ratio,
                "current_prediction": current_prediction
            }
        
        return {
            "should_exit": False,
            "pnl_ratio": pnl_ratio
        }
