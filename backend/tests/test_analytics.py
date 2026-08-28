from conftest import auth_cookie

from models import ContentItem, Rating, Tag


def _tag(db, name: str) -> Tag:
    existing = db.query(Tag).filter(Tag.name == name).first()
    if existing:
        return existing
    created = Tag(name=name, tag_type='custom')
    db.add(created)
    db.flush()
    return created


def _anime(
    db,
    *,
    creator_id: int,
    title: str,
    tags: list[str],
    is_public: bool = True,
) -> ContentItem:
    content = ContentItem(
        title=title,
        content_type='anime',
        is_public=is_public,
        created_by=creator_id,
        cover_url=f'https://example.com/{title}.jpg',
    )
    content.tags = [_tag(db, name) for name in tags]
    db.add(content)
    db.commit()
    db.refresh(content)
    return content


def _rating(db, *, user_id: int, content_id: int, score: int) -> Rating:
    rating = Rating(user_id=user_id, content_id=content_id, score=score, recommend=0, review='')
    db.add(rating)
    db.commit()
    db.refresh(rating)
    return rating


def test_analytics_requires_login_and_validates_user_scope(client, db, make_user):
    viewer = make_user('analytics-viewer')

    assert client.get('/api/v1/analytics/overview').status_code == 401

    missing_id = client.get(
        '/api/v1/analytics/overview?scope=user',
        cookies=auth_cookie(viewer),
    )
    assert missing_id.status_code == 422
    assert missing_id.json()['detail'] == '单用户分析必须提供 user_id'

    missing_user = client.get(
        '/api/v1/analytics/overview?scope=user&user_id=99999',
        cookies=auth_cookie(viewer),
    )
    assert missing_user.status_code == 404

    invalid_range = client.get(
        '/api/v1/analytics/overview?min_score=9&max_score=8',
        cookies=auth_cookie(viewer),
    )
    assert invalid_range.status_code == 422
    assert invalid_range.json()['detail'] == '最低评分不能高于最高评分'


def test_overview_defaults_to_global_and_filters_cloud_without_hiding_distribution(client, db, make_user):
    viewer = make_user('overview-viewer')
    other = make_user('overview-other')
    first = _anime(
        db,
        creator_id=viewer.id,
        title='第一部',
        tags=['日本', 'TV', '漫改', '恋爱'],
    )
    second = _anime(
        db,
        creator_id=viewer.id,
        title='第二部',
        tags=['漫画改', '奇幻'],
    )
    _anime(db, creator_id=viewer.id, title='候选一', tags=['漫画改', '恋爱'])
    _anime(db, creator_id=viewer.id, title='候选二', tags=['科幻'])
    private = _anime(
        db,
        creator_id=viewer.id,
        title='私有番剧',
        tags=['漫画改'],
        is_public=False,
    )
    _rating(db, user_id=viewer.id, content_id=first.id, score=80)
    _rating(db, user_id=other.id, content_id=second.id, score=100)
    _rating(db, user_id=other.id, content_id=private.id, score=100)
    _rating(db, user_id=viewer.id, content_id=second.id, score=0)

    response = client.get('/api/v1/analytics/overview', cookies=auth_cookie(viewer))

    assert response.status_code == 200
    payload = response.json()
    assert payload['scope'] == {'type': 'global', 'user': None}
    assert payload['rating_count'] == 2
    assert payload['title_count'] == 2
    assert payload['user_count'] == 2
    assert payload['average_score'] == 9.0
    assert len(payload['score_distribution']) == 20
    distribution = {bucket['score']: bucket['count'] for bucket in payload['score_distribution']}
    assert distribution[8.0] == 1
    assert distribution[10.0] == 1

    frequency = {item['name']: item for item in payload['frequency_tags']}
    weighted = {item['name']: item for item in payload['weighted_tags']}
    assert '日本' not in frequency
    assert 'TV' not in frequency
    assert '漫改' not in frequency
    assert frequency['漫画改']['rating_count'] == 2
    assert frequency['漫画改']['weight'] == 2.0
    assert weighted['漫画改']['weight'] == 1.8

    filtered = client.get(
        '/api/v1/analytics/overview?min_score=9&max_score=10',
        cookies=auth_cookie(viewer),
    ).json()
    assert filtered['rating_count'] == 1
    filtered_distribution = {bucket['score']: bucket['count'] for bucket in filtered['score_distribution']}
    assert filtered_distribution[8.0] == 1
    assert filtered_distribution[10.0] == 1
    assert {item['name'] for item in filtered['frequency_tags']} == {'奇幻', '漫画改'}


