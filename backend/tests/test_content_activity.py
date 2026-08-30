from conftest import auth_cookie

from models import ContentItem, Rating, UserContentStatus
from services import covers as covers_svc


def test_content_list_includes_score_only_activity_and_counts_valid_activity(client, db, make_user):
    score_only_user = make_user('score-only-user')
    comment_only_user = make_user('comment-only-user')
    score_and_comment_user = make_user('score-comment-user')
    empty_user = make_user('empty-rating-user')
    content = ContentItem(
        title='评分动态测试番剧',
        content_type='anime',
        is_public=True,
        created_by=score_only_user.id,
    )
    db.add(content)
    db.flush()
    db.add_all(
        [
            Rating(content_id=content.id, user_id=score_only_user.id, score=90, review=''),
            Rating(content_id=content.id, user_id=comment_only_user.id, score=0, review='只评论'),
            Rating(content_id=content.id, user_id=score_and_comment_user.id, score=80, review='评分评论'),
            Rating(content_id=content.id, user_id=empty_user.id, score=0, review=''),
        ],
    )
    db.commit()

    response = client.get('/api/v1/content?type=anime&size=20')

    assert response.status_code == 200
    item = next(item for item in response.json()['items'] if item['id'] == content.id)
    activities = {activity['nickname']: activity for activity in item['recent_reviews']}

    assert set(activities) == {
        score_only_user.nickname,
        comment_only_user.nickname,
        score_and_comment_user.nickname,
    }
    assert activities[score_only_user.nickname]['score'] == 90
    assert activities[score_only_user.nickname]['review'] == ''
    assert activities[comment_only_user.nickname]['score'] == 0
    assert activities[comment_only_user.nickname]['review'] == '只评论'
    assert item['rating_count'] == 2
    assert item['review_count'] == 2
    assert item['activity_count'] == 3


def test_content_related_responses_use_resolved_cover_url(client, db, make_user, monkeypatch):
    user = make_user('resolved-cover-user')
    content = ContentItem(
        title='统一封面响应测试',
        content_type='anime',
        source_type='bangumi',
        source_id='1001',
        cover_url='https://lain.bgm.tv/pic/raw-cover.jpg',
        is_public=True,
        created_by=user.id,
    )
    db.add(content)
    db.flush()
    db.add(Rating(content_id=content.id, user_id=user.id, score=90, review='测试评论'))
    db.add(UserContentStatus(content_id=content.id, user_id=user.id, status='want'))
    db.commit()

    canonical_cover = '/api/covers/bangumi/1001.webp?v=canonical'

    def fake_cover_map(_db, items):
        return {item.id: canonical_cover for item in items}

    monkeypatch.setattr(covers_svc, 'get_content_cover_url_map', fake_cover_map)

    detail = client.get(f'/api/v1/content/{content.id}')
    activity = client.get(f'/api/v1/user/{user.id}/activity', cookies=auth_cookie(user))
    history = client.get('/api/v1/rating/history', cookies=auth_cookie(user))
    recent = client.get('/api/v1/rating/recent')
    statuses = client.get('/api/v1/status', cookies=auth_cookie(user))
    analytics = client.get('/api/v1/analytics/overview', cookies=auth_cookie(user))

    assert detail.json()['cover_url'] == canonical_cover
    assert {item['content_cover'] for item in activity.json()['items']} == {canonical_cover}
    assert history.json()['items'][0]['content_cover'] == canonical_cover
    assert recent.json()['items'][0]['content_cover'] == canonical_cover
    assert statuses.json()['items'][0]['content_cover'] == canonical_cover
    assert analytics.json()['favorites'][0]['cover_url'] == canonical_cover
