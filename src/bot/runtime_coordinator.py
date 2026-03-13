from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime
from importlib import import_module
from typing import Any, Callable, Dict, List, Optional

from src.utils.telegram_chat_ids import get_telegram_chat_ids_from_env


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except Exception:
        return default


def _parse_csv_count(raw: Optional[str]) -> int:
    if not raw:
        return 0
    return len([part for part in str(raw).split(",") if str(part).strip()])


@dataclass
class LoopStatus:
    key: str
    label: str
    configured_enabled: bool
    started: bool
    reason: str
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RuntimeStatus:
    started_at: str
    loops: List[LoopStatus]
    command_access_mode: str
    protected_commands: List[str]
    required_group_chat_id: str

    def loop_map(self) -> Dict[str, LoopStatus]:
        return {loop.key: loop for loop in self.loops}


class StartupCoordinator:
    """Centralized startup orchestration + diagnostics snapshot."""

    def __init__(
        self,
        bot: Any,
        config: Dict[str, Any],
        command_access_mode: str,
        protected_commands: List[str],
        required_group_chat_id: str,
    ):
        self.bot = bot
        self.config = config
        self.command_access_mode = command_access_mode
        self.protected_commands = protected_commands
        self.required_group_chat_id = required_group_chat_id
        self._runtime_status = RuntimeStatus(
            started_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
            loops=[],
            command_access_mode=command_access_mode,
            protected_commands=protected_commands,
            required_group_chat_id=required_group_chat_id,
        )

    def get_runtime_status(self) -> RuntimeStatus:
        return self._runtime_status

    def start_all(self) -> RuntimeStatus:
        loops = [
            self._start_trade_alert_loop(),
            self._start_polygon_wallet_loop(),
            self._start_polymarket_wallet_activity_loop(),
            self._start_weekly_reward_loop(),
            self._start_payment_confirm_loop(),
        ]
        self._runtime_status = RuntimeStatus(
            started_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
            loops=loops,
            command_access_mode=self.command_access_mode,
            protected_commands=self.protected_commands,
            required_group_chat_id=self.required_group_chat_id,
        )
        return self._runtime_status

    def _start_with_validation(
        self,
        key: str,
        label: str,
        configured_enabled: bool,
        details: Dict[str, Any],
        validation_error: Optional[str],
        starter: Callable[[], Any],
    ) -> LoopStatus:
        if not configured_enabled:
            return LoopStatus(
                key=key,
                label=label,
                configured_enabled=False,
                started=False,
                reason="disabled_by_env",
                details=details,
            )
        if validation_error:
            return LoopStatus(
                key=key,
                label=label,
                configured_enabled=True,
                started=False,
                reason=validation_error,
                details=details,
            )
        try:
            thread = starter()
        except Exception as exc:
            return LoopStatus(
                key=key,
                label=label,
                configured_enabled=True,
                started=False,
                reason=f"starter_error:{exc}",
                details=details,
            )
        started = thread is not None
        reason = "started" if started else "starter_returned_none"
        if started:
            details = {**details, "thread": getattr(thread, "name", "")}
        return LoopStatus(
            key=key,
            label=label,
            configured_enabled=True,
            started=started,
            reason=reason,
            details=details,
        )

    def _start_trade_alert_loop(self) -> LoopStatus:
        enabled = _env_bool("TELEGRAM_ALERT_PUSH_ENABLED", True)
        chat_ids = get_telegram_chat_ids_from_env()
        mispricing_only = _env_bool("TELEGRAM_ALERT_MISPRICING_ONLY", True)
        interval = (
            max(300, _env_int("TELEGRAM_ALERT_MISPRICING_INTERVAL_SEC", 7200))
            if mispricing_only
            else max(60, _env_int("TELEGRAM_ALERT_PUSH_INTERVAL_SEC", 300))
        )
        cities_count = _parse_csv_count(os.getenv("TELEGRAM_ALERT_CITIES"))
        details = {
            "mode": "mispricing-only" if mispricing_only else "full",
            "interval_sec": interval,
            "cities_count": cities_count,
            "chat_targets": len(chat_ids),
        }
        validation_error = None if chat_ids else "missing_TELEGRAM_CHAT_IDS"
        return self._start_with_validation(
            key="trade_alert_push",
            label="错价雷达推送",
            configured_enabled=enabled,
            details=details,
            validation_error=validation_error,
            starter=lambda: import_module("src.utils.telegram_push").start_trade_alert_push_loop(
                self.bot,
                self.config,
            ),
        )

    def _start_polygon_wallet_loop(self) -> LoopStatus:
        enabled = _env_bool("POLYGON_WALLET_WATCH_ENABLED", False)
        chat_ids = get_telegram_chat_ids_from_env()
        rpc_url = str(os.getenv("POLYGON_RPC_URL") or "").strip()
        wallets_count = _parse_csv_count(os.getenv("POLYGON_WALLET_WATCH_ADDRESSES"))
        poll = max(3, _env_int("POLYGON_WALLET_WATCH_INTERVAL_SEC", 8))
        details = {
            "poll_sec": poll,
            "wallets_count": wallets_count,
            "polymarket_only": _env_bool("POLYGON_WALLET_WATCH_POLYMARKET_ONLY", True),
            "chat_targets": len(chat_ids),
        }
        validation_error = None
        if not chat_ids:
            validation_error = "missing_TELEGRAM_CHAT_IDS"
        elif not rpc_url:
            validation_error = "missing_POLYGON_RPC_URL"
        elif wallets_count == 0:
            validation_error = "missing_POLYGON_WALLET_WATCH_ADDRESSES"
        return self._start_with_validation(
            key="polygon_wallet_watch",
            label="Polygon 钱包监听",
            configured_enabled=enabled,
            details=details,
            validation_error=validation_error,
            starter=lambda: import_module(
                "src.onchain.polygon_wallet_watcher"
            ).start_polygon_wallet_watch_loop(self.bot),
        )

    def _start_polymarket_wallet_activity_loop(self) -> LoopStatus:
        enabled = _env_bool("POLYMARKET_WALLET_ACTIVITY_ENABLED", False)
        chat_ids = get_telegram_chat_ids_from_env()
        users_count = _parse_csv_count(os.getenv("POLYMARKET_WALLET_ACTIVITY_USERS"))
        poll = max(5, _env_int("POLYMARKET_WALLET_ACTIVITY_INTERVAL_SEC", 20))
        details = {
            "poll_sec": poll,
            "users_count": users_count,
            "link_preview": _env_bool("POLYMARKET_WALLET_ACTIVITY_LINK_PREVIEW", True),
            "chat_targets": len(chat_ids),
        }
        validation_error = None
        if not chat_ids:
            validation_error = "missing_TELEGRAM_CHAT_IDS"
        elif users_count == 0:
            validation_error = "missing_POLYMARKET_WALLET_ACTIVITY_USERS"
        return self._start_with_validation(
            key="polymarket_wallet_activity",
            label="Polymarket 钱包异动监听",
            configured_enabled=enabled,
            details=details,
            validation_error=validation_error,
            starter=lambda: import_module(
                "src.onchain.polymarket_wallet_activity_watcher"
            ).start_polymarket_wallet_activity_loop(self.bot),
        )

    def _start_weekly_reward_loop(self) -> LoopStatus:
        enabled = _env_bool("POLYWEATHER_WEEKLY_REWARD_ENABLED", True)
        chat_ids = get_telegram_chat_ids_from_env()
        settle_weekday = min(
            7, max(1, _env_int("POLYWEATHER_WEEKLY_REWARD_SETTLE_WEEKDAY", 1))
        )
        settle_hour = min(23, max(0, _env_int("POLYWEATHER_WEEKLY_REWARD_SETTLE_HOUR", 0)))
        settle_minute = min(
            59, max(0, _env_int("POLYWEATHER_WEEKLY_REWARD_SETTLE_MINUTE", 5))
        )
        check_interval = max(
            30, _env_int("POLYWEATHER_WEEKLY_REWARD_CHECK_INTERVAL_SEC", 300)
        )
        details = {
            "timezone": str(
                os.getenv("POLYWEATHER_WEEKLY_REWARD_TIMEZONE") or "Asia/Shanghai"
            ).strip(),
            "settle_weekday": settle_weekday,
            "settle_time": f"{settle_hour:02d}:{settle_minute:02d}",
            "check_interval_sec": check_interval,
            "announce": _env_bool("POLYWEATHER_WEEKLY_REWARD_ANNOUNCE_ENABLED", True),
            "chat_targets": len(chat_ids),
        }
        announce_enabled = bool(details["announce"])
        validation_error = None
        if announce_enabled and not chat_ids:
            validation_error = "missing_TELEGRAM_CHAT_IDS"
        return self._start_with_validation(
            key="weekly_reward",
            label="周榜奖励结算",
            configured_enabled=enabled,
            details=details,
            validation_error=validation_error,
            starter=lambda: import_module("src.bot.weekly_reward_loop").start_weekly_reward_loop(
                self.bot
            ),
        )

    def _start_payment_confirm_loop(self) -> LoopStatus:
        enabled = _env_bool("POLYWEATHER_PAYMENT_CONFIRM_LOOP_ENABLED", True)
        details = {
            "interval_sec": max(
                5, _env_int("POLYWEATHER_PAYMENT_CONFIRM_LOOP_INTERVAL_SEC", 20)
            ),
            "batch_size": max(
                1, min(200, _env_int("POLYWEATHER_PAYMENT_CONFIRM_LOOP_BATCH_SIZE", 20))
            ),
            "payment_enabled": _env_bool("POLYWEATHER_PAYMENT_ENABLED", False),
            "chain_id": _env_int("POLYWEATHER_PAYMENT_CHAIN_ID", 137),
            "confirmations": max(1, _env_int("POLYWEATHER_PAYMENT_CONFIRMATIONS", 2)),
        }
        validation_error = None
        if not bool(details["payment_enabled"]):
            validation_error = "payment_service_disabled"
        return self._start_with_validation(
            key="payment_confirm",
            label="支付自动补单",
            configured_enabled=enabled,
            details=details,
            validation_error=validation_error,
            starter=lambda: import_module(
                "src.payments.confirm_loop"
            ).start_payment_confirm_loop(),
        )


def render_runtime_status_html(status: RuntimeStatus) -> str:
    lines = [
        "🧭 <b>Bot 启动诊断</b>",
        f"启动时间: <code>{status.started_at}</code>",
        "",
        f"命令准入: <code>{status.command_access_mode}</code>",
        f"受保护命令: <code>{', '.join(status.protected_commands) or '--'}</code>",
        f"目标群组: <code>{status.required_group_chat_id or '--'}</code>",
        "",
        "后台循环:",
    ]
    for loop in status.loops:
        icon = "✅" if loop.started else ("⏸" if not loop.configured_enabled else "⚠️")
        detail_str = ", ".join(f"{k}={v}" for k, v in sorted(loop.details.items()))
        lines.append(
            f"{icon} <b>{loop.label}</b> | enabled={str(loop.configured_enabled).lower()} | "
            f"started={str(loop.started).lower()} | reason=<code>{loop.reason}</code>"
        )
        if detail_str:
            lines.append(f"   <code>{detail_str}</code>")
    return "\n".join(lines)
