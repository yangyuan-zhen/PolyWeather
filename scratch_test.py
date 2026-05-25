import sys
import time
import httpx
from loguru import logger

logger.remove()
logger.add(sys.stdout, format="[{time:HH:mm:ss}] <level>{message}</level>")

print("1. Testing direct httpx request to Gamma API...")
t0 = time.time()
try:
    resp = httpx.get("https://gamma-api.polymarket.com/markets", params={"active": "true", "closed": "false", "limit": 200}, timeout=10.0)
    print(f"Gamma response status: {resp.status_code}")
    print(f"Gamma response took: {time.time() - t0:.2f}s")
    markets = resp.json()
    print(f"Markets count: {len(markets)}")
except Exception as e:
    print(f"Failed to fetch from Gamma API: {e}")

print("\n2. Testing loading PolymarketReadOnlyLayer...")
try:
    from src.data_collection.polymarket_readonly import PolymarketReadOnlyLayer
    layer = PolymarketReadOnlyLayer()
    print(f"Polymarket layer enabled: {layer.enabled}")
    
    t0 = time.time()
    print("Loading active markets via layer...")
    m = layer._load_markets(active_only=True)
    print(f"Layer active markets count: {len(m)} (took {time.time() - t0:.2f}s)")
    
    t0 = time.time()
    print("Loading broad markets via layer...")
    m_broad = layer._load_markets(active_only=False)
    print(f"Layer broad markets count: {len(m_broad)} (took {time.time() - t0:.2f}s)")
except Exception as e:
    print(f"Layer test failed: {e}")

print("\n3. Testing scan terminal payload for East Asia cities...")
try:
    from web.scan_terminal_service import _build_scan_terminal_payload_uncached
    filters = {
        "scan_mode": "tradable",
        "min_price": 0.05,
        "max_price": 0.95,
        "min_edge_pct": 2.0,
        "min_liquidity": 1000.0,
        "high_liquidity_only": False,
        "market_type": "maxtemp",
        "time_range": "today",
        "limit": 28,
        "trading_region": "east_asia"
    }
    t0 = time.time()
    res = _build_scan_terminal_payload_uncached(filters, force_refresh=True)
    print(f"Build scan terminal payload for east_asia took {time.time() - t0:.2f}s")
    print(f"Result Status: {res.get('status')}")
    print(f"Result Rows count: {len(res.get('rows', []))}")
    for row in res.get('rows', []):
        print(f"- City: {row.get('city')}, Question: {row.get('market_question')}, Midpoint: {row.get('midpoint')}, IsPrimary: {row.get('is_primary_signal')}")
except Exception as e:
    import traceback
    traceback.print_exc()
