from __future__ import annotations

import asyncio
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


class FallbackAsyncClient:
    """Fake httpx client that fails direct access and succeeds via proxy."""

    calls: ClassVar[list[dict[str, object]]] = []

    def __init__(self, **kwargs: object) -> None:
        type(self).calls.append(kwargs)
        self.proxy = kwargs.get('proxy')

    async def __aenter__(self) -> FallbackAsyncClient:
        if self.proxy is None:
            request = httpx.Request('GET', 'https://api.bgm.tv')
            raise httpx.ConnectError('direct access unavailable', request=request)
        return self

    async def __aexit__(self, _exc_type: object, _exc_value: object, _traceback: object) -> None:
        return None

    async def get(
        self,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        return httpx.Response(
            200,
            json=subject_payload(),
            request=httpx.Request('GET', url, params=params, headers=headers),
        )


def test_subject_detail_disables_implicit_socks_proxy_and_falls_back_to_http_proxy(monkeypatch):
    FallbackAsyncClient.calls.clear()
    monkeypatch.setenv('ALL_PROXY', 'socks5://127.0.0.1:1080')
    monkeypatch.setattr(bangumi, 'PROXY', 'http://127.0.0.1:7890')
    monkeypatch.setattr(bangumi.httpx, 'AsyncClient', FallbackAsyncClient)

    result = asyncio.run(bangumi.get_subject_detail(1002))

    assert result is not None
    assert result['bgm_id'] == 1002
    assert [call['proxy'] for call in FallbackAsyncClient.calls] == [None, 'http://127.0.0.1:7890']
    assert all(call['trust_env'] is False for call in FallbackAsyncClient.calls)


def test_subject_detail_proxy_initialization_failure_becomes_bangumi_error(monkeypatch):
    class FailingAsyncClient:
        def __init__(self, **kwargs: object) -> None:
            self.proxy = kwargs.get('proxy')

        async def __aenter__(self) -> FailingAsyncClient:
            if self.proxy is None:
                request = httpx.Request('GET', 'https://api.bgm.tv')
                raise httpx.ConnectError('direct access unavailable', request=request)
            raise ImportError("No module named 'socksio'")

        async def __aexit__(self, _exc_type: object, _exc_value: object, _traceback: object) -> None:
            return None

    monkeypatch.setattr(bangumi, 'PROXY', 'socks5://127.0.0.1:1080')
    monkeypatch.setattr(bangumi.httpx, 'AsyncClient', FailingAsyncClient)

    with pytest.raises(bangumi.BangumiError):
        asyncio.run(bangumi.get_subject_detail(1002))


@pytest.mark.parametrize('path', ['/api/v1/bangumi/detail/1002', '/api/v1/bangumi/score/1002'])
def test_bangumi_detail_and_score_map_upstream_failure_to_502(client, monkeypatch, path):
    async def failed_detail(_bgm_id: int) -> None:
        raise bangumi.BangumiError('upstream unavailable')

    monkeypatch.setattr(bangumi, 'get_subject_detail', failed_detail)

    response = client.get(path)

    assert response.status_code == 502
    assert response.json()['detail'] == 'Bangumi 服务暂时不可用，请稍后重试'


def test_bangumi_search_maps_upstream_failure_to_502(client, make_user, monkeypatch):
    async def failed_search(_keyword: str, limit: int = 10) -> dict[str, Any]:
        del limit
        raise bangumi.BangumiError('upstream unavailable')

    monkeypatch.setattr(bangumi, 'search_subjects', failed_search)
    user = make_user('bangumi-search-error')

    response = client.get('/api/v1/bangumi/search?q=精确番剧', cookies=auth_cookie(user))

    assert response.status_code == 502


def test_bangumi_import_maps_upstream_failure_to_502(client, make_user, monkeypatch):
    async def failed_detail(_bgm_id: int) -> None:
        raise bangumi.BangumiError('upstream unavailable')

    monkeypatch.setattr(bangumi, 'get_subject_detail', failed_detail)
    admin = make_user('bangumi-import-error', role='admin')

    response = client.post('/api/v1/bangumi/import/1002', cookies=auth_cookie(admin))

    assert response.status_code == 502


def test_bangumi_detail_keeps_404_for_missing_subject(client, monkeypatch):
    async def missing_detail(_bgm_id: int) -> None:
        return None

    monkeypatch.setattr(bangumi, 'get_subject_detail', missing_detail)

    response = client.get('/api/v1/bangumi/detail/999999')

    assert response.status_code == 404
