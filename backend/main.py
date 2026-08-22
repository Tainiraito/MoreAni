"""MoreAni v2 — FastAPI application entry point.

Includes all v1 routers under /api/v1, CORS middleware,
rate limit middleware, and creates tables on startup.
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from database import Base, engine
from middleware import OriginGuardMiddleware, RateLimitMiddleware, SecurityHeadersMiddleware
from routers.v1.admin import router as admin_router
from routers.v1.auth import router as auth_router
from routers.v1.bangumi import router as bangumi_router
from routers.v1.content import router as content_router
from routers.v1.proxy import router as proxy_router
from routers.v1.rating import router as rating_router
from routers.v1.status import router as status_router
from routers.v1.tag import router as tag_router
from routers.v1.user import router as user_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create database tables on startup + lightweight migrations."""
    Base.metadata.create_all(bind=engine)
    _migrate_invite_codes_expires()
    yield


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
