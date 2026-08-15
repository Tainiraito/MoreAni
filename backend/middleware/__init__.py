"""Rate limiting middleware for MoreAni v2.

In-memory sliding-window rate limiter.
Limits: login 10/15min per IP, register 5/hr per IP,
writes 30/min per user, reads 120/min per IP.
"""

import time
from collections import defaultdict
from typing import Any, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


class RateLimitRule:
    """A single rate limit rule."""

    __slots__ = ("max_requests", "window_seconds")

    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds


# Default rules (relaxed for development)
RULES: dict[str, RateLimitRule] = {
    "login": RateLimitRule(max_requests=10, window_seconds=900),      # 10 / 15min
    "register": RateLimitRule(max_requests=5, window_seconds=3600),   # 5 / hour
    "write": RateLimitRule(max_requests=30, window_seconds=60),       # 30 / min
    "read": RateLimitRule(max_requests=120, window_seconds=60),       # 120 / min
}


class RateLimitMiddleware(BaseHTTPMiddleware):
    """In-memory sliding-window rate limiter middleware."""

    def __init__(self, app: Any) -> None:
        super().__init__(app)
        # Store: { key -> list of timestamps }
        self._hits: dict[str, list[float]] = defaultdict(list)

    def _client_ip(self, request: Request) -> str:
        """Extract client IP from request."""
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def _prune(self, key: str, now: float, window: int) -> None:
        """Remove expired timestamps from the hit list."""
        cutoff = now - window
        self._hits[key] = [t for t in self._hits[key] if t > cutoff]

    def _check_rate(self, key: str, rule: RateLimitRule) -> tuple[bool, int]:
        """Check if request is within rate limit.

        Returns:
            (allowed, remaining) — remaining is how many requests are left.
        """
        now = time.time()
        self._prune(key, now, rule.window_seconds)
        count = len(self._hits[key])
        if count >= rule.max_requests:
            return False, 0
        self._hits[key].append(now)
        return True, rule.max_requests - count - 1

    def _select_rule(self, request: Request) -> tuple[str, RateLimitRule]:
        """Select the appropriate rate limit rule based on path and method."""
        path = request.url.path
        method = request.method

        if path.endswith("/auth/login") and method == "POST":
            return "login", RULES["login"]
        if path.endswith("/auth/register") and method == "POST":
            return "register", RULES["register"]
        if method in ("POST", "PUT", "DELETE"):
            return "write", RULES["write"]
        return "read", RULES["read"]

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Apply rate limiting to each request."""
        ip = self._client_ip(request)
        rule_name, rule = self._select_rule(request)

        # Use IP for login/register/read, user_id for writes
        if rule_name == "write":
            # We don't have the user_id here yet; use IP as fallback
            key = f"write:{ip}"
        else:
            key = f"{rule_name}:{ip}"

        allowed, remaining = self._check_rate(key, rule)
        if not allowed:
            retry_after = rule.window_seconds
            return JSONResponse(
                status_code=429,
                content={
                    "detail": f"请求太频繁，请 {retry_after // 60} 分钟后再试。",
                    "retry_after": retry_after,
                },
                headers={
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(int(time.time()) + retry_after),
                    "Retry-After": str(retry_after),
                },
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response
