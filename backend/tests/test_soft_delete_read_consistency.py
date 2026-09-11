from conftest import auth_cookie

from models import ContentItem, UserContentStatus


def _content(db, owner_id: int, title: str) -> ContentItem:
    content = ContentItem(
        title=title,
        content_type='anime',
        is_public=True,
        created_by=owner_id,
    )
    db.add(content)
    db.commit()
    db.refresh(content)
    return content


def _content_ids(payload: dict) -> set[int]:
    return {item['content_id'] for item in payload['items']}


def test_soft_deleted_content_is_excluded_from_user_visible_reads(client, db, make_user):
    user = make_user('soft-delete-reader')
    active = _content(db, user.id, '保留番剧')
    deleted = _content(db, user.id, '删除番剧')
    auth = auth_cookie(user)

    for content, score in ((active, 80), (deleted, 90)):
        response = client.post(
            '/api/v1/rating',
            cookies=auth,
            json={'content_id': content.id, 'score': score, 'review': f'{content.title} 评论'},
        )
        assert response.status_code == 200

    db.add_all(
        [
            UserContentStatus(content_id=active.id, user_id=user.id, status='want'),
            UserContentStatus(content_id=deleted.id, user_id=user.id, status='want'),
        ]
    )
    db.commit()

    recent_before = client.get('/api/v1/rating/recent').json()
    history_before = client.get('/api/v1/rating/history', cookies=auth).json()
    revisions_before = client.get('/api/v1/rating/revisions', cookies=auth).json()
    content_ratings_before = client.get(f'/api/v1/rating/content/{deleted.id}').json()
    profile_before = client.get(f'/api/v1/user/{user.id}', cookies=auth).json()
    activity_before = client.get(f'/api/v1/user/{user.id}/activity', cookies=auth).json()
    statuses_before = client.get('/api/v1/status', cookies=auth).json()

    assert recent_before['total'] == 2
    assert _content_ids(recent_before) == {active.id, deleted.id}
    assert history_before['total'] == 2
    assert _content_ids(history_before) == {active.id, deleted.id}
    assert revisions_before['total'] == 2
    assert _content_ids(revisions_before) == {active.id, deleted.id}
    assert content_ratings_before['total'] == 1
    assert _content_ids(content_ratings_before) == {deleted.id}
    assert profile_before['rating_count'] == 2
    assert profile_before['review_count'] == 2
    assert profile_before['favorite_count'] == 2
    assert profile_before['avg_score'] == 85.0
    assert profile_before['content_count'] == 2
    assert activity_before['total'] == 4
    assert _content_ids(activity_before) == {active.id, deleted.id}
    assert _content_ids(statuses_before) == {active.id, deleted.id}

    delete_response = client.delete(f'/api/v1/content/{deleted.id}', cookies=auth)
    assert delete_response.status_code == 204

    db.expire_all()
    assert db.query(ContentItem).filter_by(id=deleted.id).one().deleted_at is not None

    recent_after = client.get('/api/v1/rating/recent').json()
    history_after = client.get('/api/v1/rating/history', cookies=auth).json()
    revisions_after = client.get('/api/v1/rating/revisions', cookies=auth).json()
    content_ratings_after = client.get(f'/api/v1/rating/content/{deleted.id}').json()
    detail_after = client.get(f'/api/v1/content/{deleted.id}')
    profile_after = client.get(f'/api/v1/user/{user.id}', cookies=auth).json()
    activity_after = client.get(f'/api/v1/user/{user.id}/activity', cookies=auth).json()
    statuses_after = client.get('/api/v1/status', cookies=auth).json()

    assert recent_after['total'] == 1
    assert _content_ids(recent_after) == {active.id}
    assert history_after['total'] == 1
    assert _content_ids(history_after) == {active.id}
    assert revisions_after['total'] == 1
    assert _content_ids(revisions_after) == {active.id}
    assert content_ratings_after == {'items': [], 'total': 0}
    assert detail_after.status_code == 404
    assert profile_after['rating_count'] == 1
    assert profile_after['review_count'] == 1
    assert profile_after['favorite_count'] == 1
    assert profile_after['avg_score'] == 80.0
    assert profile_after['content_count'] == 1
    assert activity_after['total'] == 2
    assert _content_ids(activity_after) == {active.id}
    assert _content_ids(statuses_after) == {active.id}
