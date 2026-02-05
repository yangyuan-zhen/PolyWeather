from loguru import logger
from typing import Optional, Dict
from src.data_collection.polymarket_api import PolymarketClient

class OrderExecutor:
    """
    交易执行器 - 负责订单生成、提交和管理
    """
    
    def __init__(self, config: dict, client: PolymarketClient):
        self.config = config
        self.client = client
        self.pending_orders = {}
        self.executed_orders = []
        
        logger.info("Order Executor initialized")

    def execute_trade(self, 
                      token_id: str, 
                      side: str, 
                      amount: float, 
                      price: float,
                      order_type: str = "GTC") -> Dict:
        """
        执行交易
        
        Args:
            token_id: Token ID
            side: "BUY" 或 "SELL"
            amount: 交易金额
            price: 价格
            order_type: 订单类型 (GTC, GTD, FOK)
            
        Returns:
            dict: 订单结果
        """
        logger.info(f"Executing {side} order: ${amount:.2f} @ {price:.4f}")
        
        # 计算数量
        if price <= 0:
            return {"status": "error", "message": "Invalid price"}
        
        size = amount / price
        
        # 提交订单
        try:
            result = self.client.create_order(
                token_id=token_id,
                side=side,
                price=price,
                size=size,
                order_type=order_type
            )
            
            if result:
                order_id = result.get("orderID", "unknown")
                self.executed_orders.append({
                    "order_id": order_id,
                    "token_id": token_id,
                    "side": side,
                    "price": price,
                    "size": size,
                    "amount": amount,
                    "result": result
                })
                
                logger.info(f"Order executed successfully: {order_id}")
                return {
                    "status": "success",
                    "order_id": order_id,
                    "side": side,
                    "price": price,
                    "size": size,
                    "amount": amount
                }
            else:
                return {"status": "error", "message": "Order submission failed"}
                
        except Exception as e:
            logger.error(f"Order execution failed: {e}")
            return {"status": "error", "message": str(e)}

    def cancel_order(self, order_id: str) -> Dict:
        """
        取消订单
        
        Args:
            order_id: 订单ID
            
        Returns:
            dict: 取消结果
        """
        try:
            result = self.client.cancel_order(order_id)
            if result:
                logger.info(f"Order {order_id} cancelled")
                return {"status": "success", "order_id": order_id}
            else:
                return {"status": "error", "message": "Cancel failed"}
        except Exception as e:
            logger.error(f"Cancel order failed: {e}")
            return {"status": "error", "message": str(e)}

    def get_open_orders(self, market_id: str = None) -> Optional[Dict]:
        """
        获取当前挂单
        
        Args:
            market_id: 可选的市场过滤
            
        Returns:
            dict: 挂单列表
        """
        return self.client.get_orders(market_id)

    def get_execution_history(self) -> list:
        """
        获取执行历史
        
        Returns:
            list: 已执行订单列表
        """
        return self.executed_orders


class PortfolioTracker:
    """
    持仓追踪器
    """
    
    def __init__(self):
        self.positions = {}
        self.total_invested = 0
        self.total_pnl = 0
        
        logger.info("Portfolio Tracker initialized")

    def add_position(self, 
                     token_id: str, 
                     side: str,
                     size: float, 
                     entry_price: float,
                     amount: float):
        """
        添加持仓
        """
        if token_id not in self.positions:
            self.positions[token_id] = {
                "side": side,
                "size": size,
                "entry_price": entry_price,
                "amount": amount,
                "current_price": entry_price,
                "unrealized_pnl": 0
            }
        else:
            # 加仓
            existing = self.positions[token_id]
            total_size = existing["size"] + size
            avg_price = (existing["size"] * existing["entry_price"] + size * entry_price) / total_size
            existing["size"] = total_size
            existing["entry_price"] = avg_price
            existing["amount"] += amount
        
        self.total_invested += amount
        logger.info(f"Position added: {token_id}, size={size}, price={entry_price}")

    def update_price(self, token_id: str, current_price: float):
        """
        更新持仓价格
        """
        if token_id in self.positions:
            pos = self.positions[token_id]
            pos["current_price"] = current_price
            
            # 计算未实现盈亏
            if pos["side"] == "BUY":
                pos["unrealized_pnl"] = (current_price - pos["entry_price"]) * pos["size"]
            else:
                pos["unrealized_pnl"] = (pos["entry_price"] - current_price) * pos["size"]

    def close_position(self, token_id: str, exit_price: float) -> Dict:
        """
        平仓
        """
        if token_id not in self.positions:
            return {"status": "error", "message": "Position not found"}
        
        pos = self.positions[token_id]
        
        if pos["side"] == "BUY":
            realized_pnl = (exit_price - pos["entry_price"]) * pos["size"]
        else:
            realized_pnl = (pos["entry_price"] - exit_price) * pos["size"]
        
        self.total_pnl += realized_pnl
        self.total_invested -= pos["amount"]
        
        del self.positions[token_id]
        
        return {
            "status": "success",
            "realized_pnl": realized_pnl,
            "exit_price": exit_price
        }

    def get_summary(self) -> Dict:
        """
        获取持仓汇总
        """
        total_unrealized = sum(p["unrealized_pnl"] for p in self.positions.values())
        
        return {
            "positions_count": len(self.positions),
            "total_invested": self.total_invested,
            "total_unrealized_pnl": total_unrealized,
            "total_realized_pnl": self.total_pnl,
            "positions": self.positions
        }
