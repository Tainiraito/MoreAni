"""User service — business logic for user management."""

from sqlalchemy.orm import Session

from models import User


def get_user_by_id(db: Session, user_id: int) -> User | None:
    """Get user by ID."""
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_username(db: Session, username: str) -> User | None:
    """Get user by username."""
    return db.query(User).filter(User.username == username).first()


def update_avatar(db: Session, user_id: int, avatar_id: int) -> User | None:
    """Update user avatar."""
    user = get_user_by_id(db, user_id)
    if user:
        user.avatar_id = avatar_id
        db.commit()
        db.refresh(user)
    return user
