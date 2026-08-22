"""Shared security helpers for the public MoreAni API.

The application deliberately keeps its public read surface open.  This module
contains the small, process-local pieces of state needed to protect the
credential and write paths without adding a new persistence dependency.
"""

from __future__ import annotations

import hashlib
import ipaddress
import os
import threading
import time
from dataclasses import dataclass, field

from fastapi import Request


def env_bool(name: str, default: bool) -> bool:
    """Read a boolean environment variable using conservative defaults."""
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


def env_int(name: str, default: int, *, minimum: int = 1) -> int:
    """Read a positive integer environment variable, falling back safely."""
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    return max(minimum, value)


def normalize_login_identifier(value: str) -> str:
    """Normalize only the key used for failed-login tracking."""
    return value.strip().casefold()


def anonymize(value: str) -> str:
    """Return a short non-reversible identifier suitable for security logs."""
    return hashlib.sha256(value.encode('utf-8', errors='replace')).hexdigest()[:12]


@dataclass
class _FailureState:
    failures: list[float] = field(default_factory=list)
    locked_until: float = 0.0


class LoginFailureTracker:
    """Thread-safe sliding-window failed-login tracker.

    It intentionally keys by caller-provided credential identifier *and* IP.
    A malicious caller therefore cannot lock an account for every legitimate
    user on the network.
    """

    def __init__(
        self,
        *,
        max_failures: int | None = None,
        window_seconds: int | None = None,
        lock_seconds: int | None = None,
    ) -> None:
        self.max_failures = max_failures or env_int('MOREANI_LOGIN_FAILURE_LIMIT', 5)
        self.window_seconds = window_seconds or env_int('MOREANI_LOGIN_FAILURE_WINDOW_SECONDS', 900)
        self.lock_seconds = lock_seconds or env_int('MOREANI_LOGIN_LOCK_SECONDS', 300)
        self._states: dict[str, _FailureState] = {}
        self._lock = threading.Lock()

    def _prune(self, state: _FailureState, now: float) -> None:
        cutoff = now - self.window_seconds
        state.failures = [timestamp for timestamp in state.failures if timestamp > cutoff]
        if state.locked_until <= now:
            state.locked_until = 0.0

    def is_locked(self, key: str, now: float | None = None) -> bool:
        """Return whether a credential/IP key is temporarily locked."""
        current = time.time() if now is None else now
        with self._lock:
            state = self._states.get(key)
            if state is None:
                return False
            self._prune(state, current)
            if not state.failures and state.locked_until == 0:
                self._states.pop(key, None)
            return state.locked_until > current

    def record_failure(self, key: str, now: float | None = None) -> bool:
        """Record a failed login and return whether the key is now locked."""
        current = time.time() if now is None else now
        with self._lock:
            state = self._states.setdefault(key, _FailureState())
            self._prune(state, current)
            if state.locked_until > current:
                return True
            state.failures.append(current)
            if len(state.failures) >= self.max_failures:
                state.locked_until = current + self.lock_seconds
                return True
            return False

    def clear(self, key: str) -> None:
        """Clear failures after a successful login."""
        with self._lock:
            self._states.pop(key, None)


login_failure_tracker = LoginFailureTracker()


def cookie_secure_default() -> bool:
    """Return the safe Cookie Secure default for the current environment."""
    return env_bool('MOREANI_COOKIE_SECURE', os.getenv('MOREANI_ENV', 'development').lower() == 'production')


def _parse_networks(value: str) -> tuple[ipaddress._BaseNetwork, ...]:
    """Parse trusted proxy CIDRs, ignoring malformed values safely."""
    networks: list[ipaddress._BaseNetwork] = []
    for raw in value.split(','):
        item = raw.strip()
        if not item:
            continue
        try:
            networks.append(ipaddress.ip_network(item, strict=False))
        except ValueError:
            continue
    return tuple(networks)


def get_client_ip(request: Request) -> str:
    """Extract the first untrusted address from a trusted proxy chain."""
    peer = request.client.host if request.client else 'unknown'
    networks = _parse_networks(os.getenv('TRUSTED_PROXY_NETWORKS', '127.0.0.1/32,::1/128,172.16.0.0/12'))

    def is_trusted(host: str) -> bool:
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            return False
        return any(address in network for network in networks)

    if not is_trusted(peer):
        return peer

    forwarded = request.headers.get('x-forwarded-for', '')
    candidates = [item.strip() for item in forwarded.split(',') if item.strip()]
    if not candidates:
        cloudflare_ip = request.headers.get('cf-connecting-ip', '').strip()
        if cloudflare_ip:
            candidates = [cloudflare_ip]
    for candidate in reversed(candidates):
        if not is_trusted(candidate):
            return candidate
    return peer
