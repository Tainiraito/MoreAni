"""阶段 5.1 评分建议 Service、Action 事实和 Rating 闭环测试。"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from conftest import auth_cookie
from fastapi.testclient import TestClient

from main import app
from models import (
    ContentItem,
    PreferenceModelRun,
    PreferenceModelRunStatus,
    Rating,
    RatingRevision,
    RatingRevisionSource,
    RedBlueComparison,
    RedBlueOutcome,
    ScoreSuggestion,
    ScoreSuggestionAction,
    ScoreSuggestionActionType,
    ScoreSuggestionStatus,
)
from routers.v1.red_blue import get_red_blue_service
from services.rating import upsert_rating
from services.red_blue import FullRecalibrationReason, RedBlueService, RedBlueServiceConfig
from services.red_blue_score_calibration import (
    CalibrationCandidate,
    CalibrationFreshness,
    CalibrationPreferenceResult,
    CalibrationRating,
    RankerStability,
    ScoreCalibrationConfig,
)
from services.red_blue_score_suggestions import (
    ScoreSuggestionConflictError,
    ScoreSuggestionDelta,
    ScoreSuggestionService,
)


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


def _suggestion_fixture(db, user_id: int, *, current_score: int = 80) -> tuple[Rating, ScoreSuggestion]:
    content = _content(db, user_id, '评分建议闭环作品')
    rating = upsert_rating(
        db,
        user_id=user_id,
        content_id=content.id,
        score=current_score,
        recommend=1,
        review='用户原有评论',
    )
    run = PreferenceModelRun(
        user_id=user_id,
        algorithm_version='red-blue-ranker-test',
        status=PreferenceModelRunStatus.COMPLETED,
        input_comparison_max_id=None,
        input_rating_revision_max_id=1,
        algorithm_config_json='{}',
        completed_at=datetime.now(UTC),
    )
    db.add(run)
    db.flush()
    suggestion = ScoreSuggestion(
        user_id=user_id,
        content_id=content.id,
        model_run_id=run.id,
        suggestion_key=f'sc-v1:{content.id}:{current_score}:85:UP',
        current_score=current_score,
        suggested_score_low=85,
        suggested_score_high=90,
        recommended_score=85,
        direction='UP',
        confidence=0.95,
        severity=0.8,
        reason_code='PREFERENCE_HIGHER_THAN_SCORE',
        status=ScoreSuggestionStatus.PENDING,
        created_at=datetime.now(UTC),
    )
    db.add(suggestion)
    db.commit()
    db.refresh(rating)
    db.refresh(suggestion)
    return rating, suggestion


def test_accepted_action_preserves_anchor_and_links_revision(db, make_user):
    user = make_user('score-suggestion-accepted')
    rating, suggestion = _suggestion_fixture(db, user.id)
    service = ScoreSuggestionService()

    result = service.apply_action(
        db,
        user_id=user.id,
        suggestion_id=suggestion.id,
        suggestion_key=suggestion.suggestion_key,
        action='ACCEPTED',
        client_event_id=str(uuid4()),
    )

    db.refresh(rating)
    action = db.query(ScoreSuggestionAction).filter_by(id=result.action_id).one()
    revision = db.query(RatingRevision).filter_by(score_suggestion_id=suggestion.id).one()
    db.refresh(suggestion)
    assert result.current_score == 80
    assert result.updated_score == 85
    assert rating.score == 85
    assert rating.score_anchor == 80
    assert rating.recommend == 1
    assert rating.review == '用户原有评论'
    assert revision.source == RatingRevisionSource.PK_SUGGESTION.value
    assert revision.score_suggestion_id == suggestion.id
    assert revision.score_suggestion_action_id == action.id
    assert action.comparison_state_version_at_action == 0
    assert suggestion.status is ScoreSuggestionStatus.ACCEPTED


def test_action_idempotency_and_conflict_are_fact_safe(db, make_user):
    user = make_user('score-suggestion-idempotency')
    rating, suggestion = _suggestion_fixture(db, user.id)
    service = ScoreSuggestionService()
    client_event_id = str(uuid4())
    kwargs = {
        'db': db,
        'user_id': user.id,
        'suggestion_id': suggestion.id,
        'suggestion_key': suggestion.suggestion_key,
        'action': 'ACCEPTED',
        'client_event_id': client_event_id,
    }

    first = service.apply_action(**kwargs)
    replay = service.apply_action(**kwargs)
    assert replay.idempotent_replay is True
    assert replay.action_id == first.action_id
    assert db.query(ScoreSuggestionAction).filter_by(user_id=user.id).count() == 1
    assert db.query(RatingRevision).filter_by(user_id=user.id).count() == 2

    with pytest.raises(ScoreSuggestionConflictError):
        service.apply_action(**{**kwargs, 'action': 'DISMISSED'})
    db.refresh(rating)
    assert rating.score == 85
    assert rating.score_anchor == 80


def test_dismissed_action_is_released_by_effective_comparison_but_not_skip(db, make_user):
    user = make_user('score-suggestion-dismissed')
    _rating, suggestion = _suggestion_fixture(db, user.id)
    service = ScoreSuggestionService(
        ScoreCalibrationConfig(
            min_calibration_samples=1,
            min_comparisons_for_suggestion=0,
            min_stability='UNCALIBRATED',
            min_local_support=1,
            local_preference_band_width=2.0,
            confidence_threshold=0.0,
            fast_confidence_threshold=0.0,
            hysteresis_confidence_threshold=0.0,
        )
    )
    service.apply_action(
        db,
        user_id=user.id,
        suggestion_id=suggestion.id,
        suggestion_key=suggestion.suggestion_key,
        action='DISMISSED',
        client_event_id=str(uuid4()),
    )
    candidate = CalibrationCandidate(suggestion.content_id)
    preference = CalibrationPreferenceResult(
        suggestion.content_id,
        preference_mean=2.0,
        preference_std=0.1,
        expected_rank=1.0,
        rank_low=1,
        rank_high=1,
        stability=RankerStability.UNCALIBRATED,
        comparison_count=2,
    )
    rating = CalibrationRating(suggestion.content_id, current_score=80, score_anchor=80)

    # 仅 state version 变化（可由 SKIP 产生）不能被当作新的有效比较证据。
    result = service.config
    assert result.dismissed_new_evidence_comparisons == 2
    action_model = service._calibration_actions(db, user_id=user.id)[0]
    assert action_model.effective_comparison_max_id_at_action is None
    assert action_model.comparison_state_version_at_action == 0
    assert candidate.content_id == preference.content_id == rating.content_id


def test_refresh_reconciles_top_suggestion_from_anchor_without_self_feedback(db, make_user):
    user = make_user('score-suggestion-refresh')
    contents = [_content(db, user.id, f'校准样本 {index}') for index in range(6)]
    for index, content in enumerate(contents):
        upsert_rating(db, user_id=user.id, content_id=content.id, score=50 + index * 8)
    target_rating = db.query(Rating).filter_by(user_id=user.id, content_id=contents[0].id).one()
    target_rating.score = 20
    db.commit()
    run = PreferenceModelRun(
        user_id=user.id,
        algorithm_version='red-blue-ranker-test',
        status=PreferenceModelRunStatus.COMPLETED,
        algorithm_config_json='{}',
    )
    db.add(run)
    db.flush()
    config = ScoreCalibrationConfig(
        min_calibration_samples=3,
        min_comparisons_for_suggestion=0,
        min_stability='UNCALIBRATED',
        local_preference_band_width=2.0,
        min_local_support=1,
        confidence_threshold=0.0,
        fast_confidence_threshold=0.0,
        hysteresis_confidence_threshold=0.0,
    )
    service = ScoreSuggestionService(config)
    candidates = tuple(CalibrationCandidate(content.id) for content in contents)
    preferences = tuple(
        CalibrationPreferenceResult(
            content_id=content.id,
            preference_mean=float(index),
            preference_std=0.1,
            expected_rank=float(index + 1),
            rank_low=index + 1,
            rank_high=index + 1,
            stability=RankerStability.UNCALIBRATED,
            comparison_count=0,
        )
        for index, content in enumerate(contents)
    )
    ratings = tuple(
        CalibrationRating(
            content_id=content.id,
            current_score=20 if index == 0 else 50 + index * 8,
            score_anchor=50 + index * 8,
        )
        for index, content in enumerate(contents)
    )

    delta, visible = service.refresh_score_suggestions(
        db,
        user_id=user.id,
        model_run_id=run.id,
        model_freshness=CalibrationFreshness.FULL,
        comparison_state_version=4,
        effective_comparison_max_id=12,
        candidates=candidates,
        preference_results=preferences,
        ratings=ratings,
    )
    assert delta.added
    target = next(item for item in delta.added if item.content_id == contents[0].id)
    persisted = db.query(ScoreSuggestion).filter_by(id=target.id).one()
    assert persisted.current_score == 20
    assert persisted.recommended_score >= 50
    assert persisted.suggestion_key.startswith(f'sc-v1:{contents[0].id}:20:')
    assert any(item.id == persisted.id for item in visible)

    stale_delta, stale_visible = service.refresh_score_suggestions(
        db,
        user_id=user.id,
        model_run_id=run.id,
        model_freshness=CalibrationFreshness.STALE_REQUIRES_FULL,
        comparison_state_version=5,
        effective_comparison_max_id=13,
        candidates=candidates,
        preference_results=preferences,
        ratings=ratings,
    )
    assert stale_delta == ScoreSuggestionDelta()
    assert any(item.id == persisted.id for item in stale_visible)
    db.refresh(persisted)
    assert persisted.status == ScoreSuggestionStatus.PENDING

    persisted.status = ScoreSuggestionStatus.EXPIRED
    persisted.handled_at = datetime.now(UTC)
    db.commit()
    reappeared_delta, reappeared = service.refresh_score_suggestions(
        db,
        user_id=user.id,
        model_run_id=run.id,
        model_freshness=CalibrationFreshness.FULL,
        comparison_state_version=4,
        effective_comparison_max_id=12,
        candidates=candidates,
        preference_results=preferences,
        ratings=ratings,
    )
    assert any(item.id == persisted.id for item in reappeared_delta.added)
    assert any(item.id == persisted.id for item in reappeared)
    db.refresh(persisted)
    assert persisted.status == ScoreSuggestionStatus.PENDING

    changed_ratings = tuple(
        CalibrationRating(
            content_id=content.id,
            current_score=25 if index == 0 else 50 + index * 8,
            score_anchor=50 + index * 8,
        )
        for index, content in enumerate(contents)
    )
    changed_delta, _changed_visible = service.refresh_score_suggestions(
        db,
        user_id=user.id,
        model_run_id=run.id,
        model_freshness=CalibrationFreshness.FULL,
        comparison_state_version=5,
        effective_comparison_max_id=13,
        candidates=candidates,
        preference_results=preferences,
        ratings=changed_ratings,
    )
    assert persisted.id in changed_delta.removed
    replacement = db.query(ScoreSuggestion).filter(
        ScoreSuggestion.user_id == user.id,
        ScoreSuggestion.content_id == contents[0].id,
        ScoreSuggestion.status == ScoreSuggestionStatus.PENDING,
    ).one()
    assert replacement.id != persisted.id
    assert replacement.suggestion_key.startswith(f'sc-v1:{contents[0].id}:25:')


def test_full_state_attaches_visible_suggestion_to_matching_ranking_content(
    db,
    session_factory,
    make_user,
):
    user = make_user('score-suggestion-state')
    contents = [_content(db, user.id, f'状态作品 {index}') for index in range(6)]
    for index, content in enumerate(contents):
        upsert_rating(db, user_id=user.id, content_id=content.id, score=50 + index * 8)
    target_rating = db.query(Rating).filter_by(user_id=user.id, content_id=contents[0].id).one()
    target_rating.score = 20
    db.commit()
    service = RedBlueService(
        session_factory=session_factory,
        config=RedBlueServiceConfig(
            score_calibration_config=ScoreCalibrationConfig(
                min_calibration_samples=3,
                min_comparisons_for_suggestion=0,
                min_stability='UNCALIBRATED',
                local_preference_band_width=2.0,
                min_local_support=1,
                confidence_threshold=0.0,
                fast_confidence_threshold=0.0,
                hysteresis_confidence_threshold=0.0,
            ),
        ),
    )
    try:
        full = service.run_full_recalibration(user.id, FullRecalibrationReason.MANUAL)
        assert full.applied_to_cache is True
        state = service.get_battle_state(db, user_id=user.id)
        target_suggestion = next(
            item for item in state.score_suggestions if item.content_id == contents[0].id
        )
        assert target_suggestion.current_score == 20
        assert target_suggestion.recommended_score >= 50
    finally:
        service.close()


def test_suggestion_action_survives_derived_suggestion_deletion(db, make_user):
    user = make_user('score-suggestion-fact')
    _rating, suggestion = _suggestion_fixture(db, user.id)
    action = ScoreSuggestionAction(
        user_id=user.id,
        content_id=suggestion.content_id,
        score_suggestion_id=suggestion.id,
        model_run_id=suggestion.model_run_id,
        suggestion_key=suggestion.suggestion_key,
        action=ScoreSuggestionActionType.REJECTED,
        current_score=suggestion.current_score,
        recommended_score=suggestion.recommended_score,
        comparison_state_version_at_action=3,
        effective_comparison_max_id_at_action=7,
        client_event_id=str(uuid4()),
    )
    db.add(action)
    db.commit()
    action_id = action.id

    db.delete(suggestion)
    db.commit()

    persisted = db.query(ScoreSuggestionAction).filter_by(id=action_id).one()
    assert persisted.action is ScoreSuggestionActionType.REJECTED
    assert persisted.score_suggestion_id is None
    # 删除 suggestion 本身不会删除仍可追溯的 model run；只有 run 被删除时
    # model_run_id 才按 SET NULL 断开。
    assert persisted.model_run_id is not None
    assert persisted.comparison_state_version_at_action == 3
    assert persisted.effective_comparison_max_id_at_action == 7


@pytest.fixture
def suggestion_api_service(session_factory):
    service = RedBlueService(
        session_factory=session_factory,
        config=RedBlueServiceConfig(
            max_fast_updates_before_full=100,
            score_calibration_config=ScoreCalibrationConfig(
                min_calibration_samples=3,
                min_comparisons_for_suggestion=0,
                min_stability='UNCALIBRATED',
                local_preference_band_width=2.0,
                min_local_support=1,
                confidence_threshold=0.0,
                fast_confidence_threshold=0.0,
                hysteresis_confidence_threshold=0.0,
            ),
        ),
    )
    app.dependency_overrides[get_red_blue_service] = lambda: service
    try:
        yield service
    finally:
        app.dependency_overrides.pop(get_red_blue_service, None)
        service.close()


def test_score_suggestion_action_api_returns_updated_ranking_row(
    client: TestClient,
    db,
    make_user,
    suggestion_api_service,
):
    user = make_user('score-suggestion-api')
    contents = [_content(db, user.id, f'动作 API 作品 {index}') for index in range(6)]
    for index, content in enumerate(contents):
        upsert_rating(db, user_id=user.id, content_id=content.id, score=50 + index * 8)
    target_rating = db.query(Rating).filter_by(user_id=user.id, content_id=contents[0].id).one()
    target_rating.score = 20
    db.commit()
    full = suggestion_api_service.run_full_recalibration(user.id, FullRecalibrationReason.MANUAL)
    assert full.applied_to_cache is True
    state = suggestion_api_service.get_battle_state(db, user_id=user.id)
    target_view = next(view for view in state.score_suggestions if view.content_id == contents[0].id)
    suggestion = db.query(ScoreSuggestion).filter_by(id=target_view.id).one()
    client_event_id = str(uuid4())
    response = client.post(
        f'/api/v1/red-blue/score-suggestions/{suggestion.id}/actions',
        cookies=auth_cookie(user),
        json={
            'action': 'ACCEPTED',
            'suggestion_key': suggestion.suggestion_key,
            'client_event_id': client_event_id,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload['action'] == 'ACCEPTED'
    assert payload['current_score'] == 20
    assert payload['updated_score'] >= 50
    assert payload['updated_ranking_item']['current_score'] == payload['updated_score']

    replay = client.post(
        f'/api/v1/red-blue/score-suggestions/{suggestion.id}/actions',
        cookies=auth_cookie(user),
        json={
            'action': 'ACCEPTED',
            'suggestion_key': suggestion.suggestion_key,
            'client_event_id': client_event_id,
        },
    )
    assert replay.status_code == 200
    assert replay.json()['idempotent_replay'] is True


def test_state_api_attaches_suggestion_to_ranking_row(
    client: TestClient,
    db,
    make_user,
    suggestion_api_service,
):
    user = make_user('score-suggestion-state-api')
    contents = [_content(db, user.id, f'API 状态作品 {index}') for index in range(6)]
    for index, content in enumerate(contents):
        upsert_rating(db, user_id=user.id, content_id=content.id, score=50 + index * 8)
    rating = db.query(Rating).filter_by(user_id=user.id, content_id=contents[0].id).one()
    rating.score = 20
    db.commit()
    full = suggestion_api_service.run_full_recalibration(user.id, 'manual')
    assert full.applied_to_cache is True

    response = client.get('/api/v1/red-blue/state', cookies=auth_cookie(user))
    assert response.status_code == 200
    target = next(
        row for row in response.json()['ranking']
        if row['content']['content_id'] == contents[0].id
    )
    assert target['score_suggestion']['current_score'] == 20
    assert target['score_suggestion']['recommended_score'] >= 50


def test_calibration_failure_does_not_fail_comparison_or_full_run(
    db,
    session_factory,
    make_user,
):
    user = make_user('score-suggestion-isolation')
    first = _content(db, user.id, '隔离作品 A')
    second = _content(db, user.id, '隔离作品 B')
    upsert_rating(db, user_id=user.id, content_id=first.id, score=80)
    upsert_rating(db, user_id=user.id, content_id=second.id, score=85)
    service = RedBlueService(
        session_factory=session_factory,
        config=RedBlueServiceConfig(max_fast_updates_before_full=100),
    )

    def fail_refresh(*_args, **_kwargs):
        raise RuntimeError('synthetic calibration failure')

    service.score_suggestion_service.refresh_score_suggestions = fail_refresh  # type: ignore[method-assign]
    try:
        comparison = service.record_comparison(
            db,
            user_id=user.id,
            left_content_id=first.id,
            right_content_id=second.id,
            outcome=RedBlueOutcome.LEFT_WIN,
            client_event_id=str(uuid4()),
        )
        assert comparison.comparison_id is not None
        assert comparison.score_suggestion_delta.added == ()
        assert db.query(RedBlueComparison).filter_by(user_id=user.id).count() == 1

        full = service.run_full_recalibration(user.id, FullRecalibrationReason.MANUAL)
        assert full.status is PreferenceModelRunStatus.COMPLETED
    finally:
        service.close()
