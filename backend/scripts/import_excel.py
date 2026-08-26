#!/usr/bin/env python3
"""导入「极乐净土.xlsx」到 MoreAni 数据库。

用法:
  python3 scripts/import_excel.py --dry-run    # 只解析打印统计，不写库
  python3 scripts/import_excel.py              # 正式导入

数据来源: 人工维护的番剧/游戏/工具清单（4 位朋友：小明/嗒当/翔哥/俊俊）
"""

import os
import re
import secrets
import sys
import zipfile
from xml.etree import ElementTree as ET

XLSX_PATH = '/mnt/f/Downloads/极乐净土.xlsx'

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def parse_xlsx(path: str):
    """解析 xlsx（绕过 openpyxl 的 WPS 样式崩溃）：返回 [(sheet_name, rows), ...]
    rows = list[dict[str, str]]，key 为列字母（A/B/C...）
    """
    with zipfile.ZipFile(path) as z:
        # workbook.xml -> sheet 顺序
        wb = ET.fromstring(z.read('xl/workbook.xml'))
        sheets = []
        for s in wb.find('m:sheets', NS):
            sheets.append(
                (
                    s.get('name'),
                    s.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'),
                )
            )

        # sharedStrings
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            ss = ET.fromstring(z.read('xl/sharedStrings.xml'))
            for si in ss.findall('m:si', NS):
                text = ''.join(
                    t.text or '' for t in si.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')
                )
                shared.append(text)

        # rels: rId -> sheetN.xml
        rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        rel_map = {}
        for r in rels:
            rel_map[r.get('Id')] = r.get('Target')

        result = []
        for name, rid in sheets:
            target = rel_map.get(rid, '')
            if not target.startswith('xl/'):
                target = 'xl/' + target.lstrip('/')
            sheet = ET.fromstring(z.read(target))
            rows = {}
            for c in sheet.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c'):
                ref = c.get('r')  # e.g. A4
                if not ref:
                    continue
                col = re.match(r'[A-Z]+', ref).group(0)
                row = re.search(r'\d+', ref).group(0)
                t = c.get('t')
                v = c.find('m:v', NS)
                val = ''
                if v is not None and v.text:
                    val = v.text
                    if t == 's':
                        val = shared[int(val)]
                elif t == 'inlineStr':
                    is_el = c.find('m:is', NS)
                    if is_el is not None:
                        val = ''.join(
                            tt.text or ''
                            for tt in is_el.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')
                        )
                if val:
                    rows.setdefault(int(row), {})[col] = val
            result.append((name, rows))
    return result


def star_to_score(val: str) -> int | None:
    """★★★★★ -> 10；★★★★☆ -> 8；☆☆☆☆☆ / 空 -> None（不评分）"""
    if not val:
        return None
    full = val.count('★')
    if full == 0:
        return None
    return full * 2


def parse_entries(sheet_rows: dict[int, dict[str, str]], kind: str):
    """把连续行累积成条目。kind: 'content'(A列=类型) / 'tool'(A列=平台)"""
    entries = []
    cur = None
    for row_num in sorted(sheet_rows.keys()):
        r = sheet_rows[row_num]
        a = r.get('A', '').strip()
        if a:
            # 新条目
            cur = {
                '_row': row_num,
                'type_raw': a,
                'cols': {k: [v.strip()] for k, v in r.items()},
            }
            entries.append(cur)
        elif cur is not None:
            # 延续行：合并各列
            for k, v in r.items():
                v = v.strip()
                if v and v not in ('☆☆☆☆☆',):
                    cur['cols'].setdefault(k, []).append(v)
    return entries


def _cells(cols: dict[str, list[str]], key: str) -> list[str]:
    """取某列所有值并按 \n 拆分成行（单元格内换行）"""
    out = []
    for v in cols.get(key, []):
        out.extend(x.strip() for x in v.split('\n'))
    return [x for x in out if x]


