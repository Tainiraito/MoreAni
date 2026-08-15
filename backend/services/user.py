"""User service — profile, avatar update for MoreAni v2."""

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import ContentItem, Rating, User


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
