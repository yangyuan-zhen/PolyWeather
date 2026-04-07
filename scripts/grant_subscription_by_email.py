#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)


def _select_exact_user_id(payload: object, email: str) -> str:
    from src.payments.contract_checkout import PaymentCheckoutError

    normalized_email = str(email or "").strip().lower()
    users = payload.get("users") if isinstance(payload, dict) else None
    if not isinstance(users, list) or not users:
        raise PaymentCheckoutError(404, f"supabase user not found for email={email}")

    matches = []
    for row in users:
        if not isinstance(row, dict):
            continue
        row_email = str(row.get("email") or "").strip().lower()
        user_id = str(row.get("id") or "").strip()
        if row_email == normalized_email and user_id:
            matches.append(user_id)

    unique_matches = []
    for user_id in matches:
        if user_id not in unique_matches:
            unique_matches.append(user_id)

    if len(unique_matches) == 1:
        return unique_matches[0]
    if len(unique_matches) > 1:
        raise PaymentCheckoutError(
            409,
            f"multiple exact supabase users matched email={email}: {unique_matches}",
        )
    raise PaymentCheckoutError(404, f"exact supabase user not found for email={email}")


def _lookup_user_id_by_email(email: str) -> str:
    from src.payments.contract_checkout import PAYMENT_CHECKOUT

    payload = PAYMENT_CHECKOUT._auth_admin_request(  # noqa: SLF001
        "GET",
        f"/admin/users?email={email}",
        allowed_status=[200],
    )
    return _select_exact_user_id(payload, email)


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
                "select": "id,expires_at,status,plan_code,starts_at,source,created_at",
                "user_id": f"eq.{user_id}",
                "status": "eq.active",
                "order": "expires_at.desc",
                "limit": "20",
            },
            allowed_status=[200],
        )

        now = datetime.now(timezone.utc)
        before = None
        upcoming = None
        if isinstance(latest_rows, list):
            for row in latest_rows:
                if not isinstance(row, dict):
                    continue
                starts_raw = str(row.get("starts_at") or "").strip()
                starts_dt = None
                if starts_raw:
                    try:
                        starts_dt = datetime.fromisoformat(starts_raw.replace("Z", "+00:00"))
                        if starts_dt.tzinfo is None:
                            starts_dt = starts_dt.replace(tzinfo=timezone.utc)
                        starts_dt = starts_dt.astimezone(timezone.utc)
                    except Exception:
                        starts_dt = None
                if starts_dt is None or starts_dt <= now:
                    if before is None:
                        before = row
                elif upcoming is None and str(row.get("plan_code") or "").strip().lower() == plan_code.lower():
                    upcoming = row

        starts_at = now
        if isinstance(before, dict):
            before_plan_code = str(before.get("plan_code") or "").strip().lower()
            before_source = str(before.get("source") or "").strip().lower()
            before_is_trial = "trial" in before_plan_code or "trial" in before_source
            if not before_is_trial:
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

        if isinstance(upcoming, dict) and str(upcoming.get("id") or "").strip():
            updated = PAYMENT_CHECKOUT._rest(  # noqa: SLF001
                "PATCH",
                "subscriptions",
                params={"id": f"eq.{upcoming['id']}"},
                payload={
                    "starts_at": starts_at.isoformat(),
                    "expires_at": expires_at.isoformat(),
                    "updated_at": now.isoformat(),
                },
                prefer="return=representation",
                allowed_status=[200],
            )
            subscription = updated[0] if isinstance(updated, list) and updated else {}
        else:
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
                "payload": {
                    "email": email,
                    "plan_code": plan_code,
                    "days": days,
                    "starts_at": starts_at.isoformat(),
                    "expires_at": expires_at.isoformat(),
                    "mode": "updated_upcoming" if isinstance(upcoming, dict) else "created_new",
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
