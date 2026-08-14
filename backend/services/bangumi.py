"""Bangumi service — API client for Bangumi."""

import httpx

BASE_URL = "https://api.bgm.tv"
HEADERS = {"User-Agent": "MoreAni/2.0"}


async def search_subjects(keyword: str, limit: int = 10) -> list[dict]:
    """Search Bangumi subjects."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{BASE_URL}/search/subject/{keyword}",
            params={"responseGroup": "large", "type": 2, "max_results": limit},
            headers=HEADERS,
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", [])


async def get_subject_detail(bgm_id: int) -> dict:
    """Get detailed info for a Bangumi subject."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{BASE_URL}/v0/subjects/{bgm_id}",
            headers=HEADERS,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()
