
import time

from src.database.runtime_state import (
    DailyRecordRepository,
    OpenMeteoCacheRepository,
    ProbabilitySnapshotRepository,
    RuntimeStateDB,
    TelegramAlertStateRepository,
)


def test_daily_record_repository_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv('POLYWEATHER_DB_PATH', str(tmp_path / 'polyweather.db'))
    repo = DailyRecordRepository(RuntimeStateDB(str(tmp_path / 'polyweather.db')))
    repo.upsert_record('ankara', '2026-03-20', {'actual_high': 15.2, 'deb_prediction': 14.8, 'mu': 15.0})
    data = repo.load_all()
    assert data['ankara']['2026-03-20']['actual_high'] == 15.2


def test_telegram_alert_state_repository_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv('POLYWEATHER_DB_PATH', str(tmp_path / 'polyweather.db'))
    repo = TelegramAlertStateRepository(RuntimeStateDB(str(tmp_path / 'polyweather.db')))
    state = {
        'last_by_city': {
            'ankara': {
                'signature': 'sig-1',
                'trigger_key': 'mkt:test',
                'severity': 'medium',
                'ts': 123,
                'active': True,
                'evidence': {'x': 1},
            }
        },
        'by_signature': {'sig-1': 123},
    }
    repo.save_state(state)
    loaded = repo.load_state()
    assert loaded == state


def test_probability_snapshot_repository_recent_rows(tmp_path, monkeypatch):
    monkeypatch.setenv('POLYWEATHER_DB_PATH', str(tmp_path / 'polyweather.db'))
    repo = ProbabilitySnapshotRepository(RuntimeStateDB(str(tmp_path / 'polyweather.db')))
    repo.append_snapshot({
        'city': 'ankara',
        'date': '2026-03-20',
        'timestamp': '2026-03-20T12:00:00Z',
        'raw_mu': 15.2,
        'raw_sigma': 1.1,
        'max_so_far': 14.9,
        'peak_status': 'before',
        'probability_mode': 'emos_shadow',
        'prob_snapshot': [{'v': 15, 'p': 0.6}],
        'shadow_prob_snapshot': [{'v': 15, 'p': 0.4}],
    })
    rows = repo.load_recent_rows('ankara', '2026-03-20', 5)
    assert len(rows) == 1
    assert rows[0]['raw_mu'] == 15.2


def test_open_meteo_cache_repository_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv('POLYWEATHER_DB_PATH', str(tmp_path / 'polyweather.db'))
    repo = OpenMeteoCacheRepository(RuntimeStateDB(str(tmp_path / 'polyweather.db')))
    payload = {
        'forecast': {'ankara': {'t': time.time(), 'temp': 15}},
        'ensemble': {'ankara': {'t': time.time(), 'spread': 1.5}},
        'multi_model': {},
        'saved_at': 1000,
    }
    repo.replace_payload(payload, 86400)
    loaded = repo.load_payload(86400)
    assert loaded['forecast']['ankara']['temp'] == 15
    assert loaded['ensemble']['ankara']['spread'] == 1.5
