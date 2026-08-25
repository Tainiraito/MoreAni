"""Resource subscriptions, notification queries, and update detection."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from database import SessionLocal
from models import ContentItem, Notification, NotificationRead, ResourceSubscription
from services import animegarden, mikan
from services import content as content_svc
from services import resources as resources_svc
from services.resource_common import db_time as _db_time
from services.resource_common import normalize_fansub_name, subject_id_for_content

logger = logging.getLogger('uvicorn')
_REFRESH_COOLDOWN_SECONDS = 60
_refresh_last_checked = 0.0
_refresh_lock = asyncio.Lock()


def utcnow_naive() -> datetime:
    """Return UTC now in the same naive form used by SQLite DateTime columns."""
    return datetime.now(UTC).replace(tzinfo=None)


def api_datetime(value: datetime | None) -> datetime | None:
    """Return a notification timestamp as an explicit UTC datetime for API responses."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _subscription_dict(subscription: ResourceSubscription) -> dict[str, Any]:
    """Serialize a resource subscription."""
    return {
        'id': subscription.id,
        'content_id': subscription.content_id,
        'subject_id': subscription.subject_id,
        'source': subscription.source,
        'fansub_key': subscription.fansub_key,
        'fansub_name': subscription.fansub_name,
        'fansub_id': subscription.fansub_id,
        'active': subscription.active,
        'last_seen_created_at': subscription.last_seen_created_at,
        'last_seen_resource_key': subscription.last_seen_resource_key,
        'created_at': subscription.created_at,
        'updated_at': subscription.updated_at,
    }


def resource_key(resource: dict[str, Any]) -> str:
    """Return the stable key used by subscriptions and notification payloads."""
    return f'{resource["provider"]}:{resource["provider_id"]}'


def resource_sort_key(resource: dict[str, Any]) -> tuple[datetime, str]:
    """Sort normalized resources by publication time and stable identity."""
    return resource['created_at'], resource_key(resource)


async def create_subscription(
    db: Session,
    *,
    user_id: int,
    content_id: int,
    source: str,
    fansub_name: str,
    fansub_id: str | None = None,
) -> ResourceSubscription:
    """Create or reactivate a source-specific subscription and establish its cursor."""
    if source not in {'mikan', 'animegarden'}:
        raise ValueError('不支持的资源源')
    content = content_svc.get_content_by_id(db, content_id)
    if not content:
        raise ValueError('番剧不存在')
    subject_id = subject_id_for_content(content)
    if subject_id is None:
        raise ValueError('该番剧未关联有效的 Bangumi 条目')

    clean_name = fansub_name.strip()
    clean_fansub_id = fansub_id.strip() if fansub_id else None
    fansub_key = (
        f'group:{clean_fansub_id}' if source == 'mikan' and clean_fansub_id else normalize_fansub_name(clean_name)
    )
    if not fansub_key:
        raise ValueError('字幕组名称不能为空')
    if source == 'mikan' and not clean_fansub_id:
        raise ValueError('Mikan 字幕组缺少稳定 ID，暂时无法关注')

    subscription = (
        db.query(ResourceSubscription)
        .filter(
            ResourceSubscription.user_id == user_id,
            ResourceSubscription.subject_id == subject_id,
            ResourceSubscription.source == source,
            ResourceSubscription.fansub_key == fansub_key,
        )
        .first()
    )
    if subscription:
        subscription.active = True
        subscription.content_id = content_id
        subscription.fansub_name = clean_name
        subscription.fansub_id = clean_fansub_id
    else:
        subscription = ResourceSubscription(
            user_id=user_id,
            content_id=content_id,
            subject_id=subject_id,
            source=source,
            fansub_key=fansub_key,
            fansub_name=clean_name,
            fansub_id=clean_fansub_id,
            active=True,
        )
        db.add(subscription)
        db.flush()

    # Establish a baseline so following an existing series does not emit old notices.
    try:
        result = await resources_svc.fetch_for_subscription(subscription, content=content)
        latest = max(result.resources, key=resource_sort_key, default=None)
        if latest:
            subscription.last_seen_created_at = _db_time(latest['created_at'])
            subscription.last_seen_resource_key = resource_key(latest)
    except (animegarden.AnimeGardenError, mikan.MikanError):
        logger.warning('Unable to establish resource subscription baseline for %s', fansub_key)

    db.commit()
    db.refresh(subscription)
    return subscription


