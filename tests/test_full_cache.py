import tempfile
import os
from src.database.db_manager import DBManager

def test_full_cache_lifecycle():
    tmpdir = tempfile.TemporaryDirectory()
    try:
        db_path = os.path.join(tmpdir.name, "test.db")
        if hasattr(DBManager, "_initialized_paths"):
            DBManager._initialized_paths.clear()
            
        db = DBManager(db_path)
        
        # Verify table name resolution
        assert db._cache_table_name("full") == "city_full_cache"
        
        # Verify cache save and load lifecycle
        city = "testcity"
        payload = {"data": "test_payload_full_depth", "nested": {"key": 123}}
        
        db.set_city_cache(
            kind="full",
            city=city,
            payload=payload,
            version="v1",
            source_fingerprint="testcity:full"
        )
        
        cached = db.get_city_cache("full", city)
        assert cached is not None
        assert cached["city"] == city
        assert cached["payload"] == payload
        assert cached["version"] == "v1"
        assert cached["source_fingerprint"] == "testcity:full"

        # Release database file handles for Windows temp directory cleanup
        del db
        import gc
        gc.collect()
    finally:
        try:
            tmpdir.cleanup()
        except PermissionError:
            import gc
            gc.collect()
            try:
                tmpdir.cleanup()
            except Exception:
                pass
