"""Persisted Bangumi weekly anime calendar and its daily synchronizer."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from database import SessionLocal
from models import AiringCalendarItem, AiringCalendarSyncState, ContentItem
from services import bangumi, covers

logger = logging.getLogger('uvicorn')

LOCAL_TZ = ZoneInfo('Asia/Shanghai')
SYNC_TIME = time(hour=4, minute=10)
WORKER_CHECK_SECONDS = 300
WEEKDAY_LABELS = ('星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日')
SYNC_LOCK = asyncio.Lock()


class AiringCalendarError(RuntimeError):
    """Raised when a Bangumi calendar payload cannot be safely persisted."""


def utcnow_naive() -> datetime:
    """Return a naive UTC timestamp compatible with SQLite DateTime columns."""
    return datetime.now(UTC).replace(tzinfo=None)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _local_date(value: datetime | None) -> date | None:
    timestamp = _as_utc(value)
    return timestamp.astimezone(LOCAL_TZ).date() if timestamp else None


def parse_calendar(payload: list[dict]) -> list[dict[str, object]]:
    """Normalize Bangumi's seven weekday groups into deduplicated records."""
    if not isinstance(payload, list):
        raise AiringCalendarError('Bangumi 周历响应不是列表')

    records: list[dict[str, object]] = []
    seen: set[tuple[int, int]] = set()
    valid_weekdays: set[int] = set()

    for group in payload:
        if not isinstance(group, dict):
            raise AiringCalendarError('Bangumi 周历分组格式不正确')
        weekday_data = group.get('weekday') or {}
        try:
            weekday = int(weekday_data.get('id'))
        except (AttributeError, TypeError, ValueError) as exc:
            raise AiringCalendarError('Bangumi 周历缺少星期信息') from exc
        if not 1 <= weekday <= 7:
            raise AiringCalendarError('Bangumi 周历星期信息超出范围')
        valid_weekdays.add(weekday)
        items = group.get('items')
        if not isinstance(items, list):
            raise AiringCalendarError('Bangumi 周历条目格式不正确')

        for item in items:
            if not isinstance(item, dict) or item.get('type') != 2:
                continue
            try:
                subject_id = int(item.get('id'))
            except (TypeError, ValueError):
                continue
            if subject_id <= 0 or (subject_id, weekday) in seen:
                continue

            title = str(item.get('name_cn') or item.get('name') or '').strip()
            if not title:
                continue
            images = item.get('images') or {}
            if not isinstance(images, dict):
                images = {}
            seen.add((subject_id, weekday))
            records.append(
                {
                    'subject_id': subject_id,
                    'weekday': weekday,
                    'title': title,
                    'title_alt': str(item.get('name') or '').strip(),
                    'cover_url': str(
                        images.get('large') or images.get('common') or images.get('medium') or '',
                    ),
                    'bangumi_url': str(item.get('url') or f'https://bgm.tv/subject/{subject_id}'),
                },
            )

    if len(valid_weekdays) < 7:
        raise AiringCalendarError('Bangumi 周历未包含完整的星期分组')
    if not records:
        raise AiringCalendarError('Bangumi 周历没有可用的动画条目')
    return records


def _get_sync_state(db: Session) -> AiringCalendarSyncState:
    state = db.query(AiringCalendarSyncState).filter(AiringCalendarSyncState.id == 1).first()
    if state is None:
        state = AiringCalendarSyncState(id=1, status='pending', item_count=0)
        db.add(state)
        db.flush()
    return state


def _set_failed(db: Session, error_message: str) -> None:
    db.rollback()
    state = _get_sync_state(db)
    state.status = 'failed'
    state.error_message = error_message[:1000]
    state.updated_at = utcnow_naive()
    db.commit()


def _prefetch_enabled() -> bool:
    """Whether the daily worker should warm Bangumi cover assets."""
    return os.getenv('MOREANI_AIRING_COVER_PREFETCH', 'false').lower() in {'1', 'true', 'yes', 'on'}


def _cleanup_enabled() -> bool:
    """Keep destructive orphan cleanup opt-in during rollout."""
    return os.getenv('MOREANI_COVER_CLEANUP_ENABLED', 'false').lower() in {'1', 'true', 'yes', 'on'}


