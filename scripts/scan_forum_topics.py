"""扫描群组内所有 Forum Topic，打印名称和 thread_id。"""
from __future__ import annotations

import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests


def _load_env() -> None:
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
            os.environ[key] = value.strip().strip('"').strip("'")


_load_env()
TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
CHAT_ID = -1003965137823


def _try_get_topic(tid: int) -> dict | None:
    try:
        r = requests.get(
            f"https://api.telegram.org/bot{TOKEN}/getForumTopic",
            params={"chat_id": CHAT_ID, "message_thread_id": tid},
            timeout=10,
        )
        data = r.json()
        if data.get("ok"):
            name = (data.get("result") or {}).get("name", "")
            return {"thread_id": tid, "name": name}
    except Exception:
        pass
    return None


def main() -> int:
    if not TOKEN:
        print("未设置 TELEGRAM_BOT_TOKEN", file=sys.stderr)
        return 1

    print(f"扫描群组话题...")
    topics = []
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(_try_get_topic, tid): tid for tid in range(1, 101)}
        for future in as_completed(futures):
            result = future.result()
            if result:
                topics.append(result)
                print(f"  thread_id={result['thread_id']}  {result['name']}")

    topics.sort(key=lambda t: t["thread_id"])
    print(f"\n共 {len(topics)} 个话题:")
    for t in topics:
        print(f"  {t['thread_id']:>4}  {t['name']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
