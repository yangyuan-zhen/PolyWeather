
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
        return json.load(fh)


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


def _norm_json(obj):
    return json.loads(json.dumps(obj, ensure_ascii=False, sort_keys=True))


def _norm_open_meteo_payload(payload):
    payload = dict(payload or {})
    payload.pop('saved_at', None)
    return _norm_json(payload)


def main():
    parser = argparse.ArgumentParser(description='Verify SQLite runtime state against legacy JSON files.')
    parser.add_argument('--daily-records', default=os.path.join(PROJECT_ROOT, 'data', 'daily_records.json'))
    parser.add_argument('--telegram-state', default=os.path.join(PROJECT_ROOT, 'data', 'telegram_alert_state.json'))
    parser.add_argument('--snapshots', default=os.path.join(PROJECT_ROOT, 'data', 'probability_training_snapshots.jsonl'))
    parser.add_argument('--open-meteo-cache', default=os.path.join(PROJECT_ROOT, 'data', 'open_meteo_cache.json'))
    parser.add_argument('--open-meteo-max-age', type=int, default=int(os.getenv('OPEN_METEO_DISK_CACHE_MAX_AGE_SEC', '86400')))
    args = parser.parse_args()

    file_daily = _load_json(args.daily_records, {})
    file_telegram = _load_json(args.telegram_state, {'last_by_city': {}, 'by_signature': {}})
    file_snapshots = _load_jsonl(args.snapshots)
    file_cache = _load_json(args.open_meteo_cache, {'forecast': {}, 'ensemble': {}, 'multi_model': {}, 'saved_at': 0})

    db_daily = DailyRecordRepository().load_all()
    db_telegram = TelegramAlertStateRepository().load_state()
    db_snapshots = ProbabilitySnapshotRepository().load_all_rows()
    db_cache = OpenMeteoCacheRepository().load_payload(args.open_meteo_max_age)

    report = {
        'daily_records': {
            'file_cities': len(file_daily or {}),
            'db_cities': len(db_daily or {}),
            'equal': _norm_json(file_daily or {}) == _norm_json(db_daily or {}),
        },
        'telegram_state': {
            'equal': _norm_json(file_telegram or {}) == _norm_json(db_telegram or {}),
            'file_last_by_city': len((file_telegram or {}).get('last_by_city') or {}),
            'db_last_by_city': len((db_telegram or {}).get('last_by_city') or {}),
        },
        'snapshots': {
            'file_rows': len(file_snapshots),
            'db_rows': len(db_snapshots),
            'equal': _norm_json(file_snapshots) == _norm_json(db_snapshots),
        },
        'open_meteo_cache': {
            'file_forecast': len((file_cache or {}).get('forecast') or {}),
            'db_forecast': len((db_cache or {}).get('forecast') or {}),
            'equal': _norm_open_meteo_payload(file_cache or {}) == _norm_open_meteo_payload(db_cache or {}),
        },
    }
    report['ok'] = all(section.get('equal') for section in report.values() if isinstance(section, dict))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(0 if report['ok'] else 1)


if __name__ == '__main__':
    main()
