"""SQLAlchemy ORM models for MoreAni v2."""

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
    avatar_url = Column(String(255), nullable=True)  # 上传的头像图片路径（/api/avatars/...）
    avatar_crop = Column(Text, nullable=True)  # GIF 显示裁剪参数（JSON）
    role = Column(String(20), default='user')  # admin / user
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    ratings = relationship('Rating', back_populates='user', cascade='all, delete-orphan')
    # 删除账号时内容会先转交给执行操作的超级管理员，不能随父用户级联删除。
    content_items = relationship('ContentItem', back_populates='creator')
    statuses = relationship('UserContentStatus', back_populates='user', cascade='all, delete-orphan')


class InviteCode(Base):
    """Registration invite code."""

    __tablename__ = 'invite_codes'

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, nullable=False, index=True)
    used_by = Column(Integer, ForeignKey('users.id'), nullable=True)
    max_uses = Column(Integer, default=1)  # 可重复使用次数
    use_count = Column(Integer, default=0)  # 已使用次数
    expires_at = Column(DateTime, nullable=True)  # 有效截止时间（None=永不过期）
    created_at = Column(DateTime, default=_utcnow)


class ContentItem(Base):
    """Unified content model for anime, anime movie, movie, game, software, website, book."""

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
    ratings = relationship('Rating', back_populates='content', cascade='all, delete-orphan')
    tags = relationship('Tag', secondary='content_tags', back_populates='contents')
    statuses = relationship('UserContentStatus', back_populates='content', cascade='all, delete-orphan')

    __table_args__ = ({'comment': 'Unified content table for all content types'},)


class Tag(Base):
    """Content tag (bangumi or custom)."""

    __tablename__ = 'tags'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False, index=True)
    tag_type = Column(String(20), default='custom')  # bangumi / custom
    created_at = Column(DateTime, default=_utcnow)

    contents = relationship('ContentItem', secondary='content_tags', back_populates='tags')


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

    __table_args__ = (UniqueConstraint('user_id', 'content_id', name='uq_user_content_status'),)


class ResourceSubscription(Base):
    """A user's subscription to one Bangumi title, source, and fansub team."""

    __tablename__ = 'resource_subscriptions'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    content_id = Column(Integer, ForeignKey('content_items.id', ondelete='CASCADE'), nullable=False, index=True)
    subject_id = Column(Integer, nullable=False, index=True)
    source = Column(String(30), nullable=False, default='animegarden', index=True)
    fansub_key = Column(String(120), nullable=False)
    fansub_name = Column(String(120), nullable=False)
    fansub_id = Column(String(120), nullable=True)
    active = Column(Boolean, nullable=False, default=True, index=True)
    last_seen_created_at = Column(DateTime, nullable=True)
    last_seen_resource_key = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    __table_args__ = (
        UniqueConstraint(
            'user_id',
            'subject_id',
            'source',
            'fansub_key',
            name='uq_resource_subscription_target',
        ),
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


class Notification(Base):
    """Public announcement or private user notification."""

    __tablename__ = 'notifications'

    id = Column(Integer, primary_key=True, index=True)
    scope = Column(String(20), nullable=False, index=True)  # public / private
    recipient_user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=True, index=True)
    kind = Column(String(30), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=False, default='')
    payload_json = Column(Text, nullable=False, default='{}')
    created_by = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    is_published = Column(Boolean, nullable=False, default=True, index=True)
    published_at = Column(DateTime, nullable=True, index=True)
    expires_at = Column(DateTime, nullable=True, index=True)
    dedupe_key = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=_utcnow, index=True)

    __table_args__ = (UniqueConstraint('recipient_user_id', 'dedupe_key', name='uq_notification_recipient_dedupe'),)


class NotificationRead(Base):
    """Per-user read receipt for public and private notifications."""

    __tablename__ = 'notification_reads'

    id = Column(Integer, primary_key=True, index=True)
    notification_id = Column(
        Integer,
        ForeignKey('notifications.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    read_at = Column(DateTime, default=_utcnow, nullable=False)

    __table_args__ = (UniqueConstraint('notification_id', 'user_id', name='uq_notification_read'),)


class AiringCalendarItem(Base):
    """A Bangumi weekly anime calendar item persisted by the daily sync."""

    __tablename__ = 'airing_calendar_items'

    id = Column(Integer, primary_key=True, index=True)
    subject_id = Column(Integer, nullable=False, index=True)
    weekday = Column(Integer, nullable=False, index=True)  # 1=Monday ... 7=Sunday
    title = Column(String(200), nullable=False)
    title_alt = Column(String(200), nullable=True, default='')
    cover_url = Column(String(500), nullable=True, default='')
    bangumi_url = Column(String(500), nullable=False)
    active = Column(Boolean, nullable=False, default=True, index=True)
    last_seen_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    __table_args__ = (UniqueConstraint('subject_id', 'weekday', name='uq_airing_calendar_subject_weekday'),)


class AiringCalendarSyncState(Base):
    """Singleton status row for the daily Bangumi calendar sync."""

    __tablename__ = 'airing_calendar_sync_state'

    id = Column(Integer, primary_key=True)
    last_attempt_at = Column(DateTime, nullable=True)
    last_success_at = Column(DateTime, nullable=True)
    status = Column(String(20), nullable=False, default='pending')  # success/failed/pending
    error_message = Column(Text, nullable=True)
    item_count = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class CoverAsset(Base):
    """A cached cover asset keyed by its upstream Bangumi subject."""

    __tablename__ = 'cover_assets'

    id = Column(Integer, primary_key=True, index=True)
    source_type = Column(String(20), nullable=False, default='bangumi', index=True)
    source_id = Column(String(50), nullable=False, index=True)
    source_url = Column(String(500), nullable=False, default='')
    local_path = Column(String(500), nullable=True)
    source_version = Column(String(16), nullable=False, default='')
    content_hash = Column(String(64), nullable=True)
    mime_type = Column(String(100), nullable=True)
    byte_size = Column(Integer, nullable=False, default=0)
    status = Column(String(20), nullable=False, default='failed', index=True)  # ready/failed
    failure_count = Column(Integer, nullable=False, default=0)
    last_attempt_at = Column(DateTime, nullable=True)
    last_success_at = Column(DateTime, nullable=True)
    last_seen_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    __table_args__ = (UniqueConstraint('source_type', 'source_id', name='uq_cover_asset_source'),)
