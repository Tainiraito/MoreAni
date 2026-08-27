from models import ContentItem, Rating


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
