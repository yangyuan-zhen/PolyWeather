import requests
import re
from datetime import datetime

def test_mb_nyc():
    lat = 40.7128
    lon = -74.0060
    timezone_name = "America/New_York"
    
    lat_dir = "N" if lat >= 0 else "S"
    lon_dir = "E" if lon >= 0 else "W"
    tz_slug = timezone_name.replace("/", "%2F")
    
    # Try both ways
    url1 = f"https://www.meteoblue.com/en/weather/week/{lat}N{lon}E8_{tz_slug}"
    url2 = f"https://www.meteoblue.com/en/weather/week/{abs(lat)}{lat_dir}{abs(lon)}{lon_dir}8_{tz_slug}"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
    }
    proxies = {"http": "http://127.0.0.1:7890", "https": "http://127.0.0.1:7890"}
    
    for url in [url1, url2]:
        print(f"\nTesting URL: {url}")
        try:
            resp = requests.get(url, headers=headers, proxies=proxies, timeout=10)
            print(f"Status: {resp.status_code}")
            content = resp.text
            match = re.search(r'Today.*?tab-temp-max.*?(\d+)&nbsp;°C', content, re.DOTALL | re.IGNORECASE)
            if match:
                print(f"Captured High: {match.group(1)}°C")
            else:
                all_highs = re.findall(r'tab-temp-max.*?(\d+)&nbsp;°C', content, re.DOTALL)
                print(f"All Highs Found: {all_highs}")
        except Exception as e:
            print(f"Error: {e}")

test_mb_nyc()
