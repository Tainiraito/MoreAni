#!/usr/bin/env python3
"""Bangumi 第四轮：修正季数错位/匹配错片（搜索基础名 + 精确验证季数）。"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bangumi_match import search_bgm, TYPE_MAP  # noqa: E402
from database import SessionLocal  # noqa: E402
from models import ContentItem  # noqa: E402

# title -> (搜索关键词, [可接受验证子串列表], [排除子串列表])
MAP = {
    '药屋少女的呢喃S1': ('药屋少女的呢喃', ['第一季', '第1季', '第 1 季'], ['第二季', '第2季']),
    '我推的孩子S1': ('我推的孩子', ['第一季', '第1季', '第 1 季'], ['第二季', '第2季', '第三季', '第3季']),
    'Love Live！！！水团！': ('Love Live', ['Sunshine'], ['电影', '虹咲', 'Superstar']),
    '钢之炼金术师03版': ('钢之炼金术师', ['2003'], ['FULLMETAL', '03版']),
    '魔法师的新娘': ('魔法使的新娘', ['第一季', '第1季', '第 1 季'], ['第二季', '第2季']),
    'Love Live！！！谬斯！': ('Love Live', ['学园偶像计划', 'Love Live!'], ['Sunshine', '电影', '虹咲', 'Superstar']),
    'BangDream S1/S2/S3': ('BanG Dream', ['第一季', '第1季', '第 1 季'], ['第二季', '第2季', '第三季', '第3季', 'MyGO', 'Ave']),
    'It\'s Mygo!!!!!': ('MyGO', ['It\'s MyGO', 'MyGO!!!!!'], ['日常生活', 'Ave']),
    '在地下城寻找邂逅是否搞错了什么': ('在地下城寻找邂逅', ['在地下城'], []),
    'Fate Strange Fake': ('Fate Strange Fake', ['strange Fake', 'Strange Fake'], ['TVCM']),
}


async def run():
    db = SessionLocal()
    updated = 0
    failed = []
    for i, (title, (keyword, accepts, rejects)) in enumerate(MAP.items(), 1):
        items = (
            db.query(ContentItem)
            .filter(ContentItem.title == title, ContentItem.deleted_at.is_(None))
            .all()
        )
        if not items:
            print(f'[{i}/{len(MAP)}] {title}: 库中无此内容')
            continue
        item = items[0]
        bgm_type = TYPE_MAP.get(item.content_type, 2)
        results = await search_bgm(keyword, bgm_type, limit=20)
        best = None
        for s in results:
            name = (s.get('name') or '') + (s.get('name_cn') or '')
            if any(a in name for a in accepts) and not any(r in name for r in rejects):
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
            print(f'[{i}/{len(MAP)}] ❌ {title}（搜 "{keyword}" 无满足条件匹配）')
        await asyncio.sleep(0.8)

    print(f'\n=== 修正完成: 更新 {updated} 条，失败 {len(failed)} 条 ===')
    if failed:
        print('未修正的：', '、'.join(failed))
    db.close()


if __name__ == '__main__':
    asyncio.run(run())
