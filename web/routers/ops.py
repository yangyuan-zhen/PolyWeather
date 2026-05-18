"""Operations/admin API routes."""

from fastapi import APIRouter, Request

from web.core import GrantPointsRequest
from web.services.ops_api import (
    extend_ops_subscription,
    get_ops_analytics_funnel,
    get_ops_config,
    get_ops_logs,
    get_ops_truth_history,
    get_ops_weekly_leaderboard,
    grant_ops_points,
    grant_ops_subscription,
    list_ops_memberships,
    list_ops_payment_incidents,
    resolve_ops_payment_incident,
    search_ops_users,
    update_ops_config,
)

router = APIRouter(tags=["ops"])


@router.get("/api/ops/users")
async def ops_search_users(request: Request, q: str = "", limit: int = 20):
    return search_ops_users(request, q=q, limit=limit)


@router.get("/api/ops/leaderboard/weekly")
async def ops_weekly_leaderboard(request: Request, limit: int = 20):
    return get_ops_weekly_leaderboard(request, limit=limit)


@router.get("/api/ops/memberships")
async def ops_memberships(request: Request, limit: int = 200):
    return list_ops_memberships(request, limit=limit)


@router.get("/api/ops/payments/incidents")
async def ops_payment_incidents(
    request: Request,
    limit: int = 50,
    reason: str = "",
    include_resolved: bool = False,
):
    return list_ops_payment_incidents(
        request,
        limit=limit,
        reason=reason,
        include_resolved=include_resolved,
    )


@router.post("/api/ops/payments/incidents/{event_id}/resolve")
async def ops_resolve_payment_incident(request: Request, event_id: int):
    return resolve_ops_payment_incident(request, event_id)


@router.post("/api/ops/users/grant-points")
async def ops_grant_points(request: Request, body: GrantPointsRequest):
    return grant_ops_points(request, body)


@router.get("/api/ops/analytics/funnel")
async def ops_analytics_funnel(request: Request, days: int = 30):
    return get_ops_analytics_funnel(request, days=days)


@router.get("/api/ops/truth-history")
async def ops_truth_history(
    request: Request,
    city: str = "",
    date_from: str = "",
    date_to: str = "",
    limit: int = 200,
):
    return get_ops_truth_history(
        request,
        city=city,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
    )


# ── Config ──────────────────────────────────────────────────────────

@router.get("/api/ops/config")
async def ops_config(request: Request):
    return get_ops_config(request)


@router.put("/api/ops/config")
async def ops_update_config(request: Request):
    import json as _json
    body_bytes = await request.body()
    body = _json.loads(body_bytes.decode("utf-8"))
    key = str(body.get("key") or "").strip()
    value = str(body.get("value") or "")
    if not key:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="key is required")
    return update_ops_config(request, key, value)


# ── Subscriptions ───────────────────────────────────────────────────

@router.post("/api/ops/subscriptions/grant")
async def ops_subscription_grant(request: Request):
    import json as _json
    body_bytes = await request.body()
    body = _json.loads(body_bytes.decode("utf-8"))
    email = str(body.get("email") or "").strip()
    plan_code = str(body.get("plan_code") or "pro_monthly").strip()
    days = int(body.get("days") or 30)
    return grant_ops_subscription(request, email=email, plan_code=plan_code, days=days)


@router.post("/api/ops/subscriptions/extend")
async def ops_subscription_extend(request: Request):
    import json as _json
    body_bytes = await request.body()
    body = _json.loads(body_bytes.decode("utf-8"))
    email = str(body.get("email") or "").strip()
    days = int(body.get("additional_days") or 30)
    return extend_ops_subscription(request, email=email, additional_days=days)


# ── Logs ────────────────────────────────────────────────────────────

@router.get("/api/ops/logs")
async def ops_logs(
    request: Request,
    level: str = "",
    lines: int = 100,
):
    return get_ops_logs(request, level=level, lines=lines)
