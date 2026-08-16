"""User service — profile, avatar update for MoreAni v2."""

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import ContentItem, Rating, User, UserContentStatus


def get_user_by_id(db: Session, user_id: int) -> User | None:
    """Get a user by ID."""
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_username(db: Session, username: str) -> User | None:
    """Get a user by username (account)."""
    return db.query(User).filter(User.username == username).first()


def get_user_by_nickname(db: Session, nickname: str) -> User | None:
    """Get a user by nickname (display name)."""
    return db.query(User).filter(User.nickname == nickname).first()


def get_user_by_login(db: Session, login: str) -> User | None:
    """Get a user by either username (account) or nickname — both are unique and can be used to log in."""
    return (
        db.query(User)
        .filter((User.username == login) | (User.nickname == login))
        .first()
    )


def create_user(
    db: Session,
    *,
    username: str,
    nickname: str,
    password_hash: str,
    avatar_id: int | None = None,
    role: str = 'user',
) -> User:
    """Create a new user.

    If avatar_id is None, randomly assigns one (0-29).
    """
    import random

    if avatar_id is None:
        avatar_id = random.randint(0, 29)

    user = User(
        username=username,
        nickname=nickname,
        password_hash=password_hash,
        avatar_id=avatar_id,
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def update_avatar(db: Session, user: User, avatar_id: int) -> User:
    """Update user's avatar.

    Re-fetches the user inside this session — the passed `user` may be bound to
    a different session (get_current_user uses its own db dependency), and
    writing a detached instance raises DetachedInstanceError.
    """
    fresh = db.query(User).filter(User.id == user.id).first()
    if fresh is None:
        raise ValueError('User not found')
    fresh.avatar_id = avatar_id
    db.commit()
    db.refresh(fresh)
    return fresh


def update_password(db: Session, user: User, new_hash: str) -> User:
    """Update user's password hash.

    Re-fetches the user inside this session — see update_avatar note.
    """
    fresh = db.query(User).filter(User.id == user.id).first()
    if fresh is None:
        raise ValueError('User not found')
    fresh.password_hash = new_hash
    db.commit()
    db.refresh(fresh)
    return fresh


def update_nickname(db: Session, user: User, nickname: str) -> User:
    """Update user's nickname (display name).

    Re-fetches the user inside this session — see update_avatar note.
    """
    fresh = db.query(User).filter(User.id == user.id).first()
    if fresh is None:
        raise ValueError('User not found')
    fresh.nickname = nickname
    db.commit()
    db.refresh(fresh)
    return fresh


def get_user_stats(db: Session, user_id: int) -> dict:
    """Get user stats: rating_count, review_count, favorite_count, avg_score, content_count."""
    rating_count = (
        db.query(func.count(Rating.id))
        .filter(Rating.user_id == user_id, Rating.score > 0)
        .scalar()
    ) or 0

    review_count = (
        db.query(func.count(Rating.id))
        .filter(
            Rating.user_id == user_id,
            Rating.review.isnot(None),
            Rating.review != '',
        )
        .scalar()
    ) or 0

    favorite_count = (
        db.query(func.count(UserContentStatus.id))
        .filter(
            UserContentStatus.user_id == user_id,
            UserContentStatus.status == 'want',
        )
        .scalar()
    ) or 0

    avg_score = (
        db.query(func.avg(Rating.score))
        .filter(Rating.user_id == user_id, Rating.score > 0)
        .scalar()
    )
    avg_score = round(float(avg_score), 1) if avg_score else None

    content_count = (
        db.query(func.count(ContentItem.id))
        .filter(ContentItem.created_by == user_id)
        .scalar()
    ) or 0

    return {
        'rating_count': rating_count,
        'review_count': review_count,
        'favorite_count': favorite_count,
        'avg_score': avg_score,
        'content_count': content_count,
    }


def get_user_activity(
    db: Session,
    user_id: int,
    page: int = 1,
    size: int = 20,
) -> tuple[list[dict], int]:
    """Get user's activity feed: ratings, reviews, favorites — sorted by time desc.

    Returns list of dicts with type/content info, and total count.
    """
    # 评分/评论（Rating 记录）
    rating_rows = (
        db.query(Rating, ContentItem)
        .join(ContentItem, Rating.content_id == ContentItem.id)
        .filter(Rating.user_id == user_id)
        .all()
    )

    # 收藏（status = want）
    status_rows = (
        db.query(UserContentStatus, ContentItem)
        .join(ContentItem, UserContentStatus.content_id == ContentItem.id)
        .filter(
            UserContentStatus.user_id == user_id,
            UserContentStatus.status == 'want',
        )
        .all()
    )

    entries: list[dict] = []
    for rating, content in rating_rows:
        has_review = bool(rating.review and rating.review.strip())
        entries.append(
            {
                'type': 'review' if has_review else 'rating',
                'content_id': content.id,
                'content_title': content.title,
                'content_cover': content.cover_url,
                'content_type': content.content_type,
                'score': rating.score,
                'review': rating.review,
                'updated_at': rating.updated_at,
            }
        )

    for status, content in status_rows:
        entries.append(
            {
                'type': 'favorite',
                'content_id': content.id,
                'content_title': content.title,
                'content_cover': content.cover_url,
                'content_type': content.content_type,
                'score': None,
                'review': '',
                'updated_at': status.updated_at,
            }
        )

    entries.sort(key=lambda e: e['updated_at'], reverse=True)
    total = len(entries)
    start = (page - 1) * size
    return entries[start:start + size], total
