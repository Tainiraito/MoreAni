"""Image proxy router — bypass CORP/CORS restrictions for external images."""

import os

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

router = APIRouter(prefix='/proxy', tags=['proxy'])

# Common browser headers
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
}

# Get proxy from environment
HTTP_PROXY = os.environ.get('http_proxy') or os.environ.get('HTTP_PROXY')
HTTPS_PROXY = os.environ.get('https_proxy') or os.environ.get('HTTPS_PROXY')


@router.get('/image')
async def proxy_image(url: str = Query(..., description='Image URL to proxy')):
    """Proxy external images to bypass CORP/CORS restrictions.

    Usage: /api/v1/proxy/image?url=https://lain.bgm.tv/pic/cover/...
    """
    # Only allow specific domains for security
    allowed_domains = [
        'lain.bgm.tv',
        'bgm.tv',
        'bangumi.tv',
        'upload.wikimedia.org',
        'assets.vercel.com',
    ]

    # Validate URL domain
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if not any(
        parsed.hostname and parsed.hostname.endswith(d) for d in allowed_domains
    ):
        raise HTTPException(status_code=403, detail='Domain not allowed')

    # Determine proxy for this URL
    proxy = None
    if url.startswith('https://') and HTTPS_PROXY:
        proxy = HTTPS_PROXY
    elif url.startswith('http://') and HTTP_PROXY:
        proxy = HTTP_PROXY

    # Fetch image
    async with httpx.AsyncClient(
        timeout=15,
        follow_redirects=True,
        proxy=proxy,
    ) as client:
        try:
            resp = await client.get(url, headers=HEADERS)
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=resp.status_code, detail='Failed to fetch image'
                )
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f'Network error: {e}') from e

    # Return image with proper headers
    content_type = resp.headers.get('content-type', 'image/jpeg')
    return Response(
        content=resp.content,
        media_type=content_type,
        headers={
            'Cache-Control': 'public, max-age=86400',  # Cache 24h
            'Access-Control-Allow-Origin': '*',
        },
    )
