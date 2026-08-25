import asyncio
from datetime import UTC, datetime

from bs4 import BeautifulSoup

from services import mikan

DETAIL_HTML = """
<html><body>
  <a href="https://bgm.tv/subject/571784">Bangumi</a>
  <section class="episode-list">
    <a href="/Home/PublishGroup/123">LoliHouse</a>
    <div class="an-res-row-frame">
      <time datetime="2026-08-20T10:00:00Z"></time>
      <a href="magnet:?xt=urn:btih:abc123" title="[LoliHouse] 测试番剧 01">下载</a>
      <a href="https://mikanani.me/Home/Episode/999">来源</a>
      <span>1.2 GB</span>
    </div>
  </section>
</body></html>
"""


RSS_XML = """
<rss><channel>
  <item>
    <title>[LoliHouse] 测试番剧 02</title>
    <guid>mikan-episode-2</guid>
    <link>https://mikanani.me/Home/Episode/1000</link>
    <pubDate>Thu, 21 Aug 2026 10:00:00 GMT</pubDate>
    <magnetURI>magnet:?xt=urn:btih:def456</magnetURI>
    <contentLength>2048</contentLength>
  </item>
</channel></rss>
"""


def test_parse_detail_requires_exact_bangumi_subject():
    matched, resources, groups = mikan._parse_detail(DETAIL_HTML, 'https://mikanani.me/Home/Bangumi/1', 571784)

    assert matched is True
    assert groups['123']['name'] == 'LoliHouse'
    assert resources[0]['provider'] == 'mikan'
    assert resources[0]['fansub']['id'] == '123'
    assert resources[0]['size'] == int(1.2 * 1024**3)
    assert resources[0]['created_at'].tzinfo == UTC

    mismatched, empty_resources, empty_groups = mikan._parse_detail(
        DETAIL_HTML.replace('571784', '999999'),
        'https://mikanani.me/Home/Bangumi/1',
        571784,
    )
    assert mismatched is False
    assert empty_resources == []
    assert empty_groups == {}


def test_parse_group_rss_normalizes_resource_fields():
    resources = mikan._parse_rss(RSS_XML, 571784, '123', 'LoliHouse')

    assert len(resources) == 1
    resource = resources[0]
    assert resource['provider_id'] == 'mikan-episode-2'
    assert resource['magnet'].startswith('magnet:')
    assert resource['fansub']['id'] == '123'
    assert resource['created_at'] == datetime(2026, 8, 21, 10, tzinfo=UTC)
    assert resource['size'] == 2048


def test_mikan_resource_cleanup_drops_placeholders_and_duplicate_magnets():
    resources = [
        {'title': 'Mikan 资源', 'size': 0, 'provider_id': 'placeholder-1', 'magnet': ''},
        {
            'title': '[LoliHouse] 测试番剧',
            'size': 1024,
            'provider_id': 'episode-1',
            'magnet': 'magnet:?xt=urn:btih:ABC123',
        },
        {
            'title': '[LoliHouse] 测试番剧（重复行）',
            'size': 2048,
            'provider_id': 'episode-2',
            'magnet': 'magnet:?xt=urn:btih:ABC123',
        },
    ]

    cleaned = mikan._deduplicate_resources(resources)

    assert len(cleaned) == 1
    assert cleaned[0]['provider_id'] == 'episode-1'
    assert cleaned[0]['size'] == 1024


def test_mikan_group_parser_prefers_publish_group_id():
    soup = BeautifulSoup(
        '<div class="subgroup-text" id="1254">'
        '<a href="/Home/PublishGroup/1025">7³ACG</a>'
        '<div><a href="magnet:?xt=urn:btih:test">资源</a></div>'
        '</div>',
        'html.parser',
    )

    assert mikan._group_for(soup.select_one('a[href^="magnet:"]')) == ('1025', '7³ACG')


def test_mikan_canonicalizes_title_only_resources_to_unique_group_id():
    resources = [
        {'fansub': {'id': '1231', 'name': '沸班亚马制作组'}},
        {'fansub': {'id': None, 'name': '[沸班亚马制作组]'.strip('[]')}},
    ]
    groups = {'1231': {'id': '1231', 'name': '沸班亚马制作组'}}

    mikan._canonicalize_fansub_groups(resources, groups)

    assert [resource['fansub']['id'] for resource in resources] == ['1231', '1231']


def test_mikan_does_not_merge_ambiguous_same_name_group_ids():
    resources = [
        {'fansub': {'id': '1231', 'name': '同名字幕组'}},
        {'fansub': {'id': None, 'name': '同名字幕组'}},
    ]
    groups = {
        '1231': {'id': '1231', 'name': '同名字幕组'},
        '1232': {'id': '1232', 'name': '同名字幕组'},
    }

    mikan._canonicalize_fansub_groups(resources, groups)

    assert resources[1]['fansub']['id'] is None


def test_mikan_rss_uses_resolved_mikan_bangumi_id(monkeypatch):
    captured: dict[str, str] = {}

    async def fake_fetch_resources(*_args, **_kwargs):
        return {'mikan_bangumi_id': 3141, 'resources': []}

    async def fake_get_path(path: str):
        captured['path'] = path
        return RSS_XML, 'https://mikanani.kas.pub'

    monkeypatch.setattr(mikan, 'fetch_resources', fake_fetch_resources)
    monkeypatch.setattr(mikan, '_get_path', fake_get_path)

    result = asyncio.run(
        mikan.fetch_group_resources(
            subject_id=571784,
            fansub_id='1254',
            fansub_name='7³ACG',
            title='测试番剧',
        )
    )

    assert 'bangumiId=3141' in captured['path']
    assert 'subgroupid=1254' in captured['path']
    assert result['resources'][0]['subject_id'] == 571784


def test_mikan_title_discovery_skips_season_endpoint(monkeypatch):
    paths: list[str] = []

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

    async def fake_get_path(path: str, _client=None):
        paths.append(path)
        if path.startswith('/Home/Search'):
            return '<a href="/Home/Bangumi/42">候选</a>', 'https://mikanani.me'
        return DETAIL_HTML, 'https://mikanani.me'

    monkeypatch.setattr(mikan, '_client', lambda: FakeClient())
    monkeypatch.setattr(mikan, '_get_path', fake_get_path)

    result = asyncio.run(mikan._resolve_and_fetch(571784, '中文标题', 'English Title', '2026-08-01'))

    assert result['matched'] is True
    assert paths[0].startswith('/Home/Search?searchstr=English%20Title')
    assert not any('BangumiCoverFlowByDayOfWeek' in path for path in paths)


def test_mikan_stale_cache_returns_immediately_and_refreshes_once(monkeypatch):
    calls = 0

    async def fake_resolve(*_args):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return {'resources': [], 'groups': {}, 'matched': False, 'match_method': 'none'}

    async def scenario():
        mikan._cache.clear()
        mikan._locks.clear()
        mikan._refresh_tasks.clear()
        now = asyncio.get_running_loop().time()
        mikan._cache[571784] = mikan._CacheEntry(
            fresh_until=now - 1,
            stale_until=now + 60,
            result={'resources': [], 'groups': {}, 'matched': True, 'match_method': 'bangumi'},
        )
        monkeypatch.setattr(mikan, '_resolve_and_fetch', fake_resolve)
        first, second = await asyncio.gather(
            mikan.fetch_resources(571784, title='测试番剧'),
            mikan.fetch_resources(571784, title='测试番剧'),
        )
        await asyncio.sleep(0.03)
        return first, second

    first, second = asyncio.run(scenario())

    assert first['matched'] is True
    assert second['matched'] is True
    assert calls == 1
