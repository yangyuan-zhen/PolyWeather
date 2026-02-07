import os
import requests
import time
import re
from typing import Dict, List, Optional
from loguru import logger
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

class PolymarketClient:
    """
    Polymarket API Client (Pure REST API version)
    Directly uses Gamma API and CLOB REST API without py-clob-client dependency.
    """

    def __init__(self, config: Dict):
        self.clob_url = config.get("base_url", "https://clob.polymarket.com")
        self.gamma_url = "https://gamma-api.polymarket.com"
        self.timeout = config.get("timeout", 20)
        self.session = requests.Session()
        
        # Cache mechanism
        self._weather_markets_cache = []
        self._last_discovery_time = 0
        self._cache_ttl = 300  # 5 minutes cache

        # Proxy settings (automatically read from environment)
        proxy = os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY")
        if proxy:
            self.session.proxies = {"http": proxy, "https": proxy}
            logger.info(f"Requests session using proxy: {proxy}")

        # Set common User-Agent and headers
        self.session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json",
                "Content-Type": "application/json"
            }
        )

        self.api_key = config.get("api_key")
        if self.api_key:
            self.session.headers.update({"POLY_API_KEY": self.api_key})

        logger.info(f"Polymarket REST Client initialized. CLOB: {self.clob_url}, Gamma: {self.gamma_url}")

    def get_markets(self, next_cursor: str = None) -> Optional[Dict]:
        """Fetch markets list via CLOB REST API"""
        try:
            params = {}
            if next_cursor:
                params["next_cursor"] = next_cursor
            resp = self.session.get(f"{self.clob_url}/markets", params=params, timeout=self.timeout)
            return resp.json() if resp.status_code == 200 else None
        except Exception as e:
            logger.debug(f"get_markets failed: {e}")
            return None

    def get_market(self, market_id: str) -> Optional[Dict]:
        """Fetch market details via CLOB REST API"""
        try:
            resp = self.session.get(f"{self.clob_url}/markets/{market_id}", timeout=self.timeout)
            return resp.json() if resp.status_code == 200 else None
        except Exception as e:
            logger.debug(f"get_market failed: {e}")
            return None

    def get_price(self, token_id: str, side: str = "ask") -> Optional[float]:
        """Fetch real-time price for a token via CLOB REST API"""
        try:
            # Correct CLOB Mapping:
            # 'sell' side price is the ASK (price you pay to BUY)
            # 'buy' side price is the BID (price you get to SELL)
            clob_side = "sell" if side.lower() in ["ask", "buy"] else "buy"
            resp = self.session.get(
                f"{self.clob_url}/price",
                params={"token_id": token_id, "side": clob_side},
                timeout=10
            )
            data = resp.json()
            return float(data.get("price", 0)) if resp.status_code == 200 else None
        except Exception as e:
            logger.debug(f"get_price failed ({token_id}): {e}")
        return None

    def get_orderbook(self, token_id: str) -> Optional[Dict]:
        """Fetch orderbook for a token via CLOB REST API"""
        try:
            resp = self.session.get(
                f"{self.clob_url}/book", params={"token_id": token_id}, timeout=10
            )
            return resp.json() if resp.status_code == 200 else None
        except Exception as e:
            logger.debug(f"get_orderbook failed ({token_id}): {e}")
        return None

    def get_buy_prices(self, yes_token_id: str, no_token_id: str) -> Optional[Dict]:
        """Fetch buy prices for both YES and NO tokens"""
        try:
            # Buy Yes = Ask price of YES token
            buy_yes = self.get_price(yes_token_id, "BUY")
            # Buy No = Ask price of NO token
            buy_no = self.get_price(no_token_id, "BUY")

            if buy_yes is not None and buy_no is not None:
                return {"buy_yes": buy_yes, "buy_no": buy_no}
        except Exception as e:
            logger.debug(f"get_buy_prices failed: {e}")
        return None

    def get_multiple_prices(self, token_requests: List[Dict]) -> Dict[str, float]:
        """Batch fetch prices for multiple tokens using ThreadPoolExecutor"""
        if not token_requests:
            return {}

        all_prices = {}
        
        def robust_float(val):
            try: return float(val)
            except: return 0.0

        def fetch_single(req):
            tid = req["token_id"]
            side = req.get("side", "ask").lower()
            # To get ASK (price to buy), request 'sell' side
            # To get BID (price to sell), request 'buy' side
            api_side = "sell" if side == "ask" else "buy"
            val = self.get_price(tid, api_side)
            if val:
                return f"{tid}:{side.lower()}", val
            return None

        with ThreadPoolExecutor(max_workers=5) as executor:
            results = list(executor.map(fetch_single, token_requests))
            
        for res in results:
            if res:
                key, val = res
                all_prices[key] = val
                
        return all_prices

    def get_midpoint(self, token_id: str) -> Optional[float]:
        """Fetch midpoint price via CLOB REST API"""
        try:
            resp = self.session.get(f"{self.clob_url}/midpoint", params={"token_id": token_id}, timeout=10)
            data = resp.json()
            return float(data.get("mid", 0)) if resp.status_code == 200 else None
        except:
            return None

    def discover_weather_markets(self) -> list:
        """Scan Gamma API for all weather-related markets with prioritized search and city targeting"""
        # Cache check
        current_time = time.time()
        if self._weather_markets_cache and (current_time - self._last_discovery_time < self._cache_ttl):
            logger.debug(f"Using cached market list ({len(self._weather_markets_cache)} items)")
            return self._weather_markets_cache

        logger.info("📡 Scanning Polymarket via Gamma API for weather markets...")
        all_weather_markets = []
        seen_keys = set()
        
        # 1. Target newest markets by query and ID sorting
        search_queries = ["highest temperature", "temperature in", "daily weather"]
        
        try:
            # Use multiple offsets to find more historical/diverse markets
            for offset in [0, 500, 1000]:
                for query in search_queries:
                    logger.debug(f"Searching with query: {query} (offset {offset})")
                    params = {
                        "query": query,
                        "active": "true",
                        "limit": 500,
                        "offset": offset,
                        "order": "id",
                        "ascending": "false"
                    }
                resp = self.session.get(f"{self.gamma_url}/markets", params=params, timeout=self.timeout)
                if resp.status_code == 200:
                    markets = resp.json()
                    logger.debug(f"Query '{query}' returned {len(markets)} markets")
                    for m in markets:
                        q = m.get("question", "").lower()
                        slug = m.get("slug", "").lower()
                        
                        # Filter for weather markets (Broadened)
                        is_weather = any(k in q or k in slug for k in [
                            "highest temperature", "highest-temperature", 
                            "temperature in", "temperature-in",
                            "daily weather", "daily-weather",
                            "weather", "气温", "温度"
                        ])
                        if is_weather:
                            c_id = m.get("conditionId")
                            t_ids = m.get("clobTokenIds")
                            active_id = m.get("activeTokenId")
                            
                            # Robust JSON parsing for clobTokenIds string
                            if isinstance(t_ids, str) and t_ids.startswith("["):
                                try:
                                    import json
                                    t_ids = json.loads(t_ids)
                                except:
                                    pass
                            
                            # For Neg Risk markets, activeTokenId might be missing in list view
                            # If we have clobTokenIds, we can work with it
                            if not t_ids:
                                continue
                                
                            if not active_id and isinstance(t_ids, list) and len(t_ids) > 0:
                                active_id = t_ids[0] # Assume first is YES

                            if not active_id:
                                continue
                                    
                            unique_key = f"{c_id}_{active_id}"
                            if unique_key not in seen_keys:
                                logger.debug(f"Found weather segment: {q}")
                                all_weather_markets.append({
                                    "condition_id": c_id,
                                    "question": m.get("question"),
                                    "active_token_id": active_id,
                                    "outcome_index": t_ids.index(active_id) if isinstance(t_ids, list) and active_id in t_ids else 0,
                                    "tokens": t_ids,
                                    "prices": m.get("outcomePrices"),
                                    "event_title": m.get("description", "")[:100],
                                    "slug": m.get("slug"),
                                    "group_id": m.get("negRiskMarketID")
                                })
                                seen_keys.add(unique_key)
                else:
                    logger.debug(f"Query '{query}' failed with status {resp.status_code}")
                
                if len(all_weather_markets) > 50:
                    break

            logger.info(f"Discovery complete: Found {len(all_weather_markets)} weather segments.")
            self._weather_markets_cache = all_weather_markets
            self._last_discovery_time = current_time
            return all_weather_markets

        except Exception as e:
            logger.error(f"Market discovery failed: {e}")
            return []

        except Exception as e:
            logger.error(f"Market discovery failed: {e}")
            return []

        except Exception as e:
            logger.error(f"Market discovery failed: {e}")
            return []

    def get_weather_markets(self) -> list:
        return self.discover_weather_markets()

    def find_weather_market(self, city: str, date_str: str = None) -> Optional[Dict]:
        markets = self.get_weather_markets()
        for m in markets:
            # Match against question, title AND slug
            content = (str(m.get("question", "")) + str(m.get("event_title", "")) + str(m.get("slug", ""))).lower()
            if city.lower() in content:
                if date_str:
                    if date_str.lower() in content: return m
                else:
                    return m
        return None

    def get_weather_event_markets(self, city: str) -> list:
        all_markets = self.get_weather_markets()
        return [
            m for m in all_markets
            if city.lower() in (str(m.get("question", "")) + str(m.get("event_title", "")) + str(m.get("slug", ""))).lower()
        ]

    # --- Trading Stubs (Real trading requires signing, which is disabled in pure REST mode) ---
    def create_order(self, *args, **kwargs) -> Optional[Dict]:
        logger.warning("create_order: Real trading is disabled in pure REST mode. Please use paper trading.")
        return None

    def cancel_order(self, *args, **kwargs) -> Optional[Dict]:
        logger.warning("cancel_order: Real trading is disabled in pure REST mode.")
        return None

    def get_orders(self, *args, **kwargs) -> Optional[Dict]:
        logger.warning("get_orders: Real trading is disabled in pure REST mode.")
        return None
