import asyncio
from io import BytesIO

import pytest
from PIL import Image

from models import AiringCalendarItem, AiringCalendarSyncState, ContentItem
from services import airing_calendar, covers


def calendar_payload() -> list[dict]:
    payload = []
    for weekday in range(1, 8):
        payload.append(
            {
                'weekday': {'id': weekday, 'cn': f'星期{weekday}'},
                'items': [
                    {
                        'id': 1000 + weekday,
                        'type': 2,
                        'name': f'Anime {weekday}',
                        'name_cn': f'番剧 {weekday}',
                        'url': f'https://bgm.tv/subject/{1000 + weekday}',
                        'images': {'large': f'https://img.example/{weekday}.jpg'},
                    },
                    {'id': 9000 + weekday, 'type': 4, 'name': '游戏条目'},
                ],
            },
        )
    payload[0]['items'].append(payload[0]['items'][0])
    return payload


def cover_bytes() -> bytes:
    """Create a small valid image for cover cache tests."""
    output = BytesIO()
    Image.new('RGB', (960, 1440), color=(251, 113, 167)).save(output, format='JPEG')
    return output.getvalue()


def test_parse_calendar_filters_non_anime_and_deduplicates():
    records = airing_calendar.parse_calendar(calendar_payload())

    assert len(records) == 7
    assert {record['weekday'] for record in records} == set(range(1, 8))
    assert all(record['subject_id'] >= 1001 for record in records)
    assert records[0]['title'] == '番剧 1'


def test_sync_failure_keeps_previous_active_snapshot(db, monkeypatch):
    async def fake_fetch():
        return calendar_payload()

    monkeypatch.setattr(airing_calendar.bangumi, 'fetch_calendar', fake_fetch)
    assert asyncio.run(airing_calendar.sync_calendar(db)) == 7
    before = db.query(AiringCalendarItem).filter(AiringCalendarItem.active.is_(True)).count()

    async def failed_fetch():
        raise airing_calendar.bangumi.BangumiError('upstream down')

    monkeypatch.setattr(airing_calendar.bangumi, 'fetch_calendar', failed_fetch)
    with pytest.raises(airing_calendar.bangumi.BangumiError):
        asyncio.run(airing_calendar.sync_calendar(db))

    assert db.query(AiringCalendarItem).filter(AiringCalendarItem.active.is_(True)).count() == before
    state = db.query(AiringCalendarSyncState).filter(AiringCalendarSyncState.id == 1).one()
    assert state.status == 'failed'
    assert state.item_count == 7


def test_week_api_matches_public_bangumi_content(client, db, make_user, monkeypatch):
    user = make_user('calendar-reader')
    db.add(
        ContentItem(
            title='本地番剧',
            content_type='anime',
            source_type='bangumi',
            source_id='1001',
            cover_url='https://img.example/local.jpg',
            created_by=user.id,
        ),
    )
    db.commit()

    async def fake_fetch():
        return calendar_payload()

    monkeypatch.setattr(airing_calendar.bangumi, 'fetch_calendar', fake_fetch)
    assert asyncio.run(airing_calendar.sync_calendar(db)) == 7

    response = client.get('/api/v1/airing/week')
    assert response.status_code == 200
    payload = response.json()
    assert len(payload['days']) == 7
    first = payload['days'][0]['items'][0]
    assert first['subject_id'] == 1001
    assert first['matched'] is True
    assert first['content_id'] is not None


def test_week_api_places_matched_items_before_unmatched_items(client, db, make_user, monkeypatch):
    user = make_user('calendar-order-reader')
    db.add(
        ContentItem(
            title='已关联番剧',
            content_type='anime',
            source_type='bangumi',
            source_id='2001',
            cover_url='',
            created_by=user.id,
        ),
    )
    db.commit()

    payload = calendar_payload()
    payload[0]['items'].append(
        {
            'id': 2001,
            'type': 2,
            'name': 'Matched Anime',
            'name_cn': '已关联番剧',
            'url': 'https://bgm.tv/subject/2001',
            'images': {'large': 'https://img.example/matched.jpg'},
        },
    )

    async def fake_fetch():
        return payload

    monkeypatch.setattr(airing_calendar.bangumi, 'fetch_calendar', fake_fetch)
    assert asyncio.run(airing_calendar.sync_calendar(db)) == 8

    items = client.get('/api/v1/airing/week').json()['days'][0]['items']
    assert [item['matched'] for item in items] == [True, False]
    assert items[0]['subject_id'] == 2001


def test_week_api_returns_etag_and_not_modified(client, db, monkeypatch):
    async def fake_fetch():
        return calendar_payload()

    monkeypatch.setattr(airing_calendar.bangumi, 'fetch_calendar', fake_fetch)
    assert asyncio.run(airing_calendar.sync_calendar(db)) == 7

    first = client.get('/api/v1/airing/week')
    assert first.status_code == 200
    assert first.headers['cache-control'] == 'public, max-age=300, stale-while-revalidate=600'
    etag = first.headers['etag']

    second = client.get('/api/v1/airing/week', headers={'If-None-Match': etag})
    assert second.status_code == 304
    assert second.headers['etag'] == etag


