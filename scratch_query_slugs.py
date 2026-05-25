import httpx

gamma_url = "https://gamma-api.polymarket.com"

cities = ["hong-kong", "beijing", "tokyo", "seoul", "shanghai"]
date_str = "may-25-2026"

for city in cities:
    slug = f"highest-temperature-in-{city}-on-{date_str}"
    try:
        resp = httpx.get(f"{gamma_url}/events", params={"slug": slug}, timeout=10.0)
        data = resp.json()
        print(f"Slug: {slug} -> Status: {resp.status_code}")
        if data and isinstance(data, list):
            print(f"  Found Event: {data[0].get('title')} | ID: {data[0].get('id')}")
            markets = data[0].get("markets", [])
            print(f"  Markets: {len(markets)}")
            for m in markets:
                print(f"    - Market: {m.get('question')} | Group: {m.get('group_id')}")
        else:
            print("  No event found.")
    except Exception as e:
        print(f"  Error for {slug}: {e}")