def build_content_entry(e: dict) -> dict | None:
    cols = e['cols']
    # 跳过表头行
    if e['type_raw'] == '类型' or e['type_raw'] == '网站、工具':
        return None
    title_lines = _cells(cols, 'B')
    if not title_lines:
        return None
    title = title_lines[0]
    alts = title_lines[1:]
    series = ' / '.join(_cells(cols, 'C'))

    # 类型映射
    type_raw = e['type_raw']
    type_map = {'番剧': 'anime', '动画电影': 'anime_movie', '电影': 'movie', '游戏': 'game'}
    ctype = None
    for key, val in type_map.items():
        if key in type_raw:
            ctype = val
            break
    if ctype is None:
        ctype = 'anime'

    # 放送时间 + 集数
    release_date = ''
    episodes_parts = []
    for d in _cells(cols, 'D'):
        m = re.match(r'(\d{4})年(\d{1,2})月', d)
        if m:
            release_date = f'{m.group(1)}-{int(m.group(2)):02d}'
        elif re.search(r'集|话|分钟|OVA|剧场版|特别篇|回顾篇|季', d):
            episodes_parts.append(d)
    episodes = 0
    em = re.search(r'(\d+)\s*集', ' '.join(episodes_parts))
    if em:
        episodes = int(em.group(1))

    tags = []
    for t in _cells(cols, 'E'):
        tags.extend(x.strip() for x in re.split(r'[,，、]', t) if x.strip())

    # 4 位朋友：评论 F/H/J/L，评分 G/I/K/M（content 表）
    friends = []
    for name, comment_col, score_col in [
        ('小明', 'F', 'G'),
        ('嗒当', 'H', 'I'),
        ('翔哥', 'J', 'K'),
        ('俊俊', 'L', 'M'),
    ]:
        comment = '\n'.join(_cells(cols, comment_col)).strip()
        score_raw = ''.join(_cells(cols, score_col)).strip()
        score = star_to_score(score_raw)
        if comment or score:
            friends.append({'name': name, 'comment': comment, 'score': score})

    alt_parts = [a for a in alts if a] + ([series] if series and series not in alts else [])
    title_alt = ' / '.join(dict.fromkeys(alt_parts))

    return {
        'title': title,
        'title_alt': title_alt,
        'content_type': ctype,
        'release_date': release_date,
        'episodes': episodes,
        'episodes_raw': ' '.join(episodes_parts)[:200],
        'tags': tags,
        'friends': friends,
    }


def build_tool_entry(e: dict) -> dict | None:
    cols = e['cols']
    if e['type_raw'] == '网站、工具':
        return None
    name_lines = _cells(cols, 'B')
    if not name_lines:
        return None
    name = name_lines[0]
    link = ''.join(_cells(cols, 'C')).strip()
    desc = ''.join(_cells(cols, 'D')).strip()
    # 工具表列：E=小明 F=评分 G=嗒当 H=评分 I=翔哥 J=评分 K=俊俊 L=评分 M=综合
    friends = []
    for name_, comment_col, score_col in [
        ('小明', 'E', 'F'),
        ('嗒当', 'G', 'H'),
        ('翔哥', 'I', 'J'),
        ('俊俊', 'K', 'L'),
    ]:
        comment = '\n'.join(_cells(cols, comment_col)).strip()
        score_raw = ''.join(_cells(cols, score_col)).strip()
        score = star_to_score(score_raw)
        if comment or score:
            friends.append({'name': name_, 'comment': comment, 'score': score})

    platform = e['type_raw']
    tags = [p.strip() for p in re.split(r'[,，、]', platform) if p.strip()]

    return {
        'title': name,
        'title_alt': link or '',
        'content_type': 'software' if any(x in platform for x in ('软件', 'Windows', 'macOS')) else 'website',
        'release_date': '',
        'episodes': 0,
        'episodes_raw': '',
        'tags': tags,
        'description': desc,
        'friends': friends,
    }


