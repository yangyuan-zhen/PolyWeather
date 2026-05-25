import httpx

gamma_url = "https://gamma-api.polymarket.com"
all_markets = []
offset = 0
limit = 100
pages = 10

for page in range(pages):
    params = {
        "archived": "false",
        "limit": limit,
        "offset": offset,
        "active": "true",
        "closed": "false"
    }
    resp = httpx.get(f"{gamma_url}/markets", params=params)
    batch = resp.json()
    if not isinstance(batch, list) and isinstance(batch, dict):
        batch = batch.get("markets", [])
    
    if not batch:
        print(f"Page {page}: No more markets.")
        break
        
    all_markets.extend(batch)
    print(f"Page {page}: Fetched {len(batch)} markets (total: {len(all_markets)})")
    if len(batch) < limit:
        print(f"Page {page}: Batch size {len(batch)} < limit {limit}. Stopping.")
        break
    offset += len(batch)

weather_markets = []
for m in all_markets:
    q = m.get("question", "").lower()
    if "temperature" in q or "weather" in q or "highest temperature" in q:
        weather_markets.append(m)

print(f"\nTotal active markets found: {len(all_markets)}")
print(f"Total weather markets found: {len(weather_markets)}")
for wm in weather_markets[:20]:
    print(f"- Question: {wm.get('question')} | Slug: {wm.get('slug')}")
