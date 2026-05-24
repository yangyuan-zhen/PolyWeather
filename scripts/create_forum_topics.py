"""
一次性为新 Telegram 群组创建所有城市的 Forum Topics。

用法：
    python scripts/create_forum_topics.py

会生成 data/city_thread_ids.json 供后续推送路由使用。
"""

from __future__ import annotations

import json
import os
import sys
import time

import requests


def _load_env() -> None:
    """从项目根目录 .env 加载环境变量（仅设置尚未存在的变量）。"""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env_path = os.path.join(root, ".env")
    if not os.path.isfile(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            if key in os.environ:
                continue
            value = value.strip().strip('"').strip("'")
            os.environ[key] = value


_load_env()
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
CHAT_ID = -1003927451869

CITIES: list[tuple[str, str]] = [
    ("🇨🇳 Beijing", "beijing"),
    ("🇨🇳 Shanghai", "shanghai"),
    ("🇨🇳 Guangzhou", "guangzhou"),
    ("🇨🇳 Qingdao", "qingdao"),
    ("🇨🇳 Chengdu", "chengdu"),
    ("🇨🇳 Chongqing", "chongqing"),
    ("🇨🇳 Wuhan", "wuhan"),
    ("🇭🇰 Hong Kong", "hong kong"),
    ("🇭🇰 Lau Fau Shan", "lau fau shan"),
    ("🇹🇼 Taipei", "taipei"),
    ("🇰🇷 Seoul", "seoul"),
    ("🇰🇷 Busan", "busan"),
    ("🇯🇵 Tokyo", "tokyo"),
    ("🇸🇬 Singapore", "singapore"),
    ("🇹🇷 Istanbul", "istanbul"),
    ("🇹🇷 Ankara", "ankara"),
    ("🇫🇮 Helsinki", "helsinki"),
    ("🇳🇱 Amsterdam", "amsterdam"),
    ("🇫🇷 Paris", "paris"),
    ("🇺🇸 New York", "new york"),
    ("🇺🇸 Los Angeles", "los angeles"),
    ("🇺🇸 Chicago", "chicago"),
    ("🇺🇸 Denver", "denver"),
    ("🇺🇸 Atlanta", "atlanta"),
    ("🇺🇸 Miami", "miami"),
    ("🇺🇸 San Francisco", "san francisco"),
    ("🇺🇸 Houston", "houston"),
    ("🇺🇸 Dallas", "dallas"),
    ("🇺🇸 Austin", "austin"),
    ("🇺🇸 Seattle", "seattle"),
]

URL = f"https://api.telegram.org/bot{BOT_TOKEN}/createForumTopic"


def _load_existing(out_path: str) -> dict:
    if os.path.isfile(out_path):
        try:
            with open(out_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_mapping(out_path: str, mapping: dict) -> None:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)


def main() -> int:
    if not BOT_TOKEN:
        print("未设置 TELEGRAM_BOT_TOKEN 环境变量", file=sys.stderr)
        return 1

    out_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "data", "city_thread_ids.json",
    )

    mapping = _load_existing(out_path)
    if mapping:
        print(f"已加载 {len(mapping)} 个已有话题，将跳过已创建的城市")

    for label, city_key in CITIES:
        if city_key in mapping:
            print(f"SKIP {label} -> 已存在 thread_id={mapping[city_key]}")
            continue

        try:
            r = requests.post(URL, json={"chat_id": CHAT_ID, "name": label}, timeout=15)
            data = r.json()
        except Exception as exc:
            print(f"ERR {label} -> network: {exc}", file=sys.stderr)
            continue

        if not data.get("ok"):
            err_code = data.get("error_code", "")
            err_desc = data.get("description", "")
            retry_after = (data.get("parameters") or {}).get("retry_after", 0)
            print(f"ERR {label} -> {err_code} {err_desc} retry_after={retry_after}s", file=sys.stderr)
            if retry_after:
                wait = int(retry_after) + 2
                print(f"    wait {wait}s ...")
                time.sleep(wait)
                try:
                    r2 = requests.post(URL, json={"chat_id": CHAT_ID, "name": label}, timeout=15)
                    data2 = r2.json()
                    if data2.get("ok"):
                        tid = (data2.get("result") or {}).get("message_thread_id")
                        if tid:
                            mapping[city_key] = int(tid)
                            print(f"OK  {label} -> thread_id={tid} (retry)")
                            _save_mapping(out_path, mapping)
                            continue
                    else:
                        print(f"ERR {label} -> retry failed: {data2.get('description')}", file=sys.stderr)
                except Exception as exc2:
                    print(f"ERR {label} -> retry network: {exc2}", file=sys.stderr)
            continue

        tid = (data.get("result") or {}).get("message_thread_id")
        if not tid:
            print(f"WARN {label} -> no thread_id: {data}", file=sys.stderr)
            continue

        mapping[city_key] = int(tid)
        print(f"OK  {label} -> thread_id={tid}")
        _save_mapping(out_path, mapping)
        time.sleep(1.2)

    _save_mapping(out_path, mapping)
    print(f"\nDone: {len(mapping)}/{len(CITIES)} cities saved to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
