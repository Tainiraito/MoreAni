"""Bangumi API client for MoreAni v2.

Uses Bangumi API v0 to search and import anime/movie data.
Docs: https://bangumi.github.io/api/
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger('uvicorn')

BANGUMI_API_BASE = 'https://api.bgm.tv'
HEADERS = {'User-Agent': 'MoreAni/2.0 (https://moreani.lovelysia.top)'}
DEFAULT_TIMEOUT_SECONDS = 8.0
DEFAULT_CACHE_MAX_ENTRIES = 256
NOT_FOUND_CACHE_SECONDS = 30.0


def _env_bool(name: str, default: bool) -> bool:
    """Read a boolean environment value with a safe default."""
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


def _env_float(name: str, default: float) -> float:
    """Read a positive floating-point environment value."""
    try:
        return max(0.1, float(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    """Read a positive integer environment value."""
    try:
        return max(1, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


def _configured_proxy() -> str | None:
    """Return the explicit Bangumi proxy without consulting ALL_PROXY."""
    configured = os.getenv('MOREANI_BANGUMI_PROXY', '').strip()
    if configured:
        return configured
    return next(
        (
            value.strip()
            for value in (
                os.getenv('MOREANI_HTTPS_PROXY'),
                os.getenv('MOREANI_HTTP_PROXY'),
                os.getenv('HTTPS_PROXY'),
                os.getenv('https_proxy'),
                os.getenv('HTTP_PROXY'),
                os.getenv('http_proxy'),
            )
            if value and value.strip()
        ),
        None,
    )


def _configured_request_order() -> str:
    """Return the configured request order, falling back to proxy-first."""
    value = os.getenv('MOREANI_BANGUMI_REQUEST_ORDER', 'proxy_first').strip().lower()
    return value if value in {'proxy_first', 'direct_first'} else 'proxy_first'


# ``PROXY`` and the other constants remain module-level so deployments can
# inspect or tests can override the resolved configuration explicitly.
PROXY = _configured_proxy()
REQUEST_ORDER = _configured_request_order()
REQUEST_TIMEOUT = _env_float('MOREANI_BANGUMI_TIMEOUT_SECONDS', DEFAULT_TIMEOUT_SECONDS)
CACHE_ENABLED = _env_bool('MOREANI_BANGUMI_CACHE_ENABLED', True)
DETAIL_CACHE_SECONDS = _env_float('MOREANI_BANGUMI_DETAIL_CACHE_SECONDS', 300.0)
SEARCH_CACHE_SECONDS = _env_float('MOREANI_BANGUMI_SEARCH_CACHE_SECONDS', 60.0)
SCORE_CACHE_SECONDS = _env_float('MOREANI_BANGUMI_SCORE_CACHE_SECONDS', 60.0)
CACHE_MAX_ENTRIES = _env_int('MOREANI_BANGUMI_CACHE_MAX_ENTRIES', DEFAULT_CACHE_MAX_ENTRIES)


class BangumiError(RuntimeError):
    """Raised when a Bangumi request cannot be completed or decoded."""


class BangumiNotFoundError(BangumiError):
    """Raised when Bangumi confirms that a subject does not exist."""


@dataclass(frozen=True)
class _CacheEntry:
    """One expiring Bangumi response cache entry."""

    value: Any
    expires_at: float


_NOT_FOUND = object()
_cache: OrderedDict[str, _CacheEntry] = OrderedDict()
_cache_lock = threading.Lock()
_inflight: dict[str, asyncio.Task[Any]] = {}
_inflight_lock = threading.Lock()
_clients: dict[str, httpx.AsyncClient] = {}
_clients_lock = threading.Lock()


def _request_routes() -> list[tuple[str, str | None]]:
    """Return the configured request routes in their execution order."""
    if not PROXY:
        return [('direct', None)]
    proxy_route = ('proxy', PROXY)
    direct_route = ('direct', None)
    return [proxy_route, direct_route] if REQUEST_ORDER == 'proxy_first' else [direct_route, proxy_route]


def _client_for(proxy: str | None) -> httpx.AsyncClient:
    """Return a process-shared HTTP client with a reusable connection pool."""
    key = proxy or 'direct'
    with _clients_lock:
        client = _clients.get(key)
        if client is None or client.is_closed:
            timeout = httpx.Timeout(
                REQUEST_TIMEOUT,
                connect=min(5.0, REQUEST_TIMEOUT),
                read=REQUEST_TIMEOUT,
                write=REQUEST_TIMEOUT,
                pool=min(5.0, REQUEST_TIMEOUT),
            )
            limits = httpx.Limits(
                max_connections=20,
                max_keepalive_connections=10,
                keepalive_expiry=30.0,
            )
            client = httpx.AsyncClient(
                timeout=timeout,
                limits=limits,
                proxy=proxy,
                trust_env=False,
            )
            _clients[key] = client
        return client


def _cache_get(key: str) -> tuple[bool, Any]:
    """Return a live cache value and move it to the newest position."""
    if not CACHE_ENABLED:
        return False, None
    now = time.monotonic()
    with _cache_lock:
        entry = _cache.get(key)
        if entry is None:
            return False, None
        if entry.expires_at <= now:
            _cache.pop(key, None)
            return False, None
        _cache.move_to_end(key)
        return True, entry.value


def _cache_set(key: str, value: Any, ttl_seconds: float) -> None:
    """Store a value in the bounded TTL cache."""
    if not CACHE_ENABLED or ttl_seconds <= 0:
        return
    with _cache_lock:
        _cache[key] = _CacheEntry(value=value, expires_at=time.monotonic() + ttl_seconds)
        _cache.move_to_end(key)
        while len(_cache) > CACHE_MAX_ENTRIES:
            _cache.popitem(last=False)


def clear_bangumi_cache() -> None:
    """Clear all in-process Bangumi cache entries."""
    with _cache_lock:
        _cache.clear()


async def close_bangumi_clients() -> None:
    """Close shared Bangumi clients and clear cache during application shutdown."""
    with _clients_lock:
        clients = list(_clients.values())
        _clients.clear()
    clear_bangumi_cache()
    if clients:
        await asyncio.gather(*(client.aclose() for client in clients), return_exceptions=True)


async def _singleflight(key: str, loader: Callable[[], Awaitable[Any]]) -> Any:
    """Share one in-flight upstream request among callers with the same key."""
    with _inflight_lock:
        task = _inflight.get(key)
        if task is None or task.done():
            task = asyncio.create_task(loader())
            _inflight[key] = task
    try:
        return await asyncio.shield(task)
    finally:
        if task.done():
            with _inflight_lock:
                if _inflight.get(key) is task:
                    _inflight.pop(key, None)


async def _fetch_json(
    url: str,
    *,
    operation: str,
    params: dict[str, Any] | None = None,
    cache_state: str = 'bypass',
) -> Any:
    """Fetch JSON through the configured routes and shared HTTP clients."""
    last_error: Exception | None = None

    for route, proxy in _request_routes():
        started = time.perf_counter()
        try:
            client = _client_for(proxy)
            response = await client.get(url, params=params, headers=HEADERS)
            if response.status_code == 404:
                raise BangumiNotFoundError(f'Bangumi subject not found during {operation}')
            response.raise_for_status()
            payload = response.json()
            logger.info(
                'Bangumi %s route=%s cache=%s elapsed=%.3fs',
                operation,
                route,
                cache_state,
                time.perf_counter() - started,
            )
            return payload
        except BangumiNotFoundError:
            raise
        except (httpx.HTTPError, httpx.TimeoutException, ValueError, ImportError) as exc:
            last_error = exc
            logger.warning(
                'Bangumi %s route=%s failed elapsed=%.3fs error=%s: %s',
                operation,
                route,
                time.perf_counter() - started,
                type(exc).__name__,
                exc,
            )

    raise BangumiError(f'Bangumi {operation} temporarily unavailable') from last_error


async def _fetch_cached_json(
    *,
    cache_key: str,
    upstream_key: str,
    operation: str,
    url: str,
    params: dict[str, Any] | None,
    ttl_seconds: float,
    validator: Callable[[Any], bool],
) -> Any:
    """Read a TTL cache entry or share one upstream JSON request."""
    cache_hit, value = _cache_get(cache_key)
    if cache_hit:
        if value is _NOT_FOUND:
            raise BangumiNotFoundError(f'Bangumi subject not found during {operation}')
        logger.info('Bangumi %s route=cache cache=hit elapsed=0.000s', operation)
        return value

    async def loader() -> Any:
        return await _fetch_json(
            url,
            operation=operation,
            params=params,
            cache_state='miss',
        )

    try:
        value = await _singleflight(upstream_key, loader)
    except BangumiNotFoundError:
        _cache_set(cache_key, _NOT_FOUND, NOT_FOUND_CACHE_SECONDS)
        raise
    else:
        if validator(value):
            _cache_set(cache_key, value, ttl_seconds)
        return value


async def fetch_calendar() -> list[dict[str, Any]]:
    """Fetch Bangumi's weekly anime calendar using configured route fallback."""
    url = f'{BANGUMI_API_BASE}/calendar'
    payload = await _fetch_json(url, operation='calendar')
    if not isinstance(payload, list):
        raise BangumiError('Bangumi 周历响应格式不正确')
    return payload


