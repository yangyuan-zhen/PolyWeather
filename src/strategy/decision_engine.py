from loguru import logger
from src.analysis.volume_analyzer import VolumeAnalyzer
from src.analysis.orderbook_analyzer import analyze_orderbook
from src.analysis.technical_indicators import TechnicalIndicators

class DecisionEngine:
    """
    综合决策引擎 - 多因子加权评分系统
    """
    
    def __init__(self, config: dict = None):
        self.config = config or {}
        
        # 因子权重
        self.weights = self.config.get("weights", {
            "statistical_prediction": 0.50,
            "data_source_consensus": 0.15,
            "market_volume_signal": 0.15,
            "orderbook_analysis": 0.10,
            "technical_indicators": 0.05,
            "onchain_whale_signal": 0.05
        })
        
        # 初始化分析器
        self.volume_analyzer = VolumeAnalyzer(config)
        self.tech_indicators = TechnicalIndicators()
        
        logger.info("决策引擎初始化完成。")
        logger.debug(f"权重配置: {self.weights}")

    def calculate_signal(self, 
                         model_prediction: dict,
                         market_data: dict,
                         weather_consensus: dict = None,
                         whale_activity: dict = None) -> dict:
        """
        综合多因子计算交易信号
        
        Args:
            model_prediction: 统计模型预测结果
            market_data: 市场数据 (价格历史、订单簿、交易量等)
            weather_consensus: 天气数据源一致性检查结果
            whale_activity: 链上大户活动数据
            
        Returns:
            dict: 综合评分和交易建议
        """
        scores = {}
        details = {}
        
        # 1. 统计模型预测得分 (权重: 50%)
        stat_confidence = model_prediction.get("confidence", 0.5)
        scores["statistical"] = stat_confidence
        details["statistical"] = {
            "score": stat_confidence,
            "prediction": model_prediction.get("predicted_temp"),
            "confidence_interval": model_prediction.get("confidence_interval")
        }
        
        # 2. 多源数据一致性 (权重: 15%)
        if weather_consensus:
            is_consensus = weather_consensus.get("consensus", False)
            consensus_score = 1.0 if is_consensus else 0.3
        else:
            consensus_score = 0.5
        scores["consensus"] = consensus_score
        details["consensus"] = weather_consensus
        
        # 3. 交易量信号 (权重: 15%)
        volume_history = market_data.get("volume_history", [])
        transactions = market_data.get("transactions", [])
        volume_analysis = self.volume_analyzer.analyze(volume_history, transactions)
        scores["volume"] = volume_analysis.get("combined_score", 0.5)
        details["volume"] = volume_analysis
        
        # 4. 订单簿分析 (权重: 10%)
        orderbook = market_data.get("orderbook", {})
        orderbook_signal = analyze_orderbook(orderbook)
        scores["orderbook"] = orderbook_signal.get("confidence", 0.5)
        details["orderbook"] = orderbook_signal
        
        # 5. 技术指标 (权重: 5%)
        price_history = market_data.get("price_history", [])
        if price_history:
            tech_signal = self.tech_indicators.get_signal(price_history)
            scores["technical"] = tech_signal.get("combined_score", 0.5)
            details["technical"] = tech_signal
        else:
            scores["technical"] = 0.5
            details["technical"] = {"message": "No price history available"}
        
        # 6. 链上鲸鱼信号 (权重: 5%)
        if whale_activity:
            is_bullish = whale_activity.get("bullish", False)
            whale_score = 0.8 if is_bullish else 0.2
        else:
            whale_score = 0.5
        scores["whale"] = whale_score
        details["whale"] = whale_activity
        
        # 加权计算最终分数
        final_score = (
            scores["statistical"] * self.weights["statistical_prediction"] +
            scores["consensus"] * self.weights["data_source_consensus"] +
            scores["volume"] * self.weights["market_volume_signal"] +
            scores["orderbook"] * self.weights["orderbook_analysis"] +
            scores["technical"] * self.weights["technical_indicators"] +
            scores["whale"] * self.weights["onchain_whale_signal"]
        )
        
        # 生成建议
        recommendation = self._get_recommendation(final_score)
        
        result = {
            "final_score": round(final_score, 4),
            "recommendation": recommendation,
            "factor_scores": scores,
            "factor_details": details,
            "weights": self.weights
        }
        
        logger.info(f"Decision: {recommendation} (score: {final_score:.4f})")
        return result

    def _get_recommendation(self, score: float) -> str:
        """
        根据评分生成交易建议
        
        Args:
            score: 综合评分 (0-1)
            
        Returns:
            str: 交易建议
        """
        if score > 0.80:
            return "STRONG_BUY"
        elif score > 0.65:
            return "BUY"
        elif score > 0.50:
            return "WEAK_BUY"
        elif score > 0.35:
            return "HOLD"
        elif score > 0.20:
            return "WEAK_SELL"
        else:
            return "NO_ACTION"

    def should_trade(self, 
                     signal: dict, 
                     current_price: float,
                     min_confidence: float = 0.65) -> dict:
        """
        判断是否应该执行交易
        
        Args:
            signal: calculate_signal返回的信号
            current_price: 当前市场价格
            min_confidence: 最低置信度阈值
            
        Returns:
            dict: 交易决策
        """
        final_score = signal.get("final_score", 0)
        recommendation = signal.get("recommendation", "NO_ACTION")
        
        # 检查是否满足交易条件
        should_buy = (
            final_score >= min_confidence and
            recommendation in ["STRONG_BUY", "BUY"] and
            current_price >= 0.85  # 价格阈值
        )
        
        should_sell = (
            final_score < 0.35 or
            recommendation in ["WEAK_SELL", "NO_ACTION"]
        )
        
        if should_buy:
            return {
                "action": "BUY",
                "confidence": final_score,
                "price": current_price,
                "reason": f"Score {final_score:.2f} >= threshold {min_confidence}"
            }
        elif should_sell:
            return {
                "action": "SELL",
                "confidence": final_score,
                "price": current_price,
                "reason": f"Score {final_score:.2f} below threshold or bearish signal"
            }
        else:
            return {
                "action": "HOLD",
                "confidence": final_score,
                "price": current_price,
                "reason": "Conditions not met for trading"
            }
