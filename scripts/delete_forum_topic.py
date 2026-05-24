"""删除指定 thread_id 的 Forum Topic。用法: python scripts/delete_forum_topic.py <thread_id>"""
from __future__ import annotations

import os
import sys
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
CHAT_ID = -1003927451869

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python scripts/delete_forum_topic.py <thread_id>")
        print("获取 thread_id: 在 Telegram 长按话题 -> 或转发该话题一条消息到 @RawDataBot")
        sys.exit(1)

    tid = int(sys.argv[1])
    r = requests.post(
        f"https://api.telegram.org/bot{TOKEN}/deleteForumTopic",
        json={"chat_id": CHAT_ID, "message_thread_id": tid},
        timeout=10,
    )
    data = r.json()
    if data.get("ok"):
        print(f"已删除 thread_id={tid}")
    else:
        print(f"失败: {data.get('description')} (code={data.get('error_code')})")
        sys.exit(1)