def list_subscriptions(
    db: Session,
    *,
    user_id: int,
    content_id: int | None = None,
) -> list[ResourceSubscription]:
    """List a user's active subscriptions."""
    query = db.query(ResourceSubscription).filter(
        ResourceSubscription.user_id == user_id,
        ResourceSubscription.active.is_(True),
    )
    if content_id is not None:
        query = query.filter(ResourceSubscription.content_id == content_id)
    return query.order_by(ResourceSubscription.created_at.asc()).all()


def cancel_subscription(db: Session, *, user_id: int, subscription_id: int) -> bool:
    """Deactivate one of the current user's subscriptions."""
    subscription = (
        db.query(ResourceSubscription)
        .filter(ResourceSubscription.id == subscription_id, ResourceSubscription.user_id == user_id)
        .first()
    )
    if not subscription:
        return False
    subscription.active = False
    db.commit()
    return True


def _visible_filter(user_id: int | None, scope: str | None = None):
    """Build the visibility condition for notification queries."""
    public = Notification.scope == 'public'
    if user_id is None:
        return public if scope in (None, 'all', 'public') else Notification.id == -1
    private = and_(Notification.scope == 'private', Notification.recipient_user_id == user_id)
    if scope == 'public':
        return public
    if scope == 'private':
        return private
    return or_(public, private)


def _published_filter(now: datetime):
    """Build the published and non-expired condition."""
    return and_(
        Notification.is_published.is_(True),
        or_(Notification.published_at.is_(None), Notification.published_at <= now),
        or_(Notification.expires_at.is_(None), Notification.expires_at > now),
    )


def _read_ids(db: Session, user_id: int | None, ids: list[int]) -> set[int]:
    """Fetch read receipts for a page of notifications."""
    if user_id is None or not ids:
        return set()
    return {
        row.notification_id
        for row in db.query(NotificationRead)
        .filter(NotificationRead.user_id == user_id, NotificationRead.notification_id.in_(ids))
        .all()
    }


def _payload(notification: Notification) -> dict[str, Any]:
    """Decode notification payload JSON safely."""
    try:
        value = json.loads(notification.payload_json or '{}')
        return value if isinstance(value, dict) else {}
    except (TypeError, json.JSONDecodeError):
        return {}


def notification_dict(notification: Notification, *, is_read: bool = False) -> dict[str, Any]:
    """Serialize a notification for the frontend."""
    return {
        'id': notification.id,
        'scope': notification.scope,
        'kind': notification.kind,
        'title': notification.title,
        'body': notification.body,
        'payload': _payload(notification),
        'created_at': api_datetime(notification.created_at),
        'published_at': api_datetime(notification.published_at),
        'expires_at': api_datetime(notification.expires_at),
        'is_read': is_read,
    }


def list_notifications(
    db: Session,
    *,
    user_id: int | None,
    scope: str | None,
    page: int,
    size: int,
) -> tuple[list[dict[str, Any]], int, int]:
    """List visible notifications and return page, total, and unread count."""
    now = utcnow_naive()
    base = db.query(Notification).filter(_visible_filter(user_id, scope), _published_filter(now))
    total = base.count()
    unread_query = base
    if user_id is not None:
        read_subquery = db.query(NotificationRead.notification_id).filter(NotificationRead.user_id == user_id)
        unread_query = unread_query.filter(~Notification.id.in_(read_subquery))
    unread_count = unread_query.count()
    rows = (
        base.order_by(Notification.created_at.desc(), Notification.id.desc())
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )
    read_ids = _read_ids(db, user_id, [row.id for row in rows])
    return [notification_dict(row, is_read=row.id in read_ids) for row in rows], total, unread_count


def unread_counts(db: Session, *, user_id: int | None) -> dict[str, int]:
    """Return public/private/total unread counters."""
    now = utcnow_naive()
    public_base = db.query(Notification).filter(
        Notification.scope == 'public',
        _published_filter(now),
    )
    if user_id is None:
        public_count = public_base.count()
        return {'total': public_count, 'public': public_count, 'private': 0}

    read_subquery = db.query(NotificationRead.notification_id).filter(NotificationRead.user_id == user_id)
    public_count = public_base.filter(~Notification.id.in_(read_subquery)).count()
    private_count = (
        db.query(Notification)
        .filter(
            Notification.scope == 'private',
            Notification.recipient_user_id == user_id,
            _published_filter(now),
            ~Notification.id.in_(read_subquery),
        )
        .count()
    )
    return {'total': public_count + private_count, 'public': public_count, 'private': private_count}


