"""封面本地化：保存内容时把外链封面下载到本地 covers/。

搜索不下载（仅预览）；确认添加/保存时才下载，失败降级保留外链（走代理）。
"""
import os
import re

import httpx

COVERS_DIR = os.getenv('COVERS_DIR', 'covers')
PROXY = (
    os.environ.get('HTTPS_PROXY')
    or os.environ.get('https_proxy')
    or os.environ.get('HTTP_PROXY')
    or os.environ.get('http_proxy')
    or 'http://192.168.31.45:7890'
)
HEADERS = {'User-Agent': 'MoreAni/2.0 (https://moreani.lovelysia.top)'}


def _pick_ext(url: str) -> str:
    """从 URL 推断扩展名；无法推断用 .jpg。"""
    m = re.search(r'\.(jpe?g|png|webp|gif)(?:\?|$)', url.lower())
    return {'.jpeg': '.jpg', '.jpg': '.jpg', '.png': '.png', '.webp': '.webp', '.gif': '.gif'}.get(
        m.group(1) if m else '', '.jpg'
    )


def _download_sync(url: str, path: str) -> bool:
    """直连失败回退代理（同步版，供同步路由使用）。"""
    for proxy in (None, PROXY):
        try:
            with httpx.Client(timeout=15.0, proxy=proxy, follow_redirects=True) as client:
                resp = client.get(url, headers=HEADERS)
                resp.raise_for_status()
                with open(path, 'wb') as f:
                    f.write(resp.content)
                return True
        except (httpx.HTTPError, httpx.TimeoutException):
            continue
    return False


def localize_cover(item, cover_url: str | None) -> str | None:
    """把外链封面下载到本地，item.cover_url 更新为 /api/covers/{id}.jpg。

    返回最终 cover_url；下载失败返回原 URL（降级外链，前端走代理）。
    """
    if not cover_url or cover_url.startswith('/api/covers/'):
        return cover_url
    try:
        os.makedirs(COVERS_DIR, exist_ok=True)
        ext = _pick_ext(cover_url)
        path = os.path.join(COVERS_DIR, f'{item.id}{ext}')
        if _download_sync(cover_url, path):
            local = f'/api/covers/{item.id}{ext}'
            item.cover_url = local
            return local
    except Exception:  # noqa: BLE001
        pass
    return cover_url
