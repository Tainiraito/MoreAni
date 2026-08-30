"""Rating service — CRUD, stats, recent activity for MoreAni v2."""

import json
import logging
from datetime import UTC, datetime

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from models import ContentItem, Notification, Rating, User, UserContentStatus
from services import covers
from services.avatar import avatar_fields

logger = logging.getLogger(__name__)


def get_user_rating(db: Session, user_id: int, content_id: int) -> Rating | None:
    """Get a specific user's rating for a content item."""
    return db.query(Rating).filter(Rating.user_id == user_id, Rating.content_id == content_id).first()


def _bump_content_updated_at(db: Session, content_id: int) -> None:
    """Touch the content's updated_at so it sorts to top of updated_desc."""
    content = db.query(ContentItem).filter(ContentItem.id == content_id).first()
    if content:
        content.updated_at = datetime.now(UTC)


def _has_activity(score: int, review: str | None) -> bool:
    """Return whether a rating contains a score or non-empty review."""
    return score > 0 or bool((review or '').strip())


def _notify_favorite_activity(db: Session, *, rating: Rating, actor_user_id: int) -> None:
    """Notify users who marked the content as wanted about its first activity."""
    try:
        content = db.query(ContentItem).filter(ContentItem.id == rating.content_id).first()
        actor = db.query(User).filter(User.id == actor_user_id).first()
        if content is None or actor is None:
            return

        recipient_rows = (
            db.query(UserContentStatus.user_id)
            .filter(
                UserContentStatus.content_id == rating.content_id,
                UserContentStatus.status == 'want',
                UserContentStatus.user_id != actor_user_id,
            )
            .distinct()
            .all()
        )
        if not recipient_rows:
            return

        activity_types: list[str] = []
        if rating.score > 0:
            activity_types.append(f'评分 {(rating.score / 10):.1f}')
        if (rating.review or '').strip():
            activity_types.append('评论')
        activity_label = '、'.join(activity_types)
        payload = {
            'content_id': rating.content_id,
            'rating_id': rating.id,
            'actor_user_id': actor_user_id,
            'actor_nickname': actor.nickname,
            'has_score': rating.score > 0,
            'has_review': bool((rating.review or '').strip()),
        }
        dedupe_key = f'content_activity:{rating.id}'

        for (recipient_user_id,) in recipient_rows:
            existing = (
                db.query(Notification)
                .filter(
                    Notification.recipient_user_id == recipient_user_id,
                    Notification.dedupe_key == dedupe_key,
                )
                .first()
            )
            if existing:
                continue
            db.add(
                Notification(
                    scope='private',
                    recipient_user_id=recipient_user_id,
                    kind='content_activity',
                    title=f'《{content.title}》有新的动态',
                    body=f'{actor.nickname} 对《{content.title}》进行了{activity_label}',
                    payload_json=json.dumps(payload, ensure_ascii=False),
                    created_by=actor_user_id,
                    is_published=True,
                    published_at=datetime.now(UTC).replace(tzinfo=None),
                    dedupe_key=dedupe_key,
                )
            )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception('Failed to create content activity notifications for rating %s', rating.id)


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
    was_active = existing is not None and _has_activity(existing.score, existing.review)
    if existing:
        existing.score = score
        existing.recommend = recommend
        existing.review = review
        _bump_content_updated_at(db, content_id)
        db.commit()
        db.refresh(existing)
        rating = existing
    else:
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

    if not was_active and _has_activity(rating.score, rating.review):
        _notify_favorite_activity(db, rating=rating, actor_user_id=user_id)
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

    activity_condition = (Rating.score > 0) | (Rating.review.isnot(None) & (Rating.review != ''))
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
            (Rating.score > 0) | (Rating.review.isnot(None) & (Rating.review != '')),
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
    cover_urls = covers.get_content_cover_url_map(db, [content for _, _, content in rows])

    items = []
    for rating, user, content in rows:
        items.append(
            {
                'rating_id': rating.id,
                'content_id': content.id,
                'content_title': content.title,
                'content_cover': cover_urls.get(content.id),
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
    cover_urls = covers.get_content_cover_url_map(db, [content for _, content in rows])

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
                'content_cover': cover_urls.get(content.id),
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
