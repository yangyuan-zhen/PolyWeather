import requests
import json
import time

def test_mgm(istno):
    # 添加时间戳防止缓存
    url = f"https://servis.mgm.gov.tr/web/sondurumlar?istno={istno}&_={int(time.time()*1000)}"
    headers = {
        "Origin": "https://www.mgm.gov.tr",
        "User-Agent": "Mozilla/5.0"
    }
    try:
        resp = requests.get(url, headers=headers)
        if resp.status_code == 200:
            data = resp.json()
            print(json.dumps(data, indent=2, ensure_ascii=False))
        else:
            print(f"Error: {resp.status_code}")
    except Exception as e:
        print(f"Exception: {e}")

print("--- Station 17128 (Esenboğa) ---")
test_mgm(17128)
