"""Operations/admin API service functions.

This module is a backward-compatible re-export hub.  Domain logic lives in
the `web.services.ops` sub-package:

  ops/users.py     — users, points, feedback, analytics, leaderboard
  ops/payments.py  — payment incidents, billing risk, memberships
  ops/health.py    — health check, source health, training accuracy, truth
  ops/config.py    — config, subscriptions, logs, telegram audit
"""

from __future__ import annotations

# Backward-compat: tests monkeypatch ops_api._requests, ops_api.legacy_routes,
# ops_api.DBManager and other module-level symbols.
import requests as _requests  # noqa: F401
import web.routes as legacy_routes  # noqa: F401
from src.database.db_manager import DBManager  # noqa: F401
from src.database.runtime_state import ObservationCollectorStatusRepository  # noqa: F401

# Backward-compat: internal helpers referenced by tests
from web.services.ops.config import _lookup_supabase_user_id_by_email  # noqa: F401
from web.services.ops.payments import _list_active_subscriptions_with_windows  # noqa: F401


def _require_ops(request):
    return legacy_routes._require_ops_admin(request)

# ---------------------------------------------------------------------------
# Users / Points / Feedback / Analytics
# ---------------------------------------------------------------------------
from web.services.ops.users import (  # noqa: E402, F401
    get_ops_analytics_funnel,
    get_ops_weekly_leaderboard,
    grant_ops_feedback_reward,
    grant_ops_points,
    list_ops_audit_log,
    list_ops_feedback,
    search_ops_users,
    transfer_ops_points,
    update_ops_feedback_status,
)

# ---------------------------------------------------------------------------
# Payments / Billing / Memberships
# ---------------------------------------------------------------------------
from web.services.ops.payments import (  # noqa: E402, F401
    create_ops_refund_case,
    get_ops_billing_risk,
    get_ops_memberships_growth,
    get_ops_memberships_overview,
    list_ops_refund_cases,
    list_ops_memberships,
    list_ops_payment_incidents,
    list_ops_payments,
    resolve_ops_payment_incident,
    update_ops_refund_case,
)

# ---------------------------------------------------------------------------
# Health / Source Health / Training / Truth
# ---------------------------------------------------------------------------
from web.services.ops.health import (  # noqa: E402, F401
    _build_training_accuracy_payload,
    get_ops_health_check,
    get_ops_observation_collector_status,
    get_ops_source_health,
    get_ops_training_accuracy,
    get_ops_truth_history,
)

# ---------------------------------------------------------------------------
# Internal market opportunities
# ---------------------------------------------------------------------------
from web.services.ops.market_opportunities import (  # noqa: E402, F401
    get_ops_market_opportunities,
)

# ---------------------------------------------------------------------------
# Config / Subscriptions / Logs / Telegram
# ---------------------------------------------------------------------------
from web.services.ops.config import (  # noqa: E402, F401
    _supabase_rest_rows,
    extend_ops_subscription,
    get_ops_config,
    get_ops_logs,
    get_ops_sensitive_config,
    get_ops_telegram_audit,
    get_ops_user_subscriptions,
    grant_ops_subscription,
    update_ops_config,
    update_ops_sensitive_config,
)
