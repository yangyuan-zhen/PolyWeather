from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, ROUND_FLOOR
from typing import Any, Dict, List, Optional

import requests

from src.payments.checkout.models import PaymentCheckoutError, PaymentIntentRecord


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _to_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _format_decimal(value: Decimal, places: int = 6) -> str:
    raw = f"{value:.{places}f}"
    return raw.rstrip("0").rstrip(".") or "0"


class AdminMixin:
    def _service_headers(self, prefer: Optional[str] = None) -> Dict[str, str]:
        headers = {
            "apikey": self.supabase_service_role_key,
            "Authorization": f"Bearer {self.supabase_service_role_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        return headers

    def _rest(
        self,
        method: str,
        table: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        payload: Optional[Any] = None,
        prefer: Optional[str] = None,
        allowed_status: Optional[List[int]] = None,
    ) -> Any:
        url = f"{self.supabase_url}/rest/v1/{table}"
        status_ok = allowed_status or [200, 201, 204]
        try:
            response = requests.request(
                method=method.upper(),
                url=url,
                params=params,
                json=payload,
                headers=self._service_headers(prefer=prefer),
                timeout=self.timeout_sec,
            )
        except Exception as exc:
            raise PaymentCheckoutError(503, f"supabase request failed: {exc}") from exc

        if response.status_code not in status_ok:
            detail = response.text[:350] if response.text else response.reason
            raise PaymentCheckoutError(
                502,
                f"supabase {method.upper()} {table} failed: {response.status_code} {detail}",
            )
        if not response.content:
            return None
        try:
            return response.json()
        except Exception:
            return None

    def _admin_auth_headers(self) -> Dict[str, str]:
        return {
            "apikey": self.supabase_service_role_key,
            "Authorization": f"Bearer {self.supabase_service_role_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _auth_admin_request(
        self,
        method: str,
        path: str,
        *,
        payload: Optional[Dict[str, Any]] = None,
        allowed_status: Optional[List[int]] = None,
    ) -> Any:
        url = f"{self.supabase_url}/auth/v1{path}"
        status_ok = allowed_status or [200]
        try:
            response = requests.request(
                method=method.upper(),
                url=url,
                json=payload,
                headers=self._admin_auth_headers(),
                timeout=self.timeout_sec,
            )
        except Exception as exc:
            raise PaymentCheckoutError(
                503, f"supabase auth request failed: {exc}"
            ) from exc
        if response.status_code not in status_ok:
            detail = response.text[:350] if response.text else response.reason
            raise PaymentCheckoutError(
                502,
                (
                    f"supabase auth {method.upper()} {path} failed: "
                    f"{response.status_code} {detail}"
                ),
            )
        if not response.content:
            return None
        try:
            return response.json()
        except Exception:
            return None

    def _extract_user_metadata(self, user_payload: Any) -> Dict[str, Any]:
        if not isinstance(user_payload, dict):
            return {}
        if isinstance(user_payload.get("user_metadata"), dict):
            return dict(user_payload.get("user_metadata") or {})
        user_obj = user_payload.get("user")
        if isinstance(user_obj, dict) and isinstance(
            user_obj.get("user_metadata"), dict
        ):
            return dict(user_obj.get("user_metadata") or {})
        return {}

    def _extract_points_from_metadata(self, metadata: Dict[str, Any]) -> int:
        if not isinstance(metadata, dict):
            return 0
        for key in ("points", "total_points"):
            raw = metadata.get(key)
            if raw is None:
                continue
            try:
                return max(0, int(raw))
            except Exception:
                continue
        return 0

    def _resolve_points_balance(self, user_id: str) -> Dict[str, Any]:
        db_user = self._db.get_user_by_supabase_user_id(user_id)
        if db_user is not None:
            try:
                balance = max(0, int(db_user.get("points") or 0))
            except Exception:
                balance = 0
            return {"source": "bot_db", "balance": balance}

        user_obj = self._auth_admin_get_user(user_id)
        metadata = self._extract_user_metadata(user_obj)
        balance = self._extract_points_from_metadata(metadata)
        return {"source": "supabase_metadata", "balance": balance, "metadata": metadata}

    def _points_max_discount_for_plan(self, plan_code: str) -> int:
        code = str(plan_code or "").strip().lower()
        if code in self.points_max_discount_usdc_by_plan:
            return max(0, int(self.points_max_discount_usdc_by_plan[code]))
        return max(0, int(self.points_max_discount_usdc))

    def _auth_admin_get_user(self, user_id: str) -> Dict[str, Any]:
        user_id_text = str(user_id or "").strip()
        if not user_id_text:
            raise PaymentCheckoutError(400, "user_id required")
        data = self._auth_admin_request(
            "GET",
            f"/admin/users/{user_id_text}",
            allowed_status=[200],
        )
        if isinstance(data, dict):
            user_obj = data.get("user")
            if isinstance(user_obj, dict):
                return user_obj
            return data
        return {}

    def _auth_admin_update_user_metadata(
        self,
        user_id: str,
        metadata: Dict[str, Any],
    ) -> Dict[str, Any]:
        user_id_text = str(user_id or "").strip()
        if not user_id_text:
            raise PaymentCheckoutError(400, "user_id required")
        payload = {"user_metadata": metadata or {}}
        data = self._auth_admin_request(
            "PUT",
            f"/admin/users/{user_id_text}",
            payload=payload,
            allowed_status=[200],
        )
        if isinstance(data, dict):
            user_obj = data.get("user")
            if isinstance(user_obj, dict):
                return user_obj
            return data
        return {}

    def _build_points_redemption(
        self,
        *,
        user_id: str,
        plan_code: str,
        plan_amount_usdc: Decimal,
        use_points: bool,
        requested_points_to_consume: Optional[int],
    ) -> Dict[str, Any]:
        max_discount_for_plan = self._points_max_discount_for_plan(plan_code)
        base = {
            "enabled": bool(self.points_enabled),
            "applied": False,
            "points_per_usdc": int(self.points_per_usdc),
            "max_discount_usdc": int(max_discount_for_plan),
            "max_discount_usdc_by_plan": {
                str(code): int(value)
                for code, value in self.points_max_discount_usdc_by_plan.items()
            },
            "points_source": "supabase_metadata",
            "points_balance_snapshot": 0,
            "points_to_consume": 0,
            "discount_usdc": "0",
            "pay_amount_usdc": plan_amount_usdc,
        }
        if not self.points_enabled:
            return base
        if not use_points:
            return base
        if plan_amount_usdc <= 0:
            return base
        points_ctx = self._resolve_points_balance(user_id)
        balance = int(points_ctx.get("balance") or 0)
        base["points_source"] = str(points_ctx.get("source") or "supabase_metadata")
        base["points_balance_snapshot"] = balance
        if balance <= 0:
            return base

        max_discount_usdc = min(
            Decimal(int(max_discount_for_plan)),
            plan_amount_usdc,
        )
        max_points_by_plan = int(
            (max_discount_usdc * Decimal(int(self.points_per_usdc))).to_integral_value(
                rounding=ROUND_FLOOR
            )
        )
        if max_points_by_plan <= 0:
            return base

        desired_points = max_points_by_plan
        if requested_points_to_consume is not None:
            try:
                desired_points = max(0, int(requested_points_to_consume))
            except Exception:
                desired_points = 0
        candidate_points = min(balance, max_points_by_plan, desired_points)
        if candidate_points <= 0:
            return base

        normalized_points = (candidate_points // int(self.points_per_usdc)) * int(
            self.points_per_usdc
        )
        if normalized_points <= 0:
            return base
        discount_units = normalized_points // int(self.points_per_usdc)
        discount_usdc = Decimal(discount_units)
        pay_amount = plan_amount_usdc - discount_usdc
        if pay_amount <= 0:
            return base

        base["applied"] = True
        base["points_to_consume"] = int(normalized_points)
        base["discount_usdc"] = _format_decimal(discount_usdc)
        base["pay_amount_usdc"] = pay_amount
        return base

    def _consume_points_for_intent(
        self,
        user_id: str,
        intent: PaymentIntentRecord,
    ) -> Dict[str, Any]:
        result = {
            "enabled": bool(self.points_enabled),
            "applied": False,
            "points_per_usdc": int(self.points_per_usdc),
            "points_redeemed": 0,
            "points_before": 0,
            "points_after": 0,
            "discount_usdc": "0",
        }
        if not self.points_enabled:
            return result

        metadata = dict(intent.metadata or {})
        redemption = metadata.get("points_redemption")
        if not isinstance(redemption, dict):
            return result
        if not bool(redemption.get("applied")):
            return result
        if bool(redemption.get("consumed")):
            result["applied"] = True
            result["points_redeemed"] = int(redemption.get("consumed_points") or 0)
            result["points_after"] = int(redemption.get("points_after") or 0)
            result["discount_usdc"] = str(redemption.get("discount_usdc") or "0")
            return result

        planned_points = int(redemption.get("points_to_consume") or 0)
        points_source = str(redemption.get("points_source") or "").strip().lower()
        if planned_points <= 0:
            return result

        if points_source == "bot_db":
            points_before = self._db.get_points_by_supabase_user_id(user_id)
            if points_before <= 0:
                return result
            redeemable = min(points_before, planned_points)
            redeemable = (redeemable // int(self.points_per_usdc)) * int(
                self.points_per_usdc
            )
            if redeemable <= 0:
                return result
            spend_result = self._db.spend_points_by_supabase_user_id(
                user_id, redeemable
            )
            if not bool(spend_result.get("ok")):
                return result
            points_after = int(spend_result.get("balance") or 0)
            discount_usdc = Decimal(redeemable // int(self.points_per_usdc))
            result["applied"] = True
            result["points_redeemed"] = int(redeemable)
            result["points_before"] = int(points_before)
            result["points_after"] = int(points_after)
            result["discount_usdc"] = _format_decimal(discount_usdc)
            return result

        user_obj = self._auth_admin_get_user(user_id)
        user_metadata = self._extract_user_metadata(user_obj)
        points_before = self._extract_points_from_metadata(user_metadata)
        if points_before <= 0:
            return result

        redeemable = min(points_before, planned_points)
        redeemable = (redeemable // int(self.points_per_usdc)) * int(
            self.points_per_usdc
        )
        if redeemable <= 0:
            return result

        points_after = points_before - redeemable
        updated_metadata = dict(user_metadata or {})
        if "points" in updated_metadata:
            updated_metadata["points"] = points_after
        if "total_points" in updated_metadata:
            updated_metadata["total_points"] = points_after
        if "points" not in updated_metadata and "total_points" not in updated_metadata:
            updated_metadata["points"] = points_after
            updated_metadata["total_points"] = points_after
        self._auth_admin_update_user_metadata(user_id, updated_metadata)

        discount_usdc = Decimal(redeemable // int(self.points_per_usdc))
        result["applied"] = True
        result["points_redeemed"] = int(redeemable)
        result["points_before"] = int(points_before)
        result["points_after"] = int(points_after)
        result["discount_usdc"] = _format_decimal(discount_usdc)
        return result
