"""Thin Supabase Admin HTTP client — extracted from DBManager.

Handles URL construction, auth headers, and the actual HTTP PATCH calls
to Supabase REST / Admin APIs.  Cache-cooldown and local SQLite lookups
remain in DBManager.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

import requests
from loguru import logger


class SupabaseAdminClient:
    """Stateless HTTP client for Supabase Management API calls."""

    def __init__(self) -> None:
        self._supabase_url = str(os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
        self._service_role_key = str(
            os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
        ).strip()

    @property
    def configured(self) -> bool:
        return bool(self._supabase_url and self._service_role_key)

    # ------------------------------------------------------------------
    # URL builders
    # ------------------------------------------------------------------

    def profiles_endpoint(self) -> str:
        if not self._supabase_url:
            return ""
        return f"{self._supabase_url}/rest/v1/profiles"

    def admin_users_endpoint(self) -> str:
        if not self._supabase_url:
            return ""
        return f"{self._supabase_url}/auth/v1/admin/users"

    # ------------------------------------------------------------------
    # Headers
    # ------------------------------------------------------------------

    def _service_headers(self, *, prefer: str = "return=minimal") -> Dict[str, str]:
        return {
            "apikey": self._service_role_key,
            "Authorization": f"Bearer {self._service_role_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Prefer": prefer,
        }

    # ------------------------------------------------------------------
    # Operations
    # ------------------------------------------------------------------

    def patch_user_metadata(
        self,
        supabase_user_id: str,
        metadata: Dict[str, Any],
        *,
        timeout: float = 8.0,
    ) -> bool:
        """PATCH /auth/v1/admin/users/{id} with user_metadata."""
        if not self.configured:
            return False
        endpoint = self.admin_users_endpoint()
        if not endpoint:
            return False

        try:
            resp = requests.patch(
                f"{endpoint}/{supabase_user_id}",
                json={"user_metadata": metadata},
                headers=self._service_headers(),
                timeout=timeout,
            )
            ok = resp.status_code in (200, 204)
            if not ok:
                logger.warning(
                    "supabase admin patch user_metadata failed "
                    "user_id={} status={} body={}",
                    supabase_user_id,
                    resp.status_code,
                    (resp.text or "")[:200],
                )
            return ok
        except Exception as exc:
            logger.warning(
                "supabase admin patch user_metadata error user_id={}: {}",
                supabase_user_id,
                exc,
            )
            return False

    def patch_profile(
        self,
        supabase_user_id: str,
        fields: Dict[str, Any],
        *,
        timeout: float = 8.0,
    ) -> bool:
        """PATCH /rest/v1/profiles?id=eq.{user_id} with telegram fields."""
        if not self.configured:
            return False
        endpoint = self.profiles_endpoint()
        if not endpoint:
            return False

        try:
            resp = requests.patch(
                endpoint,
                params={"id": f"eq.{supabase_user_id}"},
                json=fields,
                headers=self._service_headers(),
                timeout=timeout,
            )
            ok = resp.status_code in (200, 204)
            if not ok:
                logger.warning(
                    "supabase profiles patch failed "
                    "user_id={} status={} body={}",
                    supabase_user_id,
                    resp.status_code,
                    (resp.text or "")[:240],
                )
            return ok
        except Exception as exc:
            logger.warning(
                "supabase profiles patch error user_id={}: {}",
                supabase_user_id,
                exc,
            )
            return False


# Module-level singleton — mirrors the pattern used by DBManager.
_supabase_admin_client: Optional[SupabaseAdminClient] = None


def get_supabase_admin_client() -> SupabaseAdminClient:
    global _supabase_admin_client
    if _supabase_admin_client is None:
        _supabase_admin_client = SupabaseAdminClient()
    return _supabase_admin_client
