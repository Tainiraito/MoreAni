"""用户管理 CLI — 初始化管理员 / 迁移 nickname 字段 / 查看用户。

用法:
    python3 scripts/manage_users.py init    # 迁移 + 创建/确认管理员（Elysia / 爱莉希雅）
    python3 scripts/manage_users.py list    # 列出所有用户
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal  # noqa: E402
from models import User  # noqa: E402
from auth import get_password_hash  # noqa: E402
from sqlalchemy import text  # noqa: E402

# 固定管理员（需求指定）
ADMIN_USERNAME = 'Elysia'
ADMIN_NICKNAME = '爱莉希雅'
ADMIN_PASSWORD = '***REMOVED***'


def migrate_nickname() -> None:
    """Add nickname column if missing, backfill from username, add unique index.

    SQLite cannot ALTER TABLE ADD COLUMN with UNIQUE, so we add the column
    without constraint, backfill existing rows, then create a UNIQUE INDEX.
    """
    db = SessionLocal()
    try:
        cols = [row[1] for row in db.execute(text('PRAGMA table_info(users)')).fetchall()]
        if 'nickname' in cols:
            print('[迁移] nickname 列已存在，跳过')
            return
        db.execute(text('ALTER TABLE users ADD COLUMN nickname VARCHAR(50)'))
        db.execute(text("UPDATE users SET nickname = username WHERE nickname IS NULL OR nickname = ''"))
        db.execute(text('CREATE UNIQUE INDEX IF NOT EXISTS ix_users_nickname ON users (nickname)'))
        db.commit()
        print('[迁移] users 表新增 nickname 列，已回填 nickname=username，唯一索引已建')
    finally:
        db.close()


def init_admin() -> None:
    """Ensure the fixed admin account exists (idempotent)."""
    migrate_nickname()
    db = SessionLocal()
    try:
        existing = (
            db.query(User)
            .filter((User.username == ADMIN_USERNAME) | (User.nickname == ADMIN_NICKNAME))
            .first()
        )
        if existing:
            print(
                f'[已存在] id={existing.id} username={existing.username} '
                f'nickname={existing.nickname} role={existing.role} — 跳过创建'
            )
            return
        user = User(
            username=ADMIN_USERNAME,
            nickname=ADMIN_NICKNAME,
            password_hash=get_password_hash(ADMIN_PASSWORD),
            avatar_id=1,
            role='admin',
        )
        db.add(user)
        db.commit()
        print(f'[新增管理员] username={ADMIN_USERNAME} nickname={ADMIN_NICKNAME} role=admin')
    finally:
        db.close()


def list_users() -> None:
    """List all users."""
    migrate_nickname()
    db = SessionLocal()
    try:
        users = db.query(User).order_by(User.id).all()
        print(f'共 {len(users)} 个用户:')
        for u in users:
            print(f'  id={u.id} username={u.username} nickname={u.nickname} role={u.role} avatar={u.avatar_id}')
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description='MoreAni 用户管理')
    parser.add_argument('command', choices=['init', 'list'], help='init: 初始化管理员; list: 查看用户')
    args = parser.parse_args()
    if args.command == 'init':
        init_admin()
    elif args.command == 'list':
        list_users()


if __name__ == '__main__':
    main()
