#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from dotenv import load_dotenv

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
    from src.auth.supabase_entitlement import SUPABASE_ENTITLEMENT
    from src.payments.contract_checkout import PAYMENT_CHECKOUT, PaymentCheckoutError

    load_dotenv()

    parser = argparse.ArgumentParser(
        description="Manually grant a PolyWeather subscription by Supabase email.",
    )
    parser.add_argument("--email", required=True, help="Supabase email")
    parser.add_argument(
        "--plan-code",
        default="pro_monthly",
        help="Plan code to grant (default: pro_monthly)",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=30,
        help="Subscription days to grant (default: 30)",
    )
    parser.add_argument(
        "--actor",
        default="manual_admin_grant",
        help="Audit actor to record in entitlement_events",
    )
    args = parser.parse_args()

    email = str(args.email or "").strip().lower()
    plan_code = str(args.plan_code or "").strip() or "pro_monthly"
    days = int(args.days or 0)
    actor = str(args.actor or "").strip() or "manual_admin_grant"

    if not email:
        print(json.dumps({"ok": False, "reason": "invalid_email"}, ensure_ascii=False, indent=2))
        return 1
    if days <= 0:
        print(json.dumps({"ok": False, "reason": "invalid_days"}, ensure_ascii=False, indent=2))
        return 1
    if not PAYMENT_CHECKOUT.supabase_url or not PAYMENT_CHECKOUT.supabase_service_role_key:
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": "supabase_not_configured",
                    "detail": "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing",
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 1

    try:
        user_id = _lookup_user_id_by_email(email)

        latest_rows = PAYMENT_CHECKOUT._rest(  # noqa: SLF001
            "GET",
            "subscriptions",
            params={
                "select": "id,expires_at,status,plan_code,starts_at",
                "user_id": f"eq.{user_id}",
                "status": "eq.active",
                "order": "expires_at.desc",
                "limit": "1",
            },
            allowed_status=[200],
        )
        before = latest_rows[0] if isinstance(latest_rows, list) and latest_rows else None

        now = datetime.now(timezone.utc)
        starts_at = now
        if isinstance(before, dict):
            expires_raw = str(before.get("expires_at") or "").strip()
            if expires_raw:
                try:
                    latest_exp = datetime.fromisoformat(expires_raw.replace("Z", "+00:00"))
                    if latest_exp.tzinfo is None:
                        latest_exp = latest_exp.replace(tzinfo=timezone.utc)
                    latest_exp = latest_exp.astimezone(timezone.utc)
                    if latest_exp > starts_at:
                        starts_at = latest_exp
                except Exception:
                    pass
        expires_at = starts_at + timedelta(days=days)

        created = PAYMENT_CHECKOUT._rest(  # noqa: SLF001
            "POST",
            "subscriptions",
            payload={
                "user_id": user_id,
                "plan_code": plan_code,
                "status": "active",
                "starts_at": starts_at.isoformat(),
                "expires_at": expires_at.isoformat(),
                "source": actor,
                "created_at": now.isoformat(),
                "updated_at": now.isoformat(),
            },
            prefer="return=representation",
            allowed_status=[201],
        )
        subscription = created[0] if isinstance(created, list) and created else {}

        PAYMENT_CHECKOUT._rest(  # noqa: SLF001
            "POST",
            "entitlement_events",
            payload={
                "user_id": user_id,
                "action": "subscription_granted",
                "reason": "manual_admin_grant",
                "actor": actor,
                "detail": f"manual grant {plan_code} for {days} days",
                "payload": {
                    "email": email,
                    "plan_code": plan_code,
                    "days": days,
                    "starts_at": starts_at.isoformat(),
                    "expires_at": expires_at.isoformat(),
                },
                "created_at": now.isoformat(),
            },
            prefer="return=representation",
            allowed_status=[201],
        )
        SUPABASE_ENTITLEMENT.invalidate_subscription_cache(user_id)

        print(
            json.dumps(
                {
                    "ok": True,
                    "email": email,
                    "user_id": user_id,
                    "plan_code": plan_code,
                    "days": days,
                    "before": before,
                    "subscription": subscription,
                },
                ensure_ascii=False,
                indent=2,
                default=str,
            )
        )
        return 0
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
