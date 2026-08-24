from datetime import UTC, datetime, timedelta

from conftest import auth_cookie

from models import ContentItem


def _content(db, user, *, source_id: str = '571784', source_type: str = 'bangumi') -> ContentItem:
    item = ContentItem(
        title='测试番剧',
        content_type='anime',
        source_type=source_type,
        source_id=source_id,
        created_by=user.id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def _resource(provider_id: str, created_at: datetime) -> dict:
    return {
        'id': int(provider_id),
        'provider': 'dmhy',
        'provider_id': provider_id,
        'title': f'[LoliHouse] 测试资源 {provider_id}',
        'href': f'https://dmhy.org/topics/view/{provider_id}',
        'type': '动画',
        'magnet': f'magnet:?xt=urn:btih:{provider_id}',
        'size': 1024,
        'fansub': {'id': 1, 'name': 'LoliHouse', 'avatar': None},
        'publisher': None,
        'subject_id': 571784,
        'created_at': created_at,
        'fetched_at': created_at,
    }


def test_resource_lookup_does_not_guess_unlinked_bangumi(client, db, make_user, monkeypatch):
    user = make_user('resource-viewer')
    item = _content(db, user, source_id='', source_type='manual')

    async def should_not_fetch(*_args, **_kwargs):
        raise AssertionError('unlinked anime must not query Anime Garden')

    monkeypatch.setattr('routers.v1.content.animegarden.fetch_resources', should_not_fetch)
    response = client.get(f'/api/v1/content/{item.id}/resources')

    assert response.status_code == 200
    assert response.json()['available'] is False
    assert response.json()['resources'] == []


def test_resource_lookup_uses_bangumi_subject_and_normalizes_fields(client, db, make_user, monkeypatch):
    user = make_user('resource-api-reader')
    item = _content(db, user)
    resource = _resource('200', datetime.now(UTC))
    captured: dict = {}

    async def fake_fetch(subject_id, **kwargs):
        captured.update(subject_id=subject_id, kwargs=kwargs)
        return {'resources': [resource], 'page': 1, 'page_size': 50, 'complete': True}

    monkeypatch.setattr('routers.v1.content.animegarden.fetch_resources', fake_fetch)
    response = client.get(f'/api/v1/content/{item.id}/resources?source=animegarden&page=1&size=50')

    assert response.status_code == 200
    assert captured == {'subject_id': 571784, 'kwargs': {'page': 1, 'page_size': 50}}
    payload = response.json()
    assert payload['available'] is True
    assert payload['resources'][0]['provider_id'] == '200'
    assert payload['resources'][0]['fansub']['name'] == 'LoliHouse'


def test_resource_lookup_defaults_to_mikan(client, db, make_user, monkeypatch):
    user = make_user('mikan-resource-reader')
    item = _content(db, user)
    resource = {**_resource('201', datetime.now(UTC)), 'source': 'mikan', 'provider': 'mikan'}
    captured: dict = {}

    async def fake_fetch(subject_id, **kwargs):
        captured.update(subject_id=subject_id, kwargs=kwargs)
        return {
            'resources': [resource],
            'page': 1,
            'page_size': 50,
            'complete': True,
            'matched': True,
            'match_method': 'bangumi',
            'message': None,
        }

    monkeypatch.setattr('services.resources.mikan.fetch_resources', fake_fetch)
    response = client.get(f'/api/v1/content/{item.id}/resources')

    assert response.status_code == 200
    assert captured['subject_id'] == 571784
    assert captured['kwargs']['title'] == '测试番剧'
    assert response.json()['source'] == 'mikan'
    assert response.json()['match_method'] == 'bangumi'


def test_mikan_subscription_creates_source_specific_notification(client, db, make_user, monkeypatch):
    user = make_user('mikan-resource-subscriber')
    item = _content(db, user)
    first_time = datetime.now(UTC) - timedelta(days=1)
    resources = [
        {
            **_resource('100', first_time),
            'source': 'mikan',
            'provider': 'mikan',
            'provider_id': 'mikan-100',
            'fansub': {'id': '123', 'name': 'LoliHouse', 'avatar': None},
        }
    ]

    async def fake_fetch_group_resources(**_kwargs):
        return {'resources': list(resources), 'page': 1, 'page_size': 1000, 'complete': True}

    monkeypatch.setattr('services.notifications.mikan.fetch_group_resources', fake_fetch_group_resources)
    monkeypatch.setattr('services.notifications._refresh_last_checked', 0.0)

    subscription_response = client.post(
        '/api/v1/resource-subscriptions',
        cookies=auth_cookie(user),
        json={'content_id': item.id, 'source': 'mikan', 'fansub_id': '123', 'fansub_name': 'LoliHouse'},
    )
    assert subscription_response.status_code == 200
    assert subscription_response.json()['source'] == 'mikan'
    assert subscription_response.json()['fansub_key'] == 'group:123'

    resources.append(
        {
            **resources[0],
            'provider_id': 'mikan-101',
            'title': '[LoliHouse] 测试资源 101',
            'created_at': datetime.now(UTC),
        }
    )
    refresh_response = client.post('/api/v1/notifications/refresh', cookies=auth_cookie(user))
    assert refresh_response.status_code == 200
    assert refresh_response.json() == {'created': 1}

    notifications = client.get('/api/v1/notifications?scope=private', cookies=auth_cookie(user))
    assert notifications.json()['items'][0]['payload']['source'] == 'mikan'
    assert notifications.json()['items'][0]['payload']['resource_key'] == 'mikan:mikan-101'


def test_subscription_baseline_and_single_update_notification(client, db, make_user, monkeypatch):
    user = make_user('resource-subscriber')
    item = _content(db, user)
    first_time = datetime.now(UTC) - timedelta(days=1)
    resources = [_resource('100', first_time)]

    async def fake_fetch(*_args, **_kwargs):
        return {'resources': list(resources), 'page': 1, 'page_size': 1000, 'complete': True}

    monkeypatch.setattr('services.notifications.animegarden.fetch_resources', fake_fetch)

    subscription_response = client.post(
        '/api/v1/resource-subscriptions',
        cookies=auth_cookie(user),
        json={'content_id': item.id, 'fansub_name': ' LoliHouse '},
    )
    assert subscription_response.status_code == 200
    assert subscription_response.json()['fansub_key'] == 'lolihouse'

    resources.append(_resource('101', datetime.now(UTC)))
    refresh_response = client.post('/api/v1/notifications/refresh', cookies=auth_cookie(user))
    assert refresh_response.status_code == 200
    assert refresh_response.json() == {'created': 1}

    second_refresh = client.post('/api/v1/notifications/refresh', cookies=auth_cookie(user))
    assert second_refresh.status_code == 200
    assert second_refresh.json() == {'created': 0}

    notifications = client.get('/api/v1/notifications?scope=private', cookies=auth_cookie(user))
    assert notifications.status_code == 200
    payload = notifications.json()
    assert payload['total'] == 1
    assert payload['items'][0]['payload']['resource_key'] == 'dmhy:101'

    unread = client.get('/api/v1/notifications/unread-count', cookies=auth_cookie(user))
    assert unread.json() == {'total': 1, 'public': 0, 'private': 1}

    notification_id = payload['items'][0]['id']
    assert client.post(f'/api/v1/notifications/{notification_id}/read', cookies=auth_cookie(user)).status_code == 200
    assert client.get('/api/v1/notifications/unread-count', cookies=auth_cookie(user)).json()['total'] == 0


def test_public_announcement_visibility_and_admin_permissions(client, make_user):
    user = make_user('announcement-reader')
    admin = make_user('announcement-admin', role='super_admin')
    body = {'title': '版本更新', 'body': '资源通知功能已上线', 'is_published': True}

    forbidden = client.post('/api/v1/admin/announcements', cookies=auth_cookie(user), json=body)
    assert forbidden.status_code == 403

    created = client.post('/api/v1/admin/announcements', cookies=auth_cookie(admin), json=body)
    assert created.status_code == 201
    announcement_id = created.json()['id']

    public_list = client.get('/api/v1/notifications?scope=public')
    assert public_list.status_code == 200
    assert public_list.json()['items'][0]['title'] == '版本更新'

    user_list = client.get('/api/v1/notifications?scope=public', cookies=auth_cookie(user))
    assert user_list.json()['unread_count'] == 1
    notification_id = user_list.json()['items'][0]['id']
    assert client.post(f'/api/v1/notifications/{notification_id}/read', cookies=auth_cookie(user)).status_code == 200
    assert client.get('/api/v1/notifications/unread-count', cookies=auth_cookie(user)).json()['total'] == 0

    assert client.delete(f'/api/v1/admin/announcements/{announcement_id}', cookies=auth_cookie(user)).status_code == 403
    assert (
        client.delete(f'/api/v1/admin/announcements/{announcement_id}', cookies=auth_cookie(admin)).status_code == 204
    )
