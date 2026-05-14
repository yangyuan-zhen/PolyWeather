"""Analytics event API routes."""

from fastapi import APIRouter, Request

from web.core import AnalyticsEventRequest
from web.services.analytics_api import track_analytics_event

router = APIRouter(tags=["analytics"])


@router.post("/api/analytics/events")
async def analytics_track(request: Request, body: AnalyticsEventRequest):
    return track_analytics_event(request, body)
