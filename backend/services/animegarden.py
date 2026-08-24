"""Anime Garden API client and resource normalization."""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime
from typing import Any

import httpx

logger = logging.getLogger('uvicorn')

ANIMEGARDEN_API_BASE = os.getenv('ANIMEGARDEN_API_BASE', 'https://api.animes.garden').rstrip('/')
ANIMEGARDEN_TIMEOUT = float(os.getenv('ANIMEGARDEN_TIMEOUT_SECONDS', '8'))
MAX_PAGE_SIZE = 1000


def _proxy() -> str | None:
    """Return an explicit HTTP(S) proxy without implicitly enabling SOCKS."""
    value = (
        os.environ.get('ANIMEGARDEN_PROXY')
        or os.environ.get('HTTPS_PROXY')
        or os.environ.get('https_proxy')
        or os.environ.get('HTTP_PROXY')
        or os.environ.get('http_proxy')
    )
    if value and value.lower().startswith(('http://', 'https://')):
        return value
    return None


class AnimeGardenError(RuntimeError):
    """Raised when Anime Garden cannot provide a valid response."""


def _parse_datetime(value: Any) -> datetime:
    """Parse Anime Garden ISO timestamps into timezone-aware UTC values."""
    if isinstance(value, datetime):
        result = value
    elif isinstance(value, str) and value:
        try:
            result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            result = datetime.now(UTC)
    else:
        result = datetime.now(UTC)
    if result.tzinfo is None:
        return result.replace(tzinfo=UTC)
    return result.astimezone(UTC)


def _party(value: Any) -> dict[str, Any] | None:
    """Normalize one fansub/publisher object."""
    if not isinstance(value, dict) or not value.get('name'):
        return None
    return {
        'id': value.get('id'),
        'name': str(value['name']),
        'avatar': value.get('avatar') if isinstance(value.get('avatar'), str) else None,
    }


def normalize_resource(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Convert Anime Garden camelCase data into MoreAni snake_case data."""
    provider = str(raw.get('provider') or '').strip()
    provider_id = str(raw.get('providerId') or '').strip()
    title = str(raw.get('title') or '').strip()
    if not provider or not provider_id or not title:
        return None
    return {
        'id': int(raw.get('id') or 0),
        'source': 'animegarden',
        'provider': provider,
        'provider_id': provider_id,
        'title': title,
        'href': str(raw.get('href') or ''),
        'type': str(raw.get('type') or ''),
        'magnet': str(raw.get('magnet') or ''),
        'size': int(raw.get('size') or 0),
        'fansub': _party(raw.get('fansub')),
        'publisher': _party(raw.get('publisher')),
        'subject_id': int(raw['subjectId']) if raw.get('subjectId') is not None else None,
        'created_at': _parse_datetime(raw.get('createdAt')),
        'fetched_at': _parse_datetime(raw.get('fetchedAt')),
    }


def resource_key(resource: dict[str, Any]) -> str:
    """Return the stable upstream identity used for subscriptions."""
    return f'{resource["provider"]}:{resource["provider_id"]}'


def resource_sort_key(resource: dict[str, Any]) -> tuple[datetime, str]:
    """Sort resources by publication time and stable identity."""
    return resource['created_at'], resource_key(resource)


async def fetch_resources(
    subject_id: int,
    *,
    page: int = 1,
    page_size: int = 50,
    fansub: str | None = None,
) -> dict[str, Any]:
    """Fetch and normalize resources for a Bangumi subject."""
    page = max(1, page)
    page_size = min(max(1, page_size), MAX_PAGE_SIZE)
    params: list[tuple[str, str]] = [
        ('subject', str(subject_id)),
        ('type', '动画'),
        ('page', str(page)),
        ('pageSize', str(page_size)),
    ]
    if fansub:
        params.append(('fansub', fansub))

    last_error: Exception | None = None
    for proxy in (None, _proxy()):
        if proxy is None and last_error is not None and _proxy() is None:
            break
        try:
            async with httpx.AsyncClient(
                timeout=ANIMEGARDEN_TIMEOUT,
                proxy=proxy,
                trust_env=False,
                follow_redirects=True,
            ) as client:
                response = await client.get(f'{ANIMEGARDEN_API_BASE}/resources', params=params)
                response.raise_for_status()
                payload = response.json()
            if not isinstance(payload, dict) or payload.get('status') != 'OK':
                raise AnimeGardenError('Anime Garden 返回了无效响应')
            normalized = [
                item
                for raw in payload.get('resources', [])
                if isinstance(raw, dict)
                for item in [normalize_resource(raw)]
                if item is not None
            ]
            pagination = payload.get('pagination') or {}
            return {
                'resources': normalized,
                'page': int(pagination.get('page') or page),
                'page_size': int(pagination.get('pageSize') or page_size),
                'complete': bool(pagination.get('complete', True)),
            }
        except (httpx.HTTPError, httpx.TimeoutException, ValueError, AnimeGardenError) as exc:
            last_error = exc
            logger.warning('Anime Garden request failed via %s: %s', proxy or 'direct', type(exc).__name__)

    raise AnimeGardenError('Anime Garden 暂时无法访问') from last_error
