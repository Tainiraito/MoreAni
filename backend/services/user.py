"""User service — profile, avatar update for MoreAni v2."""

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import ContentItem, Rating, User


def get_user_by_id(db: Session, user_id: int) -> User | None:
    """Get a user by ID."""
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_username(db: Session, username: str) -> User | None:
    """Get a user by username."""
    return db.query(User).filter(User.username == username).first()


def create_user(
    db: Session,
    *,
    username: str,
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
        password_hash=password_hash,
        avatar_id=avatar_id,
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def update_avatar(db: Session, user: User, avatar_id: int) -> User:
    """Update user's avatar."""
    user.avatar_id = avatar_id
    db.commit()
    db.refresh(user)
    return user


def update_password(db: Session, user: User, new_hash: str) -> User:
    """Update user's password hash."""
    user.password_hash = new_hash
    db.commit()
    db.refresh(user)
    return user


def get_user_stats(db: Session, user_id: int) -> dict:
    """Get user stats: rating_count, content_count."""
    rating_count = (
        db.query(func.count(Rating.id)).filter(Rating.user_id == user_id).scalar()
    ) or 0

    content_count = (
        db.query(func.count(ContentItem.id))
        .filter(ContentItem.created_by == user_id)
        .scalar()
    ) or 0

    return {
        'rating_count': rating_count,
        'content_count': content_count,
    }
