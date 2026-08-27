from __future__ import annotations

import asyncio
from collections.abc import Iterator
from typing import Any, ClassVar

import httpx
import pytest
from conftest import auth_cookie

from services import bangumi


def subject_payload() -> dict[str, Any]:
    """Return a representative Bangumi v0 subject payload."""
    return {
        'id': 1002,
        'name': 'Exact Anime',
        'name_cn': '精确番剧',
        'images': {'large': 'https://img.example/exact.jpg'},
        'summary': '来自 Bangumi 的简介',
        'total_episodes': 12,
        'date': '2026-04-01',
        'platform': 'TV',
        'rating': {'score': 8.8},
        'tags': [{'name': '奇幻'}],
    }


def response_for(url: str, payload: Any = None, status_code: int = 200) -> httpx.Response:
    """Build a response suitable for the fake Bangumi client."""
    return httpx.Response(
        status_code,
        json=subject_payload() if payload is None else payload,
        request=httpx.Request('GET', url),
    )


class RecordingAsyncClient:
    """Fake client that records construction and request reuse."""

    instances: ClassVar[list[RecordingAsyncClient]] = []
    fail_proxy: ClassVar[bool] = False
    fail_first: ClassVar[bool] = False

    def __init__(self, **kwargs: object) -> None:
        self.proxy = kwargs.get('proxy')
        self.trust_env = kwargs.get('trust_env')
        self.get_calls = 0
        self.closed = False
        type(self).instances.append(self)

    @property
    def is_closed(self) -> bool:
        """Expose the httpx client state used by the service."""
        return self.closed

    async def get(
        self,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        del params, headers
        self.get_calls += 1
        if self.fail_proxy and self.proxy is not None:
            request = httpx.Request('GET', url)
            raise httpx.ConnectError('proxy unavailable', request=request)
        if self.fail_first and self.get_calls == 1:
            request = httpx.Request('GET', url)
            raise httpx.ConnectError('upstream unavailable', request=request)
        return response_for(url)

    async def aclose(self) -> None:
        """Mark the fake client closed."""
        self.closed = True


@pytest.fixture(autouse=True)
def reset_bangumi_state() -> Iterator[None]:
    """Prevent process-level clients and cache entries leaking between tests."""
    bangumi.clear_bangumi_cache()
    asyncio.run(bangumi.close_bangumi_clients())
    RecordingAsyncClient.instances.clear()
    RecordingAsyncClient.fail_proxy = False
    RecordingAsyncClient.fail_first = False
    yield
    bangumi.clear_bangumi_cache()
    asyncio.run(bangumi.close_bangumi_clients())


def configure_fake_client(monkeypatch: pytest.MonkeyPatch) -> None:
    """Configure the service to use the recording HTTP client."""
    monkeypatch.setattr(bangumi.httpx, 'AsyncClient', RecordingAsyncClient)
    monkeypatch.setattr(bangumi, 'PROXY', 'http://127.0.0.1:7890')
    monkeypatch.setattr(bangumi, 'REQUEST_ORDER', 'proxy_first')


def test_subject_detail_uses_proxy_first_and_disables_implicit_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    """A healthy explicit proxy should avoid the direct attempt."""
    configure_fake_client(monkeypatch)
    monkeypatch.setenv('ALL_PROXY', 'socks5://127.0.0.1:1080')

    result = asyncio.run(bangumi.get_subject_detail(1002))

    assert result is not None
    assert result['bgm_id'] == 1002
    assert [client.proxy for client in RecordingAsyncClient.instances] == ['http://127.0.0.1:7890']
    assert all(client.trust_env is False for client in RecordingAsyncClient.instances)


def test_subject_detail_falls_back_to_direct_when_proxy_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """A failed proxy attempt should be followed by one direct attempt."""
    configure_fake_client(monkeypatch)
    RecordingAsyncClient.fail_proxy = True

    result = asyncio.run(bangumi.get_subject_detail(1002))

    assert result is not None
    assert [client.proxy for client in RecordingAsyncClient.instances] == [
        'http://127.0.0.1:7890',
        None,
    ]


def test_direct_first_can_be_selected(monkeypatch: pytest.MonkeyPatch) -> None:
    """The compatibility setting should retain direct-first behavior."""
    configure_fake_client(monkeypatch)
    monkeypatch.setattr(bangumi, 'REQUEST_ORDER', 'direct_first')

    result = asyncio.run(bangumi.get_subject_detail(1002))

    assert result is not None
    assert [client.proxy for client in RecordingAsyncClient.instances] == [None]


def test_proxy_initialization_failure_becomes_bangumi_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """Invalid proxy dependencies must not escape as an ASGI exception."""

    class FailingAsyncClient:
        def __init__(self, **kwargs: object) -> None:
            if kwargs.get('proxy') is not None:
                raise ImportError("No module named 'socksio'")
            self.closed = False

        @property
        def is_closed(self) -> bool:
            return self.closed

        async def get(
            self,
            url: str,
            *,
            params: dict[str, Any] | None = None,
            headers: dict[str, str] | None = None,
        ) -> httpx.Response:
            del params, headers
            request = httpx.Request('GET', url)
            raise httpx.ConnectError('direct access unavailable', request=request)

        async def aclose(self) -> None:
            self.closed = True

    monkeypatch.setattr(bangumi, 'PROXY', 'socks5://127.0.0.1:1080')
    monkeypatch.setattr(bangumi, 'REQUEST_ORDER', 'proxy_first')
    monkeypatch.setattr(bangumi.httpx, 'AsyncClient', FailingAsyncClient)

    with pytest.raises(bangumi.BangumiError):
        asyncio.run(bangumi.get_subject_detail(1002))


def test_repeated_detail_requests_reuse_client_and_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    """Repeated detail calls reuse both the client and the cached payload."""
    configure_fake_client(monkeypatch)

    first = asyncio.run(bangumi.get_subject_detail(1002))
    second = asyncio.run(bangumi.get_subject_detail(1002))

    assert first == second
    assert len(RecordingAsyncClient.instances) == 1
    assert RecordingAsyncClient.instances[0].get_calls == 1


def test_detail_cache_expires(monkeypatch: pytest.MonkeyPatch) -> None:
    """An expired detail cache entry should fetch the subject again."""
    configure_fake_client(monkeypatch)
    now = [100.0]
    monkeypatch.setattr(bangumi.time, 'monotonic', lambda: now[0])

    asyncio.run(bangumi.get_subject_detail(1002))
    now[0] += bangumi.DETAIL_CACHE_SECONDS + 1
    asyncio.run(bangumi.get_subject_detail(1002))

    assert len(RecordingAsyncClient.instances) == 1
    assert RecordingAsyncClient.instances[0].get_calls == 2


def test_search_cache_normalizes_keyword_but_separates_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    """Equivalent search text shares a result, while a different limit does not."""
    configure_fake_client(monkeypatch)
    search_payload = {
        'results': 1,
        'list': [{'id': 1002, 'name': 'Exact Anime', 'name_cn': '精确番剧'}],
    }

    async def search_response(
        self: RecordingAsyncClient,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        del params, headers
        self.get_calls += 1
        return response_for(url, search_payload)

    monkeypatch.setattr(RecordingAsyncClient, 'get', search_response)

    first = asyncio.run(bangumi.search_subjects('  Test '))
    second = asyncio.run(bangumi.search_subjects('test'))
    third = asyncio.run(bangumi.search_subjects('test', limit=5))

    assert first == second
    assert third['total'] == 1
    assert sum(client.get_calls for client in RecordingAsyncClient.instances) == 2


def test_score_cache_has_independent_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    """Score calls use their own cache and expiration window."""
    configure_fake_client(monkeypatch)
    now = [100.0]
    monkeypatch.setattr(bangumi.time, 'monotonic', lambda: now[0])

    first = asyncio.run(bangumi.get_subject_score(1002))
    second = asyncio.run(bangumi.get_subject_score(1002))
    now[0] += bangumi.SCORE_CACHE_SECONDS + 1
    third = asyncio.run(bangumi.get_subject_score(1002))

    assert first == second == third == 8.8
    assert len(RecordingAsyncClient.instances) == 1
    assert RecordingAsyncClient.instances[0].get_calls == 2


def test_concurrent_same_subject_uses_one_upstream_request(monkeypatch: pytest.MonkeyPatch) -> None:
    """Concurrent callers for one subject are merged by single-flight."""
    configure_fake_client(monkeypatch)

    async def delayed_get(
        self: RecordingAsyncClient,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        del params, headers
        self.get_calls += 1
        await asyncio.sleep(0.01)
        return response_for(url)

    monkeypatch.setattr(RecordingAsyncClient, 'get', delayed_get)

    async def request_many() -> list[dict[str, Any] | None]:
        return await asyncio.gather(*(bangumi.get_subject_detail(1002) for _ in range(5)))

    results = asyncio.run(request_many())

    assert all(result == results[0] for result in results)
    assert len(RecordingAsyncClient.instances) == 1
    assert RecordingAsyncClient.instances[0].get_calls == 1


def test_failed_request_is_not_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    """An upstream error must be retried on the next caller."""
    configure_fake_client(monkeypatch)
    monkeypatch.setattr(bangumi, 'PROXY', None)
    RecordingAsyncClient.fail_first = True

    with pytest.raises(bangumi.BangumiError):
        asyncio.run(bangumi.get_subject_detail(1002))
    result = asyncio.run(bangumi.get_subject_detail(1002))

    assert result is not None
    assert len(RecordingAsyncClient.instances) == 1
    assert RecordingAsyncClient.instances[0].get_calls == 2


def test_missing_subject_is_negative_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    """A missing subject is briefly cached without becoming a server error."""
    configure_fake_client(monkeypatch)

    async def not_found(
        self: RecordingAsyncClient,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        del params, headers
        self.get_calls += 1
        return response_for(url, {'detail': 'not found'}, 404)

    monkeypatch.setattr(RecordingAsyncClient, 'get', not_found)

    first = asyncio.run(bangumi.get_subject_detail(999999))
    second = asyncio.run(bangumi.get_subject_detail(999999))

    assert first is None
    assert second is None
    assert len(RecordingAsyncClient.instances) == 1
    assert RecordingAsyncClient.instances[0].get_calls == 1


def test_close_clients_releases_shared_clients(monkeypatch: pytest.MonkeyPatch) -> None:
    """The lifespan shutdown hook can close all shared clients."""
    configure_fake_client(monkeypatch)
    asyncio.run(bangumi.get_subject_detail(1002))
    clients = list(RecordingAsyncClient.instances)

    asyncio.run(bangumi.close_bangumi_clients())

    assert all(client.closed for client in clients)


@pytest.mark.parametrize('path', ['/api/v1/bangumi/detail/1002', '/api/v1/bangumi/score/1002'])
def test_bangumi_detail_and_score_map_upstream_failure_to_502(client, monkeypatch, path):
    """Detail and score routes map service failures to 502."""
    if '/score/' in path:

        async def failed_score(_bgm_id: int) -> None:
            raise bangumi.BangumiError('upstream unavailable')

        monkeypatch.setattr(bangumi, 'get_subject_score', failed_score)
    else:

        async def failed_detail(_bgm_id: int) -> None:
            raise bangumi.BangumiError('upstream unavailable')

        monkeypatch.setattr(bangumi, 'get_subject_detail', failed_detail)

    response = client.get(path)

    assert response.status_code == 502
    assert response.json()['detail'] == 'Bangumi 服务暂时不可用，请稍后重试'


def test_bangumi_score_route_returns_service_score(client, monkeypatch):
    """The score route keeps its existing response shape."""

    async def score(_bgm_id: int) -> float:
        return 8.8

    monkeypatch.setattr(bangumi, 'get_subject_score', score)

    response = client.get('/api/v1/bangumi/score/1002')

    assert response.status_code == 200
    assert response.json() == {'score': 8.8}


def test_bangumi_score_route_keeps_404_for_missing_subject(client, monkeypatch):
    """A missing score subject remains a 404."""

    async def missing_score(_bgm_id: int) -> None:
        return None

    monkeypatch.setattr(bangumi, 'get_subject_score', missing_score)

    response = client.get('/api/v1/bangumi/score/999999')

    assert response.status_code == 404


def test_bangumi_search_maps_upstream_failure_to_502(client, make_user, monkeypatch):
    """Search maps a service failure to 502."""

    async def failed_search(_keyword: str, limit: int = 10) -> dict[str, Any]:
        del limit
        raise bangumi.BangumiError('upstream unavailable')

    monkeypatch.setattr(bangumi, 'search_subjects', failed_search)
    user = make_user('bangumi-search-error')

    response = client.get('/api/v1/bangumi/search?q=精确番剧', cookies=auth_cookie(user))

    assert response.status_code == 502


def test_bangumi_import_maps_upstream_failure_to_502(client, make_user, monkeypatch):
    """Import maps a service failure to 502."""

    async def failed_detail(_bgm_id: int) -> None:
        raise bangumi.BangumiError('upstream unavailable')

    monkeypatch.setattr(bangumi, 'get_subject_detail', failed_detail)
    admin = make_user('bangumi-import-error', role='admin')

    response = client.post('/api/v1/bangumi/import/1002', cookies=auth_cookie(admin))

    assert response.status_code == 502


def test_bangumi_detail_keeps_404_for_missing_subject(client, monkeypatch):
    """Detail keeps its 404 response for an absent subject."""

    async def missing_detail(_bgm_id: int) -> None:
        return None

    monkeypatch.setattr(bangumi, 'get_subject_detail', missing_detail)

    response = client.get('/api/v1/bangumi/detail/999999')

    assert response.status_code == 404
