from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone
from typing import Dict, List, Optional

from loguru import logger

from src.database.db_manager import DBManager

from ._base import (
    REFERRAL_DISCOUNT_USDC,
    REFERRAL_MONTHLY_DAY_LIMIT,
    REFERRAL_MONTHLY_DISCOUNTED_AMOUNT_USDC,
    REFERRAL_MONTHLY_POINTS_LIMIT,
    REFERRAL_MONTHLY_REWARD_LIMIT,
    REFERRAL_REWARD_DAYS,
    REFERRAL_REWARD_POINTS,
)


class ReferralMixin:
    @staticmethod
    def _normalize_referral_code(value: Optional[str]) -> str:
        return "".join(str(value or "").strip().upper().split())

    @staticmethod
    def _fallback_referral_code_for(user_id: str) -> str:
        digest = hashlib.sha256(
            f"polyweather-referral-v1:{user_id}".encode("utf-8")
        ).hexdigest()
        return f"PW{digest[:8].upper()}"

    def _find_referrer_by_fallback_code(self, code: str) -> Optional[str]:
        normalized_code = self._normalize_referral_code(code)
        try:
            rows = self._rest(
                "GET",
                "profiles",
                params={
                    "select": "id",
                    "order": "created_at.asc",
                    "limit": "5000",
                },
                allowed_status=[200],
            )
        except Exception:
            return None
        if not isinstance(rows, list):
            return None
        for row in rows:
            if not isinstance(row, dict):
                continue
            candidate = str(row.get("id") or "").strip()
            if candidate and self._fallback_referral_code_for(candidate) == normalized_code:
                return candidate
        return None

    def _find_referrer_for_referral_code(self, code: str) -> Optional[str]:
        normalized_code = self._normalize_referral_code(code)
        try:
            rows = self._rest(
                "GET",
                "referral_codes",
                params={
                    "select": "user_id,code,status",
                    "code": f"eq.{normalized_code}",
                    "status": "eq.active",
                    "limit": "1",
                },
                allowed_status=[200],
            )
            if isinstance(rows, list) and rows and isinstance(rows[0], dict):
                referrer_user_id = str(rows[0].get("user_id") or "").strip()
                if referrer_user_id:
                    return referrer_user_id
        except Exception:
            pass
        return self._find_referrer_by_fallback_code(normalized_code)

    def ensure_referral_code(self, user_id: str) -> Optional[Dict[str, object]]:
        user_key = str(user_id or "").strip()
        if not user_key or not self.service_role_key:
            return None
        try:
            rows = self._rest(
                "GET",
                "referral_codes",
                params={
                    "select": "code,status,created_at",
                    "user_id": f"eq.{user_key}",
                    "status": "eq.active",
                    "limit": "1",
                },
                allowed_status=[200],
            )
            if isinstance(rows, list) and rows and isinstance(rows[0], dict):
                return rows[0]
            now = datetime.now(timezone.utc)
            for _ in range(5):
                code = f"PW{secrets.token_hex(4).upper()}"
                try:
                    created = self._rest(
                        "POST",
                        "referral_codes",
                        payload={
                            "user_id": user_key,
                            "code": code,
                            "status": "active",
                            "created_at": self._to_iso(now),
                            "updated_at": self._to_iso(now),
                        },
                        prefer="return=representation",
                        allowed_status=[200, 201],
                    )
                    if isinstance(created, list) and created and isinstance(created[0], dict):
                        return created[0]
                    return {"code": code, "status": "active"}
                except Exception:
                    continue
        except Exception as exc:
            logger.warning("referral code ensure failed user_id={}: {}", user_key, exc)
        return {
            "code": self._fallback_referral_code_for(user_key),
            "status": "active",
            "storage": "derived",
        }

    def _get_event_referral_attribution(self, user_id: str) -> Optional[Dict[str, object]]:
        user_key = str(user_id or "").strip()
        if not user_key:
            return None
        try:
            rows = self._fetch_entitlement_events(
                user_id=user_key,
                action="in.(referral_attribution_created,referral_attribution_converted,referral_attribution_capped)",
                limit=50,
            )
        except Exception:
            return None
        for row in rows:
            action = str(row.get("action") or "").strip()
            payload = self._event_payload(row)
            if str(payload.get("referred_user_id") or row.get("user_id") or "").strip() != user_key:
                continue
            if action in {"referral_attribution_converted", "referral_attribution_capped"}:
                return None
            if action == "referral_attribution_created":
                return {
                    "id": payload.get("id") or row.get("id"),
                    "code": str(payload.get("code") or "").strip().upper(),
                    "referrer_user_id": str(payload.get("referrer_user_id") or "").strip(),
                    "referred_user_id": user_key,
                    "status": "pending",
                    "created_at": row.get("created_at"),
                    "_storage": "entitlement_events",
                }
        return None

    def _record_referral_attribution_event(
        self,
        *,
        referrer_user_id: str,
        referred_user_id: str,
        code: str,
        created_at: datetime,
    ) -> Dict[str, object]:
        attribution = {
            "id": f"event:{referred_user_id}:{self._normalize_referral_code(code)}",
            "code": self._normalize_referral_code(code),
            "referrer_user_id": referrer_user_id,
            "referred_user_id": referred_user_id,
            "status": "pending",
            "created_at": self._to_iso(created_at),
            "_storage": "entitlement_events",
        }
        self._rest(
            "POST",
            "entitlement_events",
            payload={
                "user_id": referred_user_id,
                "action": "referral_attribution_created",
                "reason": "invite_code",
                "actor": "account_center",
                "payload": attribution,
                "created_at": self._to_iso(created_at),
            },
            prefer="return=minimal",
            allowed_status=[201],
        )
        return attribution

    def get_pending_referral_attribution(self, user_id: str) -> Optional[Dict[str, object]]:
        user_key = str(user_id or "").strip()
        if not user_key:
            return None
        try:
            rows = self._rest(
                "GET",
                "referral_attributions",
                params={
                    "select": "id,code,referrer_user_id,referred_user_id,status,created_at",
                    "referred_user_id": f"eq.{user_key}",
                    "status": "eq.pending",
                    "order": "created_at.desc",
                    "limit": "1",
                },
                allowed_status=[200],
            )
        except Exception:
            return self._get_event_referral_attribution(user_key)
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            return rows[0]
        return self._get_event_referral_attribution(user_key)

    def _current_month_reward_rows(self, referrer_user_id: str) -> List[Dict[str, object]]:
        month_start = datetime.now(timezone.utc).replace(
            day=1,
            hour=0,
            minute=0,
            second=0,
            microsecond=0,
        )
        try:
            rows = self._rest(
                "GET",
                "referral_rewards",
                params={
                    "select": "id,reward_days,reward_points,created_at",
                    "referrer_user_id": f"eq.{referrer_user_id}",
                    "created_at": f"gte.{self._to_iso(month_start)}",
                    "limit": "100",
                },
                allowed_status=[200],
            )
        except Exception:
            return self._current_month_reward_event_rows(referrer_user_id, month_start)
        table_rows = [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []
        if table_rows:
            return table_rows
        return self._current_month_reward_event_rows(referrer_user_id, month_start)

    def _current_month_reward_event_rows(
        self,
        referrer_user_id: str,
        month_start: datetime,
    ) -> List[Dict[str, object]]:
        try:
            rows = self._fetch_entitlement_events(
                user_id=referrer_user_id,
                action="eq.referral_reward_granted",
                since=month_start,
                limit=100,
            )
        except Exception:
            return []
        out: List[Dict[str, object]] = []
        for row in rows:
            payload = self._event_payload(row)
            out.append(
                {
                    "id": row.get("id"),
                    "reward_days": int(payload.get("reward_days") or REFERRAL_REWARD_DAYS),
                    "reward_points": int(payload.get("reward_points") or REFERRAL_REWARD_POINTS),
                    "created_at": row.get("created_at"),
                    "_storage": "entitlement_events",
                }
            )
        return out

    def _has_referral_reward_for_attribution(self, attribution_id: object) -> bool:
        raw_id = str(attribution_id or "").strip()
        if not raw_id or raw_id.startswith("event:"):
            return False
        try:
            rows = self._rest(
                "GET",
                "referral_rewards",
                params={
                    "select": "id",
                    "referral_attribution_id": f"eq.{raw_id}",
                    "limit": "1",
                },
                allowed_status=[200],
            )
        except Exception:
            return False
        return bool(isinstance(rows, list) and rows)

    def get_referral_summary(self, user_id: str) -> Optional[Dict[str, object]]:
        user_key = str(user_id or "").strip()
        if not user_key or not self.service_role_key:
            return None
        try:
            code_row = self.ensure_referral_code(user_key) or {}
            pending = self.get_pending_referral_attribution(user_key)
            rewards = self._current_month_reward_rows(user_key)
            reward_count = len(rewards)
            reward_days = sum(int(row.get("reward_days") or 0) for row in rewards)
            reward_points = sum(int(row.get("reward_points") or 0) for row in rewards)
            return {
                "code": str(code_row.get("code") or ""),
                "discount_usdc": REFERRAL_DISCOUNT_USDC,
                "discounted_monthly_amount_usdc": REFERRAL_MONTHLY_DISCOUNTED_AMOUNT_USDC,
                "reward_days": REFERRAL_REWARD_DAYS,
                "reward_points": REFERRAL_REWARD_POINTS,
                "monthly_reward_limit": REFERRAL_MONTHLY_REWARD_LIMIT,
                "monthly_reward_days_limit": REFERRAL_MONTHLY_DAY_LIMIT,
                "monthly_reward_points_limit": REFERRAL_MONTHLY_POINTS_LIMIT,
                "monthly_reward_count": reward_count,
                "monthly_reward_days": min(reward_days, REFERRAL_MONTHLY_DAY_LIMIT),
                "monthly_reward_points": min(reward_points, REFERRAL_MONTHLY_POINTS_LIMIT),
                "applied_code": str(pending.get("code") or "") if isinstance(pending, dict) else "",
                "attribution_status": str(pending.get("status") or "") if isinstance(pending, dict) else "",
            }
        except Exception as exc:
            logger.warning("referral summary failed user_id={}: {}", user_key, exc)
            return None

    def apply_referral_code(self, user_id: str, code: str) -> Dict[str, object]:
        user_key = str(user_id or "").strip()
        normalized_code = self._normalize_referral_code(code)
        if not user_key:
            raise ValueError("user_id required")
        if len(normalized_code) < 3:
            raise ValueError("invalid referral code")
        if self.has_paid_subscription(user_key):
            raise ValueError("referral code can only be used before first paid subscription")

        referrer_user_id = self._find_referrer_for_referral_code(normalized_code)
        if not referrer_user_id:
            raise ValueError("referral code not found")
        if not referrer_user_id or referrer_user_id == user_key:
            raise ValueError("cannot use your own referral code")

        existing = self.get_pending_referral_attribution(user_key)
        if isinstance(existing, dict):
            return {
                "ok": True,
                "already_applied": True,
                "referral": self.get_referral_summary(user_key),
            }

        now = datetime.now(timezone.utc)
        try:
            self._rest(
                "POST",
                "referral_attributions",
                payload={
                    "referrer_user_id": referrer_user_id,
                    "referred_user_id": user_key,
                    "code": normalized_code,
                    "status": "pending",
                    "created_at": self._to_iso(now),
                    "updated_at": self._to_iso(now),
                },
                prefer="return=minimal",
                allowed_status=[201],
            )
        except Exception:
            self._record_referral_attribution_event(
                referrer_user_id=referrer_user_id,
                referred_user_id=user_key,
                code=normalized_code,
                created_at=now,
            )
        return {
            "ok": True,
            "already_applied": False,
            "referral": self.get_referral_summary(user_key),
        }

    def _subscription_extension_start(self, user_id: str) -> datetime:
        now = datetime.now(timezone.utc)
        try:
            rows = self._rest(
                "GET",
                "subscriptions",
                params={
                    "select": "starts_at,expires_at,plan_code,source",
                    "user_id": f"eq.{user_id}",
                    "status": "eq.active",
                    "expires_at": f"gt.{self._to_iso(now)}",
                    "order": "expires_at.desc",
                    "limit": "20",
                },
                allowed_status=[200],
            )
        except Exception:
            return now
        starts = now
        if isinstance(rows, list):
            for row in rows:
                if not isinstance(row, dict) or self._is_trial_subscription_row(row):
                    continue
                exp = self._parse_iso_datetime(str(row.get("expires_at") or ""))
                starts_at = self._parse_iso_datetime(str(row.get("starts_at") or ""))
                if exp and (starts_at is None or starts_at <= now) and exp > starts:
                    starts = exp
                    break
        return starts

    def _record_points_ledger(
        self,
        *,
        user_id: str,
        delta: int,
        source: str,
        reason: str,
        payment_intent_id: str = "",
        referral_attribution_id: Optional[object] = None,
        metadata: Optional[Dict[str, object]] = None,
    ) -> None:
        try:
            self._rest(
                "POST",
                "points_ledger",
                payload={
                    "user_id": user_id,
                    "delta": int(delta),
                    "source": source,
                    "reason": reason,
                    "payment_intent_id": payment_intent_id or None,
                    "referral_attribution_id": referral_attribution_id,
                    "metadata": metadata or {},
                    "created_at": self._to_iso(datetime.now(timezone.utc)),
                },
                prefer="return=minimal",
                allowed_status=[201],
            )
        except Exception as exc:
            logger.info("points ledger write skipped user_id={} reason={}", user_id, exc)

    def _grant_referral_points(
        self,
        referrer_user_id: str,
        points: int,
    ) -> Dict[str, object]:
        user_key = str(referrer_user_id or "").strip().lower()
        amount = int(points or 0)
        if not user_key:
            return {"ok": False, "reason": "invalid_referrer"}
        if amount <= 0:
            return {"ok": False, "reason": "invalid_points"}

        try:
            db_result = DBManager().grant_points_by_supabase_user_id(user_key, amount)
        except Exception as exc:
            db_result = {"ok": False, "reason": f"bot_db_error:{exc}"}
        if bool(db_result.get("ok")):
            return {
                "ok": True,
                "source": "bot_db",
                "points_before": int(db_result.get("points_before") or 0),
                "points_added": amount,
                "points_after": int(db_result.get("points_after") or 0),
            }

        user_obj = self._admin_get_user(user_key)
        metadata = dict(user_obj.get("user_metadata") or {})
        before = self._extract_points_from_metadata(metadata)
        after = before + amount
        metadata["points"] = after
        metadata["total_points"] = after
        self._admin_update_user_metadata(user_key, metadata)
        return {
            "ok": True,
            "source": "supabase_metadata",
            "points_before": before,
            "points_added": amount,
            "points_after": after,
        }

    def grant_points_to_user(
        self,
        user_id: str,
        points: int,
    ) -> Dict[str, object]:
        return self._grant_referral_points(user_id, points)

    def _record_referral_resolution_event(
        self,
        *,
        action: str,
        referrer_user_id: str,
        referred_user_id: str,
        attribution: Dict[str, object],
        payment_intent_id: str,
        tx_hash: str,
        created_at: datetime,
        reward_days: int = 0,
        reward_points: int = 0,
    ) -> None:
        self._rest(
            "POST",
            "entitlement_events",
            payload={
                "user_id": referrer_user_id if action == "referral_reward_granted" else referred_user_id,
                "action": action,
                "reason": "referred_user_paid",
                "actor": "payment_contract_checkout",
                "payload": {
                    "attribution_id": attribution.get("id"),
                    "code": attribution.get("code"),
                    "referrer_user_id": referrer_user_id,
                    "referred_user_id": referred_user_id,
                    "payment_intent_id": payment_intent_id,
                    "tx_hash": tx_hash,
                    "reward_days": reward_days,
                    "reward_points": reward_points,
                    "storage": "entitlement_events",
                },
                "created_at": self._to_iso(created_at),
            },
            prefer="return=minimal",
            allowed_status=[201],
        )

    def _settle_referral_reward_with_events(
        self,
        *,
        attribution: Dict[str, object],
        referrer_user_id: str,
        referred_user_id: str,
        payment_intent_id: str,
        tx_hash: str,
        now: datetime,
        monthly_rewards: List[Dict[str, object]],
    ) -> Dict[str, object]:
        if len(monthly_rewards) >= REFERRAL_MONTHLY_REWARD_LIMIT:
            self._record_referral_resolution_event(
                action="referral_attribution_capped",
                referrer_user_id=referrer_user_id,
                referred_user_id=referred_user_id,
                attribution=attribution,
                payment_intent_id=payment_intent_id,
                tx_hash=tx_hash,
                created_at=now,
            )
            return {"awarded": False, "reason": "monthly_cap_reached"}

        grant_result = self._grant_referral_points(
            referrer_user_id,
            REFERRAL_REWARD_POINTS,
        )
        if not bool(grant_result.get("ok")):
            return {
                "awarded": False,
                "reason": str(grant_result.get("reason") or "points_grant_failed"),
            }
        self._record_points_ledger(
            user_id=referrer_user_id,
            delta=REFERRAL_REWARD_POINTS,
            source="referral",
            reason="referred_user_paid",
            payment_intent_id=payment_intent_id,
            referral_attribution_id=attribution.get("id"),
            metadata={
                "referred_user_id": referred_user_id,
                "tx_hash": tx_hash,
                "storage": str(attribution.get("_storage") or "entitlement_events"),
            },
        )
        self._record_referral_resolution_event(
            action="referral_reward_granted",
            referrer_user_id=referrer_user_id,
            referred_user_id=referred_user_id,
            attribution=attribution,
            payment_intent_id=payment_intent_id,
            tx_hash=tx_hash,
            created_at=now,
            reward_days=REFERRAL_REWARD_DAYS,
            reward_points=REFERRAL_REWARD_POINTS,
        )
        self._record_referral_resolution_event(
            action="referral_attribution_converted",
            referrer_user_id=referrer_user_id,
            referred_user_id=referred_user_id,
            attribution=attribution,
            payment_intent_id=payment_intent_id,
            tx_hash=tx_hash,
            created_at=now,
            reward_days=REFERRAL_REWARD_DAYS,
            reward_points=REFERRAL_REWARD_POINTS,
        )
        return {
            "awarded": True,
            "reward_days": REFERRAL_REWARD_DAYS,
            "reward_points": REFERRAL_REWARD_POINTS,
            "referrer_user_id": referrer_user_id,
            "points": grant_result,
            "storage": "entitlement_events",
        }

    def settle_referral_reward(
        self,
        *,
        referred_user_id: str,
        payment_intent_id: str,
        tx_hash: str,
    ) -> Dict[str, object]:
        referred_key = str(referred_user_id or "").strip()
        attribution = self.get_pending_referral_attribution(referred_key)
        if not isinstance(attribution, dict):
            return {"awarded": False, "reason": "no_pending_referral"}
        referrer_key = str(attribution.get("referrer_user_id") or "").strip()
        if not referrer_key or referrer_key == referred_key:
            return {"awarded": False, "reason": "invalid_referrer"}

        now = datetime.now(timezone.utc)
        monthly_rewards = self._current_month_reward_rows(referrer_key)
        if str(attribution.get("_storage") or "") == "entitlement_events":
            return self._settle_referral_reward_with_events(
                attribution=attribution,
                referrer_user_id=referrer_key,
                referred_user_id=referred_key,
                payment_intent_id=payment_intent_id,
                tx_hash=tx_hash,
                now=now,
                monthly_rewards=monthly_rewards,
            )
        if len(monthly_rewards) >= REFERRAL_MONTHLY_REWARD_LIMIT:
            self._rest(
                "PATCH",
                "referral_attributions",
                params={"id": f"eq.{attribution.get('id')}"},
                payload={
                    "status": "capped",
                    "updated_at": self._to_iso(now),
                    "converted_payment_intent_id": payment_intent_id,
                    "converted_tx_hash": tx_hash,
                },
                prefer="return=minimal",
                allowed_status=[204],
            )
            return {"awarded": False, "reason": "monthly_cap_reached"}
        if self._has_referral_reward_for_attribution(attribution.get("id")):
            self._rest(
                "PATCH",
                "referral_attributions",
                params={"id": f"eq.{attribution.get('id')}"},
                payload={
                    "status": "converted",
                    "converted_payment_intent_id": payment_intent_id,
                    "converted_tx_hash": tx_hash,
                    "converted_at": self._to_iso(now),
                    "updated_at": self._to_iso(now),
                },
                prefer="return=minimal",
                allowed_status=[204],
            )
            return {"awarded": False, "reason": "already_rewarded"}

        grant_result = self._grant_referral_points(
            referrer_key,
            REFERRAL_REWARD_POINTS,
        )
        if not bool(grant_result.get("ok")):
            return {
                "awarded": False,
                "reason": str(grant_result.get("reason") or "points_grant_failed"),
            }

        reward_payload = {
                "referral_attribution_id": attribution.get("id"),
                "referrer_user_id": referrer_key,
                "referred_user_id": referred_key,
                "payment_intent_id": payment_intent_id,
                "tx_hash": tx_hash,
                "reward_days": REFERRAL_REWARD_DAYS,
                "reward_points": REFERRAL_REWARD_POINTS,
                "created_at": self._to_iso(now),
        }
        try:
            self._rest(
                "POST",
                "referral_rewards",
                payload=reward_payload,
                prefer="return=minimal",
                allowed_status=[201],
            )
        except Exception as exc:
            logger.warning(
                "referral_rewards insert failed attribution_id={} error={}",
                attribution.get("id"),
                exc,
            )
            self._record_referral_resolution_event(
                action="referral_reward_granted",
                referrer_user_id=referrer_key,
                referred_user_id=referred_key,
                attribution=attribution,
                payment_intent_id=payment_intent_id,
                tx_hash=tx_hash,
                created_at=now,
                reward_days=REFERRAL_REWARD_DAYS,
                reward_points=REFERRAL_REWARD_POINTS,
            )
        self._record_points_ledger(
            user_id=referrer_key,
            delta=REFERRAL_REWARD_POINTS,
            source="referral",
            reason="referred_user_paid",
            payment_intent_id=payment_intent_id,
            referral_attribution_id=attribution.get("id"),
            metadata={
                "referred_user_id": referred_key,
                "tx_hash": tx_hash,
                "grant_source": str(grant_result.get("source") or ""),
            },
        )
        self._rest(
            "PATCH",
            "referral_attributions",
            params={"id": f"eq.{attribution.get('id')}"},
            payload={
                "status": "converted",
                "converted_payment_intent_id": payment_intent_id,
                "converted_tx_hash": tx_hash,
                "converted_at": self._to_iso(now),
                "updated_at": self._to_iso(now),
            },
            prefer="return=minimal",
            allowed_status=[204],
        )
        self._record_referral_resolution_event(
            action="referral_attribution_converted",
            referrer_user_id=referrer_key,
            referred_user_id=referred_key,
            attribution=attribution,
            payment_intent_id=payment_intent_id,
            tx_hash=tx_hash,
            created_at=now,
            reward_days=REFERRAL_REWARD_DAYS,
            reward_points=REFERRAL_REWARD_POINTS,
        )
        return {
            "awarded": True,
            "reward_days": REFERRAL_REWARD_DAYS,
            "reward_points": REFERRAL_REWARD_POINTS,
            "referrer_user_id": referrer_key,
            "points": grant_result,
        }
