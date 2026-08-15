"""Rating router — create/upsert, delete, recent activity, history, content ratings."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from deps import get_current_user, get_db
from models import Rating, User
from schemas import RatingCreate, RatingResponse, RatingHistoryResponse
from services import rating as rating_svc

router = APIRouter(prefix="/rating", tags=["rating"])


@router.post("", response_model=RatingResponse)
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
        score=rating.score,
        recommend=rating.recommend,
        review=rating.review,
        created_at=rating.created_at,
        updated_at=rating.updated_at,
    )


@router.delete("/{rating_id}", status_code=204)
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
        raise HTTPException(status_code=404, detail="Rating not found")
    if rating.user_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="No permission to delete this rating")

    rating_svc.delete_rating(db, rating)


@router.get("/recent")
def get_recent_activity(
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> dict:
    """Get recent rating activity across all content.

    Anonymous for guests (no username).
    """
    items, total = rating_svc.get_recent_activity(db, page=page, size=size, guest_mode=False)
    return {"items": items, "total": total}


@router.get("/history", response_model=RatingHistoryResponse)
def get_my_history(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> RatingHistoryResponse:
    """Get current user's rating history."""
    items, total = rating_svc.get_user_ratings(db, user.id, page=page, size=size)
    return RatingHistoryResponse(items=items, total=total)


@router.get("/content/{content_id}")
def get_content_ratings(
    content_id: int,
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> dict:
    """Get all ratings for a specific content item."""
    items, total = rating_svc.get_content_ratings(db, content_id, page=page, size=size)
    return {"items": items, "total": total}
