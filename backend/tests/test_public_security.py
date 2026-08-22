from fastapi import Request

from middleware import RateLimitMiddleware, RateLimitRule
from security import LoginFailureTracker, get_client_ip


def _request(*, client_host: str, path: str = '/', headers: dict[str, str] | None = None) -> Request:
    raw_headers = [(key.lower().encode(), value.encode()) for key, value in (headers or {}).items()]
    return Request(
        {
            'type': 'http',
            'method': 'GET',
            'path': path,
            'headers': raw_headers,
            'client': (client_host, 1234),
            'server': ('testserver', 80),
            'scheme': 'http',
        }
    )


def test_login_failure_tracker_locks_and_clears():
    tracker = LoginFailureTracker(max_failures=3, window_seconds=60, lock_seconds=10)
    key = 'user@example:203.0.113.10'

    assert tracker.record_failure(key, now=100) is False
    assert tracker.record_failure(key, now=101) is False
    assert tracker.record_failure(key, now=102) is True
    assert tracker.is_locked(key, now=111) is True
    assert tracker.is_locked(key, now=113) is False

    tracker.record_failure(key, now=200)
    tracker.clear(key)
    assert tracker.is_locked(key, now=200) is False


def test_client_ip_ignores_forwarded_header_from_untrusted_peer():
    request = _request(
        client_host='198.51.100.4',
        headers={'x-forwarded-for': '203.0.113.10'},
    )
    assert get_client_ip(request) == '198.51.100.4'


def test_client_ip_walks_forwarded_chain_from_trusted_proxy():
    request = _request(
        client_host='127.0.0.1',
        headers={'x-forwarded-for': '203.0.113.10, 172.16.0.2'},
    )
    assert get_client_ip(request) == '203.0.113.10'


def test_rate_limit_buckets_are_consumed_atomically():
    middleware = RateLimitMiddleware(lambda *_args: None)
    rule = RateLimitRule(max_requests=1, window_seconds=60)

    allowed, remaining, _retry_after = middleware._check_rates([('ip:one', rule), ('user:one', rule)])
    assert (allowed, remaining) == (True, 0)
    allowed, _remaining, _retry_after = middleware._check_rates([('ip:one', rule), ('user:one', rule)])
    assert allowed is False


def test_request_classification_skips_health_and_options():
    middleware = RateLimitMiddleware(lambda *_args: None)
    health = _request(client_host='testclient', path='/api/health')
    health.scope['method'] = 'GET'
    options = _request(client_host='testclient', path='/api/v1/content')
    options.scope['method'] = 'OPTIONS'
    asset = _request(client_host='testclient', path='/api/covers/1.jpg')
    asset.scope['method'] = 'GET'

    assert middleware._select_rule(health) == (None, None)
    assert middleware._select_rule(options) == (None, None)
    assert middleware._select_rule(asset)[0] == 'asset'


def test_login_failures_lock_only_the_same_identifier_and_ip(client, make_user, monkeypatch):
    monkeypatch.delenv('MOREANI_COOKIE_SECURE', raising=False)
    monkeypatch.delenv('MOREANI_ENV', raising=False)
    user = make_user('security-login')

    for _ in range(5):
        response = client.post(
            '/api/v1/auth/login',
            json={'username': user.username, 'password': 'wrong-password'},
        )
        assert response.status_code == 401

    locked = client.post(
        '/api/v1/auth/login',
        json={'username': user.username, 'password': 'a-test-password'},
    )
    assert locked.status_code == 429
    assert 'Retry-After' in locked.headers

    other = make_user('security-login-other')
    other_login = client.post(
        '/api/v1/auth/login',
        json={'username': other.username, 'password': 'a-test-password'},
    )
    assert other_login.status_code == 200
    assert 'HttpOnly' in other_login.headers['set-cookie']
    assert 'SameSite=lax' in other_login.headers['set-cookie']


def test_production_login_cookie_is_secure(client, make_user, monkeypatch):
    monkeypatch.setenv('MOREANI_ENV', 'production')
    monkeypatch.delenv('MOREANI_COOKIE_SECURE', raising=False)
    user = make_user('secure-cookie')

    response = client.post(
        '/api/v1/auth/login',
        json={'username': user.username, 'password': 'a-test-password'},
    )
    assert response.status_code == 200
    assert 'Secure' in response.headers['set-cookie']


def test_security_headers_origin_guard_and_public_health(client):
    health = client.get('/api/health')
    assert health.status_code == 200
    assert health.headers['X-Content-Type-Options'] == 'nosniff'
    assert health.headers['X-Frame-Options'] == 'DENY'
    assert 'default-src' in health.headers['Content-Security-Policy']
    assert 'X-RateLimit-Remaining' not in health.headers

    rejected = client.post('/api/v1/auth/logout', headers={'Origin': 'https://evil.example'})
    assert rejected.status_code == 403

    allowed = client.post('/api/v1/auth/logout', headers={'Origin': 'https://moreani.lovelysia.top'})
    assert allowed.status_code == 200
    assert 'X-RateLimit-Remaining' in allowed.headers
