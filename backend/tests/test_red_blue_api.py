"""红蓝合战阶段 4C HTTP API 契约、隔离和序列化性能测试。"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from uuid import uuid4

import pytest
from conftest import auth_cookie
from fastapi.testclient import TestClient

from main import app
from middleware import RateLimitMiddleware, RateLimitRule
from models import ContentItem, Rating, RedBlueComparison
from routers.v1.red_blue import get_red_blue_service
from services.red_blue import (
    FullRecalibrationReason,
    RedBlueService,
    RedBlueServiceConfig,
)


def _content(db, owner_id: int, title: str, *, score: int = 80) -> ContentItem:
    content = ContentItem(
        title=title,
        content_type='anime',
        is_public=True,
        created_by=owner_id,
    )
    db.add(content)
    db.flush()
    db.add(Rating(user_id=owner_id, content_id=content.id, score=score, score_anchor=score))
    return content


def _disable_automatic_full(service: RedBlueService) -> None:
    """让 API 契约测试稳定观察当前响应，而不等待后台调度竞态。"""
    service.request_full_recalibration = lambda _user_id, _reason: False  # type: ignore[method-assign]


@pytest.fixture
def api_service(session_factory):
    service = RedBlueService(
        session_factory=session_factory,
        config=RedBlueServiceConfig(
            max_fast_updates_before_full=100,
            cache_ttl_seconds=300,
            cache_max_users=32,
        ),
    )
    _disable_automatic_full(service)
    app.dependency_overrides[get_red_blue_service] = lambda: service
    try:
        yield service
    finally:
        app.dependency_overrides.pop(get_red_blue_service, None)
        service.close()


def _seed_contents(db, user_id: int, count: int) -> list[ContentItem]:
    contents = [_content(db, user_id, f'红蓝作品 {index:04d}', score=50 + index % 51) for index in range(count)]
    db.commit()
    return contents


def test_state_requires_authentication(client):
    response = client.get('/api/v1/red-blue/state')
    assert response.status_code == 401


def test_openapi_exposes_explicit_red_blue_contract(client):
    response = client.get('/openapi.json')
    assert response.status_code == 200
    paths = response.json()['paths']
    assert set(paths) >= {
        '/api/v1/red-blue/state',
        '/api/v1/red-blue/comparisons',
        '/api/v1/red-blue/comparisons/{comparison_id}/revoke',
    }
    assert 'get' in paths['/api/v1/red-blue/comparisons']
    schemas = response.json()['components']['schemas']
    assert {
        'CreateComparisonRequest',
        'CreateComparisonResponse',
        'RedBlueStateResponse',
        'RevokeComparisonResponse',
        'RedBlueComparisonHistoryItemResponse',
    } <= set(schemas)
    assert 'score_suggestion_delta' in schemas['CreateComparisonResponse']['properties']
    assert schemas['RedBlueRankingItemResponse']['properties']['rank']['type'] == 'integer'


def _assert_display_ranks(payload):
    ranks = [item['rank'] for item in payload['ranking']]
    assert ranks == list(range(1, len(ranks) + 1))
    assert all(isinstance(rank, int) and not isinstance(rank, bool) for rank in ranks)


def test_state_empty_and_one_candidate(client, db, make_user, api_service):
    user = make_user('red-blue-empty')

    empty = client.get('/api/v1/red-blue/state', cookies=auth_cookie(user))
    assert empty.status_code == 200
    assert empty.json()['candidate_count'] == 0
    assert empty.json()['current_pair'] is None
    assert empty.json()['ranking'] == []
    assert empty.json()['pair_status'] == 'INSUFFICIENT_CANDIDATES'

    _seed_contents(db, user.id, 1)
    one = client.get('/api/v1/red-blue/state', cookies=auth_cookie(user))
    assert one.status_code == 200
    assert one.json()['candidate_count'] == 1
    assert one.json()['current_pair'] is None
    assert len(one.json()['ranking']) == 1
    assert one.json()['pair_status'] == 'INSUFFICIENT_CANDIDATES'


def test_state_bootstrap_full_fast_and_pair_contract(client, db, make_user, api_service):
    user = make_user('red-blue-state')
    _seed_contents(db, user.id, 3)

    bootstrap = client.get('/api/v1/red-blue/state', cookies=auth_cookie(user))
    assert bootstrap.status_code == 200
    bootstrap_payload = bootstrap.json()
    assert bootstrap_payload['model_freshness'] == 'BOOTSTRAP'
    assert bootstrap_payload['state_version'] == 0
    assert bootstrap_payload['candidate_count'] == 3
    assert bootstrap_payload['pair_status'] == 'AVAILABLE'
    assert (
        bootstrap_payload['current_pair']['left']['content_id']
        != bootstrap_payload['current_pair']['right']['content_id']
    )
    assert set(bootstrap_payload['ranking'][0]) >= {
        'content',
        'rank',
        'current_score',
        'preference_mean',
        'comparison_count',
        'stability',
        'rank_low',
        'rank_high',
    }
    _assert_display_ranks(bootstrap_payload)
    assert set(bootstrap_payload['current_pair']['left']) == {
        'content_id',
        'title',
        'description',
        'cover_url',
        'content_type',
    }

    full = api_service.run_full_recalibration(user.id, FullRecalibrationReason.MANUAL)
    assert full.applied_to_cache is True
    api_service.cache.clear()
    full_response = client.get('/api/v1/red-blue/state', cookies=auth_cookie(user))
    assert full_response.status_code == 200
    full_payload = full_response.json()
    assert full_payload['model_freshness'] == 'FULL'
    _assert_display_ranks(full_payload)

    pair = full_response.json()['current_pair']
    response = client.post(
        '/api/v1/red-blue/comparisons',
        cookies=auth_cookie(user),
        json={
            'left_content_id': pair['left']['content_id'],
            'right_content_id': pair['right']['content_id'],
            'outcome': 'LEFT_WIN',
            'client_event_id': str(uuid4()),
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload['model_freshness'] == 'FAST'
    assert payload['state_version'] == 1
    assert payload['comparison']['outcome'] == 'LEFT_WIN'
    assert payload['next_pair'] is not None
    assert payload['ranking_delta']
    assert all('content_id' in item and 'new_rank' in item for item in payload['ranking_delta'])
    assert all(isinstance(item['new_rank'], int) for item in payload['ranking_delta'])

    fast_payload = client.get('/api/v1/red-blue/state', cookies=auth_cookie(user)).json()
    _assert_display_ranks(fast_payload)
    old_ranks = {item['content']['content_id']: item['rank'] for item in full_payload['ranking']}
    new_ranks = {item['content']['content_id']: item['rank'] for item in fast_payload['ranking']}
    for delta in payload['ranking_delta']:
        assert delta['old_rank'] == old_ranks.get(delta['content_id'])
        assert delta['new_rank'] == new_ranks[delta['content_id']]


def test_comparison_focus_context_guides_next_pair_without_becoming_a_fact(
    client,
    db,
    make_user,
    api_service,
):
    user = make_user('red-blue-focus-api')
    contents = _seed_contents(db, user.id, 4)
    api_service.config = replace(
        api_service.config,
        selector_config=replace(api_service.config.selector_config, focus_probability=1.0),
    )
    state = client.get('/api/v1/red-blue/state', cookies=auth_cookie(user)).json()
    pair = state['current_pair']
    response = client.post(
        '/api/v1/red-blue/comparisons',
        cookies=auth_cookie(user),
        json={
            'left_content_id': pair['left']['content_id'],
            'right_content_id': pair['right']['content_id'],
            'outcome': 'TIE',
            'client_event_id': str(uuid4()),
            'focus_content_id': contents[-1].id,
        },
    )
    assert response.status_code == 200, response.text
    next_pair = response.json()['next_pair']
    assert contents[-1].id in {next_pair['left']['content_id'], next_pair['right']['content_id']}
    assert 'focus_content_id' not in response.json()['comparison']


def test_real_continuous_comparison_smoke_uses_http_contract(client, db, make_user, api_service):
    """Use the real FastAPI route and isolated test DB to prove the browser chain contract."""
    user = make_user('red-blue-real-smoke')
    _seed_contents(db, user.id, 6)
    cookies = auth_cookie(user)
    origin_headers = {'Origin': 'http://localhost:5173'}

    initial = client.get('/api/v1/red-blue/state', cookies=cookies)
    assert initial.status_code == 200
    current_pair = initial.json()['current_pair']
    assert current_pair is not None
    seen_pairs: set[tuple[int, int]] = set()

    for index, outcome in enumerate(('LEFT_WIN', 'RIGHT_WIN', 'TIE', 'SKIP', 'LEFT_WIN'), start=1):
        current_ids = (
            current_pair['left']['content_id'],
            current_pair['right']['content_id'],
        )
        seen_pairs.add(current_ids)
        response = client.post(
            '/api/v1/red-blue/comparisons',
            cookies=cookies,
            headers=origin_headers,
            json={
                'left_content_id': current_ids[0],
                'right_content_id': current_ids[1],
                'outcome': outcome,
                'client_event_id': str(uuid4()),
            },
        )
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload['state_version'] == index
        assert payload['comparison']['outcome'] == outcome
        assert payload['idempotent_replay'] is False
        assert payload['pair_status'] == 'AVAILABLE'
        assert payload['next_pair'] is not None
        next_ids = (
            payload['next_pair']['left']['content_id'],
            payload['next_pair']['right']['content_id'],
        )
        assert set(next_ids) != set(current_ids)
        current_pair = payload['next_pair']

    final_state = client.get('/api/v1/red-blue/state', cookies=cookies)
    assert final_state.status_code == 200
    final_payload = final_state.json()
    assert final_payload['state_version'] == 5
    assert final_payload['current_pair'] is not None
    assert db.query(RedBlueComparison).filter_by(user_id=user.id).count() == 5
    assert len(seen_pairs) == 5


def test_comparison_history_lists_active_facts_and_removes_revoked_rows(client, db, make_user, api_service):
    user = make_user('red-blue-history')
    first, second = _seed_contents(db, user.id, 2)
    cookies = auth_cookie(user)
    created = client.post(
        '/api/v1/red-blue/comparisons',
        cookies=cookies,
        json={
            'left_content_id': first.id,
            'right_content_id': second.id,
            'outcome': 'LEFT_WIN',
            'client_event_id': str(uuid4()),
        },
    )
    assert created.status_code == 200
    comparison_id = created.json()['comparison']['id']

    history = client.get('/api/v1/red-blue/comparisons', cookies=cookies)
    assert history.status_code == 200
    assert history.json()[0]['id'] == comparison_id
    assert history.json()[0]['left_content']['title'] == first.title
    assert history.json()[0]['right_content']['title'] == second.title
    assert history.json()[0]['outcome'] == 'LEFT_WIN'

    revoked = client.post(
        f'/api/v1/red-blue/comparisons/{comparison_id}/revoke',
        cookies=cookies,
    )
    assert revoked.status_code == 200
    assert client.get('/api/v1/red-blue/comparisons', cookies=cookies).json() == []
    assert db.query(RedBlueComparison).filter_by(id=comparison_id).one().revoked_at is not None


def test_comparison_outcomes_idempotency_and_payload_conflict(client, db, make_user, api_service):
    user = make_user('red-blue-idempotency')
    first, second = _seed_contents(db, user.id, 2)
    event_id = str(uuid4())
    body = {
        'left_content_id': first.id,
        'right_content_id': second.id,
        'outcome': 'TIE',
        'client_event_id': event_id,
    }

    created = client.post('/api/v1/red-blue/comparisons', cookies=auth_cookie(user), json=body)
    replay = client.post('/api/v1/red-blue/comparisons', cookies=auth_cookie(user), json=body)
    conflict = client.post(
        '/api/v1/red-blue/comparisons',
        cookies=auth_cookie(user),
        json={**body, 'outcome': 'LEFT_WIN'},
    )

    assert created.status_code == 200
    assert replay.status_code == 200
    assert replay.json()['idempotent_replay'] is True
    assert replay.json()['state_version'] == created.json()['state_version']
    assert conflict.status_code == 409
    assert '不同 Comparison payload' in conflict.json()['detail']
    assert db.query(RedBlueComparison).filter_by(user_id=user.id).count() == 1


@pytest.mark.parametrize('outcome', ['LEFT_WIN', 'RIGHT_WIN', 'TIE', 'SKIP'])
def test_all_comparison_outcomes_and_validation(client, db, make_user, api_service, outcome):
    user = make_user(f'red-blue-outcome-{outcome.lower()}')
    first, second = _seed_contents(db, user.id, 2)
    response = client.post(
        '/api/v1/red-blue/comparisons',
        cookies=auth_cookie(user),
        json={
            'left_content_id': first.id,
            'right_content_id': second.id,
            'outcome': outcome,
            'client_event_id': str(uuid4()),
        },
    )
    assert response.status_code == 200
    assert response.json()['comparison']['outcome'] == outcome

    same_content = client.post(
        '/api/v1/red-blue/comparisons',
        cookies=auth_cookie(user),
        json={
            'left_content_id': first.id,
            'right_content_id': first.id,
            'outcome': 'LEFT_WIN',
            'client_event_id': str(uuid4()),
        },
    )
    assert same_content.status_code == 400


def test_non_candidate_and_user_isolation(client, db, make_user, api_service):
    user_a = make_user('red-blue-user-a')
    user_b = make_user('red-blue-user-b')
    a_first, a_second = _seed_contents(db, user_a.id, 2)
    b_first, b_second = _seed_contents(db, user_b.id, 2)

    state_a = client.get('/api/v1/red-blue/state', cookies=auth_cookie(user_a))
    assert state_a.status_code == 200
    assert state_a.json()['candidate_count'] == 2
    assert {item['content']['content_id'] for item in state_a.json()['ranking']} == {a_first.id, a_second.id}

    non_candidate = client.post(
        '/api/v1/red-blue/comparisons',
        cookies=auth_cookie(user_a),
        json={
            'left_content_id': a_first.id,
            'right_content_id': b_first.id,
            'outcome': 'LEFT_WIN',
            'client_event_id': str(uuid4()),
        },
    )
    assert non_candidate.status_code == 400

    b_comparison = client.post(
        '/api/v1/red-blue/comparisons',
        cookies=auth_cookie(user_b),
        json={
            'left_content_id': b_first.id,
            'right_content_id': b_second.id,
            'outcome': 'LEFT_WIN',
            'client_event_id': str(uuid4()),
        },
    )
    comparison_id = b_comparison.json()['comparison']['id']
    revoke_as_a = client.post(
        f'/api/v1/red-blue/comparisons/{comparison_id}/revoke',
        cookies=auth_cookie(user_a),
    )
    assert revoke_as_a.status_code == 404


def test_revoke_is_idempotent_and_requires_full(client, db, make_user, api_service):
    user = make_user('red-blue-revoke')
    first, second = _seed_contents(db, user.id, 2)
    created = client.post(
        '/api/v1/red-blue/comparisons',
        cookies=auth_cookie(user),
        json={
            'left_content_id': first.id,
            'right_content_id': second.id,
            'outcome': 'LEFT_WIN',
            'client_event_id': str(uuid4()),
        },
    )
    comparison_id = created.json()['comparison']['id']

    revoked = client.post(
        f'/api/v1/red-blue/comparisons/{comparison_id}/revoke',
        cookies=auth_cookie(user),
    )
    repeated = client.post(
        f'/api/v1/red-blue/comparisons/{comparison_id}/revoke',
        cookies=auth_cookie(user),
    )
    missing = client.post('/api/v1/red-blue/comparisons/999999/revoke', cookies=auth_cookie(user))

    assert revoked.status_code == 200
    assert revoked.json()['revoked'] is True
    assert revoked.json()['model_freshness'] in {'BOOTSTRAP', 'STALE_REQUIRES_FULL'}
    assert repeated.status_code == 200
    assert repeated.json()['state_version'] == revoked.json()['state_version']
    assert missing.status_code == 404


def test_pair_cooldown_is_explicit(client, db, make_user, api_service):
    user = make_user('red-blue-cooldown')
    first, second = _seed_contents(db, user.id, 2)
    for outcome in ('LEFT_WIN', 'RIGHT_WIN'):
        response = client.post(
            '/api/v1/red-blue/comparisons',
            cookies=auth_cookie(user),
            json={
                'left_content_id': first.id,
                'right_content_id': second.id,
                'outcome': outcome,
                'client_event_id': str(uuid4()),
            },
        )
        assert response.status_code == 200, response.text
    state = client.get('/api/v1/red-blue/state', cookies=auth_cookie(user))
    assert state.status_code == 200
    assert state.json()['current_pair'] is None
    assert state.json()['pair_status'] == 'COOLDOWN'


def test_concurrent_same_and_different_users_are_serialized(client, db, make_user, api_service):
    user_a = make_user('red-blue-concurrent-a')
    user_b = make_user('red-blue-concurrent-b')
    a_first, a_second = _seed_contents(db, user_a.id, 2)
    b_first, b_second = _seed_contents(db, user_b.id, 2)
    user_a_cookie = auth_cookie(user_a)
    user_b_cookie = auth_cookie(user_b)

    a_ids = (a_first.id, a_second.id)
    b_ids = (b_first.id, b_second.id)

    def submit(cookie: dict[str, str], first_id: int, second_id: int) -> int:
        thread_client = TestClient(app)
        response = thread_client.post(
            '/api/v1/red-blue/comparisons',
            cookies=cookie,
            json={
                'left_content_id': first_id,
                'right_content_id': second_id,
                'outcome': 'LEFT_WIN',
                'client_event_id': str(uuid4()),
            },
        )
        assert response.status_code == 200, response.text
        return response.json()['state_version']

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [
            executor.submit(submit, user_a_cookie, *a_ids),
            executor.submit(submit, user_a_cookie, *a_ids),
            executor.submit(submit, user_b_cookie, *b_ids),
            executor.submit(submit, user_b_cookie, *b_ids),
        ]
        versions = [future.result() for future in futures]

    assert sorted(versions[:2]) == [1, 2]
    assert sorted(versions[2:]) == [1, 2]
    assert db.query(RedBlueComparison).filter_by(user_id=user_a.id).count() == 2
    assert db.query(RedBlueComparison).filter_by(user_id=user_b.id).count() == 2


def test_comparison_has_dedicated_rate_limit(client, db, make_user, api_service):
    user = make_user('red-blue-rate-limit')
    first, second = _seed_contents(db, user.id, 2)
    client.get('/api/health')
    middleware = app.middleware_stack
    while middleware is not None and not isinstance(middleware, RateLimitMiddleware):
        middleware = getattr(middleware, 'app', None)
    assert isinstance(middleware, RateLimitMiddleware)

    original_rule = middleware.rules['red_blue_comparison']
    middleware.rules['red_blue_comparison'] = RateLimitRule(max_requests=2, window_seconds=60)
    try:
        responses = [
            client.post(
                '/api/v1/red-blue/comparisons',
                cookies=auth_cookie(user),
                json={
                    'left_content_id': first.id,
                    'right_content_id': second.id,
                    'outcome': 'SKIP',
                    'client_event_id': str(uuid4()),
                },
            )
            for _ in range(3)
        ]
    finally:
        middleware.rules['red_blue_comparison'] = original_rule
    assert [response.status_code for response in responses] == [200, 200, 429]
    assert responses[-1].headers['Retry-After'] == '60'


@pytest.mark.parametrize('count', [500, 1000])
def test_comparison_http_chain_scale(client, db, make_user, api_service, count):
    user = make_user(f'red-blue-comparison-scale-{count}')
    contents = _seed_contents(db, user.id, count)
    state_started = time.perf_counter()
    state = client.get('/api/v1/red-blue/state', cookies=auth_cookie(user))
    state_seconds = time.perf_counter() - state_started
    pair = state.json()['current_pair']

    started = time.perf_counter()
    response = client.post(
        '/api/v1/red-blue/comparisons',
        cookies=auth_cookie(user),
        json={
            'left_content_id': pair['left']['content_id'],
            'right_content_id': pair['right']['content_id'],
            'outcome': 'LEFT_WIN',
            'client_event_id': str(uuid4()),
        },
    )
    elapsed = time.perf_counter() - started

    assert response.status_code == 200
    assert len(response.content) > 0
    print(
        'RED_BLUE_COMPARISON_BENCH '
        f'candidates={len(contents)} state_seconds={state_seconds:.6f} '
        f'post_seconds={elapsed:.6f} response_bytes={len(response.content)}',
    )


@pytest.mark.parametrize('count', [50, 100, 500, 1000])
def test_state_serialization_scale(client, db, make_user, api_service, count):
    user = make_user(f'red-blue-scale-{count}')
    _seed_contents(db, user.id, count)
    started = time.perf_counter()
    response = client.get('/api/v1/red-blue/state', cookies=auth_cookie(user))
    elapsed = time.perf_counter() - started

    assert response.status_code == 200
    assert response.json()['candidate_count'] == count
    assert len(response.json()['ranking']) == count
    assert len(response.content) > 0
    # 4C 记录实际测量值但不把机器相关的绝对耗时写死为硬门槛。
    print(f'RED_BLUE_STATE_BENCH count={count} seconds={elapsed:.6f} bytes={len(response.content)}')
