#!/usr/bin/env python3
"""Bangumi 匹配：为手动导入的内容匹配 Bangumi 数据（封面/简介/年份）。

用法:
  python3 scripts/bangumi_match.py --dry-run   # 只输出匹配报告，不更新
  python3 scripts/bangumi_match.py --apply     # 精确匹配的更新；模糊/未匹配打印清单

匹配不上（模糊或未命中）不硬匹配，打印清单等待人工确认。
"""

import asyncio
import os
import sys

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal  # noqa: E402
from models import ContentItem  # noqa: E402

BANGUMI_API = 'https://api.bgm.tv'
HEADERS = {'User-Agent': 'MoreAni/2.0 (https://moreani.lovelysia.top)'}
PROXY = os.environ.get('HTTPS_PROXY') or 'http://192.168.31.45:7890'


async def search_bgm(keyword: str, subject_type: int, limit: int = 10) -> list[dict]:
    """搜索 Bangumi：直连 5s 超时，失败回退代理。"""
    url = f'{BANGUMI_API}/search/subject/{keyword}'
    params = {'responseGroup': 'large', 'max_results': limit, 'type': subject_type}
    for proxy in (None, PROXY):
        try:
            async with httpx.AsyncClient(timeout=6.0, proxy=proxy) as client:
                resp = await client.get(url, params=params, headers=HEADERS)
                resp.raise_for_status()
                data = resp.json()
                return (data or {}).get('list', []) or []
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            print(f'    [bangumi {proxy or "direct"} fail] {type(e).__name__}')
    return []


TYPE_MAP = {'anime': 2, 'movie': 2, 'game': 6}
BGMI_TYPE_LABEL = {2: 'anime', 6: 'game'}


def normalize(s: str) -> str:
    return ''.join(s.lower().split())


async def match_one(item: ContentItem) -> dict:
    """返回 {status: exact|fuzzy|none, bgm: {...} | None, candidates: [...]}"""
    bgm_type = TYPE_MAP.get(item.content_type)
    if bgm_type is None:
        return {'status': 'skip', 'bgm': None, 'candidates': []}

    # 尝试主标题
    candidates = await search_bgm(item.title, bgm_type, limit=10)

    # 主标题精确匹配
    ntitle = normalize(item.title)
    for s in candidates:
        if normalize(s.get('name', '')) == ntitle or normalize(s.get('name_cn', '')) == ntitle:
            return {'status': 'exact', 'bgm': s, 'candidates': candidates[:5]}

    # 别名匹配
    for alt in [a for a in (item.title_alt or '').split(' / ') if a]:
        for s in candidates:
            if normalize(s.get('name', '')) == normalize(alt) or normalize(s.get('name_cn', '')) == normalize(alt):
                return {'status': 'exact', 'bgm': s, 'candidates': candidates[:5]}

    # 模糊：标题包含或候选包含（长度 > 2 防误匹配）
    def fuzzy(hay: str, needle: str) -> bool:
        if len(needle) < 3:
            return False
        return needle in hay or hay in needle

    for s in candidates:
        names = [normalize(s.get('name', '')), normalize(s.get('name_cn', ''))]
        if any(fuzzy(n, ntitle) for n in names if n):
            return {'status': 'fuzzy', 'bgm': s, 'candidates': candidates[:5]}

    return {'status': 'none', 'bgm': None, 'candidates': candidates[:5]}


async def run(apply: bool):
    db = SessionLocal()
    items = (
        db.query(ContentItem)
        .filter(
            ContentItem.deleted_at.is_(None),
            ContentItem.source_type != 'bangumi',
            ContentItem.content_type.in_(['anime', 'movie', 'game']),
        )
        .order_by(ContentItem.id)
        .all()
    )
    print(f'待匹配内容: {len(items)} 条')

    exact, fuzzy, none_, skipped = [], [], [], []
    for i, item in enumerate(items):
        result = await match_one(item)
        status = result['status']
        label = f'[{i + 1}/{len(items)}] {item.title}'
        if status == 'skip':
            skipped.append(item)
            continue
        if status == 'exact':
            exact.append((item, result['bgm']))
            print(f'{label} → ✅ 精确: {result["bgm"].get("name_cn") or result["bgm"].get("name")}')
        elif status == 'fuzzy':
            fuzzy.append((item, result['bgm'], result['candidates']))
            print(f'{label} → ⚠️ 模糊: {result["bgm"].get("name_cn") or result["bgm"].get("name")}')
        else:
            none_.append((item, result['candidates']))
            print(f'{label} → ❌ 未匹配')
        await asyncio.sleep(0.8)  # Bangumi 限流保护

    print('\n=== 报告 ===')
    print(
        f'精确匹配: {len(exact)}  模糊候选: {len(fuzzy)}  未匹配: {len(none_)}  '
        f'跳过(非anime/movie/game): {len(skipped)}'
    )

    if not apply:
        print('\n[dry-run] 未更新数据库。确认后加 --apply 应用精确匹配。')
        db.close()
        return

    # 应用精确匹配：更新封面/简介/来源
    updated = 0
    for item, bgm in exact:
        image = (bgm.get('images') or {}).get('large', '') or (bgm.get('images') or {}).get('medium', '')
        summary = (bgm.get('summary') or '').strip()
        name_cn = bgm.get('name_cn') or ''
        changed = False
        if image and (not item.cover_url or item.source_type != 'bangumi'):
            item.cover_url = image
            changed = True
        if summary and not item.description:
            item.description = summary
            changed = True
        item.source_type = 'bangumi'
        item.source_id = str(bgm.get('id', ''))
        item.title_alt = name_cn or item.title_alt
        if not item.release_date:
            air = bgm.get('air_date', '')
            if air:
                item.release_date = air[:7]
        if changed or item.source_type == 'bangumi':
            updated += 1
    db.commit()
    print(f'已更新 {updated} 条（封面/简介/来源）')

    if fuzzy:
        print('\n=== 模糊候选（待确认）===')
        for item, _best, cands in fuzzy:
            print(f'\n{item.title} (type={item.content_type}):')
            for c in cands[:5]:
                print(f'  - {c.get("name_cn") or c.get("name")} [{c.get("id")}]')
    if none_:
        print('\n=== 未匹配（待确认）===')
        for item, cands in none_:
            print(f'\n{item.title} (type={item.content_type}):')
            for c in cands[:3]:
                print(f'  - {c.get("name_cn") or c.get("name")} [{c.get("id")}]')

    db.close()


if __name__ == '__main__':
    apply = '--apply' in sys.argv
    asyncio.run(run(apply))
