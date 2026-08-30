"""Rating router — create/upsert, delete, recent activity, history, content ratings."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from deps import get_current_user, get_db
from models import Rating, User
from schemas import (
    RatingCalibrationCandidateResponse,
    RatingCalibrationSaveRequest,
    RatingCalibrationSaveResponse,
    RatingCreate,
    RatingHistoryResponse,
    RatingResponse,
    RatingRevisionListResponse,
)
from services import rating as rating_svc
from services.avatar import avatar_fields

router = APIRouter(prefix='/rating', tags=['rating'])


@router.post('', response_model=RatingResponse)
def create_or_update_rating(
    body: RatingCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RatingResponse:
    """Create or update a rating for a content item.

    同一用户对同一内容只保留一条评分（upsert）。
     score=0 means 'no rating' and won't count in averages.
    """
    rating = rating_svc.upsert_rating(
        db,
        user_id=user.id,
        content_id=body.content_id,
        score=body.score,
        recommend=body.recommend,
        review=body.review,
    )
    return RatingResponse(
        id=rating.id,
        content_id=rating.content_id,
        user_id=rating.user_id,
        username=user.username,
        nickname=user.nickname,
        **{key: value for key, value in avatar_fields(user).items() if key != 'avatar_id'},
        score=rating.score,
        recommend=rating.recommend,
        review=rating.review,
        created_at=rating.created_at,
        updated_at=rating.updated_at,
    )


@router.get('/calibration/candidates', response_model=list[RatingCalibrationCandidateResponse])
def get_calibration_candidates(
    count: int = Query(1, ge=1, le=20),
    exclude_content_id: list[int] = Query(default=[]),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[RatingCalibrationCandidateResponse]:
    """Return random positive ratings not already used in the session."""
    candidates = rating_svc.get_random_calibration_candidates(
        db,
        user.id,
        exclude_content_ids=set(exclude_content_id),
        count=count,
    )
    if not candidates:
        raise HTTPException(status_code=404, detail='没有更多可对比的评分作品')
    return [RatingCalibrationCandidateResponse(**candidate) for candidate in candidates]


@router.post('/calibration', response_model=RatingCalibrationSaveResponse)
def save_calibration(
    body: RatingCalibrationSaveRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RatingCalibrationSaveResponse:
    """Save a calibration batch atomically and record score revisions."""
    items = [(item.content_id, item.expected_score, item.new_score) for item in body.items]
    try:
        result = rating_svc.save_calibration_scores(db, user_id=user.id, items=items)
    except rating_svc.RatingCalibrationConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={'message': str(exc), 'conflicts': exc.conflicts},
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RatingCalibrationSaveResponse(**result)


@router.get('/revisions', response_model=RatingRevisionListResponse)
def get_rating_revisions(
    content_id: int | None = Query(default=None, ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> RatingRevisionListResponse:
    """Get the current user's primary-score revision history."""
    items, total = rating_svc.get_user_rating_revisions(
        db,
        user.id,
        content_id=content_id,
        page=page,
        size=size,
    )
    return RatingRevisionListResponse(items=items, total=total)


@router.delete('/{rating_id}', status_code=204)
def delete_rating(
    rating_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Delete a rating.

    Only the rating creator or admin can delete.
    """
    rating = db.query(Rating).filter(Rating.id == rating_id).first()
    if not rating:
        raise HTTPException(status_code=404, detail='Rating not found')
    if rating.user_id != user.id and user.role not in ('admin', 'super_admin'):
        raise HTTPException(status_code=403, detail='No permission to delete this rating')

    rating_svc.delete_rating(db, rating)


@router.get('/recent')
def get_recent_activity(
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> dict:
    """Get recent rating activity across all content.

    Anonymous for guests (no username).
    """
    items, total = rating_svc.get_recent_activity(db, page=page, size=size, guest_mode=False)
    return {'items': items, 'total': total}


@router.get('/history', response_model=RatingHistoryResponse)
def get_my_history(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> RatingHistoryResponse:
    """Get current user's rating history."""
    items, total = rating_svc.get_user_ratings(db, user.id, page=page, size=size)
    return RatingHistoryResponse(items=items, total=total)


@router.get('/content/{content_id}')
def get_content_ratings(
    content_id: int,
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> dict:
    """Get all ratings for a specific content item."""
    items, total = rating_svc.get_content_ratings(db, content_id, page=page, size=size)
    return {'items': items, 'total': total}