async def sync_calendar(db: Session) -> int:
    """Fetch and atomically replace the active calendar snapshot."""
    attempted_at = utcnow_naive()
    state = _get_sync_state(db)
    state.last_attempt_at = attempted_at
    state.status = 'pending'
    state.error_message = None
    db.commit()

    started_at = datetime.now(UTC)
    try:
        payload = await bangumi.fetch_calendar()
        records = parse_calendar(payload)
    except (bangumi.BangumiError, AiringCalendarError) as exc:
        _set_failed(db, str(exc))
        raise
    except Exception as exc:  # noqa: BLE001
        _set_failed(db, 'Bangumi 周历同步失败')
        raise AiringCalendarError('Bangumi 周历同步失败') from exc

    now = utcnow_naive()
    db.query(AiringCalendarItem).filter(AiringCalendarItem.active.is_(True)).update(
        {'active': False, 'updated_at': now},
        synchronize_session=False,
    )
    existing_rows = (
        db.query(AiringCalendarItem)
        .filter(AiringCalendarItem.subject_id.in_([record['subject_id'] for record in records]))
        .all()
    )
    existing_by_key = {(row.subject_id, row.weekday): row for row in existing_rows}
    for record in records:
        item = existing_by_key.get((record['subject_id'], record['weekday']))
        if item is None:
            item = AiringCalendarItem(
                subject_id=record['subject_id'],
                weekday=record['weekday'],
                created_at=now,
            )
            db.add(item)
        item.title = record['title']
        item.title_alt = record['title_alt']
        item.cover_url = record['cover_url']
        item.bangumi_url = record['bangumi_url']
        item.active = True
        item.last_seen_at = now
        item.updated_at = now

    state = _get_sync_state(db)
    state.last_success_at = now
    state.status = 'success'
    state.error_message = None
    state.item_count = len(records)
    state.updated_at = now
    db.commit()
    if _prefetch_enabled():
        try:
            await covers.prefetch_airing_covers(db, records)
        except Exception:  # noqa: BLE001
            # 周历数据已经成功落盘，单张或整批封面失败都不应回滚周历快照。
            db.rollback()
            logger.exception('Bangumi airing cover prefetch failed after calendar sync')
    if _cleanup_enabled():
        try:
            covers.cleanup_orphan_cover_assets(db)
        except Exception:  # noqa: BLE001
            logger.exception('Bangumi cover cleanup failed after calendar sync')
    elapsed = (datetime.now(UTC) - started_at).total_seconds()
    logger.info('Bangumi calendar sync succeeded: items=%d elapsed=%.3fs', len(records), elapsed)
    return len(records)


def should_sync_today(db: Session, now: datetime | None = None) -> bool:
    """Allow at most one attempt per local day after the configured sync time."""
    current = now.astimezone(LOCAL_TZ) if now else datetime.now(LOCAL_TZ)
    state = db.query(AiringCalendarSyncState).filter(AiringCalendarSyncState.id == 1).first()
    if state is None:
        return True
    if _local_date(state.last_attempt_at) == current.date():
        return False
    return current.time() >= SYNC_TIME


async def run_worker(stop_event: asyncio.Event) -> None:
    """Run the daily calendar check without blocking normal API requests."""
    while not stop_event.is_set():
        db = SessionLocal()
        try:
            async with SYNC_LOCK:
                if should_sync_today(db):
                    await sync_calendar(db)
        except AiringCalendarError as exc:
            logger.warning('Bangumi calendar sync failed: %s', exc)
        except Exception:  # noqa: BLE001
            logger.exception('Bangumi calendar worker failed')
        finally:
            db.close()
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=WORKER_CHECK_SECONDS)
        except TimeoutError:
            continue


def get_week(db: Session, now: datetime | None = None) -> dict[str, object]:
    """Read the current local week from the persisted calendar snapshot."""
    current = now.astimezone(LOCAL_TZ) if now else datetime.now(LOCAL_TZ)
    monday = current.date() - timedelta(days=current.weekday())
    rows = (
        db.query(AiringCalendarItem)
        .filter(AiringCalendarItem.active.is_(True))
        .order_by(AiringCalendarItem.weekday.asc(), AiringCalendarItem.title.asc())
        .all()
    )
    subject_ids = {row.subject_id for row in rows}
    asset_urls = covers.get_asset_url_map(db, subject_ids)
    local_items: dict[int, ContentItem] = {}
    if subject_ids:
        local_rows = (
            db.query(ContentItem)
            .filter(
                ContentItem.source_type == 'bangumi',
                ContentItem.source_id.in_([str(subject_id) for subject_id in subject_ids]),
                ContentItem.is_public.is_(True),
                ContentItem.deleted_at.is_(None),
            )
            .order_by(ContentItem.id.desc())
            .all()
        )
        for item in local_rows:
            local_items.setdefault(int(item.source_id), item)

    grouped: dict[int, list[dict[str, object]]] = {weekday: [] for weekday in range(1, 8)}
    for row in rows:
        content = local_items.get(row.subject_id)
        content_cover = content.cover_url if content and content.cover_url else ''
        if content_cover.startswith('/api/covers/') and not covers.is_local_cover_available(content_cover):
            content_cover = ''
        grouped[row.weekday].append(
            {
                'subject_id': row.subject_id,
                'content_id': content.id if content else None,
                'matched': content is not None,
                'title': row.title,
                'title_alt': row.title_alt or '',
                'cover_url': asset_urls.get(row.subject_id) or content_cover or row.cover_url or '',
                'bangumi_url': row.bangumi_url,
            },
        )

    for day_items in grouped.values():
        day_items.sort(key=lambda item: not bool(item['matched']))

    state = db.query(AiringCalendarSyncState).filter(AiringCalendarSyncState.id == 1).first()
    status = state.status if state else 'pending'
    return {
        'timezone': 'Asia/Shanghai',
        'week_start': monday.isoformat(),
        'last_synced_at': _as_utc(state.last_success_at) if state else None,
        'sync_status': status,
        'days': [
            {
                'date': (monday + timedelta(days=weekday - 1)).isoformat(),
                'weekday': weekday,
                'label': WEEKDAY_LABELS[weekday - 1],
                'is_today': current.weekday() + 1 == weekday,
                'items': grouped[weekday],
            }
            for weekday in range(1, 8)
        ],
    }
