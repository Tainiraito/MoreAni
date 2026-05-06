import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal, engine, Base
from models import InviteCode

Base.metadata.create_all(bind=engine)

CODES = [
    'MOREANI2026',
    'ANIME-FRIEND',
    'BANGUMI-FAN',
]


def add_codes(codes: list[str]):
    db = SessionLocal()
    try:
        added = 0
        for code in codes:
            existing = db.query(InviteCode).filter(InviteCode.code == code).first()
            if existing:
                print(f'  [已存在] {code}')
                continue
            db.add(InviteCode(code=code))
            added += 1
            print(f'  [新增] {code}')
        db.commit()
        print(f'\n完成：新增 {added} 个邀请码')
    finally:
        db.close()


def list_codes():
    db = SessionLocal()
    try:
        codes = db.query(InviteCode).all()
        if not codes:
            print('暂无邀请码')
            return
        print(f'现有 {len(codes)} 个邀请码：')
        for c in codes:
            print(f'  {c.code}')
    finally:
        db.close()


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('用法:')
        print('  python manage_codes.py add CODE1 [CODE2 ...]')
        print('  python manage_codes.py list')
        print('  python manage_codes.py init   (添加默认邀请码)')
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == 'add':
        if len(sys.argv) < 3:
            print('请提供至少一个邀请码')
            sys.exit(1)
        add_codes(sys.argv[2:])

    elif cmd == 'list':
        list_codes()

    elif cmd == 'init':
        add_codes(CODES)

    else:
        print(f'未知命令: {cmd}')
        sys.exit(1)
