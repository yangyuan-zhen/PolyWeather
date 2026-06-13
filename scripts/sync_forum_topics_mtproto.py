"""Sync Telegram forum topic IDs into city_thread_ids.json via MTProto.

Bot API can send to a forum topic when message_thread_id is known, but it does
not enumerate existing topic names. This script uses Telegram MTProto
channels.getForumTopics through Telethon to discover topic IDs.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Iterable, Mapping

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.utils.telegram_push import HIGH_FREQ_AIRPORT_CITIES, normalize_airport_push_city  # noqa: E402


DEFAULT_CHAT_ID = "-1003927451869"


def _load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key in os.environ:
            continue
        os.environ[key] = value.strip().strip('"').strip("'")


def _topic_candidates(title: str) -> list[str]:
    raw = str(title or "").strip()
    if not raw:
        return []
    candidates = [raw]
    candidates.extend(match.group(1) for match in re.finditer(r"#([A-Za-z][A-Za-z0-9_]+)", raw))
    stripped = re.sub(r"#[A-Za-z][A-Za-z0-9_]+", " ", raw)
    stripped = re.sub(r"[^\w\s/.-]+", " ", stripped, flags=re.UNICODE)
    for part in re.split(r"[/|,;·]+", stripped):
        part = re.sub(r"\s+", " ", part).strip()
        if part:
            candidates.append(part)
    return candidates


def _topic_city(title: str) -> str:
    for candidate in _topic_candidates(title):
        city = normalize_airport_push_city(candidate)
        if city:
            return city
    return ""


def build_city_thread_mapping(topics: Iterable[Mapping[str, Any]]) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for topic in topics:
        title = str(topic.get("title") or topic.get("name") or "").strip()
        city = _topic_city(title)
        if not city:
            continue
        thread_id = int(topic.get("message_thread_id") or topic.get("id") or 0)
        if thread_id > 0:
            mapping[city] = thread_id
    return dict(sorted(mapping.items()))


def _default_output_path() -> Path:
    env_path = str(os.getenv("POLYWEATHER_CITY_THREAD_IDS_PATH") or "").strip()
    if env_path:
        return Path(env_path)
    runtime_dir = str(os.getenv("POLYWEATHER_RUNTIME_DATA_DIR") or "").strip()
    if runtime_dir:
        return Path(runtime_dir) / "city_thread_ids.json"
    return Path("data") / "city_thread_ids.json"


def _merge_and_write(path: Path, discovered: Mapping[str, int]) -> dict[str, int]:
    existing: dict[str, int] = {}
    if path.is_file() and path.stat().st_size > 0:
        loaded = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            existing = {str(k): int(v) for k, v in loaded.items()}
    merged = dict(existing)
    merged.update({str(k): int(v) for k, v in discovered.items()})
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(
        json.dumps(dict(sorted(merged.items())), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    tmp_path.replace(path)
    return merged


async def _fetch_forum_topics(*, api_id: int, api_hash: str, bot_token: str, chat_id: str) -> list[dict[str, Any]]:
    try:
        from telethon import TelegramClient
        from telethon.tl.functions.channels import GetForumTopicsRequest
    except ImportError as exc:  # pragma: no cover - depends on optional runtime package
        raise SystemExit("Missing dependency: pip install telethon") from exc

    session_name = str(os.getenv("TELEGRAM_FORUM_SYNC_SESSION") or "polyweather_forum_sync")
    async with TelegramClient(session_name, api_id, api_hash).start(bot_token=bot_token) as client:
        entity = await client.get_entity(int(chat_id))
        result = await client(
            GetForumTopicsRequest(
                channel=entity,
                offset_date=0,
                offset_id=0,
                offset_topic=0,
                limit=100,
                q="",
            )
        )
        topics = []
        for topic in getattr(result, "topics", []) or []:
            topics.append(
                {
                    "id": int(getattr(topic, "id", 0) or 0),
                    "title": str(getattr(topic, "title", "") or ""),
                }
            )
        return topics


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--chat-id", default=os.getenv("TELEGRAM_FORUM_CHAT_ID") or os.getenv("POLYWEATHER_TELEGRAM_GROUP_ID") or DEFAULT_CHAT_ID)
    parser.add_argument("--output", default=str(_default_output_path()))
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    _load_env_file(Path(".env"))
    args = _parse_args()
    api_id = int(str(os.getenv("TELEGRAM_API_ID") or "0").strip() or "0")
    api_hash = str(os.getenv("TELEGRAM_API_HASH") or "").strip()
    bot_token = str(os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
    if not api_id or not api_hash or not bot_token:
        raise SystemExit("Missing TELEGRAM_API_ID, TELEGRAM_API_HASH, or TELEGRAM_BOT_TOKEN")

    topics = asyncio.run(
        _fetch_forum_topics(
            api_id=api_id,
            api_hash=api_hash,
            bot_token=bot_token,
            chat_id=str(args.chat_id),
        )
    )
    mapping = build_city_thread_mapping(topics)
    missing = sorted(set(HIGH_FREQ_AIRPORT_CITIES) - set(mapping))
    print(f"Fetched topics: {len(topics)}")
    print(f"Matched city topics: {len(mapping)}")
    if missing:
        print(f"Missing city topics: {', '.join(missing)}")
    if args.dry_run:
        print(json.dumps(mapping, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    merged = _merge_and_write(Path(args.output), mapping)
    print(f"Wrote {len(mapping)} discovered / {len(merged)} total mappings to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
