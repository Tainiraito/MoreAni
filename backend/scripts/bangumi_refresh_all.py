#!/usr/bin/env python3
"""Bangumi 全量字段校对：按已关联的 source_id 调详情 API，重新获取所有字段。

用法:
    python3 scripts/bangumi_refresh_all.py --dry-run    # 只打印差异，不写库
    python3 scripts/bangumi_refresh_all.py              # 写入数据库
"""

import argparse
import asyncio
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal  # noqa: E402
from models import ContentItem  # noqa: E402
from services.bangumi import get_subject_detail  # noqa: E402
from services.content import _attach_tags  # noqa: E402


def clean_summary(text: str) -> str:
    """清理 Bangumi 简介脏格式。"""
    if not text:
        return ''
    text = text.replace('\u3000', ' ')  # 全角空格
    text = text.replace('\r\n', '\n').replace('\r', '\n')  # 统一换行
    text = re.sub(r'=+', '', text)  # 分隔线
    text = re.sub(r'\n\s*\n\s*\n+', '\n\n', text)  # 多余空行
    return text.strip()


def _pair_similar(a: str, b: str) -> bool:
    """两个标题是否相似（相等 / 互相包含(≥4字) / 去标点后共同字符占比 ≥60%）。"""
    if not a or not b:
        return False
    if a == b:
        return True
    if a in b or b in a:
        # 太短的子串（如「赛马娘」3 字）不算有效匹配，防角色名误配动画本体
        return min(len(a), len(b)) >= 4
    pa = set(re.sub(r'[\s\-—–:：.。·~～・]', '', a.lower()))
    pb = set(re.sub(r'[\s\-—–:：.。·~～・]', '', b.lower()))
    if not pa or not pb:
        return False
    return len(pa & pb) / min(len(pa), len(pb)) >= 0.6


def title_similar(our_titles: list[str], bgm_titles: list[str]) -> bool:
    """组合匹配：库里 title/title_alt 与 Bangumi name_cn/name 任一组合相似即通过。

    救回译名差异大的同番（如 GIRLS BAND CRY ↔ 少女乐队的呐喊）。
    """
    return any(_pair_similar(a, b) for a in our_titles for b in bgm_titles)


# 真错配黑名单：保持无来源（当前为空；曾含赛马娘特别周/东海帝皇，已确认是
# 用角色名作标题的第一季/第二季，2026-08-16 已正确关联 212003/315574 并移除）
SKIP_IDS: set[int] = set()
# 已人工确认为同一番但译名差异过大（相似度不足）→ 强制按详情更新
FORCE_IDS = {202}


def _year_diff(a: str, b: str) -> int:
    """两个日期字符串的年份差（解析失败返回大数，视为不可信）。"""
    try:
        return abs(int(a[:4]) - int(b[:4]))
    except (TypeError, ValueError):
        return 999