def test_matched_and_unmatched_items_share_subject_asset(client, db, make_user, monkeypatch, tmp_path):
    monkeypatch.setenv('COVERS_DIR', str(tmp_path / 'covers'))
    monkeypatch.setenv('MOREANI_AIRING_COVER_PREFETCH', 'true')
    user = make_user('shared-cover-reader')
    db.add(
        ContentItem(
            title='共享封面番剧',
            content_type='anime',
            source_type='bangumi',
            source_id='1001',
            cover_url='',
            created_by=user.id,
        ),
    )
    db.commit()

    async def fake_fetch():
        return calendar_payload()

    async def fake_download(_client, _url):
        return cover_bytes(), 'image/jpeg'

    monkeypatch.setattr(airing_calendar.bangumi, 'fetch_calendar', fake_fetch)
    monkeypatch.setattr(covers, '_download_async_bytes', fake_download)
    assert asyncio.run(airing_calendar.sync_calendar(db)) == 7

    payload = client.get('/api/v1/airing/week').json()
    item = payload['days'][0]['items'][0]
    assert item['matched'] is True
    assert item['cover_url'].startswith('/api/covers/bangumi/1001.webp?v=')
    assert covers.get_asset_url_map(db, {1001})[1001] == item['cover_url']


def test_cover_prefetch_deduplicates_and_skips_ready_asset(db, tmp_path, monkeypatch):
    monkeypatch.setenv('COVERS_DIR', str(tmp_path / 'covers'))
    calls = 0

    async def fake_download(_client, _url):
        nonlocal calls
        calls += 1
        return cover_bytes(), 'image/jpeg'

    monkeypatch.setattr(covers, '_download_async_bytes', fake_download)
    records = [
        {'subject_id': 1001, 'cover_url': 'https://lain.bgm.tv/pic/1001.jpg'},
        {'subject_id': 1001, 'cover_url': 'https://lain.bgm.tv/pic/1001.jpg'},
    ]

    first = asyncio.run(covers.prefetch_airing_covers(db, records))
    second = asyncio.run(covers.prefetch_airing_covers(db, records))

    assert first == {'total': 1, 'skipped': 0, 'downloaded': 1, 'failed': 0}
    assert second == {'total': 1, 'skipped': 1, 'downloaded': 0, 'failed': 0}
    assert calls == 1
    asset = db.query(covers.CoverAsset).filter_by(source_id='1001').one()
    assert asset.local_path == 'bangumi/1001.webp'
    assert covers.get_asset_url_map(db, {1001})[1001].startswith('/api/covers/bangumi/1001.webp?v=')


def test_cover_url_change_and_corrupt_file_trigger_download(db, tmp_path, monkeypatch):
    monkeypatch.setenv('COVERS_DIR', str(tmp_path / 'covers'))
    calls = 0

    async def fake_download(_client, _url):
        nonlocal calls
        calls += 1
        return cover_bytes(), 'image/jpeg'

    monkeypatch.setattr(covers, '_download_async_bytes', fake_download)
    asyncio.run(covers.prefetch_airing_covers(db, [{'subject_id': 1002, 'cover_url': 'https://lain.bgm.tv/old.jpg'}]))
    first_path = tmp_path / 'covers' / 'bangumi' / '1002.webp'
    first_path.write_bytes(b'broken')
    second = asyncio.run(
        covers.prefetch_airing_covers(db, [{'subject_id': 1002, 'cover_url': 'https://lain.bgm.tv/new.jpg'}])
    )

    assert second['downloaded'] == 1
    assert calls == 2
    assert db.query(covers.CoverAsset).filter_by(source_id='1002').one().source_url.endswith('new.jpg')


def test_cover_failure_keeps_external_fallback_and_calendar_data(db, tmp_path, monkeypatch):
    monkeypatch.setenv('COVERS_DIR', str(tmp_path / 'covers'))

    async def failed_download(_client, _url):
        raise covers.CoverDownloadError('upstream unavailable')

    monkeypatch.setattr(covers, '_download_async_bytes', failed_download)
    records = [{'subject_id': 1003, 'cover_url': 'https://lain.bgm.tv/fallback.jpg', 'weekday': 1}]
    result = asyncio.run(covers.prefetch_airing_covers(db, records))

    assert result['failed'] == 1
    assert db.query(covers.CoverAsset).filter_by(source_id='1003').one().status == 'failed'


def test_legacy_content_cover_is_reused_without_external_download(db, tmp_path, monkeypatch):
    monkeypatch.setenv('COVERS_DIR', str(tmp_path / 'covers'))
    legacy_path = tmp_path / 'covers' / '77.jpg'
    legacy_path.parent.mkdir(parents=True)
    legacy_path.write_bytes(cover_bytes())
    db.add(
        ContentItem(
            title='Legacy cover',
            content_type='anime',
            source_type='bangumi',
            source_id='1004',
            cover_url='/api/covers/77.jpg',
        ),
    )
    db.commit()

    async def unexpected_download(_client, _url):
        raise AssertionError('legacy cover should not download from CDN')

    monkeypatch.setattr(covers, '_download_async_bytes', unexpected_download)
    result = asyncio.run(
        covers.prefetch_airing_covers(db, [{'subject_id': 1004, 'cover_url': 'https://lain.bgm.tv/1004.jpg'}])
    )

    assert result['downloaded'] == 1
    assert (tmp_path / 'covers' / 'bangumi' / '1004.webp').is_file()


def test_other_content_type_groups_five_non_anime_types(client, db, make_user):
    user = make_user('other-reader')
    for content_type in ('movie', 'game', 'software', 'website', 'book', 'anime', 'anime_movie'):
        db.add(ContentItem(title=content_type, content_type=content_type, created_by=user.id))
    db.commit()

    response = client.get('/api/v1/content?type=other&size=100')
    assert response.status_code == 200
    assert {item['content_type'] for item in response.json()['items']} == {
        'movie',
        'game',
        'software',
        'website',
        'book',
    }

    anime_response = client.get('/api/v1/content?type=anime&size=100')
    assert anime_response.status_code == 200
    assert {item['content_type'] for item in anime_response.json()['items']} == {'anime', 'anime_movie'}
