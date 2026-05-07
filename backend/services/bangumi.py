import httpx
from typing import Optional
from time import time

BANGUMI_V0 = 'https://api.bgm.tv/v0'
BANGUMI_OLD = 'https://api.bgm.tv'

_client: Optional[httpx.AsyncClient] = None

# 简单缓存：subject_id -> (timestamp, data)
_cache: dict[int, tuple[float, dict]] = {}
CACHE_TTL = 600  # 10分钟


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=15,
            headers={
                'User-Agent': 'MoreAni/0.1 (https://github.com/anomalyco/moreani)',
                'Accept': 'application/json'
            }
        )
    return _client


async def search_subjects(keyword: str, limit: int = 10, offset: int = 0) -> dict:
    resp = await get_client().post(
        f'{BANGUMI_V0}/search/subjects',
        json={
            'keyword': keyword,
            'filter': {'type': [2], 'nsfw': False},
            'limit': limit,
            'offset': offset
        }
    )
    resp.raise_for_status()
    return resp.json()


async def get_subject(subject_id: int) -> dict:
    """获取番剧详情（含简介），带10分钟缓存"""
    now = time()
    if subject_id in _cache:
        ts, data = _cache[subject_id]
        if now - ts < CACHE_TTL:
            return data

    resp = await get_client().get(f'{BANGUMI_V0}/subjects/{subject_id}')
    resp.raise_for_status()
    data = resp.json()
    _cache[subject_id] = (now, data)
    return data


async def get_subject_summary(subject_id: int) -> Optional[str]:
    try:
        resp = await get_client().get(
            f'{BANGUMI_OLD}/subject/{subject_id}',
            params={'responseGroup': 'medium'}
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get('summary', '')
    except Exception:
        return ''
