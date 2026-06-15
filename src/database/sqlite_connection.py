from __future__ import annotations

import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from typing import Any, Dict, Iterator, Optional

_PROCESS_LOCKS: Dict[str, threading.RLock] = {}
_PROCESS_LOCKS_GUARD = threading.Lock()
_WAL_INITIALIZED: set[str] = set()
_WAL_INITIALIZED_GUARD = threading.Lock()


def _env_float(name: str, default: float) -> float:
    raw = str(os.getenv(name, "") or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = str(os.getenv(name, "") or "").strip()
    if not raw:
        return default
    try:
        return int(float(raw))
    except ValueError:
        return default


def _write_lock_enabled() -> bool:
    raw = str(os.getenv("POLYWEATHER_SQLITE_WRITE_LOCK_ENABLED", "1") or "").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _default_sqlite_timeout_sec() -> float:
    return max(1.0, _env_float("POLYWEATHER_SQLITE_TIMEOUT_SEC", 30.0))


def _default_busy_timeout_ms() -> int:
    return max(1000, _env_int("POLYWEATHER_SQLITE_BUSY_TIMEOUT_MS", 30000))


def _default_write_lock_timeout_sec() -> float:
    return max(1.0, _env_float("POLYWEATHER_SQLITE_WRITE_LOCK_TIMEOUT_SEC", 30.0))


def sqlite_write_lock_path(db_path: str) -> str:
    override = str(os.getenv("POLYWEATHER_SQLITE_WRITE_LOCK_PATH") or "").strip()
    if override:
        return os.path.abspath(override)
    return f"{os.path.abspath(os.fspath(db_path))}.write.lock"


def _process_lock(path: str) -> threading.RLock:
    with _PROCESS_LOCKS_GUARD:
        lock = _PROCESS_LOCKS.get(path)
        if lock is None:
            lock = threading.RLock()
            _PROCESS_LOCKS[path] = lock
        return lock


def _ensure_lock_file_ready(fd: int, path: str) -> None:
    try:
        if os.path.getsize(path) <= 0:
            os.write(fd, b"\0")
    except OSError:
        pass
    os.lseek(fd, 0, os.SEEK_SET)


if os.name == "nt":
    import msvcrt

    def _try_lock_fd(fd: int) -> None:
        os.lseek(fd, 0, os.SEEK_SET)
        try:
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        except OSError as exc:
            raise BlockingIOError(str(exc)) from exc

    def _unlock_fd(fd: int) -> None:
        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)

else:
    import fcntl

    def _try_lock_fd(fd: int) -> None:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def _unlock_fd(fd: int) -> None:
        fcntl.flock(fd, fcntl.LOCK_UN)


@contextmanager
def sqlite_write_lock(
    db_path: str,
    *,
    timeout_sec: Optional[float] = None,
) -> Iterator[None]:
    if not _write_lock_enabled():
        yield
        return

    lock_path = sqlite_write_lock_path(db_path)
    lock_dir = os.path.dirname(lock_path)
    if lock_dir:
        os.makedirs(lock_dir, exist_ok=True)

    timeout = _default_write_lock_timeout_sec() if timeout_sec is None else max(0.0, float(timeout_sec))
    deadline = time.monotonic() + timeout
    process_lock = _process_lock(lock_path)
    remaining = max(0.0, deadline - time.monotonic())
    acquired_thread_lock = process_lock.acquire(timeout=remaining)
    if not acquired_thread_lock:
        raise TimeoutError(f"timed out waiting for sqlite write lock: {lock_path}")

    fd = -1
    acquired_file_lock = False
    try:
        fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o666)
        _ensure_lock_file_ready(fd, lock_path)
        while True:
            try:
                _try_lock_fd(fd)
                acquired_file_lock = True
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"timed out waiting for sqlite write lock: {lock_path}")
                time.sleep(0.025)
        yield
    finally:
        try:
            if acquired_file_lock and fd >= 0:
                _unlock_fd(fd)
        finally:
            if fd >= 0:
                os.close(fd)
            process_lock.release()


_WRITE_PREFIXES = {
    "alter",
    "attach",
    "begin",
    "create",
    "delete",
    "detach",
    "drop",
    "insert",
    "pragma",
    "reindex",
    "replace",
    "update",
    "vacuum",
}


def _strip_sql_comments(sql: str) -> str:
    text = str(sql or "").lstrip()
    while text.startswith("--") or text.startswith("/*"):
        if text.startswith("--"):
            _, _, text = text.partition("\n")
            text = text.lstrip()
            continue
        end = text.find("*/")
        if end < 0:
            return ""
        text = text[end + 2 :].lstrip()
    return text


