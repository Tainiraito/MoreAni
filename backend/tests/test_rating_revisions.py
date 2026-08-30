from conftest import auth_cookie

from models import ContentItem, Rating, RatingRevision


def _content(db, owner_id: int, title: str, content_type: str = 'anime') -> ContentItem:
    content = ContentItem(
        title=title,
        content_type=content_type,
        is_public=True,
        created_by=owner_id,
    )
    db.add(content)
    db.commit()
    db.refresh(content)
    return content


def test_rating_create_and_update_records_primary_score_revisions(client, db, make_user):
    user = make_user('revision-user')
    content = _content(db, user.id, '评分历史番剧')

    created = client.post(
        '/api/v1/rating',
        cookies=auth_cookie(user),
        json={'content_id': content.id, 'score': 60, 'review': ''},
    )
    updated = client.post(
        '/api/v1/rating',
        cookies=auth_cookie(user),
        json={'content_id': content.id, 'score': 80, 'review': '更新评论'},
    )

    assert created.status_code == 200
    assert updated.status_code == 200
    revisions = (
        db.query(RatingRevision).filter_by(user_id=user.id, content_id=content.id).order_by(RatingRevision.id).all()
    )
    assert [(item.previous_score, item.new_score, item.source) for item in revisions] == [
        (0, 60, 'initial'),
        (60, 80, 'manual'),
    ]

    response = client.get('/api/v1/rating/revisions', cookies=auth_cookie(user))
    assert response.status_code == 200
    assert response.json()['total'] == 2
    assert response.json()['items'][0]['new_score'] == 80
    assert response.json()['items'][0]['content_title'] == content.title


def test_calibration_candidate_excludes_selected_and_zero_score(client, db, make_user):
    user = make_user('candidate-user')
    first = _content(db, user.id, '候选一')
    second = _content(db, user.id, '候选二')
    comment_only = _content(db, user.id, '仅评论')
    game = _content(db, user.id, '游戏候选', 'game')
    anime_movie = _content(db, user.id, '动画电影候选', 'anime_movie')
    db.add_all(
        [
            Rating(content_id=first.id, user_id=user.id, score=70),
            Rating(content_id=second.id, user_id=user.id, score=90),
            Rating(content_id=comment_only.id, user_id=user.id, score=0, review='评论'),
            Rating(content_id=game.id, user_id=user.id, score=100),
            Rating(content_id=anime_movie.id, user_id=user.id, score=80),
        ],
    )
    db.commit()

    anime_response = client.get(
        '/api/v1/rating/calibration/candidates',
        params=[('exclude_content_id', str(first.id)), ('exclude_content_id', str(second.id))],
        cookies=auth_cookie(user),
    )
    assert anime_response.status_code == 200
    assert anime_response.json()[0]['content_id'] == anime_movie.id

    response = client.get(
        '/api/v1/rating/calibration/candidates',
        params=[
            ('exclude_content_id', str(first.id)),
            ('exclude_content_id', str(second.id)),
            ('exclude_content_id', str(anime_movie.id)),
        ],
        cookies=auth_cookie(user),
    )

    assert response.status_code == 404
    assert response.json()['detail'] == '没有更多可对比的评分作品'


def test_calibration_batch_changes_only_final_positive_scores(client, db, make_user):
    user = make_user('calibration-user')
    first = _content(db, user.id, '对比一')
    second = _content(db, user.id, '对比二')
    db.add_all(
        [
            Rating(content_id=first.id, user_id=user.id, score=60),
            Rating(content_id=second.id, user_id=user.id, score=70),
        ],
    )
    db.commit()

    response = client.post(
        '/api/v1/rating/calibration',
        cookies=auth_cookie(user),
        json={
            'items': [
                {'content_id': first.id, 'expected_score': 60, 'new_score': 80},
                {'content_id': second.id, 'expected_score': 70, 'new_score': 0},
            ],
        },
    )

    assert response.status_code == 200
    assert response.json()['updated_content_ids'] == [first.id]
    assert response.json()['skipped_content_ids'] == [second.id]
    assert db.query(Rating).filter_by(content_id=first.id, user_id=user.id).one().score == 80
    assert db.query(Rating).filter_by(content_id=second.id, user_id=user.id).one().score == 70
    comparison_revisions = db.query(RatingRevision).filter_by(source='comparison').all()
    assert len(comparison_revisions) == 1
    assert comparison_revisions[0].previous_score == 60
    assert comparison_revisions[0].new_score == 80
    assert comparison_revisions[0].comparison_id == response.json()['comparison_id']


def test_calibration_batch_rejects_stale_scores_without_partial_update(client, db, make_user):
    user = make_user('conflict-user')
    first = _content(db, user.id, '冲突一')
    second = _content(db, user.id, '冲突二')
    db.add_all(
        [
            Rating(content_id=first.id, user_id=user.id, score=60),
            Rating(content_id=second.id, user_id=user.id, score=70),
        ],
    )
    db.commit()

    response = client.post(
        '/api/v1/rating/calibration',
        cookies=auth_cookie(user),
        json={
            'items': [
                {'content_id': first.id, 'expected_score': 50, 'new_score': 80},
                {'content_id': second.id, 'expected_score': 70, 'new_score': 90},
            ],
        },
    )

    assert response.status_code == 409
    assert response.json()['detail']['conflicts'] == [
        {'content_id': first.id, 'expected_score': 50, 'current_score': 60},
    ]
    assert db.query(Rating).filter_by(content_id=first.id, user_id=user.id).one().score == 60
    assert db.query(Rating).filter_by(content_id=second.id, user_id=user.id).one().score == 70
