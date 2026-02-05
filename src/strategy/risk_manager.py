from loguru import logger

class RiskManager:
    """
    风险控制系统
    """
    
    def __init__(self, config=None):
        self.config = config or {}
        self.max_single_trade = self.config.get("max_single_trade", 500)  # 最大单笔$500
        self.max_drawdown = self.config.get("max_drawdown", 0.10)  # 最大回撤10%
        self.min_liquidity = self.config.get("min_liquidity", 1000)  # 最小流动性$1000
        self.max_slippage = self.config.get("max_slippage", 0.02)  # 最大滑点2%
        self.min_confidence = self.config.get("min_confidence", 0.65)  # 最小置信度65%
        
        self.peak_capital = 0
        self.current_drawdown = 0
        self.is_trading_paused = False
        
        logger.info("Initializing Risk Manager...")

    def check_trade_risk(self, 
                         trade_size: float,
                         market_data: dict,
                         model_confidence: float) -> dict:
        """
        检查单笔交易风险
        
        Args:
            trade_size: 交易金额
            market_data: 市场数据 (包含订单簿等)
            model_confidence: 模型置信度
            
        Returns:
            dict: 风险检查结果
        """
        risks = []
        passed = True
        
        # 1. 检查交易金额
        if trade_size > self.max_single_trade:
            risks.append({
                "type": "TRADE_SIZE",
                "message": f"Trade size ${trade_size:.2f} exceeds max ${self.max_single_trade}"
            })
            passed = False
        
        # 2. 检查置信度
        if model_confidence < self.min_confidence:
            risks.append({
                "type": "LOW_CONFIDENCE",
                "message": f"Model confidence {model_confidence:.2f} below threshold {self.min_confidence}"
            })
            passed = False
        
        # 3. 检查流动性
        orderbook = market_data.get("orderbook", {})
        total_liquidity = self._calculate_liquidity(orderbook)
        if total_liquidity < self.min_liquidity:
            risks.append({
                "type": "LOW_LIQUIDITY",
                "message": f"Market liquidity ${total_liquidity:.2f} below threshold ${self.min_liquidity}"
            })
            passed = False
        
        # 4. 检查滑点
        expected_slippage = self._estimate_slippage(trade_size, orderbook)
        if expected_slippage > self.max_slippage:
            risks.append({
                "type": "HIGH_SLIPPAGE",
                "message": f"Expected slippage {expected_slippage:.2%} exceeds max {self.max_slippage:.2%}"
            })
            passed = False
        
        # 5. 检查是否暂停交易
        if self.is_trading_paused:
            risks.append({
                "type": "TRADING_PAUSED",
                "message": "Trading is paused due to drawdown limit"
            })
            passed = False
        
        return {
            "passed": passed,
            "risks": risks,
            "liquidity": total_liquidity,
            "expected_slippage": expected_slippage
        }

    def _calculate_liquidity(self, orderbook: dict) -> float:
        """计算订单簿总流动性"""
        bids = orderbook.get("bids", [])
        asks = orderbook.get("asks", [])
        
        bid_liquidity = sum(float(b.get("size", 0)) for b in bids)
        ask_liquidity = sum(float(a.get("size", 0)) for a in asks)
        
        return bid_liquidity + ask_liquidity

    def _estimate_slippage(self, trade_size: float, orderbook: dict) -> float:
        """估算滑点"""
        asks = orderbook.get("asks", [])
        if not asks:
            return 0.05  # 无数据时假设5%滑点
        
        best_ask = float(asks[0].get("price", 0)) if asks else 0
        if best_ask == 0:
            return 0.05
        
        # 简单估算：交易额 / 流动性 * 基础滑点
        ask_liquidity = sum(float(a.get("size", 0)) for a in asks)
        if ask_liquidity == 0:
            return 0.05
        
        impact_ratio = trade_size / ask_liquidity
        estimated_slippage = impact_ratio * 0.1  # 假设10%的市场冲击系数
        
        return min(estimated_slippage, 0.1)  # 最大10%

    def update_drawdown(self, current_capital: float) -> dict:
        """
        更新回撤状态
        
        Args:
            current_capital: 当前资金
            
        Returns:
            dict: 回撤状态
        """
        # 更新峰值
        if current_capital > self.peak_capital:
            self.peak_capital = current_capital
        
        # 计算回撤
        if self.peak_capital > 0:
            self.current_drawdown = (self.peak_capital - current_capital) / self.peak_capital
        else:
            self.current_drawdown = 0
        
        # 检查是否需要暂停交易
        if self.current_drawdown >= self.max_drawdown:
            self.is_trading_paused = True
            logger.warning(f"Trading PAUSED! Drawdown {self.current_drawdown:.2%} exceeds limit {self.max_drawdown:.2%}")
        
        return {
            "peak_capital": self.peak_capital,
            "current_capital": current_capital,
            "drawdown": self.current_drawdown,
            "is_paused": self.is_trading_paused
        }

    def resume_trading(self):
        """手动恢复交易"""
        self.is_trading_paused = False
        logger.info("Trading resumed manually")
