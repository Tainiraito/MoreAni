"""Persisted weekly anime airing calendar APIs."""

import hashlib
import json

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from deps import get_db
from schemas import AiringCalendarWeekResponse
from services import airing_calendar

router = APIRouter(prefix='/airing', tags=['airing'])


@router.get('/week', response_model=AiringCalendarWeekResponse)
def get_airing_week(request: Request, db: Session = Depends(get_db)) -> Response:
    """Return the locally persisted current-week Bangumi calendar."""
    response_model = AiringCalendarWeekResponse(**airing_calendar.get_week(db))
    payload = response_model.model_dump(mode='json')
    digest = hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8'),
    ).hexdigest()[:16]
    etag = f'"{digest}"'
    headers = {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
        'ETag': etag,
    }
    if request.headers.get('if-none-match') == etag:
        return Response(status_code=304, headers=headers)
    return JSONResponse(content=payload, headers=headers)
