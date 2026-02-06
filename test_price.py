"""
Polymarket 天气市场价格查询
直接获取 YES/NO 的真实买入价格（Ask）
"""
import requests

# ============ 配置 ============
# 替换成你要查的 token_id（从 Gamma API 获取）
YES_TOKEN_ID = "你的YES_token_id"
NO_TOKEN_ID = "你的NO_token_id"

CLOB_BASE = "https://clob.polymarket.com"
GAMMA_BASE = "https://gamma-api.polymarket.com"
# ============ 方法1: 快速查价格 ============
def get_price(token_id, side="buy"):
"""获取单个 token 的买入/卖出价格"""
resp = requests.get(f"{CLOB_BASE}/price", params={
"token_id": token_id,
"side": side.upper()
})
data = resp.json()
return float(data.get("price", 0))

# ============ 方法2: 查完整盘口 ============
def get_orderbook(token_id):
"""获取完整 orderbook，含深度"""
resp = requests.get(f"{CLOB_BASE}/book", params={
"token_id": token_id
})
return resp.json()

# ============ 方法3: 从 Gamma 发现天气市场 ============
def discover_weather_markets(city="New York"):
"""自动发现天气市场，获取 token_id"""
resp = requests.get(f"{GAMMA_BASE}/markets", params={
"tag": "weather",
"closed": "false",
"limit": 50
})
markets = resp.json()
results = []
for m in markets:
if city.lower() in m.get("question", "").lower():
tokens = m.get("tokens", [])
if len(tokens) >= 2:
    yes_token = None
    no_token = None
    for t in tokens:
        if t.get("outcome") == "Yes":
            yes_token = t["token_id"]
        else:
            no_token = t["token_id"]
    if yes_token and no_token:
        results.append({
            "question": m["question"],
            "yes_token": yes_token,
            "no_token": no_token,
            "slug": m.get("market_slug", "")
        })
return results


# ============ 主流程 ============
def main():
print("📡 正在发现 NYC 天气市场...\n")
markets = discover_weather_markets("New York")
if not markets:
print("❌ 未找到天气市场，检查 Gamma API")
return

print(f"✅ 找到 {len(markets)} 个市场\n")
print("=" * 55)

for m in markets[:10]:
q = m["question"]
yes_id = m["yes_token"]
no_id = m["no_token"]

# 获取真实 Ask 价格
yes_ask = get_price(yes_id, "buy")
no_ask = get_price(no_id, "buy")

# 获取 Bid
yes_bid = get_price(yes_id, "sell")

spread = yes_ask - yes_bid if yes_ask and yes_bid else None

# 获取盘口深度
book = get_orderbook(yes_id)
ask_depth = sum(float(o.get("size", 0)) for o in book.get("asks", [])[:3])
bid_depth = sum(float(o.get("size", 0)) for o in book.get("bids", [])[:3])

# 流动性判断
if ask_depth < 50:
liq = "🔴枯竭"
elif ask_depth < 500:
liq = "🟡正常"
else:
liq = "🟢充裕"

print(f"\n📊 {q}")
print(f" YES Ask: {yes_ask*100:.1f}¢ | NO Ask: {no_ask*100:.1f}¢")
print(f" YES Bid: {yes_bid*100:.1f}¢ | Spread: {spread*100:.1f}¢" if spread else " YES Bid: --")
print(f" 深度: Ask ${ask_depth:.0f} | Bid ${bid_depth:.0f} | {liq}")
print(f" 🔗 https://polymarket.com/event/{m['slug']}")

print("\n" + "=" * 55)
print("💡 价格单位: Ask = 你买入要付的价格")

if __name__ == "__main__":
main()