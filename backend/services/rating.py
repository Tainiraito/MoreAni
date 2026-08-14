"""Rating service — business logic for ratings."""

from sqlalchemy.orm import Session

from models import Rating


def get_user_rating(db: Session, content_id: int, user_id: int) -> Rating | None:
    """Get a user's rating for specific content."""
    return db.query(Rating).filter(
        Rating.content_id == content_id,
        Rating.user_id == user_id,
    ).first()


def upsert_rating(db: Session, content_id: int, user_id: int, score: int, recommend: int, review: str = "") -> Rating:
    """Create or update a rating."""
    existing = get_user_rating(db, content_id, user_id)
    if existing:
        existing.score = score
        existing.recommend = recommend
        existing.review = review
    else:
        existing = Rating(
            content_id=content_id,
            user_id=user_id,
            score=score,
            recommend=recommend,
            review=review,
        )
        db.add(existing)

    db.commit()
    db.refresh(existing)
    return existing


def get_recent_ratings(db: Session, limit: int = 10) -> list[Rating]:
    """Get recent ratings across all content."""
    return db.query(Rating).order_by(Rating.created_at.desc()).limit(limit).all()
