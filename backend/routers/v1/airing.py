"""Persisted weekly anime airing calendar APIs."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from deps import get_db
from schemas import AiringCalendarWeekResponse
from services import airing_calendar

router = APIRouter(prefix='/airing', tags=['airing'])


@router.get('/week', response_model=AiringCalendarWeekResponse)
def get_airing_week(db: Session = Depends(get_db)) -> AiringCalendarWeekResponse:
    """Return the locally persisted current-week Bangumi calendar."""
    return AiringCalendarWeekResponse(**airing_calendar.get_week(db))
