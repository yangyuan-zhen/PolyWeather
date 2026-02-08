import requests

def save_nyc_mb():
    url = "https://www.meteoblue.com/en/weather/week/40.713N74.006W"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    proxies = {"http": "http://127.0.0.1:7890", "https": "http://127.0.0.1:7890"}
    try:
        resp = requests.get(url, headers=headers, proxies=proxies, timeout=10)
        with open("nyc_mb.html", "w", encoding="utf-8") as f:
            f.write(resp.text)
        print("Saved nyc_mb.html")
    except Exception as e:
        print(f"Error: {e}")

save_nyc_mb()