async def search_subjects(
    keyword: str,
    subject_type: int = 2,
    limit: int = 10,
) -> dict[str, Any]:
    """Search Bangumi for subjects with a short-lived normalized cache."""
    normalized_keyword = keyword.strip().casefold()
    url = f'{BANGUMI_API_BASE}/search/subject/{normalized_keyword}'
    params = {
        'responseGroup': 'large',
        'max_results': limit,
        'type': subject_type,
    }

    try:
        data = await _fetch_cached_json(
            cache_key=f'search:{normalized_keyword}:{subject_type}:{limit}',
            upstream_key=f'search:{normalized_keyword}:{subject_type}:{limit}',
            operation='search',
            url=url,
            params=params,
            ttl_seconds=SEARCH_CACHE_SECONDS,
            validator=lambda value: isinstance(value, dict),
        )
    except BangumiNotFoundError:
        return {'total': 0, 'items': []}
    if not isinstance(data, dict):
        raise BangumiError('Bangumi search response format is invalid')

    results: list[dict[str, Any]] = []
    for item in data.get('list', []):
        images = item.get('images', {}) or {}
        rating_info = item.get('rating', {}) or {}
        results.append(
            {
                'bgm_id': item.get('id', 0),
                'name': item.get('name', ''),
                'name_cn': item.get('name_cn', ''),
                'cover_url': images.get('large', '') or images.get('common', ''),
                'rating': rating_info.get('score', 0),
                'tags': [t.get('name', '') for t in (item.get('tags', []) or [])],
                'eps': item.get('eps_count', 0) or item.get('eps', 0),
                'air_date': item.get('air_date', ''),
                'platform': item.get('platform', ''),
                'summary': item.get('summary', ''),
            }
        )

    return {'total': data.get('results', len(results)), 'items': results}


