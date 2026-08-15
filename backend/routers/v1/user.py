"""User router — public profile and rating history."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from deps import get_current_user, get_db
from models import User
from schemas import RatingResponse, UserPublicProfile
from services import rating as rating_svc
from services import user as user_svc

router = APIRouter(prefix="/user", tags=["user"])


@router.get("/{user_id}", response_model=UserPublicProfile)
def get_user_profile(
    user_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserPublicProfile:
    """Get a user's public profile."""
    target = user_svc.get_user_by_id(db, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    stats = user_svc.get_user_stats(db, user_id)
    return UserPublicProfile(
        id=target.id,
        username=target.username,
        avatar_id=target.avatar_id,
        role=target.role,
        created_at=target.created_at,
        rating_count=stats["rating_count"],
        content_count=stats["content_count"],
    )


@router.get("/{user_id}/ratings")
def get_user_ratings(
    user_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> dict:
    """Get a user's rating history."""
    target = user_svc.get_user_by_id(db, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    items, total = rating_svc.get_user_ratings(db, user_id, page=page, size=size)
    return {"items": items, "total": total}
