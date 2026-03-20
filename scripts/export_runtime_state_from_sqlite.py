
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


def main():
    parser = argparse.ArgumentParser(description='Export runtime state from SQLite back to legacy JSON files.')
    parser.add_argument('--daily-records', default=os.path.join(PROJECT_ROOT, 'data', 'daily_records.json'))
    parser.add_argument('--telegram-state', default=os.path.join(PROJECT_ROOT, 'data', 'telegram_alert_state.json'))
    parser.add_argument('--snapshots', default=os.path.join(PROJECT_ROOT, 'data', 'probability_training_snapshots.jsonl'))
    parser.add_argument('--open-meteo-cache', default=os.path.join(PROJECT_ROOT, 'data', 'open_meteo_cache.json'))
    parser.add_argument('--open-meteo-max-age', type=int, default=int(os.getenv('OPEN_METEO_DISK_CACHE_MAX_AGE_SEC', '86400')))
    args = parser.parse_args()

    daily = DailyRecordRepository().load_all()
    telegram = TelegramAlertStateRepository().load_state()
    snapshots = ProbabilitySnapshotRepository().load_all_rows()
    open_meteo = OpenMeteoCacheRepository().load_payload(args.open_meteo_max_age)

    os.makedirs(os.path.dirname(os.path.abspath(args.daily_records)), exist_ok=True)
    with open(args.daily_records, 'w', encoding='utf-8') as fh:
        json.dump(daily, fh, ensure_ascii=False, indent=2)
    with open(args.telegram_state, 'w', encoding='utf-8') as fh:
        json.dump(telegram, fh, ensure_ascii=False, indent=2)
    with open(args.snapshots, 'w', encoding='utf-8') as fh:
        for row in snapshots:
            fh.write(json.dumps(row, ensure_ascii=False) + '\n')
    with open(args.open_meteo_cache, 'w', encoding='utf-8') as fh:
        json.dump(open_meteo, fh, ensure_ascii=False)

    print(json.dumps({
        'daily_records_exported': sum(len(v) for v in daily.values()),
        'telegram_state_exported': len((telegram.get('last_by_city') or {})) + len((telegram.get('by_signature') or {})),
        'snapshots_exported': len(snapshots),
        'open_meteo_cache_exported': sum(len((open_meteo.get(k) or {})) for k in ('forecast', 'ensemble', 'multi_model')),
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