async def _get_subject_payload(
    bgm_id: int,
    *,
    cache_key_prefix: str,
    operation: str,
    ttl_seconds: float,
) -> dict[str, Any]:
    """Fetch one subject payload with operation-specific cache expiry."""
    url = f'{BANGUMI_API_BASE}/v0/subjects/{bgm_id}'
    data = await _fetch_cached_json(
        cache_key=f'{cache_key_prefix}:{bgm_id}',
        upstream_key=f'subject:{bgm_id}',
        operation=operation,
        url=url,
        params=None,
        ttl_seconds=ttl_seconds,
        validator=lambda value: isinstance(value, dict),
    )
    if not isinstance(data, dict):
        raise BangumiError('Bangumi subject response format is invalid')
    return data


def _normalize_subject(data: dict[str, Any]) -> dict[str, Any]:
    """Normalize Bangumi's subject payload for the public API."""
    images = data.get('images', {}) or {}
    rating_info = data.get('rating', {}) or {}
    tags = data.get('tags', []) or []
    return {
        'bgm_id': data.get('id', 0),
        'name': data.get('name', ''),
        'name_cn': data.get('name_cn', ''),
        'cover_url': images.get('large', '') or images.get('common', ''),
        'summary': data.get('summary', ''),
        'eps': data.get('total_episodes', 0) or data.get('eps', 0),
        'air_date': data.get('date', ''),
        'platform': data.get('platform', ''),
        'rating_score': rating_info.get('score', 0) or 0,
        'tags': [t.get('name', '') for t in tags],
    }


async def get_subject_detail(bgm_id: int) -> dict[str, Any] | None:
    """Get detailed info for a single Bangumi subject."""
    try:
        data = await _get_subject_payload(
            bgm_id,
            cache_key_prefix='detail',
            operation=f'detail/{bgm_id}',
            ttl_seconds=DETAIL_CACHE_SECONDS,
        )
    except BangumiNotFoundError:
        return None
    return _normalize_subject(data)


async def get_subject_score(bgm_id: int) -> int | float | None:
    """Get a subject score using an independently expiring score cache."""
    try:
        data = await _get_subject_payload(
            bgm_id,
            cache_key_prefix='score',
            operation=f'score/{bgm_id}',
            ttl_seconds=SCORE_CACHE_SECONDS,
        )
    except BangumiNotFoundError:
        return None
    score = (data.get('rating', {}) or {}).get('score', 0) or 0
    if not isinstance(score, (int, float)):
        return 0
    return score
