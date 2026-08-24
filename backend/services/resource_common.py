"""Shared resource-source helpers."""

from __future__ import annotations

import unicodedata
from datetime import UTC, datetime
from typing import Any

from models import ContentItem


def subject_id_for_content(content: ContentItem) -> int | None:
    """Return a valid Bangumi subject ID for an anime content item."""
    if content.content_type != 'anime' or content.source_type != 'bangumi':
        return None
    try:
        subject_id = int(content.source_id)
    except (TypeError, ValueError):
        return None
    return subject_id if subject_id > 0 else None


def normalize_fansub_name(value: str) -> str:
    """Normalize a fansub display name into a stable subscription key."""
    return unicodedata.normalize('NFKC', value).strip().casefold()


def db_time(value: datetime) -> datetime:
    """Convert an aware datetime to naive UTC for SQLite comparisons."""
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def resource_party(name: str, group_id: str | int | None = None) -> dict[str, Any] | None:
    """Build a normalized resource group summary."""
    clean_name = str(name or '').strip()
    if not clean_name:
        return None
    return {
        'id': str(group_id) if group_id is not None else None,
        'name': clean_name,
        'avatar': None,
    }
