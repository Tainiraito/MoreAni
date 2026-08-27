"""Rating service — CRUD, stats, recent activity for MoreAni v2."""

from datetime import UTC, datetime

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from models import ContentItem, Rating, User
from services.avatar import avatar_fields


def get_user_rating(db: Session, user_id: int, content_id: int) -> Rating | None:
    """Get a specific user's rating for a content item."""
    return db.query(Rating).filter(Rating.user_id == user_id, Rating.content_id == content_id).first()


def _bump_content_updated_at(db: Session, content_id: int) -> None:
    """Touch the content's updated_at so it sorts to top of updated_desc."""
    content = db.query(ContentItem).filter(ContentItem.id == content_id).first()
    if content:
        content.updated_at = datetime.now(UTC)


def upsert_rating(
    db: Session,
    *,
    user_id: int,
    content_id: int,
    score: int,
    recommend: int = 0,
    review: str = '',
) -> Rating:
    """Create or update a rating (upsert on unique constraint).

    If user already rated this content, update the existing rating.
    Also bumps the parent content's updated_at so it sorts to top.
    """
    existing = get_user_rating(db, user_id, content_id)
    if existing:
        existing.score = score
        existing.recommend = recommend
        existing.review = review
        _bump_content_updated_at(db, content_id)
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
    _bump_content_updated_at(db, content_id)
    db.commit()
    db.refresh(rating)
    return rating


def delete_rating(db: Session, rating: Rating) -> None:
    """Delete a rating."""
    db.delete(rating)
    db.commit()


def get_rating_stats(db: Session, content_id: int) -> dict:
    """Calculate rating statistics for a content item.

    Returns dict with avg_score, avg_recommend, rating_count, review_count, and activity_count.
    score=0 means 'no rating' — excluded from average.
    """
    return get_rating_stats_map(db, [content_id]).get(
        content_id,
        {
            'avg_score': None,
            'avg_recommend': None,
            'rating_count': 0,
            'review_count': 0,
            'activity_count': 0,
        },
    )


def get_rating_stats_map(db: Session, content_ids: list[int]) -> dict[int, dict]:
    """批量计算内容评分统计，返回 content_id -> stats。"""
    if not content_ids:
        return {}

    activity_condition = (Rating.score > 0) | (
        Rating.review.isnot(None) & (Rating.review != '')
    )
    rows = (
        db.query(
            Rating.content_id,
            func.avg(case((Rating.score > 0, Rating.score))).label('avg_score'),
            func.avg(case((Rating.score > 0, Rating.recommend))).label('avg_recommend'),
            func.count(case((Rating.score > 0, Rating.id))).label('rating_count'),
            func.count(
                case(
                    (
                        Rating.review.isnot(None) & (Rating.review != ''),
                        Rating.id,
                    )
                )
            ).label('review_count'),
            func.count(case((activity_condition, Rating.id))).label('activity_count'),
        )
        .filter(Rating.content_id.in_(content_ids))
        .group_by(Rating.content_id)
        .all()
    )
    return {
        row.content_id: {
            'avg_score': round(float(row.avg_score), 1) if row.avg_score else None,
            'avg_recommend': round(float(row.avg_recommend), 1) if row.avg_recommend else None,
            'rating_count': row.rating_count or 0,
            'review_count': row.review_count or 0,
            'activity_count': row.activity_count or 0,
        }
        for row in rows
    }


def get_user_ratings_map(
    db: Session,
    user_id: int | None,
    content_ids: list[int],
) -> dict[int, Rating]:
    """批量返回当前用户在指定内容上的评分记录。"""
    if user_id is None or not content_ids:
        return {}
    ratings = db.query(Rating).filter(Rating.user_id == user_id, Rating.content_id.in_(content_ids)).all()
    return {rating.content_id: rating for rating in ratings}


def get_recent_reviews_map(
    db: Session,
    content_ids: list[int],
    limit: int = 3,
) -> dict[int, list[dict]]:
    """Get recent N rating/review activities for each content id (batch query, avoids N+1).

    Returns {content_id: [ {nickname, avatar_id, score, review, created_at}, ... ]}
    """
    if not content_ids:
        return {}

    rows = (
        db.query(Rating, User)
        .join(User, Rating.user_id == User.id)
        .filter(
            Rating.content_id.in_(content_ids),
            (Rating.score > 0)
            | (Rating.review.isnot(None) & (Rating.review != '')),
        )
        .order_by(Rating.updated_at.desc())
        .all()
    )

    result: dict[int, list[dict]] = {}
    for rating, user in rows:
        lst = result.setdefault(rating.content_id, [])
        if len(lst) >= limit:
            continue
        lst.append(
            {
                'nickname': user.nickname,
                **avatar_fields(user),
                'score': rating.score,
                'review': rating.review,
                'created_at': rating.created_at,
            }
        )
    return result


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
        items.append(
            {
                'rating_id': rating.id,
                'content_id': content.id,
                'content_title': content.title,
                'content_cover': content.cover_url,
                'content_type': content.content_type,
                'score': rating.score,
                'recommend': rating.recommend,
                'review': rating.review,
                'username': '匿名用户' if guest_mode else user.username,
                'nickname': '匿名用户' if guest_mode else user.nickname,
                **avatar_fields(user, anonymous=guest_mode),
                'created_at': rating.created_at,
            }
        )

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
        items.append(
            {
                'id': rating.id,
                'content_id': content.id,
                'user_id': user_id,
                'score': rating.score,
                'recommend': rating.recommend,
                'review': rating.review,
                'created_at': rating.created_at,
                'updated_at': rating.updated_at,
                'content_title': content.title,
                'content_cover': content.cover_url,
                'content_type': content.content_type,
            }
        )

    return items, total


def get_content_ratings(
    db: Session,
    content_id: int,
    *,
    page: int = 1,
    size: int = 20,
) -> tuple[list[dict], int]:
    """Get all ratings for a specific content item."""
    query = (
        db.query(Rating, User)
        .join(User, Rating.user_id == User.id)
        .filter(
            Rating.content_id == content_id,
            # 有评分或写了评论都展示（score=0 的只评论用户不被过滤掉）
            (Rating.score > 0) | (Rating.review.isnot(None) & (Rating.review != '')),
        )
        .order_by(Rating.created_at.desc())
    )

    total = query.count()
    rows = query.offset((page - 1) * size).limit(size).all()

    items = []
    for rating, user in rows:
        items.append(
            {
                'id': rating.id,
                'content_id': content_id,
                'user_id': rating.user_id,
                'username': user.username,
                'nickname': user.nickname,
                **avatar_fields(user),
                'score': rating.score,
                'recommend': rating.recommend,
                'review': rating.review,
                'created_at': rating.created_at,
            }
        )

    return items, total
