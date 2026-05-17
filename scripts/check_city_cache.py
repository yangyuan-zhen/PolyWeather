"""Check which cities have hourly / multi-model data in the analysis cache."""
import json
import urllib.request

TOK = "Bearer ZLuvwSsQvHSj2geIWfX7gjn9rJU_heOlgq0FBp7cUOgXaB2eHbE20R4PKwonP2FP"
CITIES = [
    "london", "paris", "amsterdam", "helsinki", "istanbul", "ankara",
    "moscow", "new york", "los angeles", "chicago", "miami", "houston",
    "lagos", "jeddah", "karachi", "tel aviv",
]

for city in CITIES:
    url = f"http://localhost:8000/api/city/{city}/detail?force_refresh=false"
    req = urllib.request.Request(url, headers={"Authorization": TOK})
    try:
        r = urllib.request.urlopen(req, timeout=30)
        d = json.loads(r.read())
    except Exception as e:
        print(f"{city}: FAILED {e}")
        continue
    h = d.get("timeseries", {}).get("hourly", {})
    m = d.get("models", {})
    deb = d.get("deb", {})
    print(f"{city}: hourly={len(h.get('times',[]))}p models={len(m)} deb={deb.get('prediction')}")