def test_user_overview_is_visible_to_other_members(client, db, make_user):
    viewer = make_user('member-viewer')
    target = make_user('member-target')
    content = _anime(db, creator_id=viewer.id, title='个人代表作', tags=['治愈', '日常'])
    _anime(db, creator_id=viewer.id, title='全站补充', tags=['治愈'])
    _rating(db, user_id=target.id, content_id=content.id, score=85)

    response = client.get(
        f'/api/v1/analytics/overview?scope=user&user_id={target.id}',
        cookies=auth_cookie(viewer),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload['scope']['type'] == 'user'
    assert payload['scope']['user']['id'] == target.id
    assert payload['rating_count'] == 1
    assert payload['favorites'][0]['id'] == content.id
    assert payload['favorites'][0]['score'] == 8.5


def test_recommendations_exclude_scope_user_ratings_and_penalize_low_score_tags(client, db, make_user):
    viewer = make_user('recommend-viewer')
    cold_user = make_user('recommend-cold')
    liked = _anime(db, creator_id=viewer.id, title='喜欢的恋爱番', tags=['恋爱', '校园'])
    disliked = _anime(db, creator_id=viewer.id, title='不喜欢的恐怖番', tags=['恐怖', '惊悚'])
    good_candidate = _anime(db, creator_id=viewer.id, title='恋爱候选', tags=['恋爱', '校园'])
    bad_candidate = _anime(db, creator_id=viewer.id, title='恐怖候选', tags=['恐怖', '惊悚'])
    neutral_candidate = _anime(db, creator_id=viewer.id, title='中性候选', tags=['科幻'])
    _anime(db, creator_id=viewer.id, title='科幻补充', tags=['科幻'])
    _rating(db, user_id=viewer.id, content_id=liked.id, score=100)
    _rating(db, user_id=viewer.id, content_id=disliked.id, score=20)
    _rating(db, user_id=viewer.id, content_id=neutral_candidate.id, score=0)

    personal_response = client.get(
        f'/api/v1/analytics/recommendations?scope=user&user_id={viewer.id}&limit=6',
        cookies=auth_cookie(viewer),
    )

    assert personal_response.status_code == 200
    personal = personal_response.json()
    assert personal['basis'] == 'blended'
    assert personal['confidence'] == 'low'
    ids = [item['id'] for item in personal['items']]
    assert liked.id not in ids
    assert disliked.id not in ids
    assert ids.index(good_candidate.id) < ids.index(bad_candidate.id)
    good = next(item for item in personal['items'] if item['id'] == good_candidate.id)
    bad = next(item for item in personal['items'] if item['id'] == bad_candidate.id)
    assert good['match_percent'] > bad['match_percent']
    assert set(good['matched_tags']) == {'恋爱', '校园'}

    global_response = client.get(
        '/api/v1/analytics/recommendations?limit=6',
        cookies=auth_cookie(viewer),
    ).json()
    global_ids = [item['id'] for item in global_response['items']]
    assert liked.id not in global_ids
    assert disliked.id not in global_ids
    assert neutral_candidate.id in global_ids

    cold_response = client.get(
        f'/api/v1/analytics/recommendations?scope=user&user_id={cold_user.id}',
        cookies=auth_cookie(viewer),
    ).json()
    assert cold_response['basis'] == 'global_fallback'
    assert cold_response['confidence'] == 'low'
    assert cold_response['profile_rating_count'] == 0
