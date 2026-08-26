import asyncio

import pytest

from models import AiringCalendarItem, AiringCalendarSyncState, ContentItem
from services import airing_calendar


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
