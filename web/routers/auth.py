"""Authentication API routes."""

from fastapi import APIRouter, Request, Response

from web.services.auth_api import get_auth_me_payload

router = APIRouter(tags=["auth"])


@router.get("/api/auth/me")
async def auth_me(request: Request, response: Response):
    payload = get_auth_me_payload(request)
    server_timing = str(
        getattr(request.state, "auth_me_server_timing", "") or ""
    ).strip()
    if server_timing:
        response.headers["Server-Timing"] = server_timing
    return payload
