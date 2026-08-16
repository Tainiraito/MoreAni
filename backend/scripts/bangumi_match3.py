#!/usr/bin/env python3
"""Bangumi 第三轮：修正错误匹配 + 重试失败项（force 覆盖已有 bangumi 记录）。"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bangumi_match import TYPE_MAP, search_bgm  # noqa: E402

from database import SessionLocal  # noqa: E402
from models import ContentItem  # noqa: E402

# title -> (搜索关键词, 验证子串)
MAP = {
    # ── 修正错误匹配（force 覆盖）──
    '药屋少女的呢喃S1': ('药屋少女的呢喃 第一季', '第一季'),
    '我推的孩子S1': ('我推的孩子 第一季', '第一季'),
    'Love Live！！！水团！': ('Love Live! Sunshine!!', 'Sunshine'),
    '钢之炼金术师03版': ('钢之炼金术师', '2003'),
    '魔法师的新娘': ('魔法使的新娘', '第一季'),
    # ── 重试失败项（换关键词）──
    'Fate/stay night[UBW]': ('Unlimited Blade Works', 'Unlimited Blade Works'),
    'Fate Zero': ('Fate Zero', 'Fate/Zero'),
    'Love Live！！！谬斯！': ('LoveLive', 'Love Live'),
    '笨蛋测验召唤兽': ('笨蛋 测验 召唤兽', '召唤兽'),
    '斩赤红之瞳': ('斩·赤红之瞳', '赤红之瞳'),
    'Fate/stay night': ('Fate stay night', 'Fate/stay night'),
    '在地下城寻找邂逅是否搞错了什么': (
        '在地下城寻找邂逅是否搞错了什么 第一季',
        '在地下城',
    ),
    'megelo box': ('MEGALO BOX', 'MEGALO'),
    '没落要塞/DECA-DENCE': ('没落要塞', '没落要塞'),
    'BangDream S1/S2/S3': ('BanG Dream 第一季', 'BanG Dream'),
    "It's Mygo!!!!!": ('MyGO', 'MyGO'),
    'Fate Strange Fake': ('Fate Strange Fake', 'Strange Fake'),
}


async def run():
    db = SessionLocal()
    updated = 0
    failed = []
    for i, (title, (keyword, verify)) in enumerate(MAP.items(), 1):
        items = db.query(ContentItem).filter(ContentItem.title == title, ContentItem.deleted_at.is_(None)).all()
        if not items:
            print(f'[{i}/{len(MAP)}] {title}: 库中无此内容')
            continue
        item = items[0]
        bgm_type = TYPE_MAP.get(item.content_type, 2)
        results = await search_bgm(keyword, bgm_type, limit=15)
        best = None
        for s in results:
            name = (s.get('name') or '') + (s.get('name_cn') or '')
            if verify in name:
                best = s
                break
        if best:
            image = (best.get('images') or {}).get('large', '') or (best.get('images') or {}).get('medium', '')
            summary = (best.get('summary') or '').strip()
            item.cover_url = image or item.cover_url
            if summary:
                item.description = summary
            item.source_type = 'bangumi'
            item.source_id = str(best.get('id', ''))
            if not item.release_date and best.get('air_date'):
                item.release_date = best['air_date'][:7]
            db.commit()
            updated += 1
            print(f'[{i}/{len(MAP)}] ✅ {title} → {best.get("name_cn") or best.get("name")} [{best.get("id")}]')
        else:
            failed.append(title)
            print(f'[{i}/{len(MAP)}] ❌ {title}（搜 "{keyword}" 无匹配）')
        await asyncio.sleep(0.8)

    print(f'\n=== 修正完成: 更新 {updated} 条，失败 {len(failed)} 条 ===')
    if failed:
        print('仍未找到的：', '、'.join(failed))
    db.close()


if __name__ == '__main__':
    asyncio.run(run())
