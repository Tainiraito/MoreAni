from conftest import auth_cookie
from sqlalchemy import event

from models import ContentItem, Rating, Tag


def seed_content(db, creator, count: int = 35):
    tag = Tag(name='测试标签', tag_type='custom')
    items = []
    for index in range(count):
        item = ContentItem(
            title=f'内容 {index}',
            content_type='anime',
            cover_url=f'/api/covers/{index}.jpg',
            is_public=index != count - 1,
            created_by=creator.id,
        )
        item.tags.append(tag)
        items.append(item)
    db.add_all(items)
    db.commit()
    return items


def test_recommendations_are_unique_public_and_prioritize_current_user(client, db, make_user):
    user = make_user('recommend-user')
    items = seed_content(db, user, 35)
    for item in items[:12]:
        db.add(Rating(content_id=item.id, user_id=user.id, score=80, review='看过'))
    db.commit()

    response = client.get(
        '/api/v1/content/recommendations?type=anime&size=12',
        cookies=auth_cookie(user),
    )
    assert response.status_code == 200
    result = response.json()['items']
    ids = [item['id'] for item in result]
    assert len(result) == 12
    assert len(ids) == len(set(ids))
    assert all(item['is_public'] and item['cover_url'] for item in result)
    assert sum(bool(item['my_score'] or item['my_has_review']) for item in result) == 6

    excluded_query = '&'.join(f'exclude_id={item_id}' for item_id in ids)
    refreshed = client.get(f'/api/v1/content/recommendations?size=12&{excluded_query}').json()['items']
    assert len({item['id'] for item in refreshed}) == len(refreshed)
    assert not ({item['id'] for item in refreshed} & set(ids))


def test_random_content_supports_type_and_exclusions(client, db, make_user):
    creator = make_user('random-owner')
    items = seed_content(db, creator, 5)
    excluded_id = items[0].id
    response = client.get(f'/api/v1/content/random?type=anime&exclude_id={excluded_id}')
    assert response.status_code == 200
    result = response.json()
    assert result['id'] != excluded_id
    assert result['content_type'] == 'anime'
    assert result['is_public'] is True


def test_random_content_prefers_unhandled_items_for_authenticated_user(client, db, make_user):
    user = make_user('random-filter-user')
    items = seed_content(db, user, 6)
    db.add_all(
        [
            Rating(content_id=items[0].id, user_id=user.id, score=80),
            Rating(content_id=items[1].id, user_id=user.id, score=0, review='已经看过'),
            Rating(content_id=items[2].id, user_id=user.id, score=0, review='   '),
        ],
    )
    db.commit()

    response = client.get(
        f'/api/v1/content/random?type=anime&exclude_id={items[3].id}',
        cookies=auth_cookie(user),
    )

    assert response.status_code == 200
    assert response.json()['id'] in {items[2].id, items[4].id, items[5].id}


def test_random_content_falls_back_when_all_items_are_handled(client, db, make_user):
    user = make_user('random-fallback-user')
    items = seed_content(db, user, 3)
    db.add_all([Rating(content_id=item.id, user_id=user.id, score=80) for item in items])
    db.commit()

    response = client.get(
        f'/api/v1/content/random?type=anime&exclude_id={items[0].id}',
        cookies=auth_cookie(user),
    )

    assert response.status_code == 200
    assert response.json()['id'] in {items[1].id, items[2].id}


def test_content_list_query_count_is_constant(client, db, db_engine, make_user):
    creator = make_user('query-owner')
    seed_content(db, creator, 25)
    client.cookies.update(auth_cookie(creator))
    statements: list[str] = []

    def count_business_sql(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith('SELECT'):
            statements.append(statement)

    event.listen(db_engine, 'before_cursor_execute', count_business_sql)
    try:
        client.get('/api/v1/content?size=1')
        one_count = len(statements)
        statements.clear()
        response = client.get('/api/v1/content?size=20')
        twenty_count = len(statements)
    finally:
        event.remove(db_engine, 'before_cursor_execute', count_business_sql)

    assert response.status_code == 200
    assert one_count == twenty_count
    assert twenty_count <= 7