def mark_read(db: Session, *, user_id: int, notification_id: int) -> bool:
    """Mark a visible notification as read."""
    notification = db.query(Notification).filter(Notification.id == notification_id, _visible_filter(user_id)).first()
    if not notification:
        return False
    existing = db.query(NotificationRead).filter_by(notification_id=notification_id, user_id=user_id).first()
    if not existing:
        db.add(NotificationRead(notification_id=notification_id, user_id=user_id))
        db.commit()
    return True


def mark_all_read(db: Session, *, user_id: int, scope: str | None = None) -> int:
    """Mark all currently visible notifications as read."""
    now = utcnow_naive()
    rows = db.query(Notification).filter(_visible_filter(user_id, scope), _published_filter(now)).all()
    existing = {
        row.notification_id for row in db.query(NotificationRead).filter(NotificationRead.user_id == user_id).all()
    }
    new_rows = [NotificationRead(notification_id=row.id, user_id=user_id) for row in rows if row.id not in existing]
    if new_rows:
        db.add_all(new_rows)
        db.commit()
    return len(new_rows)


def create_announcement(db: Session, *, admin_id: int, data: dict[str, Any]) -> Notification:
    """Create a public announcement."""
    is_published = bool(data.get('is_published', True))
    published_at = data.get('published_at')
    if is_published and published_at is None:
        published_at = utcnow_naive()
    elif published_at is not None:
        published_at = _db_time(published_at)
    announcement = Notification(
        scope='public',
        kind='announcement',
        title=data['title'].strip(),
        body=data.get('body', ''),
        payload_json='{}',
        created_by=admin_id,
        is_published=is_published,
        published_at=published_at,
        expires_at=_db_time(data['expires_at']) if data.get('expires_at') else None,
    )
    db.add(announcement)
    db.commit()
    db.refresh(announcement)
    return announcement


def update_announcement(db: Session, *, announcement_id: int, data: dict[str, Any]) -> Notification | None:
    """Update a public announcement."""
    announcement = (
        db.query(Notification)
        .filter(Notification.id == announcement_id, Notification.scope == 'public', Notification.kind == 'announcement')
        .first()
    )
    if not announcement:
        return None
    if data.get('title') is not None:
        announcement.title = data['title'].strip()
    if data.get('body') is not None:
        announcement.body = data['body']
    if data.get('is_published') is not None:
        announcement.is_published = bool(data['is_published'])
        if announcement.is_published and announcement.published_at is None:
            announcement.published_at = utcnow_naive()
    if 'published_at' in data:
        announcement.published_at = _db_time(data['published_at']) if data['published_at'] else None
    if 'expires_at' in data:
        announcement.expires_at = _db_time(data['expires_at']) if data['expires_at'] else None
    db.commit()
    db.refresh(announcement)
    return announcement


def list_announcements(db: Session, *, page: int, size: int) -> tuple[list[Notification], int]:
    """List all announcements for the super-admin panel."""
    query = db.query(Notification).filter(Notification.scope == 'public', Notification.kind == 'announcement')
    total = query.count()
    rows = (
        query.order_by(Notification.created_at.desc(), Notification.id.desc())
        .offset((page - 1) * size)
        .limit(size)
        .all()
    )
    return rows, total


def delete_announcement(db: Session, *, announcement_id: int) -> bool:
    """Delete one public announcement."""
    announcement = (
        db.query(Notification)
        .filter(Notification.id == announcement_id, Notification.scope == 'public', Notification.kind == 'announcement')
        .first()
    )
    if not announcement:
        return False
    db.query(NotificationRead).filter(NotificationRead.notification_id == announcement_id).delete(
        synchronize_session=False,
    )
    db.delete(announcement)
    db.commit()
    return True


