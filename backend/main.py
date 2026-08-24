"""MoreAni v2 — FastAPI application entry point.

Includes all v1 routers under /api/v1, CORS middleware,
rate limit middleware, and creates tables on startup.
"""

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from database import Base, engine
from middleware import OriginGuardMiddleware, RateLimitMiddleware, SecurityHeadersMiddleware
from models import ResourceSubscription
from routers.v1.admin import router as admin_router
from routers.v1.auth import router as auth_router
from routers.v1.bangumi import router as bangumi_router
from routers.v1.content import router as content_router
from routers.v1.notifications import router as notifications_router
from routers.v1.notifications import subscription_router
from routers.v1.proxy import router as proxy_router
from routers.v1.rating import router as rating_router
from routers.v1.status import router as status_router
from routers.v1.tag import router as tag_router
from routers.v1.user import router as user_router
from services.notifications import run_worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create database tables on startup + lightweight migrations."""
    Base.metadata.create_all(bind=engine)
    _migrate_invite_codes_expires()
    _migrate_users_avatar_crop()
    _migrate_resource_subscriptions()
    worker_task = None
    stop_event = asyncio.Event()
    worker_enabled = os.getenv('MOREANI_NOTIFICATION_WORKER', 'false').lower() in {'1', 'true', 'yes', 'on'}
    if worker_enabled:
        interval = max(60, int(os.getenv('MOREANI_NOTIFICATION_INTERVAL_SECONDS', '1800')))
        worker_task = asyncio.create_task(run_worker(stop_event, interval_seconds=interval))
    try:
        yield
    finally:
        if worker_task:
            stop_event.set()
            await worker_task


def _migrate_invite_codes_expires() -> None:
    """SQLite 轻量迁移：invite_codes 表补 expires_at 列（幂等）。"""
    try:
        from sqlalchemy import text

        with engine.connect() as conn:
            cols = [r[1] for r in conn.execute(text('PRAGMA table_info(invite_codes)'))]
            if cols and 'expires_at' not in cols:
                conn.execute(text('ALTER TABLE invite_codes ADD COLUMN expires_at DATETIME'))
                conn.commit()
                print('[migrate] invite_codes.expires_at 已添加')
    except Exception as e:  # noqa: BLE001
        print(f'[migrate] invite_codes 迁移跳过: {e}')

    # users.avatar_url（头像上传）
    try:
        from sqlalchemy import text

        with engine.connect() as conn:
            cols = [r[1] for r in conn.execute(text('PRAGMA table_info(users)'))]
            if cols and 'avatar_url' not in cols:
                conn.execute(text('ALTER TABLE users ADD COLUMN avatar_url VARCHAR(255)'))
                conn.commit()
                print('[migrate] users.avatar_url 已添加')
    except Exception as e:  # noqa: BLE001
        print(f'[migrate] users.avatar_url 迁移跳过: {e}')


def _migrate_users_avatar_crop() -> None:
    """SQLite 轻量迁移：users 表补 avatar_crop 列（幂等）。"""
    try:
        from sqlalchemy import text

        with engine.connect() as conn:
            cols = [r[1] for r in conn.execute(text('PRAGMA table_info(users)'))]
            if cols and 'avatar_crop' not in cols:
                conn.execute(text('ALTER TABLE users ADD COLUMN avatar_crop TEXT'))
                conn.commit()
                print('[migrate] users.avatar_crop 已添加')
    except Exception as e:  # noqa: BLE001
        print(f'[migrate] users.avatar_crop 迁移跳过: {e}')


def _migrate_resource_subscriptions() -> None:
    """Upgrade subscriptions to source-aware rows while preserving cursors."""
    from sqlalchemy import text

    table_name = ResourceSubscription.__tablename__
    try:
        with engine.connect() as conn:
            columns = [row[1] for row in conn.execute(text(f'PRAGMA table_info({table_name})'))]
            if not columns:
                return
            indexes = []
            for index in conn.execute(text(f'PRAGMA index_list({table_name})')).mappings():
                index_name = index['name']
                index_columns = [row[2] for row in conn.execute(text(f'PRAGMA index_info("{index_name}")'))]
                indexes.append((bool(index['unique']), index_columns))
            has_new_unique = any(
                unique and index_columns == ['user_id', 'subject_id', 'source', 'fansub_key']
                for unique, index_columns in indexes
            )
            if {'source', 'fansub_id'} <= set(columns) and has_new_unique:
                return

        legacy_table = f'{table_name}_legacy'
        with engine.begin() as conn:
            conn.exec_driver_sql('PRAGMA foreign_keys=OFF')
            conn.exec_driver_sql(f'ALTER TABLE {table_name} RENAME TO {legacy_table}')
            ResourceSubscription.__table__.create(conn)
            source_expr = "COALESCE(source, 'animegarden')" if 'source' in columns else "'animegarden'"
            fansub_id_expr = 'fansub_id' if 'fansub_id' in columns else 'NULL'
            conn.execute(
                text(
                    f"""INSERT INTO {table_name} (
                        id, user_id, content_id, subject_id, source, fansub_key,
                        fansub_name, fansub_id, active, last_seen_created_at,
                        last_seen_resource_key, created_at, updated_at
                    )
                    SELECT id, user_id, content_id, subject_id, {source_expr}, fansub_key,
                        fansub_name, {fansub_id_expr}, active, last_seen_created_at,
                        last_seen_resource_key, created_at, updated_at
                    FROM {legacy_table}""",
                )
            )
            conn.exec_driver_sql(f'DROP TABLE {legacy_table}')
            conn.exec_driver_sql('PRAGMA foreign_keys=ON')
        print('[migrate] resource_subscriptions 已升级为多资源源订阅表')
    except Exception as exc:  # noqa: BLE001
        print(f'[migrate] resource_subscriptions 迁移跳过: {exc}')


app = FastAPI(
    title='MoreAni API',
    version='2.0.0',
    lifespan=lifespan,
)

# --- CORS ---
# 白名单模式：cookie 认证下不允许通配符（allow_origins=['*'] + credentials=True
# 等于任何网站都能携带 cookie 调用 API）。生产域名 + 本地开发域名显式列出。
MOREANI_ENV = os.getenv('MOREANI_ENV', 'development').lower()
if MOREANI_ENV == 'production':
    default_origins = 'https://moreani.lovelysia.top'
else:
    default_origins = 'http://localhost:5173,http://127.0.0.1:5173,https://moreani.lovelysia.top'
configured_origins = [
    origin.strip() for origin in os.getenv('ALLOWED_ORIGINS', default_origins).split(',') if origin.strip()
]
if MOREANI_ENV == 'production':
    # 防止部署环境误把明文 HTTP 来源带入生产 Cookie 白名单。
    ALLOWED_ORIGINS = [origin for origin in configured_origins if origin.lower().startswith('https://')]
else:
    ALLOWED_ORIGINS = configured_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allow_headers=['Accept', 'Content-Type', 'X-Requested-With'],
)

# --- Rate Limiting ---
app.add_middleware(RateLimitMiddleware)
app.add_middleware(OriginGuardMiddleware, allowed_origins=ALLOWED_ORIGINS)
app.add_middleware(SecurityHeadersMiddleware)

# --- V1 API routers ---
app.include_router(auth_router, prefix='/api/v1')
app.include_router(content_router, prefix='/api/v1')
app.include_router(notifications_router, prefix='/api/v1')
app.include_router(subscription_router, prefix='/api/v1')
app.include_router(rating_router, prefix='/api/v1')
app.include_router(status_router, prefix='/api/v1')
app.include_router(tag_router, prefix='/api/v1')
app.include_router(user_router, prefix='/api/v1')
app.include_router(bangumi_router, prefix='/api/v1')
app.include_router(proxy_router, prefix='/api/v1')
app.include_router(admin_router, prefix='/api/v1')

# --- 封面本地化：/api/covers/{id}.jpg 静态服务（图片下载到本地，不依赖外链 CDN） ---
COVERS_DIR = os.getenv('COVERS_DIR', 'covers')
os.makedirs(COVERS_DIR, exist_ok=True)
app.mount('/api/covers', StaticFiles(directory=COVERS_DIR), name='covers')

# --- 头像静态服务：/api/avatars/{file} ---
AVATARS_DIR = os.getenv('AVATARS_DIR', 'avatars')
os.makedirs(AVATARS_DIR, exist_ok=True)
app.mount('/api/avatars', StaticFiles(directory=AVATARS_DIR), name='avatars')


@app.get('/api/health')
def health_check() -> dict:
    """Health check endpoint."""
    return {'status': 'ok', 'version': '2.0.0'}
