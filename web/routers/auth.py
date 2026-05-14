"""Authentication API routes."""

from fastapi import APIRouter, Request

from web.services.auth_api import get_auth_me_payload

router = APIRouter(tags=["auth"])


@router.get("/api/auth/me")
async def auth_me(request: Request):
    return get_auth_me_payload(request)