def _statement_needs_write_lock(sql: str) -> bool:
    text = _strip_sql_comments(sql)
    if not text:
        return False
    first = text.split(None, 1)[0].strip().lower()
    if first not in _WRITE_PREFIXES:
        return False
    if first == "pragma":
        lower = text.lower()
        return "journal_mode" in lower or "wal_checkpoint" in lower
    if first == "begin":
        lower = text.lower()
        return "immediate" in lower or "exclusive" in lower
    return True


def _script_needs_write_lock(sql_script: str) -> bool:
    return any(_statement_needs_write_lock(statement) for statement in str(sql_script or "").split(";"))


class LockedSQLiteConnection(sqlite3.Connection):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._polyweather_db_path = os.fspath(args[0]) if args else ""
        self._polyweather_write_lock_timeout_sec = _default_write_lock_timeout_sec()
        self._polyweather_write_lock_cm = None

    def configure_polyweather_lock(
        self,
        *,
        db_path: str,
        write_lock_timeout_sec: Optional[float] = None,
    ) -> "LockedSQLiteConnection":
        self._polyweather_db_path = os.fspath(db_path)
        if write_lock_timeout_sec is not None:
            self._polyweather_write_lock_timeout_sec = max(0.0, float(write_lock_timeout_sec))
        return self

    def _ensure_write_lock(self) -> None:
        if self._polyweather_write_lock_cm is not None:
            return
        cm = sqlite_write_lock(
            self._polyweather_db_path,
            timeout_sec=self._polyweather_write_lock_timeout_sec,
        )
        cm.__enter__()
        self._polyweather_write_lock_cm = cm

    def _release_write_lock(self) -> None:
        cm = self._polyweather_write_lock_cm
        if cm is None:
            return
        self._polyweather_write_lock_cm = None
        cm.__exit__(None, None, None)

    def execute(self, sql: str, parameters: Any = (), /) -> sqlite3.Cursor:
        if _statement_needs_write_lock(sql):
            self._ensure_write_lock()
        return super().execute(sql, parameters)

    def executemany(self, sql: str, seq_of_parameters: Any, /) -> sqlite3.Cursor:
        if _statement_needs_write_lock(sql):
            self._ensure_write_lock()
        return super().executemany(sql, seq_of_parameters)

    def executescript(self, sql_script: str, /) -> sqlite3.Cursor:
        if _script_needs_write_lock(sql_script):
            self._ensure_write_lock()
        return super().executescript(sql_script)

    def commit(self) -> None:
        try:
            super().commit()
        finally:
            self._release_write_lock()

    def rollback(self) -> None:
        try:
            super().rollback()
        finally:
            self._release_write_lock()

    def close(self) -> None:
        try:
            super().close()
        finally:
            self._release_write_lock()

    def __exit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> Optional[bool]:
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self._release_write_lock()


def _wal_cache_key(db_path: str) -> str:
    return os.path.abspath(os.fspath(db_path))


def _ensure_wal_mode(conn: LockedSQLiteConnection, db_path: str, timeout_sec: float) -> None:
    if os.fspath(db_path) == ":memory:":
        return
    cache_key = _wal_cache_key(db_path)
    if cache_key in _WAL_INITIALIZED:
        return
    with _WAL_INITIALIZED_GUARD:
        if cache_key in _WAL_INITIALIZED:
            return
        with sqlite_write_lock(db_path, timeout_sec=timeout_sec):
            sqlite3.Connection.execute(conn, "PRAGMA journal_mode=WAL")
        _WAL_INITIALIZED.add(cache_key)


def connect_sqlite(
    db_path: str,
    *,
    timeout: Optional[float] = None,
    busy_timeout_ms: Optional[int] = None,
    enable_wal: bool = True,
    row_factory: Optional[Any] = None,
    write_lock_timeout_sec: Optional[float] = None,
    **kwargs: Any,
) -> LockedSQLiteConnection:
    sqlite_timeout = _default_sqlite_timeout_sec() if timeout is None else max(0.0, float(timeout))
    lock_timeout = (
        _default_write_lock_timeout_sec()
        if write_lock_timeout_sec is None
        else max(0.0, float(write_lock_timeout_sec))
    )
    conn = sqlite3.connect(
        db_path,
        timeout=sqlite_timeout,
        factory=LockedSQLiteConnection,
        **kwargs,
    )
    conn.configure_polyweather_lock(
        db_path=db_path,
        write_lock_timeout_sec=lock_timeout,
    )
    sqlite3.Connection.execute(
        conn,
        f"PRAGMA busy_timeout={_default_busy_timeout_ms() if busy_timeout_ms is None else max(0, int(busy_timeout_ms))}",
    )
    if enable_wal:
        _ensure_wal_mode(conn, db_path, lock_timeout)
    if row_factory is not None:
        conn.row_factory = row_factory
    return conn
