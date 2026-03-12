from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Iterable, Set

from src.auth.supabase_entitlement import SUPABASE_ENTITLEMENT
from src.database.db_manager import DBManager


def _env_bool(name: str, default: bool = False) -> bool:
    raw = str(os.getenv(name, "")).strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


@dataclass
class EntitlementDecision:
    allowed: bool
    reason: str


class BotEntitlementService:
    """
    Payment/entitlement pre-hook for command access.

    Disabled by default. Enable with:
    POLYWEATHER_BOT_REQUIRE_ENTITLEMENT=true
    """

    def __init__(
        self,
        db: DBManager,
        enabled: bool | None = None,
        protected_commands: Iterable[str] | None = None,
    ):
        self.db = db
        self.enabled = _env_bool("POLYWEATHER_BOT_REQUIRE_ENTITLEMENT", False) if enabled is None else enabled
        self.use_supabase = _env_bool(
            "POLYWEATHER_BOT_USE_SUPABASE_ENTITLEMENT",
            SUPABASE_ENTITLEMENT.enabled,
        )
        commands = protected_commands or ("/city", "/deb")
        self.protected_commands: Set[str] = {str(c).strip().lower() for c in commands if str(c).strip()}

    def check(self, user_id: int, command_label: str) -> EntitlementDecision:
        command = str(command_label or "").strip().lower()
        if not self.enabled:
            return EntitlementDecision(True, "entitlement_disabled")
        if command not in self.protected_commands:
            return EntitlementDecision(True, "command_not_protected")

        user = self.db.get_user(user_id) or {}
        if self.use_supabase:
            supabase_user_id = str(user.get("supabase_user_id") or "").strip()
            if not supabase_user_id:
                return EntitlementDecision(False, "bind_required")
            if SUPABASE_ENTITLEMENT.has_active_subscription(supabase_user_id):
                return EntitlementDecision(True, "supabase_subscription_active")
            return EntitlementDecision(False, "supabase_subscription_required")

        has_premium = bool(user.get("is_web_premium") or user.get("is_group_premium"))
        if has_premium:
            return EntitlementDecision(True, "premium_user")
        return EntitlementDecision(False, "premium_required")
