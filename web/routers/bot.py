"""Bot-facing API routes."""

from typing import Optional

from fastapi import APIRouter, Request, Response

from web.services.bot_api import get_bot_deb_payload

router = APIRouter(tags=["bot"])


@router.get("/api/bot/deb")
async def bot_deb(request: Request, response: Response, cities: Optional[str] = None):
    payload = await get_bot_deb_payload(request, cities=cities)
    response.headers["Cache-Control"] = "private, max-age=30"
    return payload
