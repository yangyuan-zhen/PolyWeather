import json
import os
import time
from datetime import datetime, timedelta
from loguru import logger


class PaperTrader:
    """
    模拟交易系统 (Paper Trading System)
    """

    def __init__(self, storage_path="data/paper_positions.json", total_capital=1000.0):
        self.storage_path = storage_path
        self.initial_capital = total_capital
        data = self._load_data()
        self.positions = data.get("positions", {})
        self.history = data.get("history", [])  # 历史结项记录
        self.trades = data.get("trades", [])    # 原始买入/卖出记录
        self.balance = data.get("balance", total_capital)
        logger.info(f"模拟交易系统初始化。累计成交: {len(self.history)} 笔, 买入记录: {len(self.trades)} 笔")

    def _load_data(self):
        if os.path.exists(self.storage_path):
            try:
                with open(self.storage_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except:
                return {"positions": {}, "history": [], "trades": [], "balance": self.initial_capital}
        return {"positions": {}, "history": [], "trades": [], "balance": self.initial_capital}

    def _save_data(self):
        with open(self.storage_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "positions": self.positions,
                    "history": self.history,
                    "trades": self.trades,
                    "balance": round(self.balance, 2),
                },
                f,
                ensure_ascii=False,
                indent=2,
            )

    def open_position(self, market_id: str, city: str, option: str, price: int, side: str, amount_usd: float = 5.0):
        """
        开仓进入模拟仓位
        """
        # 价格以美分计，转换为 0-1 比例
        price_decimal = price / 100.0
        
        # 检查余额
        if self.balance < amount_usd:
            logger.warning(f"余额不足，无法开仓 (余额: ${self.balance:.2f})")
            return False
            
        # 计算持仓份额
        shares = amount_usd / price_decimal if price_decimal > 0 else 0
        
        position_id = f"{market_id}_{side}"
        
        # 如果已经有相同方向的仓位，可以选择加仓或忽略（这里简单起见，不重复开仓）
        if position_id in self.positions:
            return False
            
        new_pos = {
            "market_id": market_id,
            "city": city,
            "option": option,
            "side": side,
            "entry_price": price,
            "shares": shares,
            "cost_usd": amount_usd,
            "current_price": price,
            "pnl_usd": 0.0,
            "pnl_pct": 0.0,
            "status": "OPEN",
            "opened_at": (datetime.utcnow() + timedelta(hours=8)).strftime("%Y-%m-%d %H:%M:%S")
        }
        
        self.positions[position_id] = new_pos
        self.balance -= amount_usd
        
        # 记录交易流水
        self.trades.append({
            "type": "BUY",
            "city": city,
            "option": option,
            "side": side,
            "price": price,
            "amount": amount_usd,
            "time": new_pos["opened_at"]
        })
        
        self._save_data()
        
        logger.success(f"【模拟开仓】{city} | {option} | {side} | 价格: {price}¢ | 投入: ${amount_usd}")
        return True

    def update_pnl(self, current_prices: dict):
        updated_report = []
        finished_ids = []

        for pid, pos in self.positions.items():
            if pos["status"] != "OPEN":
                continue
            m_id = pos["market_id"]

            if m_id in current_prices:
                curr_price = current_prices[m_id].get("price", 50)
                if pos["side"] == "NO":
                    curr_price = 100 - curr_price

                # 更新当前价值
                value = pos["shares"] * (curr_price / 100.0)
                pnl = value - pos["cost_usd"]
                pnl_pct = (pnl / pos["cost_usd"]) * 100 if pos["cost_usd"] > 0 else 0

                pos["current_price"] = curr_price
                pos["pnl_usd"] = round(pnl, 2)
                pos["pnl_pct"] = round(pnl_pct, 2)

                # --- 自动结项检测：如果价格变为 0 或 100 (Polymarket 已结算) ---
                if curr_price >= 99.5 or curr_price <= 0.5:
                    pos["status"] = "CLOSED"
                    pos["closed_at"] = (
                        datetime.utcnow() + timedelta(hours=8)
                    ).strftime("%Y-%m-%d %H:%M:%S")
                    self.balance += value  # 资金回笼
                    self.history.append(pos)
                    finished_ids.append(pid)
                    logger.success(
                        f"【模拟结项】{pos['city']} | {pos['option']} | 最终价格: {curr_price}¢ | 获利: ${pnl:+.2f}"
                    )
                else:
                    updated_report.append(pos)

        # 从活跃仓位中移除已结项的
        for pid in finished_ids:
            # 在流水中添加卖出（结项）记录
            pos = self.positions[pid]
            self.trades.append({
                "type": "SELL",
                "city": pos["city"],
                "option": pos["option"],
                "side": pos["side"],
                "price": pos["current_price"],
                "amount": round(pos["shares"] * (pos["current_price"] / 100.0), 2),
                "time": pos.get("closed_at")
            })
            del self.positions[pid]

        self._save_data()
            
        return updated_report
