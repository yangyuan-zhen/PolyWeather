import os
import requests
import time
import re
from typing import Dict, List, Optional
from loguru import logger
from datetime import datetime

# 官方组件
try:
    from py_clob_client.client import ClobClient
    from py_clob_client.constants import POLYGON
except ImportError:
    logger.debug("官方库 py-clob-client 未安装，将回退到 requests 模式")
    ClobClient = None
    POLYGON = 137


class PolymarketClient:
    """
    Polymarket API Client for market data and trading
    """

    def __init__(self, config: Dict):
        self.base_url = config.get("base_url", "https://clob.polymarket.com")
        self.timeout = config.get("timeout", 10)
        self.session = requests.Session()

        # 统一代理设置
        proxy = os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY")
        if proxy:
            self.session.proxies = {"http": proxy, "https": proxy}
            logger.info(f"正在使用代理: {proxy}")  # Added this line for logging

        # 设置公开接口通用的 User-Agent
        self.session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json",
            }
        )

        # 只有在明确需要签名交易时才注入私钥相关头 (目前我们只拉取报价)
        self.api_key = config.get("api_key")
        self.api_secret = config.get("api_secret")
        self.api_passphrase = config.get("api_passphrase")
        
        # 初始化官方 CLOB 客户端
        if ClobClient:
            try:
                self.clob_client = ClobClient(
                    host=self.base_url,
                    key=self.api_key,
                    secret=self.api_secret,
                    passphrase=self.api_passphrase,
                    chain_id=POLYGON
                )
                logger.info("官方 py-clob-client 初始化成功")
            except Exception as e:
                logger.error(f"官方客户端初始化失败: {e}")
                self.clob_client = None
        else:
            self.clob_client = None

        self._setup_headers()
        logger.info(f"Polymarket 客户端初始化完成。Base URL: {self.base_url}")

    def _setup_headers(self):
        """Setup default headers for API requests"""
        self.session.headers.update(
            {"Content-Type": "application/json", "Accept": "application/json"}
        )
        if self.api_key:
            self.session.headers.update({"POLY_API_KEY": self.api_key})

    def _request(self, method: str, endpoint: str, **kwargs) -> Optional[Dict]:
        """Make HTTP request with error handling"""
        url = f"{self.base_url}{endpoint}"

        try:
            response = self.session.request(
                method=method, url=url, timeout=self.timeout, **kwargs
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.Timeout:
            logger.error(f"Request timeout: {url}")
            return None
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 404:
                logger.debug(f"Resource not found (404): {url}")
            else:
                logger.error(f"HTTP error: {e}")
            return None
        except Exception as e:
            logger.error(f"Request failed: {e}")
            return None

    def get_markets(self, next_cursor: str = None) -> Optional[Dict]:
        """
        Get list of all markets

        Returns:
            dict: Market list with pagination info
        """
        params = {}
        if next_cursor:
            params["next_cursor"] = next_cursor

        return self._request("GET", "/markets", params=params)

    def get_market(self, market_id: str) -> Optional[Dict]:
        """
        Get specific market details

        Args:
            market_id: The market condition ID

        Returns:
            dict: Market details
        """
        return self._request("GET", f"/markets/{market_id}")

    def get_price(self, token_id: str, side: str = "ask") -> Optional[float]:
        """
        获取 Token 的实时盘口价格 (优先使用官方库)
        """
        # 官方库模式
        if self.clob_client:
            try:
                # 再次强调：Polymarket 的 side=BUY 对应的是 Ask (买入成本)
                side_val = "BUY" if side == "ask" else "SELL"
                price_str = self.clob_client.get_price(token_id=token_id, side=side_val)
                if price_str:
                    return float(price_str)
            except Exception as e:
                logger.debug(f"官方库 get_price 失败: {e}")

        # 回退模式
        try:
            book = self.get_orderbook(token_id)
            if book and isinstance(book, dict):
                if side == "ask" and book.get("asks"):
                    return float(book["asks"][0].get("price"))
                elif side == "bid" and book.get("bids"):
                    return float(book["bids"][0].get("price"))

            # 如果 orderbook 拿不到，尝试直接查 price 接口
            # 根据 Polymarket 文档：BUY 侧价格 = 市场上的最佳 ask (即你的买入成本)
            side_val = "BUY" if side == "ask" else "SELL"
            res = self._request("GET", "/price", params={"token_id": token_id, "side": side_val})
            if res and isinstance(res, dict) and "price" in res:
                return float(res["price"])
        except Exception as e:
            logger.debug(f"抓取 CLOB 价格失败 ({token_id}): {e}")

        return None

    def get_orderbook(self, token_id: str) -> Optional[Dict]:
        """
        获取订单簿深度 (优先使用官方库)
        """
        if self.clob_client:
            try:
                return self.clob_client.get_order_book(token_id=token_id)
            except Exception as e:
                logger.debug(f"官方库 get_order_book 失败: {e}")

        # 回退到 requests 模式
        try:
            url = f"{self.base_url}/book"
            response = self.session.get(url, params={"token_id": token_id}, timeout=15)
            if response.status_code == 200:
                return response.json()
        except Exception as e:
            logger.debug(f"获取订单簿失败: {e}")
        return None

    def get_buy_prices(self, yes_token_id: str, no_token_id: str) -> Optional[Dict]:
        """
        获取买入价格 (Buy Yes 和 Buy No)

        Args:
            yes_token_id: Yes token ID
            no_token_id: No token ID

        Returns:
            dict: {"buy_yes": float, "buy_no": float} 或 None
        """
        try:
            # Buy Yes = Yes token 的最佳卖单 (asks)
            yes_book = self.get_orderbook(yes_token_id)
            buy_yes = None
            if (
                yes_book
                and isinstance(yes_book, dict)
                and yes_book.get("asks")
                and len(yes_book["asks"]) > 0
            ):
                buy_yes = float(yes_book["asks"][0].get("price", 0))

            # Buy No = No token 的最佳卖单 (asks)
            no_book = self.get_orderbook(no_token_id)
            buy_no = None
            if (
                no_book
                and isinstance(no_book, dict)
                and no_book.get("asks")
                and len(no_book["asks"]) > 0
            ):
                buy_no = float(no_book["asks"][0].get("price", 0))

            if buy_yes is not None and buy_no is not None:
                return {"buy_yes": buy_yes, "buy_no": buy_no}

        except Exception as e:
            logger.debug(f"获取买入价格失败: {e}")

        return None

    def get_multiple_prices(self, token_requests: List[Dict]) -> Dict[str, float]:
        """
        批量获取多个 token 的价格 (使用 Polymarket 批量接口)
        """
        if not token_requests:
            return {}

        try:
            # 批量获取价格端点
            url = f"{self.base_url}/prices"

            # Polymarket 期望的查询参数格式
            # 我们需要获取可买入的价格，所以 side 应该是 "buy"
            all_prices = {}

            # 分批处理以提高稳定性
            for i in range(0, len(token_requests), 50):
                batch = token_requests[i : i + 50]
                # 根据 Polymarket CLOB 文档，获取买入成本应使用 side=BUY (即 Ask 价格)
                payload = []
                for r in batch:
                    # 映射逻辑：我们想买(ask) -> API side=BUY; 我们想卖(bid) -> API side=SELL
                    side_val = "BUY" if r.get("side") == "ask" else "SELL"
                    payload.append({"token_id": r["token_id"], "side": side_val})

                response = self.session.post(url, json=payload, timeout=20)
                logger.debug(f"批量价格请求: 状态码={response.status_code}")
                if response.status_code == 200:
                    results = response.json()
                    # 结果通常是 { "token_id": "price", ... } 或 [{ "token_id": "...", "price": "..." }, ...]
                    if isinstance(results, dict):
                        for tid, p in results.items():
                            all_prices[tid] = float(p)
                    elif isinstance(results, list):
                        for item in results:
                            if "token_id" in item and "price" in item:
                                all_prices[item["token_id"]] = float(item["price"])
                    else:
                        logger.warning(f"批量价格返回非dict格式: {type(results)}")

            return all_prices
        except Exception as e:
            logger.warning(f"批量获取盘口价格失败: {e}")
        return {}

    def get_midpoint(self, token_id: str) -> Optional[float]:
        """
        Get midpoint price for a token

        Args:
            token_id: The token ID

        Returns:
            float: Midpoint price
        """
        result = self._request("GET", f"/midpoint", params={"token_id": token_id})
        if result and "mid" in result:
            return float(result["mid"])
        return None

    def search_markets(self, query: str) -> Optional[Dict]:
        """
        Search markets by query

        Args:
            query: Search query string

        Returns:
            dict: Search results
        """
        return self._request("GET", "/markets", params={"tag": query})

    # Trading methods (require authentication)
    def create_order(
        self,
        token_id: str,
        side: str,
        price: float,
        size: float,
        order_type: str = "GTC",
    ) -> Optional[Dict]:
        """
        Create a new order (requires API key)

        Args:
            token_id: Token to trade
            side: "BUY" or "SELL"
            price: Order price
            size: Order size
            order_type: Order type (GTC, GTD, FOK)

        Returns:
            dict: Order confirmation
        """
        if not self.api_key:
            logger.error("API key required for trading")
            return None

        order_data = {
            "tokenID": token_id,
            "side": side.upper(),
            "price": str(price),
            "size": str(size),
            "type": order_type,
        }

        logger.info(f"Creating order: {side} {size} @ {price}")
        return self._request("POST", "/order", json=order_data)

    def cancel_order(self, order_id: str) -> Optional[Dict]:
        """
        Cancel an existing order

        Args:
            order_id: Order ID to cancel

        Returns:
            dict: Cancellation confirmation
        """
        if not self.api_key:
            logger.error("API key required for trading")
            return None

        return self._request("DELETE", f"/order/{order_id}")

    def discover_weather_markets(self) -> list:
        """
        通过全量扫描活跃事件发现最高温天气市场。
        """
        gamma_url = "https://gamma-api.polymarket.com/events"
        all_weather_markets = []
        seen_condition_ids = set()

        def process_events(events, source_label):
            if not isinstance(events, list):
                return

            new_markets_count = 0
            for event in events:
                title = event.get("title", "")
                is_weather_event = (
                    "Highest temperature" in title or "temperature in" in title.lower()
                )

                event_slug = event.get("slug", "")
                for m in event.get("markets", []):
                    question = m.get("groupItemTitle") or m.get("question") or ""

                    # 关键词匹配
                    if not (
                        is_weather_event
                        or "Highest temperature" in question
                        or "temperature in" in question.lower()
                    ):
                        continue

                    c_id = m.get("conditionId")
                    # 对于多选一市场，不同档位共享 conditionId，但 tokenId 不同
                    unique_key = f"{c_id}_{m.get('activeTokenId')}"
                    if c_id and unique_key not in seen_condition_ids:
                        all_weather_markets.append(
                            {
                                "condition_id": c_id,
                                "question": question,
                                "active_token_id": m.get("activeTokenId"),
                                "tokens": m.get("clobTokenIds"),
                                "prices": m.get("outcomePrices"),
                                "event_title": title,
                                "slug": event_slug,
                            }
                        )
                        seen_condition_ids.add(unique_key)
                        new_markets_count += 1
            if new_markets_count > 0:
                logger.debug(f"[{source_label}] 发现 {new_markets_count} 个新市场合约")

        try:
            # 1. 扫描活跃且未合并的 (全量) - 增加到20000以确保抓取所有天气市场
            for offset in range(0, 20000, 1000):
                params = {
                    "active": "true",
                    "closed": "false",
                    "limit": 1000,
                    "offset": offset,
                }
                response = self.session.get(
                    gamma_url, params=params, timeout=self.timeout
                )
                if response.status_code == 200:
                    events = response.json()
                    if not events:
                        break
                    process_events(events, f"Open-O{offset}")
                else:
                    break

            # 2. 扫描活跃但已关闭的 - 增加到20000以覆盖更多历史
            for offset in range(0, 20000, 1000):
                params = {
                    "active": "true",
                    "closed": "true",
                    "limit": 1000,
                    "offset": offset,
                }
                response = self.session.get(
                    gamma_url, params=params, timeout=self.timeout
                )
                if response.status_code == 200:
                    events = response.json()
                    if not events:
                        break
                    process_events(events, f"Closed-O{offset}")
                else:
                    break

            # 3. 扫描非活跃但未关闭的市场
            for offset in range(0, 10000, 1000):
                params = {
                    "active": "false",
                    "closed": "false",
                    "limit": 1000,
                    "offset": offset,
                }
                response = self.session.get(
                    gamma_url, params=params, timeout=self.timeout
                )
                if response.status_code == 200:
                    events = response.json()
                    if not events:
                        break
                    process_events(events, f"Inactive-O{offset}")
                else:
                    break

            # 4. 扫描非活跃且已关闭的市场（某些即将结算的市场可能在这里）
            for offset in range(0, 10000, 1000):
                params = {
                    "active": "false",
                    "closed": "true",
                    "limit": 1000,
                    "offset": offset,
                }
                response = self.session.get(
                    gamma_url, params=params, timeout=self.timeout
                )
                if response.status_code == 200:
                    events = response.json()
                    if not events:
                        break
                    process_events(events, f"InactiveClosed-O{offset}")
                else:
                    break

            logger.info(
                f"全量发现结束，共获取 {len(all_weather_markets)} 个天气档位合约"
            )
            return all_weather_markets

        except Exception as e:
            logger.error(f"全量发现天气市场失败: {e}")
            return []

    def get_weather_markets(self) -> list:
        """
        获取全量活跃天气市场
        """
        return self.discover_weather_markets()

    def get_event_by_slug(self, slug: str) -> Optional[Dict]:
        """
        通过slug直接获取特定事件（用于捕获部分结算等特殊状态的市场）
        """
        try:
            url = f"{self.base_url.replace('clob', 'gamma-api')}/events"
            params = {"slug": slug}
            response = self.session.get(url, params=params, timeout=self.timeout)

            if response.status_code == 200:
                events = response.json()
                if events and len(events) > 0:
                    return events[0]
        except Exception as e:
            logger.debug(f"通过slug获取事件失败 ({slug}): {e}")
        return None

    def find_weather_market(self, city: str, date_str: str = None) -> Optional[Dict]:
        """
        根据城市和日期精准查找
        """
        weather_markets = self.get_weather_markets()
        for m in weather_markets:
            content = (
                str(m.get("question", "")) + str(m.get("event_title", ""))
            ).lower()
            if city.lower() in content:
                if date_str:
                    if date_str.lower() in content:
                        return m
                else:
                    return m
        return None

    def get_weather_event_markets(self, city: str) -> list:
        """
        获取某个城市相关的所有区间市场
        """
        all_markets = self.get_weather_markets()
        return [
            m
            for m in all_markets
            if city.lower()
            in (str(m.get("question", "")) + str(m.get("event_title", ""))).lower()
        ]
