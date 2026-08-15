"""Re-export RateLimitMiddleware for convenience."""

from middleware import RateLimitMiddleware  # noqa: F401

__all__ = ["RateLimitMiddleware"]
