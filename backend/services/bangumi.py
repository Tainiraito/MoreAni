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


async def fetch_calendar() -> list[dict[str, Any]]:
    """Fetch Bangumi's weekly anime calendar using direct-then-proxy fallback."""
    url = f'{BANGUMI_API_BASE}/calendar'
    proxies = [None] if not PROXY else [None, PROXY]
    last_error: Exception | None = None

    for proxy in proxies:
        try:
            async with httpx.AsyncClient(
                timeout=REQUEST_TIMEOUT,
                proxy=proxy,
                trust_env=False,
            ) as client:
                response = await client.get(url, headers=HEADERS)
                response.raise_for_status()
                payload = response.json()
            if not isinstance(payload, list):
                raise BangumiError('Bangumi 周历响应格式不正确')
            return payload
        except (httpx.HTTPError, httpx.TimeoutException, ValueError, BangumiError) as exc:
            last_error = exc
            logger.warning('Bangumi calendar failed via %s: %s', proxy or 'direct', exc)

    raise BangumiError('Bangumi 周历暂时不可用') from last_error


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

    # 直连失败回退代理（WSL2 网络环境）
    for proxy in (None, PROXY):
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, proxy=proxy) as client:
                resp = await client.get(url, params=params, headers=HEADERS)
                resp.raise_for_status()
                data = resp.json()
            break
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            logger.warning('Bangumi search failed via %s: %s', proxy or 'direct', e)
            data = None
    if not data:
        return {'total': 0, 'items': []}

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

    # 直连失败回退代理（WSL2 网络环境）
    for proxy in (None, PROXY):
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, proxy=proxy) as client:
                resp = await client.get(url, headers=HEADERS)
                resp.raise_for_status()
                data = resp.json()
            break
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            logger.warning('Bangumi detail failed for %d via %s: %s', bgm_id, proxy or 'direct', e)
            data = None
    if not data:
        return None

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
