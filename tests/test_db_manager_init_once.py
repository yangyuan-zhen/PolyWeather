from src.database.db_manager import DBManager


def test_db_manager_initializes_each_db_path_once(monkeypatch, tmp_path):
    calls = []

    def fake_init_db(self):
        calls.append(self.db_path)

    monkeypatch.setattr(DBManager, "_init_db", fake_init_db)
    if hasattr(DBManager, "_initialized_paths"):
        DBManager._initialized_paths.clear()  # noqa: SLF001

    path_a = str(tmp_path / "a.db")
    path_b = str(tmp_path / "b.db")

    DBManager(path_a)
    DBManager(path_a)
    DBManager(path_b)

    assert calls == [path_a, path_b]
