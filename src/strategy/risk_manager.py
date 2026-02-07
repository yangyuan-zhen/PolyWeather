from loguru import logger


class RiskManager:
    """
    风险控制系统
    """

    def __init__(self, config=None):
        self.config = config or {}
        # 基础风控参数
        self.max_single_trade = self.config.get(
            "max_single_trade", 50.0
        )  # 最大单笔调整为 $50
        self.max_daily_exposure = 50.0  # 每日最高投入上限
        self.daily_used_exposure = 0.0
        self.last_reset_date = ""

        self.min_confidence = 0.5
        self.peak_capital = 0
        self.is_trading_paused = False

        logger.info("Initializing Pro Risk Manager...")

    def _reset_daily_exposure(self):
        """每日重置额度"""
        from datetime import datetime

        today = datetime.now().strftime("%Y-%m-%d")
        if self.last_reset_date != today:
            self.daily_used_exposure = 0.0
            self.last_reset_date = today
            logger.info(f"Daily exposure reset for {today}")

    def calculate_position_size(
        self,
        base_confidence_usd: float,
        depth: float = 0,
        hours_to_settle: float = 24,
        is_high_relative_volume: bool = False,
    ) -> tuple[float, str]:
        """
        仓位计算方法 (简化版，移除流动性过滤):
        仓位 = base_position(置信度)
               × time_decay(离结算衰减)
               × budget_limit
        """
        self._reset_daily_exposure()

        final_pos = base_confidence_usd
        reason = "Normal"

        # 1. 时间衰减因子
        # 离结算时间越近，预测越准但也存在剧烈博弈风险
        time_factor = 1.0
        if hours_to_settle <= 1.0:
            time_factor = 0.0  # 最后 1 小时停止建仓
            reason = "🚫临近结算"
        elif hours_to_settle <= 4.0:
            time_factor = 0.4  # 1-4小时：缩小 60%
            reason = "⏱️结算冲刺 (40%)"
        elif hours_to_settle <= 12.0:
            time_factor = 0.7  # 4-12小时：缩小 30%
            reason = "⏳接近结算 (70%)"

        final_pos *= time_factor
        if final_pos <= 0:
            return 0.0, reason

        # 2. 预算上限过滤
        remaining_daily = self.max_daily_exposure - self.daily_used_exposure
        if remaining_daily <= 0:
            return 0.0, "🚫今日总额度已满 ($50)"

        if final_pos > remaining_daily:
            final_pos = remaining_daily
            reason = "🛑触及日风控上限"

        # 3. 高相对成交量加权 (如果是高成交量市场，且逻辑支持，可保持原状或微增)
        # 这里逻辑设定为：如果不是高成交量，再次缩减 20% 防御
        if not is_high_relative_volume:
            final_pos *= 0.8
            if reason == "Normal":
                reason = "📉低活缩减"

        return round(final_pos, 2), reason

    def record_trade(self, amount: float):
        """记录成交额以扣除额度"""
        self.daily_used_exposure += amount
        logger.debug(
            f"Applied exposure: ${amount}. Daily Total: ${self.daily_used_exposure}"
        )

    def check_trade_risk(
        self, trade_size: float, market_data: dict, model_confidence: float
    ) -> dict:
        """保持基础接口兼容"""
        return {"passed": True, "risks": []}
