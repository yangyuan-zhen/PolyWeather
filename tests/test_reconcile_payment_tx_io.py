import importlib.util
from pathlib import Path


def _load_script():
    root = Path(__file__).resolve().parents[1]
    path = root / "scripts" / "reconcile_payment_tx.py"
    spec = importlib.util.spec_from_file_location("reconcile_payment_tx", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_find_intent_by_tx_queries_tx_hash_directly(monkeypatch):
    module = _load_script()
    tx_hash = "0x" + "a" * 64
    calls = []

    class FakeCheckout:
        def _rest(self, method, table, *, params, allowed_status):
            calls.append(
                {
                    "method": method,
                    "table": table,
                    "params": params,
                    "allowed_status": allowed_status,
                }
            )
            return [{"id": "intent-1", "user_id": "user-1", "tx_hash": tx_hash}]

    monkeypatch.setattr(module, "PAYMENT_CHECKOUT", FakeCheckout())

    result = module._find_intent_by_tx("user-1", tx_hash.upper())

    assert result["id"] == "intent-1"
    assert calls == [
        {
            "method": "GET",
            "table": "payment_intents",
            "params": {
                "select": "id,user_id",
                "tx_hash": f"eq.{tx_hash}",
                "limit": "1",
            },
            "allowed_status": [200],
        }
    ]


def test_find_intent_by_tx_rejects_other_user(monkeypatch):
    module = _load_script()

    class FakeCheckout:
        def _rest(self, method, table, *, params, allowed_status):
            return [{"id": "intent-other", "user_id": "user-2"}]

    monkeypatch.setattr(module, "PAYMENT_CHECKOUT", FakeCheckout())

    assert module._find_intent_by_tx("user-1", "0x" + "a" * 64) is None


def test_find_intent_by_order_id_uses_unique_order_lookup(monkeypatch):
    module = _load_script()
    calls = []

    class FakeCheckout:
        def _rest(self, method, table, *, params, allowed_status):
            calls.append(
                {
                    "method": method,
                    "table": table,
                    "params": params,
                    "allowed_status": allowed_status,
                }
            )
            return [
                {
                    "id": "intent-1",
                    "user_id": "user-1",
                    "order_id_hex": "0x" + "b" * 64,
                }
            ]

    monkeypatch.setattr(module, "PAYMENT_CHECKOUT", FakeCheckout())

    result = module._find_intent_by_order_id("user-1", "0X" + "B" * 64)

    assert result["id"] == "intent-1"
    assert calls == [
        {
            "method": "GET",
            "table": "payment_intents",
            "params": {
                "select": "id,user_id",
                "order_id_hex": "eq.0x" + "b" * 64,
                "limit": "1",
            },
            "allowed_status": [200],
        }
    ]


def test_find_intent_by_order_id_rejects_other_user(monkeypatch):
    module = _load_script()

    class FakeCheckout:
        def _rest(self, method, table, *, params, allowed_status):
            return [
                {
                    "id": "intent-other",
                    "user_id": "user-2",
                    "order_id_hex": "0x" + "b" * 64,
                }
            ]

    monkeypatch.setattr(module, "PAYMENT_CHECKOUT", FakeCheckout())

    assert module._find_intent_by_order_id("user-1", "0x" + "b" * 64) is None
