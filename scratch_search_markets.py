import httpx

gamma_url = "https://gamma-api.polymarket.com"
all_markets = []
offset = 0
limit = 100

while True:
    params = {
        "archived": "false",
        "limit": limit,
        "offset": offset,
        "active": "true",
        "closed": "false"
    }
    try:
        resp = httpx.get(f"{gamma_url}/markets", params=params, timeout=10.0)
        batch = resp.json()
    except Exception as e:
        print("Fetch error:", e)
        break
    if not isinstance(batch, list) and isinstance(batch, dict):
        batch = batch.get("markets", [])
    if not batch:
        break
    all_markets.extend(batch)
    if len(batch) < limit:
        break
    offset += len(batch)

print(f"Total active markets: {len(all_markets)}")

cities = ["beijing", "tokyo", "seoul", "shanghai", "singapore", "manila", "jakarta", "taipei", "hong kong", "busan", "shenzhen"]

for city in cities:
    matched = []
    for m in all_markets:
        q = m.get("question", "").lower()
        if city in q:
            matched.append(m)
    print(f"City '{city}': matched {len(matched)} active markets")
    for m in matched:
        print(f"  - {m.get('question')} (slug: {m.get('slug')})")
