
import argparse
import json
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.database.runtime_state import (  # noqa: E402
    DailyRecordRepository,
    OpenMeteoCacheRepository,
    ProbabilitySnapshotRepository,
    TelegramAlertStateRepository,
)


def _load_json(path, default):
    if not path or not os.path.exists(path):
        return default
    with open(path, 'r', encoding='utf-8') as fh:
        data = json.load(fh)
    return data


def _load_jsonl(path):
    rows = []
    if not path or not os.path.exists(path):
        return rows
    with open(path, 'r', encoding='utf-8') as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except Exception:
                continue
            if isinstance(row, dict):
                rows.append(row)
    return rows


def main():
    parser = argparse.ArgumentParser(description='Migrate runtime JSON state into SQLite.')
    parser.add_argument('--daily-records', default=os.path.join(PROJECT_ROOT, 'data', 'daily_records.json'))
    parser.add_argument('--telegram-state', default=os.path.join(PROJECT_ROOT, 'data', 'telegram_alert_state.json'))
    parser.add_argument('--snapshots', default=os.path.join(PROJECT_ROOT, 'data', 'probability_training_snapshots.jsonl'))
    parser.add_argument('--open-meteo-cache', default=os.path.join(PROJECT_ROOT, 'data', 'open_meteo_cache.json'))
    parser.add_argument('--open-meteo-max-age', type=int, default=int(os.getenv('OPEN_METEO_DISK_CACHE_MAX_AGE_SEC', '86400')))
    args = parser.parse_args()

    daily = _load_json(args.daily_records, {})
    telegram = _load_json(args.telegram_state, {'last_by_city': {}, 'by_signature': {}})
    snapshots = _load_jsonl(args.snapshots)
    open_meteo = _load_json(args.open_meteo_cache, {'forecast': {}, 'ensemble': {}, 'multi_model': {}, 'saved_at': 0})

    daily_count = DailyRecordRepository().replace_all(daily if isinstance(daily, dict) else {})
    telegram_count = TelegramAlertStateRepository().replace_from_state(telegram if isinstance(telegram, dict) else {})
    snapshot_count = ProbabilitySnapshotRepository().replace_all(snapshots)
    cache_count = OpenMeteoCacheRepository().replace_payload(open_meteo if isinstance(open_meteo, dict) else {}, args.open_meteo_max_age)

    print(json.dumps({
        'daily_records_imported': daily_count,
        'telegram_state_imported': telegram_count,
        'snapshots_imported': snapshot_count,
        'open_meteo_cache_imported': cache_count,
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