async def refresh_one(db, item: ContentItem, apply: bool) -> dict | None:
    """获取详情并计算字段差异；apply=True 时写入。

    返回: {'id', 'title', 'changes'} 或 {'id', 'title', 'mismatch'/'skipped': True} 或 None(获取失败)。
    """
    if item.id in SKIP_IDS:
        return {'id': item.id, 'title': item.title, 'skipped': True}
    try:
        detail = await get_subject_detail(int(item.source_id))
    except (TypeError, ValueError):
        return None
    if not detail:
        return None

    name = (detail.get('name') or '').strip()
    name_cn = (detail.get('name_cn') or '').strip()
    new_title = name_cn or name

    # ⚠️ 标题对不上 = 疑似 source_id 关联错片 → 不硬校对，整条跳过（只记录，不动库）
    # 组合匹配：title/title_alt 与 name_cn/name 任一相似即通过（译名差异大的同番也能救回）
    if not title_similar([item.title, item.title_alt or ''], [name_cn, name]) and item.id not in FORCE_IDS:
        return {'id': item.id, 'title': item.title, 'mismatch': True}

    summary = clean_summary(detail.get('summary') or '')
    eps = detail.get('eps') or 0
    air_date = (detail.get('air_date') or '').strip()
    platform = (detail.get('platform') or '').strip()
    cover = (detail.get('cover_url') or '').strip()
    tags = list(dict.fromkeys(t for t in (detail.get('tags') or []) if t))  # 去重：Bangumi 标签可能有重复名

    new_title_alt = name if name_cn else item.title_alt  # 无中文名不动别名

    changes = []
    if new_title and new_title != item.title:
        changes.append(('标题', item.title, new_title))
    if new_title_alt != item.title_alt:
        changes.append(('别名', item.title_alt, new_title_alt))
    if cover and cover != item.cover_url:
        changes.append(('封面', item.cover_url[:40], cover[:40]))
    if summary and summary != (item.description or ''):
        changes.append(('简介', f'{len(item.description or "")}字', f'{len(summary)}字'))
    # 集数只增不减：减少通常是 Bangumi 拆条/关联错，保护用户数据
    if eps and eps > item.episodes:
        changes.append(('集数', item.episodes, eps))
    # 日期：空则填；非空仅年份差 ≤1 才更新（跨年跳变 = 疑似错配）
    date_ok = bool(
        air_date
        and air_date != item.release_date
        and (not item.release_date or _year_diff(air_date, item.release_date) <= 1)
    )
    if date_ok:
        changes.append(('日期', item.release_date, air_date))
    if platform and platform != item.platform:
        changes.append(('平台', item.platform or '(空)', platform))
    if tags and tags != [t.name for t in (item.tags or [])]:
        changes.append(('标签', f'{len(item.tags or [])}个', f'{len(tags)}个'))

    if apply and (changes or tags):
        if new_title:
            item.title = new_title
        item.title_alt = new_title_alt
        if cover:
            item.cover_url = cover
        if summary:
            item.description = summary
        if eps and eps > item.episodes:
            item.episodes = eps
        if date_ok:
            item.release_date = air_date
        if platform:
            item.platform = platform
        if tags:
            _attach_tags(db, item, tags)
        db.commit()

    return {'id': item.id, 'title': item.title, 'changes': changes}


async def run(apply: bool) -> None:
    db = SessionLocal()
    items = db.query(ContentItem).filter(ContentItem.source_type == 'bangumi', ContentItem.deleted_at.is_(None)).all()
    print(f'=== 共 {len(items)} 条 Bangumi 条目，开始校对（{"写入" if apply else "dry-run"}）===\n')
    ok = failed = skipped = changed = 0
    for i, item in enumerate(items, 1):
        result = await refresh_one(db, item, apply)
        if result is None:
            failed += 1
            print(f'[{i}/{len(items)}] ❌ {item.title} (id={item.id}) — 详情获取失败')
        elif result.get('mismatch'):
            skipped += 1
            print(f'[{i}/{len(items)}] ⚠️ {result["title"]} (id={result["id"]}) — 标题对不上，疑似错配，跳过')
        elif result.get('skipped'):
            skipped += 1
            print(f'[{i}/{len(items)}] ⛔ {result["title"]} (id={result["id"]}) — 黑名单跳过（真错配，保持无来源）')
        else:
            ok += 1
            if result['changes']:
                changed += 1
                print(f'[{i}/{len(items)}] ✏️ {result["title"]} (id={item.id})')
                for field, old, new in result['changes']:
                    print(f'      {field}: {old!r} → {new!r}')
        await asyncio.sleep(0.8)  # 防 Bangumi 限流

    print(f'\n=== 完成: 成功 {ok}，获取失败 {failed}，疑似错配跳过 {skipped}，有差异 {changed} 条 ===')
    if apply:
        print('✅ 已写入数据库')
    else:
        print('ℹ️ dry-run 模式未写入，确认后运行不带 --dry-run 执行')
    db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Bangumi 全量字段校对')
    parser.add_argument('--dry-run', action='store_true', help='只打印差异不写库')
    args = parser.parse_args()
    asyncio.run(run(apply=not args.dry_run))
