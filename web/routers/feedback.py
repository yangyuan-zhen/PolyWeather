"""User feedback API routes."""

from fastapi import APIRouter, Request

from web.core import UserFeedbackRequest
from web.services.feedback_api import list_current_user_feedback, submit_user_feedback

router = APIRouter(tags=["feedback"])


@router.post("/api/feedback")
async def feedback_submit(request: Request, body: UserFeedbackRequest):
    return submit_user_feedback(request, body)


@router.get("/api/feedback")
async def feedback_list_current_user(request: Request, limit: int = 20):
    return list_current_user_feedback(request, limit=limit)
