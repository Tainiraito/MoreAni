from conftest import auth_cookie

from models import ContentItem, Notification


def _content(db, creator_id: int) -> ContentItem:
    item = ContentItem(
        title='收藏动态测试番剧',
        content_type='anime',
        is_public=True,
        created_by=creator_id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def _favorite(client, user, content_id: int) -> None:
    response = client.post(
        '/api/v1/status',
        cookies=auth_cookie(user),
        json={'content_id': content_id, 'status': 'want'},
    )
    assert response.status_code == 200


def test_first_rating_activity_notifies_each_favorite_without_self_notification(client, db, make_user):
    actor = make_user('activity-actor')
    first_fan = make_user('activity-fan-one')
    second_fan = make_user('activity-fan-two')
    non_fan = make_user('activity-non-fan')
    content = _content(db, actor.id)
    _favorite(client, first_fan, content.id)
    _favorite(client, second_fan, content.id)

    response = client.post(
        '/api/v1/rating',
        cookies=auth_cookie(actor),
        json={'content_id': content.id, 'score': 85, 'recommend': 0, 'review': '不应进入通知正文'},
    )
    assert response.status_code == 200

    for recipient in (first_fan, second_fan):
        notifications = client.get('/api/v1/notifications?scope=private', cookies=auth_cookie(recipient))
        assert notifications.status_code == 200
        payload = notifications.json()
        assert payload['total'] == 1
        notification = payload['items'][0]
        assert notification['kind'] == 'content_activity'
        assert notification['body'] == f'{actor.nickname} 对《{content.title}》进行了评分 8.5、评论'
        assert '不应进入通知正文' not in notification['body']
        assert notification['payload'] == {
            'content_id': content.id,
            'rating_id': response.json()['id'],
            'actor_user_id': actor.id,
            'actor_nickname': actor.nickname,
            'has_score': True,
            'has_review': True,
        }

    actor_notifications = client.get('/api/v1/notifications?scope=private', cookies=auth_cookie(actor))
    non_fan_notifications = client.get('/api/v1/notifications?scope=private', cookies=auth_cookie(non_fan))
    assert actor_notifications.json()['total'] == 0
    assert non_fan_notifications.json()['total'] == 0

    update = client.post(
        '/api/v1/rating',
        cookies=auth_cookie(actor),
        json={'content_id': content.id, 'score': 90, 'recommend': 0, 'review': '修改后不应重复通知'},
    )
    assert update.status_code == 200
    assert client.get('/api/v1/notifications?scope=private', cookies=auth_cookie(first_fan)).json()['total'] == 1

    assert db.query(Notification).filter(Notification.kind == 'content_activity').count() == 2


def test_empty_rating_becomes_first_activity_and_notifies_once(client, db, make_user):
    actor = make_user('empty-activity-actor')
    fan = make_user('empty-activity-fan')
    content = _content(db, actor.id)
    _favorite(client, fan, content.id)

    empty = client.post(
        '/api/v1/rating',
        cookies=auth_cookie(actor),
        json={'content_id': content.id, 'score': 0, 'recommend': 0, 'review': ''},
    )
    assert empty.status_code == 200
    assert client.get('/api/v1/notifications?scope=private', cookies=auth_cookie(fan)).json()['total'] == 0

    first_activity = client.post(
        '/api/v1/rating',
        cookies=auth_cookie(actor),
        json={'content_id': content.id, 'score': 0, 'recommend': 0, 'review': '第一次有效动态'},
    )
    assert first_activity.status_code == 200
    assert client.get('/api/v1/notifications?scope=private', cookies=auth_cookie(fan)).json()['total'] == 1

    second_update = client.post(
        '/api/v1/rating',
        cookies=auth_cookie(actor),
        json={'content_id': content.id, 'score': 0, 'recommend': 0, 'review': '修改评论'},
    )
    assert second_update.status_code == 200
    assert client.get('/api/v1/notifications?scope=private', cookies=auth_cookie(fan)).json()['total'] == 1
