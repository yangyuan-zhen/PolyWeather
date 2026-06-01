"""User feedback API routes."""

from fastapi import APIRouter, Request

from web.core import UserFeedbackRequest
from web.services.feedback_api import submit_user_feedback

router = APIRouter(tags=["feedback"])


@router.post("/api/feedback")
async def feedback_submit(request: Request, body: UserFeedbackRequest):
    return submit_user_feedback(request, body)
