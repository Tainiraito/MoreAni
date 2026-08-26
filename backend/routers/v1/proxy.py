"""Image proxy router — bypass CORP/CORS restrictions for external images."""

from __future__ import annotations

import asyncio
import os
import threading
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

router = APIRouter(prefix='/proxy', tags=['proxy'])

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
}
ALLOWED_DOMAINS = (
    'lain.bgm.tv',
    'bgm.tv',
    'bangumi.tv',
    'upload.wikimedia.org',
    'assets.vercel.com',
)
HTTP_PROXY = os.environ.get('http_proxy') or os.environ.get('HTTP_PROXY')
HTTPS_PROXY = os.environ.get('https_proxy') or os.environ.get('HTTPS_PROXY')
MAX_IMAGE_BYTES = 8 * 1024 * 1024
_clients: dict[str, httpx.AsyncClient] = {}
_clients_lock = threading.Lock()


def _is_allowed(url: str) -> bool:
    """Validate URL scheme and exact host/subdomain allowlist."""
    parsed = urlparse(url)
    if parsed.scheme not in {'http', 'https'} or not parsed.hostname:
        return False
    hostname = parsed.hostname.lower().rstrip('.')
    return any(hostname == domain or hostname.endswith(f'.{domain}') for domain in ALLOWED_DOMAINS)


def _env_max_bytes() -> int:
    try:
        return max(1, int(os.getenv('MOREANI_PROXY_IMAGE_MAX_BYTES', str(MAX_IMAGE_BYTES))))
    except (TypeError, ValueError):
        return MAX_IMAGE_BYTES


def _client_for(url: str) -> httpx.AsyncClient:
    """Return a process-shared connection-pooling client for the URL scheme."""
    parsed = urlparse(url)
    proxy = HTTPS_PROXY if parsed.scheme == 'https' else HTTP_PROXY
    key = proxy or 'direct'
    with _clients_lock:
        client = _clients.get(key)
        if client is None or client.is_closed:
            timeout = httpx.Timeout(15.0, connect=5.0, read=15.0, pool=5.0)
            client = httpx.AsyncClient(timeout=timeout, follow_redirects=False, proxy=proxy, trust_env=False)
            _clients[key] = client
        return client


async def close_proxy_clients() -> None:
    """Close shared proxy clients during application shutdown."""
    with _clients_lock:
        clients = list(_clients.values())
        _clients.clear()
    if clients:
        await asyncio.gather(*(client.aclose() for client in clients))


async def _fetch_image(url: str) -> tuple[bytes, str]:
    """Fetch an allowlisted image with bounded redirects and response size."""
    if not _is_allowed(url):
        raise HTTPException(status_code=403, detail='Domain not allowed')
    max_bytes = _env_max_bytes()
    fetch_url = url
    for _ in range(4):
        if not _is_allowed(fetch_url):
            raise HTTPException(status_code=403, detail='Domain not allowed')
        client = _client_for(fetch_url)
        try:
            async with client.stream('GET', fetch_url, headers=HEADERS) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get('location')
                    if not location:
                        raise HTTPException(status_code=502, detail='Image redirect missing location')
                    fetch_url = urljoin(fetch_url, location)
                    continue
                if response.status_code != 200:
                    raise HTTPException(status_code=response.status_code, detail='Failed to fetch image')
                content_type = response.headers.get('content-type', 'image/jpeg').split(';', 1)[0].strip()
                if not content_type.startswith('image/'):
                    raise HTTPException(status_code=502, detail='Upstream response is not an image')
                try:
                    content_length = int(response.headers.get('content-length', '0') or 0)
                except ValueError:
                    content_length = 0
                if content_length > max_bytes:
                    raise HTTPException(status_code=413, detail='Image is too large')
                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > max_bytes:
                        raise HTTPException(status_code=413, detail='Image is too large')
                    chunks.append(chunk)
                return b''.join(chunks), content_type
        except HTTPException:
            raise
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail='Network error while fetching image') from exc
    raise HTTPException(status_code=502, detail='Too many image redirects')


@router.get('/image')
async def proxy_image(url: str = Query(..., description='Image URL to proxy')) -> Response:
    """Proxy external images to bypass CORP/CORS restrictions."""
    content, content_type = await _fetch_image(url)
    return Response(
        content=content,
        media_type=content_type,
        headers={
            'Cache-Control': 'public, max-age=86400',
            'Access-Control-Allow-Origin': '*',
        },
    )
