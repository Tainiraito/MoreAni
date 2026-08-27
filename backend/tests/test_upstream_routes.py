import asyncio
from collections.abc import Iterator
from typing import ClassVar

import httpx

from services import covers, mikan


class FakeCoverResponse:
    """Minimal streaming response for synchronous cover route tests."""

    status_code = 200
    headers = {'content-type': 'image/jpeg'}

    def __enter__(self) -> 'FakeCoverResponse':
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def iter_bytes(self) -> Iterator[bytes]:
        yield b'cover-bytes'


class FakeCoverClient:
    """Record cover client route order and optionally fail the proxy."""

    instances: ClassVar[list['FakeCoverClient']] = []
    fail_proxy: ClassVar[bool] = False

    def __init__(self, **kwargs: object) -> None:
        self.proxy = kwargs.get('proxy')
        type(self).instances.append(self)

    def __enter__(self) -> 'FakeCoverClient':
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def stream(self, method: str, url: str, *, headers: dict[str, str]) -> FakeCoverResponse:
        del method, headers
        if self.fail_proxy and self.proxy is not None:
            raise httpx.ConnectError('proxy unavailable', request=httpx.Request('GET', url))
        return FakeCoverResponse()


def test_cover_download_uses_proxy_before_direct(monkeypatch):
    """A healthy cover proxy must prevent the direct attempt."""
    FakeCoverClient.instances.clear()
    FakeCoverClient.fail_proxy = False
    monkeypatch.setattr(covers.httpx, 'Client', FakeCoverClient)
    monkeypatch.setattr(covers, 'PROXY', 'http://127.0.0.1:7890')
    monkeypatch.setattr(covers, 'REQUEST_ORDER', 'proxy_first')

    data, content_type = covers._download_sync_bytes('https://lain.bgm.tv/pic/test.jpg')

    assert data == b'cover-bytes'
    assert content_type == 'image/jpeg'
    assert [client.proxy for client in FakeCoverClient.instances] == ['http://127.0.0.1:7890']


def test_cover_download_falls_back_to_direct_after_proxy_failure(monkeypatch):
    """A failed cover proxy should be followed by one direct attempt."""
    FakeCoverClient.instances.clear()
    FakeCoverClient.fail_proxy = True
    monkeypatch.setattr(covers.httpx, 'Client', FakeCoverClient)
    monkeypatch.setattr(covers, 'PROXY', 'http://127.0.0.1:7890')
    monkeypatch.setattr(covers, 'REQUEST_ORDER', 'proxy_first')

    covers._download_sync_bytes('https://lain.bgm.tv/pic/test.jpg')

    assert [client.proxy for client in FakeCoverClient.instances] == [
        'http://127.0.0.1:7890',
        None,
    ]


class FakeMikanResponse:
    """Minimal successful Mikan response."""

    text = '<html></html>'

    def raise_for_status(self) -> None:
        return None


class FakeMikanClient:
    """Record Mikan routes and optionally reject the proxy route."""

    calls: ClassVar[list[str | None]] = []
    fail_proxy: ClassVar[bool] = False

    def __init__(self, proxy: str | None) -> None:
        self.proxy = proxy

    async def get(self, url: str) -> FakeMikanResponse:
        type(self).calls.append(self.proxy)
        if self.fail_proxy and self.proxy is not None:
            raise httpx.ConnectError('proxy unavailable', request=httpx.Request('GET', url))
        return FakeMikanResponse()


def test_mikan_path_uses_proxy_before_direct(monkeypatch):
    """Mikan should use the explicit proxy before trying direct access."""
    FakeMikanClient.calls.clear()
    FakeMikanClient.fail_proxy = False
    monkeypatch.setattr(mikan, 'MIKAN_PROXY', 'http://127.0.0.1:7890')
    monkeypatch.setattr(mikan, 'MIKAN_REQUEST_ORDER', 'proxy_first')
    monkeypatch.setattr(mikan, 'MIKAN_BASE_URL', 'https://mikan.example')
    monkeypatch.setattr(mikan, 'MIKAN_FALLBACK_BASE_URL', '')
    monkeypatch.setattr(mikan, '_client_for', FakeMikanClient)
    mikan._base_failures.clear()

    result = asyncio.run(mikan._get_path('/Home/Search?searchstr=test'))

    assert result[0] == '<html></html>'
    assert FakeMikanClient.calls == ['http://127.0.0.1:7890']


def test_mikan_path_falls_back_to_direct_after_proxy_failure(monkeypatch):
    """Mikan should only try direct access after the proxy route fails."""
    FakeMikanClient.calls.clear()
    FakeMikanClient.fail_proxy = True
    monkeypatch.setattr(mikan, 'MIKAN_PROXY', 'http://127.0.0.1:7890')
    monkeypatch.setattr(mikan, 'MIKAN_REQUEST_ORDER', 'proxy_first')
    monkeypatch.setattr(mikan, 'MIKAN_BASE_URL', 'https://mikan.example')
    monkeypatch.setattr(mikan, 'MIKAN_FALLBACK_BASE_URL', '')
    monkeypatch.setattr(mikan, '_client_for', FakeMikanClient)
    mikan._base_failures.clear()

    result = asyncio.run(mikan._get_path('/Home/Search?searchstr=test'))

    assert result[0] == '<html></html>'
    assert FakeMikanClient.calls == [
        'http://127.0.0.1:7890',
        None,
    ]
