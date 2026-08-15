"""Rating service — CRUD, stats, recent activity for MoreAni v2."""

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import ContentItem, Rating, User


def get_user_rating(db: Session, user_id: int, content_id: int) -> Rating | None:
    """Get a specific user's rating for a content item."""
    return (
        db.query(Rating)
        .filter(Rating.user_id == user_id, Rating.content_id == content_id)
        .first()
    )


def upsert_rating(
    db: Session,
    *,
    user_id: int,
    content_id: int,
    score: int,
    recommend: int = 0,
    review: str = "",
) -> Rating:
    """Create or update a rating (upsert on unique constraint).

    If user already rated this content, update the existing rating.
    """
    existing = get_user_rating(db, user_id, content_id)
    if existing:
        existing.score = score
        existing.recommend = recommend
        existing.review = review
        db.commit()
        db.refresh(existing)
        return existing

    rating = Rating(
        user_id=user_id,
        content_id=content_id,
        score=score,
        recommend=recommend,
        review=review,
    )
    db.add(rating)
    db.commit()
    db.refresh(rating)
    return rating


def delete_rating(db: Session, rating: Rating) -> None:
    """Delete a rating."""
    db.delete(rating)
    db.commit()


def get_rating_stats(db: Session, content_id: int) -> dict:
    """Calculate rating statistics for a content item.

    Returns dict with avg_score, avg_recommend, rating_count.
    score=0 means 'no rating' — excluded from average.
    """
    stats = (
        db.query(
            func.avg(Rating.score).label("avg_score"),
            func.avg(Rating.recommend).label("avg_recommend"),
            func.count(Rating.id).label("rating_count"),
        )
        .filter(Rating.content_id == content_id, Rating.score > 0)
        .first()
    )

    avg_score = round(float(stats[0]), 1) if stats[0] else None
    avg_recommend = round(float(stats[1]), 1) if stats[1] else None
    rating_count = stats[2] or 0

    return {
        "avg_score": avg_score,
        "avg_recommend": avg_recommend,
        "rating_count": rating_count,
    }


def get_recent_activity(
    db: Session,
    *,
    page: int = 1,
    size: int = 20,
    guest_mode: bool = False,
) -> tuple[list[dict], int]:
    """Get recent rating activity across all content.

    Returns list of dicts with rating + user + content info.
    In guest_mode, username/avatar are hidden.
    """
    query = (
        db.query(Rating, User, ContentItem)
        .join(User, Rating.user_id == User.id)
        .join(ContentItem, Rating.content_id == ContentItem.id)
        .order_by(Rating.updated_at.desc())
    )

    total = query.count()
    rows = query.offset((page - 1) * size).limit(size).all()

    items = []
    for rating, user, content in rows:
        items.append({
            "rating_id": rating.id,
            "content_id": content.id,
            "content_title": content.title,
            "content_cover": content.cover_url,
            "content_type": content.content_type,
            "score": rating.score,
            "recommend": rating.recommend,
            "review": rating.review,
            "username": "匿名用户" if guest_mode else user.username,
            "avatar_id": 0 if guest_mode else user.avatar_id,
            "created_at": rating.created_at,
        })

    return items, total


def get_user_ratings(
    db: Session,
    user_id: int,
    *,
    page: int = 1,
    size: int = 20,
) -> tuple[list[dict], int]:
    """Get all ratings by a specific user."""
    query = (
        db.query(Rating, ContentItem)
        .join(ContentItem, Rating.content_id == ContentItem.id)
        .filter(Rating.user_id == user_id)
        .order_by(Rating.created_at.desc())
    )

    total = query.count()
    rows = query.offset((page - 1) * size).limit(size).all()

    items = []
    for rating, content in rows:
        items.append({
            "id": rating.id,
            "content_id": content.id,
            "user_id": user_id,
            "score": rating.score,
            "recommend": rating.recommend,
            "review": rating.review,
            "created_at": rating.created_at,
            "updated_at": rating.updated_at,
            "content_title": content.title,
            "content_cover": content.cover_url,
            "content_type": content.content_type,
        })

    return items, total
