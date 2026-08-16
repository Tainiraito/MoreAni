#!/usr/bin/env python3
"""封面本地化：把外链封面下载到本地 covers/ 目录，DB cover_url 改为 /api/covers/{id}.jpg。

用法:
    COVERS_DIR=backend/covers python3 scripts/download_covers.py --dry-run   # 预览
    COVERS_DIR=backend/covers python3 scripts/download_covers.py             # 执行

容器内（NAS）：docker exec moreani-app python3 /app/backend/scripts/download_covers.py
（容器已配 COVERS_DIR=/app/data/covers + 代理 env）
"""
import argparse
import asyncio
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402

from database import SessionLocal  # noqa: E402
from models import ContentItem  # noqa: E402

COVERS_DIR = os.getenv('COVERS_DIR', 'covers')
PROXY = (
    os.environ.get('HTTPS_PROXY')
    or os.environ.get('https_proxy')
    or os.environ.get('HTTP_PROXY')
    or os.environ.get('http_proxy')
    or 'http://192.168.31.45:7890'
)

EXT_BY_URL = {
    '.jpg': '.jpg', '.jpeg': '.jpg', '.png': '.png', '.webp': '.webp', '.gif': '.gif',
}


def pick_ext(url: str) -> str:
    """从 URL 推断扩展名；无法推断用 .jpg。"""
    m = re.search(r'\.(jpe?g|png|webp|gif)(?:\?|$)', url.lower())
    return EXT_BY_URL.get(m.group(1) if m else '', '.jpg')


async def download(url: str, path: str) -> bool:
    """直连失败回退代理。"""
    for proxy in (None, PROXY):
        try:
            async with httpx.AsyncClient(timeout=15.0, proxy=proxy, follow_redirects=True) as client:
                resp = await client.get(url, headers={'User-Agent': 'MoreAni/2.0 (https://moreani.lovelysia.top)'})
                resp.raise_for_status()
                with open(path, 'wb') as f:
                    f.write(resp.content)
                return True
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            print(f'    [{proxy or "direct"} fail] {type(e).__name__}')
    return False


async def run(dry_run: bool) -> None:
    os.makedirs(COVERS_DIR, exist_ok=True)
    db = SessionLocal()
    items = (
        db.query(ContentItem)
        .filter(ContentItem.deleted_at.is_(None))
        .all()
    )
    todo = [i for i in items if (i.cover_url or '').strip() and not i.cover_url.startswith('/api/covers/')]
    print(f'=== 共 {len(items)} 条内容，需要本地化的封面 {len(todo)} 张（目标: {COVERS_DIR}）===\n')
    ok = failed = 0
    for i, item in enumerate(todo, 1):
        ext = pick_ext(item.cover_url)
        path = os.path.join(COVERS_DIR, f'{item.id}{ext}')
        new_url = f'/api/covers/{item.id}{ext}'
        if dry_run:
            print(f'[{i}/{len(todo)}] {item.title}: {item.cover_url[:50]}… → {new_url}')
            continue
        success = await download(item.cover_url, path)
        if success:
            item.cover_url = new_url
            db.commit()
            ok += 1
            print(f'[{i}/{len(todo)}] ✅ {item.title} → {new_url}')
        else:
            failed += 1
            print(f'[{i}/{len(todo)}] ❌ {item.title} 下载失败，保持外链')
        await asyncio.sleep(0.3)  # 防限流

    print(f'\n=== 完成: 成功 {ok}，失败 {failed} ===')
    db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='封面本地化')
    parser.add_argument('--dry-run', action='store_true', help='只预览不执行')
    args = parser.parse_args()
    asyncio.run(run(dry_run=args.dry_run))
