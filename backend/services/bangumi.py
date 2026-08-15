"""Bangumi API client for MoreAni v2.

Uses Bangumi API v0 to search and import anime/movie data.
Docs: https://bangumi.github.io/api/
"""
import logging
from typing import Any

import httpx

logger = logging.getLogger("uvicorn")

BANGUMI_API_BASE = "https://api.bgm.tv"
HEADERS = {"User-Agent": "MoreAni/2.0 (https://moreani.lovelysia.top)"}


async def search_subjects(
    keyword: str,
    subject_type: int = 2,
    limit: int = 10,
) -> dict[str, Any]:
    """Search Bangumi for subjects (type 2=anime, 1=book, 4=game).

    API: GET /search/subject/{keyword}?type=2&responseGroup=large&max_results=N
    Response: {"results": N, "list": [...]}
    """
    url = f"{BANGUMI_API_BASE}/search/subject/{keyword}"
    params = {
        "responseGroup": "large",
        "max_results": limit,
        "type": subject_type,
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(url, params=params, headers=HEADERS)
            resp.raise_for_status()
            data = resp.json()
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            logger.error("Bangumi search failed: %s", e)
            return {"total": 0, "items": []}

    # API returns {"results": N, "list": [...]}
    results = []
    for item in data.get("list", []):
        images = item.get("images", {}) or {}
        rating_info = item.get("rating", {}) or {}
        results.append({
            "bgm_id": item.get("id", 0),
            "name": item.get("name", ""),
            "name_cn": item.get("name_cn", ""),
            "cover_url": images.get("large", "") or images.get("common", ""),
            "rating": rating_info.get("score", 0),
            "tags": [t.get("name", "") for t in (item.get("tags", []) or [])],
            "eps": item.get("eps_count", 0) or item.get("eps", 0),
            "air_date": item.get("air_date", ""),
            "platform": item.get("platform", ""),
            "summary": item.get("summary", ""),
        })

    return {"total": data.get("results", len(results)), "items": results}


async def get_subject_detail(bgm_id: int) -> dict[str, Any] | None:
    """Get detailed info for a single Bangumi subject.

    API: GET /v0/subjects/{id}
    """
    url = f"{BANGUMI_API_BASE}/v0/subjects/{bgm_id}"

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(url, headers=HEADERS)
            resp.raise_for_status()
            data = resp.json()
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            logger.error("Bangumi detail failed for %d: %s", bgm_id, e)
            return None

    images = data.get("images", {}) or {}
    rating_info = data.get("rating", {}) or {}
    tags = data.get("tags", []) or []

    return {
        "bgm_id": data.get("id", 0),
        "name": data.get("name", ""),
        "name_cn": data.get("name_cn", ""),
        "cover_url": images.get("large", "") or images.get("common", ""),
        "summary": data.get("summary", ""),
        "eps": data.get("total_episodes", 0) or data.get("eps", 0),
        "air_date": data.get("date", ""),
        "platform": data.get("platform", ""),
        "rating_score": rating_info.get("score", 0),
        "tags": [t.get("name", "") for t in tags],
    }
