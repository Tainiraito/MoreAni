"""MoreAni v2 — FastAPI application entry point.

Includes all v1 routers under /api/v1, CORS middleware,
rate limit middleware, and creates tables on startup.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import Base, engine
from middleware import RateLimitMiddleware
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
    """Create database tables on startup."""
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title='MoreAni API',
    version='2.0.0',
    lifespan=lifespan,
)

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

# --- Rate Limiting ---
app.add_middleware(RateLimitMiddleware)

# --- V1 API routers ---
app.include_router(auth_router, prefix='/api/v1')
app.include_router(content_router, prefix='/api/v1')
app.include_router(rating_router, prefix='/api/v1')
app.include_router(status_router, prefix='/api/v1')
app.include_router(tag_router, prefix='/api/v1')
app.include_router(user_router, prefix='/api/v1')
app.include_router(bangumi_router, prefix='/api/v1')
app.include_router(proxy_router, prefix='/api/v1')


@app.get('/api/health')
def health_check() -> dict:
    """Health check endpoint."""
    return {'status': 'ok', 'version': '2.0.0'}