def main():
    dry = '--dry-run' in sys.argv
    sheets = parse_xlsx(XLSX_PATH)
    all_entries = []
    for sheet_name, rows in sheets:
        entries = parse_entries(rows, 'content' if '二次元' in sheet_name else 'tool')
        builder = build_content_entry if '二次元' in sheet_name else build_tool_entry
        built = [builder(e) for e in entries]
        built = [b for b in built if b]
        print(f'\n=== {sheet_name}: {len(built)} 条有效条目 ===')
        type_counts = {}
        friend_count = 0
        for b in built:
            type_counts[b['content_type']] = type_counts.get(b['content_type'], 0) + 1
            friend_count += len(b['friends'])
        print(f'类型分布: {type_counts}')
        print(f'朋友评论+评分总数: {friend_count}')
        all_entries.extend(built)

    print(f'\n总计: {len(all_entries)} 条内容')
    if dry:
        print('\n[dry-run] 解析验证通过，未写库。')
        return

    # ── 正式导入 ──
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from database import SessionLocal
    from models import ContentItem, User
    from services import content as content_svc
    from services import rating as rating_svc

    db = SessionLocal()

    # 1. 4 位朋友用户（幂等创建）
    from auth import get_password_hash

    friends = [
        ('xiaoming', '小明'),
        ('dadang', '嗒当'),
        ('xiangge', '翔哥'),
        ('junjun', '俊俊'),
    ]
    friend_users = {}
    print('\n[1/3] 朋友用户：')
    for username, nickname in friends:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            # 密码：环境变量 IMPORT_FRIEND_PASSWORD，缺省随机生成并打印
            pwd = os.environ.get('IMPORT_FRIEND_PASSWORD') or secrets.token_urlsafe(8)
            user = User(
                username=username,
                nickname=nickname,
                password_hash=get_password_hash(pwd),
                avatar_id=secrets.randbelow(30),
                role='user',
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            print(f'  新建 {nickname}({username}) 密码: {pwd}')
        else:
            print(f'  已存在 {nickname}({username})')
        friend_users[nickname] = user

    # 2. 导入内容（title+type 查重）
    admin = db.query(User).filter(User.role == 'admin').order_by(User.id).first()
    created = 0
    skipped = 0
    print('\n[2/3] 导入内容：')
    for entry in all_entries:
        exists = (
            db.query(ContentItem)
            .filter(
                ContentItem.title == entry['title'],
                ContentItem.content_type == entry['content_type'],
                ContentItem.deleted_at.is_(None),
            )
            .first()
        )
        if exists:
            skipped += 1
            continue
        content_svc.create_content(
            db,
            title=entry['title'],
            title_alt=entry.get('title_alt', ''),
            cover_url='',
            description=entry.get('description', ''),
            content_type=entry['content_type'],
            episodes=entry.get('episodes', 0),
            status='',
            release_date=entry.get('release_date', ''),
            platform='',
            source_type='manual',
            source_id='',
            source_url='',
            content_metadata={},
            is_public=True,
            created_by=admin.id if admin else None,
            tag_names=entry.get('tags', []),
        )
        created += 1
    print(f'  新建 {created} 条，跳过重复 {skipped} 条')

    # 3. 朋友的评分/评论
    rating_count = 0
    print('\n[3/3] 导入朋友评分/评论：')
    for entry in all_entries:
        content = (
            db.query(ContentItem)
            .filter(
                ContentItem.title == entry['title'],
                ContentItem.content_type == entry['content_type'],
                ContentItem.deleted_at.is_(None),
            )
            .first()
        )
        if not content:
            continue
        for f in entry.get('friends', []):
            user = friend_users.get(f['name'])
            if not user:
                continue
            rating_svc.upsert_rating(
                db,
                user_id=user.id,
                content_id=content.id,
                score=f.get('score') or 0,
                review=f.get('comment', ''),
            )
            rating_count += 1
    print(f'  写入评分/评论 {rating_count} 条')

    db.close()
    print('\n✅ 导入完成')


if __name__ == '__main__':
    main()
