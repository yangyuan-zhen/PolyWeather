import sqlite3
import threading
import time

from src.database.db_manager import DBManager
from src.database.runtime_state import RuntimeStateDB
from src.database.sqlite_connection import (
    LockedSQLiteConnection,
    connect_sqlite,
    sqlite_write_lock,
)


def test_sqlite_write_lock_times_out_when_another_thread_holds_it(tmp_path):
    db_path = str(tmp_path / "polyweather.db")
    errors = []

    def contender():
        try:
            with sqlite_write_lock(db_path, timeout_sec=0.05):
                pass
        except TimeoutError as exc:
            errors.append(exc)

    with sqlite_write_lock(db_path, timeout_sec=1.0):
        started = time.monotonic()
        thread = threading.Thread(target=contender)
        thread.start()
        thread.join(timeout=1.0)
        elapsed = time.monotonic() - started

    assert not thread.is_alive()
    assert errors
    assert elapsed >= 0.05


def test_locked_sqlite_connection_serializes_concurrent_writes(tmp_path):
    db_path = str(tmp_path / "polyweather.db")
    with connect_sqlite(db_path) as conn:
        conn.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
        conn.commit()

    first_inserted = threading.Event()
    release_first = threading.Event()
    order = []

    def first_writer():
        with connect_sqlite(db_path, write_lock_timeout_sec=2.0) as conn:
            conn.execute("INSERT INTO items(value) VALUES ('first')")
            order.append("first-inserted")
            first_inserted.set()
            assert release_first.wait(timeout=2.0)
            conn.commit()
            order.append("first-committed")

    def second_writer():
        assert first_inserted.wait(timeout=2.0)
        with connect_sqlite(db_path, write_lock_timeout_sec=2.0) as conn:
            conn.execute("INSERT INTO items(value) VALUES ('second')")
            conn.commit()
            order.append("second-committed")

    first = threading.Thread(target=first_writer)
    second = threading.Thread(target=second_writer)
    first.start()
    second.start()

    assert first_inserted.wait(timeout=2.0)
    time.sleep(0.1)
    assert order == ["first-inserted"]

    release_first.set()
    first.join(timeout=2.0)
    second.join(timeout=2.0)

    assert not first.is_alive()
    assert not second.is_alive()
    assert order == ["first-inserted", "first-committed", "second-committed"]

    with connect_sqlite(db_path) as conn:
        rows = conn.execute("SELECT value FROM items ORDER BY id ASC").fetchall()
    assert [row[0] for row in rows] == ["first", "second"]


def test_database_managers_use_locked_sqlite_connections(tmp_path):
    manager = DBManager(str(tmp_path / "app.db"))
    with manager._get_connection() as conn:
        assert isinstance(conn, LockedSQLiteConnection)
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] >= 30000

    state_db = RuntimeStateDB(str(tmp_path / "state.db"))
    with state_db.connect() as conn:
        assert isinstance(conn, LockedSQLiteConnection)
        assert conn.row_factory is sqlite3.Row
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] >= 30000
