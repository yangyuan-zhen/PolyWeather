#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)


def _lookup_user_id_by_email(email: str) -> str:
    from src.payments.contract_checkout import PAYMENT_CHECKOUT, PaymentCheckoutError

    payload = PAYMENT_CHECKOUT._auth_admin_request(  # noqa: SLF001
        "GET",
        f"/admin/users?email={email}",
        allowed_status=[200],
    )
    users = payload.get("users") if isinstance(payload, dict) else None
    if not isinstance(users, list) or not users:
        raise PaymentCheckoutError(404, f"supabase user not found for email={email}")
    user = users[0] if isinstance(users[0], dict) else {}
    user_id = str(user.get("id") or "").strip()
    if not user_id:
        raise PaymentCheckoutError(404, f"supabase user id missing for email={email}")
    return user_id


def main() -> int:
    from src.payments.contract_checkout import PAYMENT_CHECKOUT, PaymentCheckoutError

    parser = argparse.ArgumentParser(
        description="Reconcile latest PolyWeather payment/subscription by Supabase email.",
    )
    parser.add_argument("--email", required=True, help="Supabase email")
    args = parser.parse_args()

    email = str(args.email or "").strip().lower()
    if not email:
        print(json.dumps({"ok": False, "reason": "invalid_email"}, ensure_ascii=False, indent=2))
        return 1

    try:
        user_id = _lookup_user_id_by_email(email)
        result: Dict[str, Any] = PAYMENT_CHECKOUT.reconcile_latest_intent(user_id)
        result["email"] = email
        result["user_id"] = user_id
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        return 0 if result.get("ok") else 1
    except PaymentCheckoutError as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "email": email,
                    "status_code": exc.status_code,
                    "error": exc.detail,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
