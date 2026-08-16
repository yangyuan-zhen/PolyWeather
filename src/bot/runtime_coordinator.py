from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime
from importlib import import_module
from typing import Any, Callable, Dict, List, Optional


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

    def loop_map(self) -> Dict[str, LoopStatus]:
        return {loop.key: loop for loop in self.loops}


class StartupCoordinator:
    """Centralized startup orchestration + diagnostics snapshot."""

    def __init__(
        self,
        bot: Any,
        config: Dict[str, Any],
    ):
        self.bot = bot
        self.config = config
        self._runtime_status = RuntimeStatus(
            started_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
            loops=[],
        )

    def get_runtime_status(self) -> RuntimeStatus:
        return self._runtime_status

    def start_all(self) -> RuntimeStatus:
        loops = [
            self._start_growth_milestone_reward_loop(),
            self._start_payment_event_loop(),
            self._start_payment_confirm_loop(),
        ]
        self._runtime_status = RuntimeStatus(
            started_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
            loops=loops,
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

    def _start_growth_milestone_reward_loop(self) -> LoopStatus:
        enabled = _env_bool("POLYWEATHER_GROWTH_REWARD_ENABLED", False)
        interval_sec = max(
            300, _env_int("POLYWEATHER_GROWTH_REWARD_CHECK_INTERVAL_SEC", 21600)
        )
        details = {
            "metric": "verified_supabase_auth_users",
            "check_interval_sec": interval_sec,
            "next_milestones": "600:+1d,750:+2d,1000+ every 100:+3d",
        }
        validation_error = None
        if enabled and (
            not str(os.getenv("SUPABASE_URL") or "").strip()
            or not str(os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
        ):
            validation_error = "missing_supabase_service_credentials"
        return self._start_with_validation(
            key="growth_milestone_reward",
            label="用户增长里程碑奖励",
            configured_enabled=enabled,
            details=details,
            validation_error=validation_error,
            starter=lambda: import_module(
                "src.bot.growth_milestone_reward_loop"
            ).start_growth_milestone_reward_loop(),
        )

    def _start_payment_confirm_loop(self) -> LoopStatus:
        enabled = _env_bool("POLYWEATHER_PAYMENT_CONFIRM_LOOP_ENABLED", True)
        interval_sec = max(
            5, _env_int("POLYWEATHER_PAYMENT_CONFIRM_LOOP_INTERVAL_SEC", 20)
        )
        idle_interval_sec = max(
            interval_sec,
            _env_int("POLYWEATHER_PAYMENT_CONFIRM_LOOP_IDLE_INTERVAL_SEC", 300),
        )
        details = {
            "interval_sec": interval_sec,
            "idle_interval_sec": idle_interval_sec,
            "idle_after_empty_cycles": max(
                1,
                _env_int("POLYWEATHER_PAYMENT_CONFIRM_LOOP_IDLE_AFTER_EMPTY_CYCLES", 3),
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

    def _start_payment_event_loop(self) -> LoopStatus:
        enabled = _env_bool("POLYWEATHER_PAYMENT_EVENT_LOOP_ENABLED", True)
        details = {
            "interval_sec": max(
                5, _env_int("POLYWEATHER_PAYMENT_EVENT_LOOP_INTERVAL_SEC", 20)
            ),
            "lookback_blocks": max(
                500,
                _env_int(
                    "POLYWEATHER_PAYMENT_EVENT_LOOP_START_LOOKBACK_BLOCKS",
                    5000,
                ),
            ),
            "step_blocks": min(
                49999,
                max(100, _env_int("POLYWEATHER_PAYMENT_EVENT_LOOP_STEP_BLOCKS", 2000)),
            ),
            "max_events": max(
                10, _env_int("POLYWEATHER_PAYMENT_EVENT_LOOP_MAX_EVENTS_PER_CYCLE", 200)
            ),
            "payment_enabled": _env_bool("POLYWEATHER_PAYMENT_ENABLED", False),
            "chain_id": _env_int("POLYWEATHER_PAYMENT_CHAIN_ID", 137),
        }
        validation_error = None
        if not bool(details["payment_enabled"]):
            validation_error = "payment_service_disabled"
        return self._start_with_validation(
            key="payment_event",
            label="支付事件监听",
            configured_enabled=enabled,
            details=details,
            validation_error=validation_error,
            starter=lambda: import_module(
                "src.payments.event_loop"
            ).start_payment_event_loop(),
        )


def render_runtime_status_html(status: RuntimeStatus) -> str:
    lines = [
        "🧭 <b>Bot 启动诊断</b>",
        f"启动时间: <code>{status.started_at}</code>",
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
