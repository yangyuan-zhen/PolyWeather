import os
import requests
import time
import re
from typing import Dict, List, Optional
from loguru import logger
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

from py_clob_client.client import ClobClient
from py_clob_client.constants import POLYGON
from py_clob_client.clob_types import ApiCreds, BookParams, OpenOrderParams


class PolymarketClient:
    """
    Polymarket API Client for market data and trading (Exclusive py-clob-client mode)
    """

    def __init__(self, config: Dict):
        self.base_url = config.get("base_url", "https://clob.polymarket.com")
        self.timeout = config.get("timeout", 20)
        self.session = requests.Session()
        
        # 缓存机制
        self._weather_markets_cache = []
        self._last_discovery_time = 0
        self._cache_ttl = 300  # 5 分钟缓存

        # 统一代理设置
        proxy = os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY")
        if proxy:
            self.session.proxies = {"http": proxy, "https": proxy}
            logger.info(f"正在使用代理: {proxy}")

        # 设置公开接口通用的 User-Agent
        self.session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json",
            }
        )

        # 初始化官方 CLOB 客户端
        self.api_key = config.get("api_key")
        self.api_secret = config.get("api_secret")
        self.api_passphrase = config.get("api_passphrase")
        
        try:
            
            # 组装凭据对象 (如果提供)
            creds = None
            if self.api_key and self.api_secret:
                creds = ApiCreds(
                    api_key=self.api_key,
                    api_secret=self.api_secret,
                    api_passphrase=self.api_passphrase
                )

            self.clob_client = ClobClient(
                host=self.base_url,
                key=None, # 除非有 0x 开头的私钥，否则传入 None 以避免报错
                creds=creds,
                chain_id=POLYGON
            )
            # 注入代理到官方客户端 (官方库使用 httpx 或 requests)
            if proxy:
                # 尝试给官方 client 的内部 session 设置代理 (取决于版本实现)
                try:
                    if hasattr(self.clob_client, 'session'):
                        self.clob_client.session.proxies = {"http": proxy, "https": proxy}
                except: pass
            
            logger.info("✅ 官方 py-clob-client 已满血上线，Requests 模式已彻底退役。")
        except Exception as e:
            logger.error(f"官方客户端启动失败: {e}")
            raise RuntimeError("必须安装并配置正确的 py-clob-client 才能运行。")

        self._setup_headers()
        logger.info(f"Polymarket 客户端初始化完成。Base URL: {self.base_url}")

    def _setup_headers(self):
        """Setup default headers for API requests"""
        self.session.headers.update(
            {"Content-Type": "application/json", "Accept": "application/json"}
        )
        if self.api_key:
            self.session.headers.update({"POLY_API_KEY": self.api_key})

    def get_markets(self, next_cursor: str = None) -> Optional[Dict]:
        """
        获取全量市场列表 (官方接口)
        """
        try:
            return self.clob_client.get_markets(next_cursor=next_cursor)
        except: return None

    def get_market(self, market_id: str) -> Optional[Dict]:
        """
        获取特定市场详情 (官方接口)
        """
        try:
            return self.clob_client.get_market(market_id=market_id)
        except: return None

    def get_price(self, token_id: str, side: str = "ask") -> Optional[float]:
        """
        获取 Token 的实时盘口价格
        优先使用官方库，失败时使用直接 REST API
        """
        # 方法1: 尝试官方库
        try:
            sdk_side = "BUY" if side == "ask" else "SELL"
            price_str = self.clob_client.get_price(token_id=token_id, side=sdk_side)
            if price_str:
                return float(price_str)
        except Exception as e:
            logger.debug(f"官方库 get_price 失败 ({token_id}): {e}")
        
        # 方法2: 直接调用 REST API (与 test_price.py 一致)
        try:
            resp = self.session.get(f"{self.base_url}/price", params={
                "token_id": token_id,
                "side": side.upper()
            }, timeout=10)
            data = resp.json()
            return float(data.get("price", 0))
        except Exception as e:
            logger.debug(f"REST API get_price 失败 ({token_id}): {e}")
        return None

    def get_orderbook(self, token_id: str) -> Optional[Dict]:
        """
        获取订单簿深度
        优先使用官方库，失败时使用直接 REST API
        """
        # 方法1: 尝试官方库
        try:
            return self.clob_client.get_orderbook(token_id=token_id)
        except Exception as e:
            logger.debug(f"官方库 get_orderbook 失败 ({token_id}): {e}")
        
        # 方法2: 直接调用 REST API (与 test_price.py 一致)
        try:
            resp = self.session.get(f"{self.base_url}/book", params={
                "token_id": token_id
            }, timeout=10)
            return resp.json()
        except Exception as e:
            logger.debug(f"REST API get_orderbook 失败 ({token_id}): {e}")
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
        批量获取多个 token 的价格
        优先使用官方库，失败时使用直接 REST API
        """
        if not token_requests:
            return {}

        all_prices = {}
        batch_size = 20
        
        def robust_float(val):
            if isinstance(val, (int, float)): return float(val)
            if isinstance(val, str):
                try: return float(val)
                except: return 0.0
            return 0.0

        chunks = [token_requests[i : i + batch_size] for i in range(0, len(token_requests), batch_size)]
        
        def fetch_chunk_sdk(chunk):
            """使用官方 SDK 批量获取"""
            try:
                batch_req = []
                for r in chunk:
                    sdk_side = "BUY" if r.get("side") == "ask" else "SELL"
                    batch_req.append(BookParams(token_id=r["token_id"], side=sdk_side))
                
                results = self.clob_client.get_prices(batch_req)
                
                chunk_prices = {}
                if isinstance(results, list):
                    for item in results:
                        tid = item.get("token_id")
                        price_raw = item.get("price")
                        res_side = item.get("side")
                        if tid and price_raw:
                            val = robust_float(price_raw)
                            key_side = "ask" if res_side == "BUY" else "bid"
                            chunk_prices[f"{tid}:{key_side}"] = val
                return chunk_prices
            except Exception as e:
                logger.debug(f"SDK batch fetch failed: {e}")
                return None
        
        def fetch_chunk_rest(chunk):
            """使用 REST API 逐个获取 (备用方案)"""
            chunk_prices = {}
            for r in chunk:
                try:
                    resp = self.session.get(f"{self.base_url}/price", params={
                        "token_id": r["token_id"],
                        "side": r.get("side", "ask").upper()
                    }, timeout=10)
                    data = resp.json()
                    price = robust_float(data.get("price", 0))
                    if price > 0:
                        chunk_prices[f"{r['token_id']}:{r.get('side', 'ask')}"] = price
                except Exception as e:
                    logger.debug(f"REST API price fetch failed for {r['token_id'][:16]}...: {e}")
            return chunk_prices

        # 使用线程池并发抓取
        with ThreadPoolExecutor(max_workers=3) as executor:
            future_results = list(executor.map(fetch_chunk_sdk, chunks))
        
        # 检查结果，如果 SDK 全部失败，使用 REST API 备用
        sdk_success = False
        for chunk_result in future_results:
            if chunk_result:
                all_prices.update(chunk_result)
                sdk_success = True
        
        # 如果 SDK 完全失败，使用 REST API
        if not sdk_success and token_requests:
            logger.info("SDK 批量获取失败，使用 REST API 逐个获取...")
            with ThreadPoolExecutor(max_workers=5) as executor:
                future_results = list(executor.map(fetch_chunk_rest, chunks))
            for chunk_result in future_results:
                all_prices.update(chunk_result)
        
        return all_prices


    def get_midpoint(self, token_id: str) -> Optional[float]:
        """
        获取中点价格 (官方接口)
        """
        try:
            res = self.clob_client.get_midpoint(token_id)
            if res and "mid" in res:
                return float(res["mid"])
        except: pass
        return None

    def search_markets(self, query: str) -> Optional[Dict]:
        """
        搜索市场
        """
        try:
            # Note: The py-clob-client's get_markets method does not directly support a 'query' parameter for searching.
            # It primarily supports pagination (next_cursor).
            # This implementation will fetch the first page of markets and return them.
            # A more robust search would involve fetching all markets and filtering locally,
            # or using a different API endpoint if available.
            return self.clob_client.get_markets(next_cursor=None) 
        except Exception as e:
            logger.error(f"搜索市场失败: {e}")
            return None

    # --- 交易指令 (强依赖官方库) ---
    def create_order(
        self,
        token_id: str,
        side: str,
        price: float,
        size: float,
        order_type: str = "GTC",
    ) -> Optional[Dict]:
        """
        创建新订单
        """
        try:
            # 转换方向
            side_val = "BUY" if side.upper() == "BUY" else "SELL"
            # 使用官方签名下单 (SDK 会自动处理签名)
            return self.clob_client.create_order(
                token_id=token_id,
                price=price,
                size=size,
                side=side_val
            )
        except Exception as e:
            logger.error(f"下单失败: {e}")
            return None

    def cancel_order(self, order_id: str) -> Optional[Dict]:
        """
        取消订单
        """
        try:
            return self.clob_client.cancel_order(order_id)
        except Exception as e:
            logger.error(f"取消订单失败: {e}")
            return None

    def get_orders(self, market_id: str = None) -> Optional[Dict]:
        """
        获取当前活跃挂单
        """
        try:
            params = OpenOrderParams(market=market_id) if market_id else None
            return self.clob_client.get_orders(params=params)
        except Exception as e:
            logger.error(f"获取挂单失败: {e}")
            return None

    def discover_weather_markets(self) -> list:
        """
        通过全量扫描活跃事件发现最高温天气市场 (支持缓存机制)
        """
        # 缓存检查
        current_time = time.time()
        if self._weather_markets_cache and (current_time - self._last_discovery_time < self._cache_ttl):
            logger.debug(f"使用缓存的市场列表 (剩余寿命: {int(self._cache_ttl - (current_time - self._last_discovery_time))}s)")
            return self._weather_markets_cache

        logger.info("📡 正在全量扫描 Polymarket 发现天气市场...")
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

                    # 强化过滤：必须在标题中包含明确的气温气象词，且排除非气温市场
                    t_lower = title.lower()
                    q_lower = question.lower()
                    
                    # 1. 标题必须像个气温市场
                    if not any(k in t_lower for k in ["highest temperature", "high temperature", "will temperature", "daily temperature"]):
                        continue
                    
                    # 2. 排除干扰项
                    if "climate" in t_lower or "rain" in t_lower or "snow" in t_lower:
                        continue
                        
                    # 3. 确保这个具体的 market (bracket) 是我们想要的
                    if not any(k in q_lower for k in ["temperature", "be", "highest", "range"]):
                        # 补充：如果是多选一市场的子项，question 可能只是一个数字或范围，此时看 title
                        if not any(k in t_lower for k in ["temperature", "highest"]):
                             continue

                    c_id = m.get("conditionId")
                    # 识别 outcome_index
                    t_ids = m.get("clobTokenIds", [])
                    active_id = m.get("activeTokenId")
                    idx = 0
                    if isinstance(t_ids, list) and active_id in t_ids:
                        idx = t_ids.index(active_id)

                    # 对于多选一市场，不同档位共享 conditionId，但 tokenId 不同
                    unique_key = f"{c_id}_{active_id}"
                    if c_id and unique_key not in seen_condition_ids:
                        all_weather_markets.append(
                            {
                                "condition_id": c_id,
                                "question": question,
                                "active_token_id": active_id,
                                "outcome_index": idx,
                                "tokens": t_ids,
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
            # 1. 扫描活跃且未合并的 (全量)
            for offset in range(0, 20000, 1000):
                params = {
                    "active": "true",
                    "closed": "false",
                    "limit": 1000,
                    "offset": offset,
                }
                
                # 增加重试机制
                success = False
                for retry in range(3):
                    try:
                        response = self.session.get(
                            gamma_url, params=params, timeout=self.timeout
                        )
                        if response.status_code == 200:
                            events = response.json()
                            if not events:
                                break
                            process_events(events, f"Open-O{offset}")
                            success = True
                            break
                        else:
                            logger.warning(f"Gamma API 状态码异常 ({response.status_code})，第 {retry+1} 次重试...")
                    except Exception as e:
                        logger.warning(f"发现市场请求出错: {e}，第 {retry+1} 次重试...")
                    time.sleep(2)
                
                if not success:
                    break

            # 2. 扫描活跃但已关闭的
            for offset in range(0, 20000, 1000):
                params = {
                    "active": "true",
                    "closed": "true",
                    "limit": 1000,
                    "offset": offset,
                }
                
                success = False
                for retry in range(3):
                    try:
                        response = self.session.get(
                            gamma_url, params=params, timeout=self.timeout
                        )
                        if response.status_code == 200:
                            events = response.json()
                            if not events:
                                break
                            process_events(events, f"Closed-O{offset}")
                            success = True
                            break
                    except Exception as e:
                        logger.warning(f"发现关闭市场请求出错: {e}，第 {retry+1} 次重试...")
                    time.sleep(2)

                if not success:
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
            
            # 更新缓存
            self._weather_markets_cache = all_weather_markets
            self._last_discovery_time = current_time
            
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
