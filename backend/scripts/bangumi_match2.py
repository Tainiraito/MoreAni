#!/usr/bin/env python3
"""Bangumi 补搜：为模糊合理 + 未匹配可修复的内容，用标准名补搜并应用。

映射表: {库内 title: (搜索关键词, content_type)}
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bangumi_match import TYPE_MAP, search_bgm  # noqa: E402

from database import SessionLocal  # noqa: E402
from models import ContentItem  # noqa: E402

# 补搜映射：库内标题 -> (搜索关键词, 需验证的子串)
MAP = {
    # ── 合理模糊候选 ──
    '明天，美食广场见': ('明天，美食广场见', '明天，美食广场见'),
    '沉默魔女的秘密': ('Silent Witch 沉默魔女的秘密', '沉默魔女'),
    '天使的心跳': ('天使的心跳', '天使的心跳'),
    '三坪房间的侵略者': ('三坪房间的侵略者', '三坪房间的侵略者'),
    '中二病也要谈恋爱': ('中二病也要谈恋爱', '中二病也要谈恋爱'),
    '寄生兽': ('寄生兽 生命的准则', '寄生兽'),
    '会长是女仆大人': ('会长是女仆大人', '会长是女仆大人'),
    '问题儿童都来自异世界': ('问题儿童都来自异世界', '问题儿童都来自异世界'),
    '学园默示录': ('学园默示录', '学园默示录'),
    '为美好的世界献上祝福': ('为美好的世界献上祝福', '为美好的世界献上祝福'),
    '你的名字': ('你的名字', '你的名字'),
    '俺物语': ('俺物语', '俺物语'),
    '孤独摇滚': ('孤独摇滚', '孤独摇滚'),
    '无职转生': ('无职转生', '无职转生'),
    '想要成为影之实力者': ('想要成为影之实力者', '想要成为影之实力者'),
    # ── 未匹配可修复（标准名补搜）──
    '86 -不存在的战区-': ('86 不存在的战区', '86'),
    '86 -不存在的战区- 第2部分': ('86 不存在的战区 第2部分', '86'),
    '86不存在的战区': ('86 不存在的战区', '86'),
    'Fate/stay night[UBW]': ('Fate/stay night UBW', 'Unlimited Blade Works'),
    "Fate stay night Heaven's Feel Ⅰ/Ⅱ/Ⅲ": (
        "Fate stay night Heaven's Feel",
        "Heaven's Feel",
    ),
    '命运石之门:负荷领域的既视感': ('命运石之门 负荷领域的既视感', '负荷领域的既视感'),
    '我们不可能成为恋人！绝对不行。（似乎可行？）': (
        '我们不可能成为恋人',
        '我们不可能成为恋人',
    ),
    '赛马娘特别周': ('赛马娘 Pretty Derby', '赛马娘'),
    '赛马娘东海帝皇': ('赛马娘 Pretty Derby', '赛马娘'),
    '药屋少女的呢喃S1': ('药屋少女的呢喃 第一季', '药屋少女的呢喃'),
    '药屋少女的呢喃S2': ('药屋少女的呢喃 第二季', '药屋少女的呢喃'),
    '未闻花名': ('我们仍未知道那天所看见的花的名字', '未闻花名'),
    'Fate Zero': ('Fate/Zero', 'Fate/Zero'),
    '命运石之门:0': ('命运石之门 0', '命运石之门 0'),
    '秒速五厘米': ('秒速5厘米', '秒速'),
    '吊带袜天使1/2': ('吊带袜天使', '吊带袜天使'),
    'Love Live！！！谬斯！': ('Love Live!', 'Love Live'),
    '笨蛋测验召唤兽': ('笨蛋测验召唤兽', '笨蛋测验召唤兽'),
    '斩赤红之瞳': ('斩赤红之瞳', '斩赤红之瞳'),
    'Fate/stay night': ('Fate/stay night', 'Fate/stay night'),
    '请问您今天要点兔子吗': ('请问您今天要来点兔子吗', '兔子'),
    '在地下城寻找邂逅是否搞错了什么': (
        '在地下城寻找邂逅是否搞错了什么',
        '在地下城寻找邂逅',
    ),
    'Love Live！！！水团！': ('Love Live! Sunshine', 'Sunshine'),
    '钢之炼金术师03版': ('钢之炼金术师 2003', '钢之炼金术师'),
    '钢之炼金术师09版': ('钢之炼金术师 FULLMETAL', 'FULLMETAL'),
    '幻界战线': ('血界战线', '血界战线'),
    'Re:0': ('从零开始的异世界生活', '从零开始的异世界生活'),
    '欢迎来到实力至上的教室': ('欢迎来到实力至上主义的教室', '实力至上'),
    'megelo box': ('MEGALOBOX', 'MEGALOBOX'),
    '关于我转生变成史莱姆那档事': ('关于我转生变成史莱姆', '史莱姆'),
    'citrus~柑橘味香气~': ('citrus', 'citrus'),
    'lycoris recoil（莉可丽丝）': ('莉可丽丝', '莉可丽丝'),
    '网购技能开启异世界美食之旅': ('拥有超常技能的异世界流浪美食家', '超常技能'),
    '没落要塞/DECA-DENCE': ('DECA-DENCE', 'DECA-DENCE'),
    '动物狂想曲/BEASTARS': ('BEASTARS', 'BEASTARS'),
    '明日酱的水手服': ('明日同学的水手服', '明日同学'),
    '魔法师的新娘': ('魔法使的新娘 第一季', '魔法使的新娘'),
    'BangDream S1/S2/S3': ('BanG Dream!', 'BanG Dream'),
    "It's Mygo!!!!!": ("BanG Dream! It's MyGO", 'MyGO'),
    '我推的孩子S1': ('我推的孩子 第一季', '我推的孩子'),
    '我推的孩子S2': ('我推的孩子 第二季', '我推的孩子'),
    '电锯人：蕾塞篇': ('剧场版 链锯人 蕾塞篇', '蕾塞'),
    'Fate Strange Fake': ('Fate/strange Fake', 'strange Fake'),
    '咒术回战第三季': ('咒术回战 死灭回游', '死灭回游'),
    '超时空的辉夜姬': ('超时空辉夜姬', '辉夜姬'),
    '躲在超市后门抽烟的二人': ('在超市后门吸烟的二人', '超市后门'),
}


async def run():
    db = SessionLocal()
    updated = 0
    failed = []
    for i, (title, (keyword, verify)) in enumerate(MAP.items(), 1):
        items = (
            db.query(ContentItem)
            .filter(
                ContentItem.title == title,
                ContentItem.deleted_at.is_(None),
                ContentItem.source_type != 'bangumi',
            )
            .all()
        )
        if not items:
            print(f'[{i}/{len(MAP)}] {title}: 库中无此内容')
            continue
        item = items[0]
        bgm_type = TYPE_MAP.get(item.content_type, 2)
        results = await search_bgm(keyword, bgm_type, limit=10)
        best = None
        for s in results:
            name = (s.get('name') or '') + (s.get('name_cn') or '')
            if verify in name:
                best = s
                break
        if not best:
            # 宽容：第一个结果若名称高度相关也接受
            fn = (results[0].get('name') or '') + (results[0].get('name_cn') or '') if results else ''
            if fn and verify in fn and (keyword.split()[0] in fn or fn.split()[0] in keyword):
                best = results[0]
        if best:
            image = (best.get('images') or {}).get('large', '') or (best.get('images') or {}).get('medium', '')
            summary = (best.get('summary') or '').strip()
            item.cover_url = image or item.cover_url
            if summary and not item.description:
                item.description = summary
            item.source_type = 'bangumi'
            item.source_id = str(best.get('id', ''))
            if not item.release_date and best.get('air_date'):
                item.release_date = best['air_date'][:7]
            db.commit()
            updated += 1
            print(f'[{i}/{len(MAP)}] ✅ {title} → {best.get("name_cn") or best.get("name")}')
        else:
            failed.append(title)
            print(f'[{i}/{len(MAP)}] ❌ {title}（搜 "{keyword}" 无匹配）')
        await asyncio.sleep(0.8)

    print(f'\n=== 补搜完成: 更新 {updated} 条，失败 {len(failed)} 条 ===')
    if failed:
        print('未找到的：', '、'.join(failed))
    db.close()


if __name__ == '__main__':
    asyncio.run(run())
