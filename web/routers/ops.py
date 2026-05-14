"""Operations/admin API routes."""

from fastapi import APIRouter, Request

from web.core import GrantPointsRequest
from web.services.ops_api import (
    get_ops_analytics_funnel,
    get_ops_truth_history,
    get_ops_weekly_leaderboard,
    grant_ops_points,
    list_ops_memberships,
    list_ops_payment_incidents,
    resolve_ops_payment_incident,
    search_ops_users,
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
