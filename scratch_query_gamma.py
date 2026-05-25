import httpx

gamma_url = "https://gamma-api.polymarket.com"

# 1. Search markets
print("Searching markets for 'temperature'...")
try:
    resp = httpx.get(f"{gamma_url}/markets", params={"active": "true", "search": "temperature", "limit": 100}, timeout=10.0)
    data = resp.json()
    print(f"Found {len(data)} markets matching 'temperature':")
    for m in data[:10]:
        print(f"  - {m.get('question')} | Slug: {m.get('slug')}")
except Exception as e:
    print("Error:", e)

# 2. Search events
print("\nSearching events for 'temperature'...")
try:
    resp = httpx.get(f"{gamma_url}/events", params={"active": "true", "search": "temperature", "limit": 100}, timeout=10.0)
    data = resp.json()
    print(f"Found {len(data)} events matching 'temperature':")
    for e in data[:10]:
        print(f"  - {e.get('title')} | Slug: {e.get('slug')}")
except Exception as e:
    print("Error:", e)

# 3. Search events for 'weather'
print("\nSearching events for 'weather'...")
try:
    resp = httpx.get(f"{gamma_url}/events", params={"active": "true", "search": "weather", "limit": 100}, timeout=10.0)
    data = resp.json()
    print(f"Found {len(data)} events matching 'weather':")
    for e in data[:10]:
        print(f"  - {e.get('title')} | Slug: {e.get('slug')}")
except Exception as e:
    print("Error:", e)
