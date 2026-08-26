from models import ContentItem


def test_seasons_only_include_anime_content_types(client, db, make_user):
    creator = make_user('season-filter-owner')
    db.add_all(
        [
            ContentItem(
                title='番剧',
                content_type='anime',
                release_date='2099-01',
                is_public=True,
                created_by=creator.id,
            ),
            ContentItem(
                title='番剧电影',
                content_type='anime_movie',
                release_date='2099-01',
                is_public=True,
                created_by=creator.id,
            ),
            ContentItem(
                title='游戏',
                content_type='game',
                release_date='2099-04',
                is_public=True,
                created_by=creator.id,
            ),
            ContentItem(
                title='仅其他内容季度',
                content_type='movie',
                release_date='2099-04',
                is_public=True,
                created_by=creator.id,
            ),
        ],
    )
    db.commit()

    response = client.get('/api/v1/content/seasons')

    assert response.status_code == 200
    seasons = {item['value']: item['count'] for item in response.json()['items']}
    assert seasons['2099-01'] == 2
    assert '2099-04' not in seasons
