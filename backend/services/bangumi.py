"""Bangumi API client for MoreAni v2.

Uses Bangumi API v0 to search and import anime/movie data.
Docs: https://bangumi.github.io/api/
"""

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger('uvicorn')

BANGUMI_API_BASE = 'https://api.bgm.tv'
HEADERS = {'User-Agent': 'MoreAni/2.0 (https://moreani.lovelysia.top)'}

# WSL2 直连 api.bgm.tv 经常超时 → 直连 6s 失败后回退 Windows 侧代理
PROXY = (
    os.environ.get('HTTPS_PROXY')
    or os.environ.get('https_proxy')
    or os.environ.get('HTTP_PROXY')
    or os.environ.get('http_proxy')
    or 'http://192.168.31.45:7890'
)
REQUEST_TIMEOUT = 6.0


class BangumiError(RuntimeError):
    """Raised when a Bangumi request cannot be completed or decoded."""


class BangumiNotFoundError(BangumiError):
    """Raised when Bangumi confirms that a subject does not exist."""


async def _fetch_json(
    url: str,
    *,
    operation: str,
    params: dict[str, Any] | None = None,
) -> Any:
    """Fetch JSON through direct access and then the configured explicit proxy.

    ``trust_env=False`` is required here: otherwise httpx may silently pick up
    an unrelated ALL_PROXY/SOCKS proxy before the explicit fallback is tried.
    """
    proxies = [None] if not PROXY else [None, PROXY]
    last_error: Exception | None = None

    for proxy in proxies:
        try:
            async with httpx.AsyncClient(
                timeout=REQUEST_TIMEOUT,
                proxy=proxy,
                trust_env=False,
            ) as client:
                response = await client.get(url, params=params, headers=HEADERS)
                if response.status_code == 404:
                    raise BangumiNotFoundError(f'Bangumi subject not found during {operation}')
                response.raise_for_status()
                return response.json()
        except BangumiNotFoundError:
            raise
        except (httpx.HTTPError, httpx.TimeoutException, ValueError, ImportError) as exc:
            last_error = exc
            logger.warning(
                'Bangumi %s failed via %s: %s',
                operation,
                proxy or 'direct',
                exc,
            )

    raise BangumiError(f'Bangumi {operation} temporarily unavailable') from last_error


async def fetch_calendar() -> list[dict[str, Any]]:
    """Fetch Bangumi's weekly anime calendar using direct-then-proxy fallback."""
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
    """Search Bangumi for subjects (type 2=anime, 1=book, 4=game).

    API: GET /search/subject/{keyword}?type=2&responseGroup=large&max_results=N
    Response: {"results": N, "list": [...]}
    """
    url = f'{BANGUMI_API_BASE}/search/subject/{keyword}'
    params = {
        'responseGroup': 'large',
        'max_results': limit,
        'type': subject_type,
    }

    try:
        data = await _fetch_json(url, operation='search', params=params)
    except BangumiNotFoundError:
        return {'total': 0, 'items': []}
    if not isinstance(data, dict):
        raise BangumiError('Bangumi search response format is invalid')

    # API returns {"results": N, "list": [...]}
    results = []
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


async def get_subject_detail(bgm_id: int) -> dict[str, Any] | None:
    """Get detailed info for a single Bangumi subject.

    API: GET /v0/subjects/{id}
    """
    url = f'{BANGUMI_API_BASE}/v0/subjects/{bgm_id}'

    try:
        data = await _fetch_json(url, operation=f'detail/{bgm_id}')
    except BangumiNotFoundError:
        return None
    if not isinstance(data, dict):
        raise BangumiError('Bangumi detail response format is invalid')

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
        'rating_score': rating_info.get('score', 0),
        'tags': [t.get('name', '') for t in tags],
    }