async def refresh_subscriptions(db: Session, *, user_id: int | None = None) -> int:
    """Check active subscriptions and create new resource notifications."""
    query = db.query(ResourceSubscription).filter(ResourceSubscription.active.is_(True))
    if user_id is not None:
        query = query.filter(ResourceSubscription.user_id == user_id)
    subscriptions = query.all()
    grouped: dict[tuple[str, int, str, str | None], list[ResourceSubscription]] = defaultdict(list)
    for subscription in subscriptions:
        grouped[
            (
                subscription.source,
                subscription.subject_id,
                subscription.fansub_key,
                subscription.fansub_id,
            )
        ].append(subscription)

    created = 0
    for (_source, _subject_id, _fansub_key, _fansub_id), group in grouped.items():
        representative = group[0]
        content = db.query(ContentItem).filter(ContentItem.id == representative.content_id).first()
        try:
            result = await resources_svc.fetch_for_subscription(representative, content=content)
        except (animegarden.AnimeGardenError, mikan.MikanError):
            continue

        resources = sorted(result.resources, key=resource_sort_key)
        for subscription in group:
            current_time = subscription.last_seen_created_at
            current_key = subscription.last_seen_resource_key or ''
            if current_time is None:
                latest = resources[-1] if resources else None
                if latest:
                    subscription.last_seen_created_at = _db_time(latest['created_at'])
                    subscription.last_seen_resource_key = resource_key(latest)
                continue

            new_resources = [
                resource
                for resource in resources
                if (
                    _db_time(resource['created_at']),
                    resource_key(resource),
                )
                > (current_time, current_key)
            ]
            for resource in new_resources:
                key = resource_key(resource)
                dedupe_key = f'resource:{subscription.id}:{key}'
                existing = (
                    db.query(Notification)
                    .filter(
                        Notification.recipient_user_id == subscription.user_id,
                        Notification.dedupe_key == dedupe_key,
                    )
                    .first()
                )
                if existing:
                    continue
                title = f'{content.title if content else "番剧"} 有新资源'
                body = f'{subscription.fansub_name} 发布了新资源：{resource["title"]}'
                payload = {
                    'content_id': subscription.content_id,
                    'subject_id': subscription.subject_id,
                    'source': subscription.source,
                    'fansub_id': subscription.fansub_id,
                    'fansub_name': subscription.fansub_name,
                    'provider': resource['provider'],
                    'provider_id': resource['provider_id'],
                    'resource_title': resource['title'],
                    'resource_href': resource['href'],
                    'resource_key': key,
                }
                db.add(
                    Notification(
                        scope='private',
                        recipient_user_id=subscription.user_id,
                        kind='resource_update',
                        title=title,
                        body=body,
                        payload_json=json.dumps(payload, ensure_ascii=False),
                        is_published=True,
                        published_at=utcnow_naive(),
                        dedupe_key=dedupe_key,
                    )
                )
                created += 1

            if resources:
                latest = resources[-1]
                latest_cursor = (_db_time(latest['created_at']), resource_key(latest))
                current_cursor = (current_time, current_key)
                if latest_cursor > current_cursor:
                    subscription.last_seen_created_at = latest_cursor[0]
                    subscription.last_seen_resource_key = latest_cursor[1]

    if subscriptions:
        db.commit()
    return created


async def refresh_subscriptions_with_cooldown(db: Session) -> int:
    """Refresh all subscriptions at most once per cooldown window per process."""
    global _refresh_last_checked
    now = time.monotonic()
    if _refresh_last_checked > 0 and now - _refresh_last_checked < _REFRESH_COOLDOWN_SECONDS:
        return 0
    async with _refresh_lock:
        now = time.monotonic()
        if _refresh_last_checked > 0 and now - _refresh_last_checked < _REFRESH_COOLDOWN_SECONDS:
            return 0
        created = await refresh_subscriptions(db)
        _refresh_last_checked = time.monotonic()
        return created


async def run_worker(stop_event: asyncio.Event, interval_seconds: int = 1800) -> None:
    """Run the single-process resource notification worker."""
    while not stop_event.is_set():
        db = SessionLocal()
        try:
            await refresh_subscriptions(db)
        except Exception:  # noqa: BLE001
            logger.exception('Resource notification worker failed')
            db.rollback()
        finally:
            db.close()
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval_seconds)
        except TimeoutError:
            continue
