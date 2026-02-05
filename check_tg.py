import requests
import os
from dotenv import load_dotenv

load_dotenv()

def get_updates():
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    proxy = os.getenv("HTTPS_PROXY")
    proxies = {"http": proxy, "https": proxy} if proxy else None
    
    url = f"https://api.telegram.org/bot{token}/getUpdates"
    try:
        resp = requests.get(url, proxies=proxies)
        data = resp.json()
        print(f"Updates: {data}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    get_updates()
