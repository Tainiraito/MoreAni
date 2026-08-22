"""Public API security middleware for MoreAni.

The limits are intentionally generous for public reads and stricter only for
credential and write paths. State is process-local; production currently runs
one Uvicorn worker because the application uses SQLite.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from fastapi import Request, Response
from jose import JWTError, jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from auth import ALGORITHM, SECRET_KEY
from security import anonymize, env_int, get_client_ip

security_logger = logging.getLogger('moreani.security')


@dataclass(frozen=True, slots=True)
class RateLimitRule:
    """A single sliding-window rate limit rule."""

    max_requests: int
    window_seconds: int


def _load_rules() -> dict[str, RateLimitRule]:
    """Load configurable limits while retaining balanced production defaults."""
    return {
        'login': RateLimitRule(
            max_requests=env_int('MOREANI_RATE_LIMIT_LOGIN', 10),
            window_seconds=env_int('MOREANI_RATE_LIMIT_LOGIN_WINDOW_SECONDS', 900),
        ),
        'register': RateLimitRule(
            max_requests=env_int('MOREANI_RATE_LIMIT_REGISTER', 5),
            window_seconds=env_int('MOREANI_RATE_LIMIT_REGISTER_WINDOW_SECONDS', 3600),
        ),
        'write': RateLimitRule(
            max_requests=env_int('MOREANI_RATE_LIMIT_WRITE', 30),
            window_seconds=env_int('MOREANI_RATE_LIMIT_WRITE_WINDOW_SECONDS', 60),
        ),
        'read': RateLimitRule(
            max_requests=env_int('MOREANI_RATE_LIMIT_READ', 300),
            window_seconds=env_int('MOREANI_RATE_LIMIT_READ_WINDOW_SECONDS', 60),
        ),
        'asset': RateLimitRule(
            max_requests=env_int('MOREANI_RATE_LIMIT_ASSET', 600),
            window_seconds=env_int('MOREANI_RATE_LIMIT_ASSET_WINDOW_SECONDS', 60),
        ),
    }


# Kept as a public snapshot for compatibility with existing imports/tests.
RULES = _load_rules()


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Thread-safe in-memory sliding-window rate limiter."""

    def __init__(self, app: Any) -> None:
        super().__init__(app)
        self.rules = _load_rules()
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()

    @staticmethod
    def _authenticated_user_id(request: Request) -> int | None:
        """Read a valid user id from the httpOnly access token, if present."""
        token = request.cookies.get('access_token')
        if not token:
            return None
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            value = payload.get('sub')
            return int(value) if value is not None else None
        except (JWTError, TypeError, ValueError):
            return None

    def _prune(self, key: str, now: float, window: int) -> None:
        cutoff = now - window
        self._hits[key] = [timestamp for timestamp in self._hits[key] if timestamp > cutoff]

    def _check_rates(self, entries: list[tuple[str, RateLimitRule]]) -> tuple[bool, int, int]:
        """Atomically check and consume all buckets for a request."""
        now = time.time()
        with self._lock:
            for key, rule in entries:
                self._prune(key, now, rule.window_seconds)
                if len(self._hits[key]) >= rule.max_requests:
                    return False, 0, rule.window_seconds
            remaining = min(rule.max_requests - len(self._hits[key]) - 1 for key, rule in entries)
            for key, _rule in entries:
                self._hits[key].append(now)
            return True, remaining, max(rule.window_seconds for _key, rule in entries)

    def _select_rule(self, request: Request) -> tuple[str | None, RateLimitRule | None]:
        """Select a rule based on path and method; None means no limiting."""
        path = request.url.path
        method = request.method.upper()

        if method == 'OPTIONS' or path == '/api/health':
            return None, None
        if path.startswith('/api/covers/') or path.startswith('/api/avatars/'):
            return 'asset', self.rules['asset']
        if path.endswith('/auth/login') and method == 'POST':
            return 'login', self.rules['login']
        if path.endswith('/auth/register') and method == 'POST':
            return 'register', self.rules['register']
        if method in {'POST', 'PUT', 'PATCH', 'DELETE'}:
            return 'write', self.rules['write']
        return 'read', self.rules['read']

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Apply the selected limit and attach standard rate headers."""
        rule_name, rule = self._select_rule(request)
        if rule_name is None or rule is None:
            return await call_next(request)

        ip = get_client_ip(request)
        entries = [(f'{rule_name}:ip:{ip}', rule)]
        if rule_name == 'write':
            user_id = self._authenticated_user_id(request)
            if user_id is not None:
                entries.append((f'write:user:{user_id}', rule))

        allowed, remaining, retry_after = self._check_rates(entries)
        if not allowed:
            security_logger.info(
                'rate_limit_exceeded rule=%s path=%s ip=%s',
                rule_name,
                request.url.path,
                anonymize(ip),
            )
            return JSONResponse(
                status_code=429,
                content={'detail': '请求太频繁，请稍后再试。', 'retry_after': retry_after},
                headers={
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset': str(int(time.time()) + retry_after),
                    'Retry-After': str(retry_after),
                },
            )

        response = await call_next(request)
        response.headers['X-RateLimit-Remaining'] = str(remaining)
        response.headers['X-RateLimit-Reset'] = str(int(time.time()) + rule.window_seconds)
        return response


class OriginGuardMiddleware(BaseHTTPMiddleware):
    """Reject unsafe cross-origin requests outside the configured allowlist."""

    def __init__(self, app: Any, allowed_origins: list[str]) -> None:
        super().__init__(app)
        self.allowed_origins = {origin for origin in allowed_origins if origin}

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if request.method.upper() in {'POST', 'PUT', 'PATCH', 'DELETE'}:
            origin = request.headers.get('origin')
            if origin and origin not in self.allowed_origins:
                security_logger.info(
                    'origin_rejected path=%s origin=%s',
                    request.url.path,
                    anonymize(origin),
                )
                return JSONResponse(status_code=403, content={'detail': '不允许的请求来源'})
        return await call_next(request)


SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Content-Security-Policy': (
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
        "form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'"
    ),
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach baseline browser security headers to every application response."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        return response


__all__ = [
    'RULES',
    'OriginGuardMiddleware',
    'RateLimitMiddleware',
    'RateLimitRule',
    'SECURITY_HEADERS',
    'SecurityHeadersMiddleware',
]
