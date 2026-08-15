"""SQLAlchemy ORM models for MoreAni v2.

All tables: User, InviteCode, ContentItem, Tag, ContentTag,
Rating, UserContentStatus, ShareLink.
"""

from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from database import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    """System user (admin or regular user)."""

    __tablename__ = 'users'

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    nickname = Column(String(50), unique=True, nullable=False, index=True)  # display name, unique
    password_hash = Column(String(128), nullable=False)
    avatar_id = Column(Integer, default=0)
    role = Column(String(20), default='user')  # admin / user
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    ratings = relationship(
        'Rating', back_populates='user', cascade='all, delete-orphan'
    )
    content_items = relationship(
        'ContentItem', back_populates='creator', cascade='all, delete-orphan'
    )
    statuses = relationship(
        'UserContentStatus', back_populates='user', cascade='all, delete-orphan'
    )


class InviteCode(Base):
    """Registration invite code."""

    __tablename__ = 'invite_codes'

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, nullable=False, index=True)
    used_by = Column(Integer, ForeignKey('users.id'), nullable=True)
    max_uses = Column(Integer, default=1)  # 可重复使用次数
    use_count = Column(Integer, default=0)  # 已使用次数
    created_at = Column(DateTime, default=_utcnow)


class ContentItem(Base):
    """Unified content model for anime, movie, game, software, website, book."""

    __tablename__ = 'content_items'

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    title_alt = Column(String(200), default='')
    cover_url = Column(String(500), default='')
    description = Column(Text, default='')
    content_type = Column(String(20), nullable=False, index=True)
    episodes = Column(Integer, default=0)
    status = Column(String(20), default='')  # airing/finished/upcoming
    release_date = Column(String(20), default='')
    platform = Column(String(50), default='')
    source_type = Column(String(20), default='manual')  # bangumi/manual
    source_id = Column(String(50), default='', index=True)
    source_url = Column(String(500), default='')
    content_metadata = Column('metadata', Text, default='{}')
    is_public = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey('users.id'))
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    deleted_at = Column(DateTime, nullable=True, index=True)  # soft delete

    creator = relationship('User', back_populates='content_items')
    ratings = relationship(
        'Rating', back_populates='content', cascade='all, delete-orphan'
    )
    tags = relationship('Tag', secondary='content_tags', back_populates='contents')
    statuses = relationship(
        'UserContentStatus', back_populates='content', cascade='all, delete-orphan'
    )

    __table_args__ = ({'comment': 'Unified content table for all content types'},)


class Tag(Base):
    """Content tag (bangumi or custom)."""

    __tablename__ = 'tags'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False, index=True)
    tag_type = Column(String(20), default='custom')  # bangumi / custom
    created_at = Column(DateTime, default=_utcnow)

    contents = relationship(
        'ContentItem', secondary='content_tags', back_populates='tags'
    )


class ContentTag(Base):
    """Association table for content <-> tag."""

    __tablename__ = 'content_tags'

    content_id = Column(
        Integer,
        ForeignKey('content_items.id', ondelete='CASCADE'),
        primary_key=True,
    )
    tag_id = Column(
        Integer,
        ForeignKey('tags.id', ondelete='CASCADE'),
        primary_key=True,
    )


class Rating(Base):
    """User rating for a content item (0-100 scale)."""

    __tablename__ = 'ratings'

    id = Column(Integer, primary_key=True, index=True)
    content_id = Column(
        Integer,
        ForeignKey('content_items.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    user_id = Column(
        Integer,
        ForeignKey('users.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    score = Column(Integer, nullable=False, default=0)  # 0-100
    recommend = Column(Integer, nullable=False, default=0)  # 0-100
    review = Column(Text, default='')
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    content = relationship('ContentItem', back_populates='ratings')
    user = relationship('User', back_populates='ratings')

    __table_args__ = (
        UniqueConstraint('content_id', 'user_id', name='uq_content_user'),
        {'comment': 'Per-user rating for a content item'},
    )


class UserContentStatus(Base):
    """Per-user watch status for a content item."""

    __tablename__ = 'user_content_status'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey('users.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    content_id = Column(
        Integer,
        ForeignKey('content_items.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    status = Column(String(20), nullable=False)  # want/watching/watched/dropped
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    user = relationship('User', back_populates='statuses')
    content = relationship('ContentItem', back_populates='statuses')

    __table_args__ = (
        UniqueConstraint('user_id', 'content_id', name='uq_user_content_status'),
    )


class ShareLink(Base):
    """Share link token for guest access."""

    __tablename__ = 'share_links'

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(32), unique=True, nullable=False, index=True)
    created_by = Column(Integer, ForeignKey('users.id'))
    expires_at = Column(DateTime, nullable=True)
    view_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=_utcnow)
