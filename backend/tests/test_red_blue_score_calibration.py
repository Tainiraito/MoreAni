"""阶段 5 评分校准算法测试。"""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime, timedelta

import pytest

from services.red_blue_ranker import RankerStability
from services.red_blue_score_calibration import (
    CalibrationAction,
    CalibrationCandidate,
    CalibrationFreshness,
    CalibrationPreferenceResult,
    CalibrationRating,
    PreviousCalibrationSuggestion,
    ScoreCalibrationConfig,
    ScoreCalibrationDirection,
    ScoreCalibrationReasonCode,
    _fit_pava,
    generate_score_calibrations,
)


def _inputs(
    *,
    current_scores: list[int],
    anchors: list[int] | None = None,
    preferences: list[float] | None = None,
    stability: RankerStability | str = RankerStability.STABLE,
    comparison_count: int = 4,
    rank_width: int = 0,
):
    count = len(current_scores)
    active_anchors = anchors or current_scores
    active_preferences = preferences or [index * 0.5 for index in range(count)]
    candidates = [CalibrationCandidate(index + 1) for index in range(count)]
    preference_results = [
        CalibrationPreferenceResult(
            content_id=index + 1,
            preference_mean=active_preferences[index],
            preference_std=0.02,
            expected_rank=float(index + 1),
            rank_low=max(1, index + 1 - rank_width),
            rank_high=index + 1 + rank_width,
            stability=stability,
            comparison_count=comparison_count,
        )
        for index in range(count)
    ]
    ratings = [
        CalibrationRating(
            content_id=index + 1,
            current_score=current_scores[index],
            score_anchor=active_anchors[index],
        )
        for index in range(count)
    ]
    return candidates, preference_results, ratings


def _config(**overrides) -> ScoreCalibrationConfig:
    values = {
        'min_calibration_samples': 3,
        'local_preference_band_width': 1.1,
        'min_local_support': 1,
        'confidence_threshold': 0.70,
        'fast_confidence_threshold': 0.80,
        'hysteresis_confidence_threshold': 0.60,
        'rank_interval_score_scale': 0.1,
    }
    values.update(overrides)
    return ScoreCalibrationConfig(**values)


def _generate(
    *,
    current_scores: list[int],
    anchors: list[int] | None = None,
    preferences: list[float] | None = None,
    config: ScoreCalibrationConfig | None = None,
    freshness: CalibrationFreshness | str = CalibrationFreshness.FULL,
    actions=(),
    previous_suggestions=(),
    now: datetime | None = None,
):
    candidates, preference_results, ratings = _inputs(
        current_scores=current_scores,
        anchors=anchors,
        preferences=preferences,
    )
    return generate_score_calibrations(
        candidates,
        preference_results,
        ratings,
        previous_actions=actions,
        config=config or _config(),
        model_freshness=freshness,
        previous_suggestions=previous_suggestions,
        now=now,
    )


def test_empty_and_insufficient_calibration_samples():
    empty = generate_score_calibrations([], [], [], config=_config())
    assert empty.suggestions == ()
    assert empty.diagnostics.candidate_count == 0

    result = _generate(current_scores=[80, 85, 90], config=ScoreCalibrationConfig())
    assert result.suggestions == ()
    assert {
        evaluation.exclusion_reason for evaluation in result.evaluations
    } == {'CALIBRATION_SAMPLES_INSUFFICIENT'}


def test_config_round_trip_is_json_serializable():
    config = _config(max_suggestions=3, dismissed_suppression_days=7)
    restored = ScoreCalibrationConfig.from_json(config.to_json())
    assert restored == config
    assert json.loads(config.to_json())['algorithm_version'] == 'score-calibration-v1'


def test_pava_is_monotonic_and_allows_plateaus():
    model = _fit_pava([(0.0, 80.0, 1), (0.5, 90.0, 2), (1.0, 80.0, 3), (1.5, 90.0, 4)])
    predicted = [model.predict(value) for value in (0.0, 0.5, 1.0, 1.5)]
    assert predicted == sorted(predicted)
    assert predicted[1] == predicted[2] == 85.0


def test_same_score_with_different_rank_does_not_create_artificial_suggestions():
    result = _generate(
        current_scores=[90] * 8,
        anchors=[90] * 8,
        preferences=[index * 0.5 for index in range(8)],
    )
    assert result.suggestions == ()
    assert all(item.predicted_score == 90 for item in result.evaluations)


def test_score_anchor_trains_but_current_score_only_detects():
    base = _generate(
        current_scores=[80, 80, 85, 90, 95, 95],
        anchors=[80, 80, 85, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
    )
    current_changed = _generate(
        current_scores=[70, 80, 85, 90, 95, 95],
        anchors=[80, 80, 85, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
    )
    assert current_changed.evaluations[0].predicted_score == base.evaluations[0].predicted_score
    assert current_changed.evaluations[0].current_score == 70
    assert any(item.content_id == 1 for item in current_changed.suggestions)

    anchor_changed = _generate(
        current_scores=[80, 80, 85, 90, 95, 95],
        anchors=[80, 100, 85, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
    )
    assert anchor_changed.evaluations[0].predicted_score != base.evaluations[0].predicted_score


def test_pk_suggestion_score_is_not_reused_as_an_anchor_training_label():
    result = _generate(
        current_scores=[80, 80, 85, 90, 95, 95],
        anchors=[80, 85, 80, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
    )
    target = next(item for item in result.evaluations if item.content_id == 3)
    assert target.current_score == 85
    assert target.predicted_score == 85.0
    assert not target.eligible
    assert target.exclusion_reason == 'CURRENT_SCORE_WITHIN_INTERVAL'


def test_leave_one_out_does_not_hide_preference_outlier():
    current_scores = [80, 80, 85, 90, 95, 95, 80]
    preferences = [0, 0.5, 1, 1.5, 2, 2.5, 3]
    anchors = [80, 80, 85, 90, 95, 95, 80]
    result = _generate(
        current_scores=current_scores,
        anchors=anchors,
        preferences=preferences,
    )
    target = next(item for item in result.suggestions if item.content_id == 7)
    assert target.direction is ScoreCalibrationDirection.UP
    assert target.reason_code is ScoreCalibrationReasonCode.PREFERENCE_HIGHER_THAN_SCORE
    assert target.recommended_score > target.current_score

    changed_target_anchor = anchors.copy()
    changed_target_anchor[-1] = 100
    changed = _generate(
        current_scores=current_scores,
        anchors=changed_target_anchor,
        preferences=preferences,
    )
    first_prediction = result.evaluations[-1].predicted_score
    changed_prediction = changed.evaluations[-1].predicted_score
    assert first_prediction == changed_prediction


def test_up_and_down_reasons_are_symmetric():
    result = _generate(
        current_scores=[95, 70, 85, 90, 95, 95, 80],
        anchors=[80, 80, 85, 90, 95, 95, 80],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5, 3],
    )
    by_id = {item.content_id: item for item in result.suggestions}
    assert by_id[1].direction is ScoreCalibrationDirection.DOWN
    assert by_id[1].reason_code is ScoreCalibrationReasonCode.PREFERENCE_LOWER_THAN_SCORE
    assert by_id[2].direction is ScoreCalibrationDirection.UP
    assert by_id[2].reason_code is ScoreCalibrationReasonCode.PREFERENCE_HIGHER_THAN_SCORE


def test_quantization_and_interval_are_score_step_aligned():
    result = _generate(
        current_scores=[70, 80, 85, 90, 95, 95],
        anchors=[80, 80, 85, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
    )
    suggestion = next(item for item in result.suggestions if item.content_id == 1)
    assert suggestion.recommended_score % 5 == 0
    assert suggestion.suggested_score_low % 5 == 0
    assert suggestion.suggested_score_high % 5 == 0
    assert suggestion.suggested_score_low <= suggestion.recommended_score <= suggestion.suggested_score_high


def test_prediction_interval_containing_current_score_suppresses_suggestion():
    result = _generate(
        current_scores=[85, 80, 85, 90, 95, 95],
        anchors=[80, 80, 85, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
        config=_config(prediction_interval_probability=0.99),
    )
    target = next(item for item in result.evaluations if item.content_id == 1)
    assert not target.eligible
    assert target.exclusion_reason in {'CURRENT_SCORE_WITHIN_INTERVAL', 'SCORE_DELTA_INSUFFICIENT'}


@pytest.mark.parametrize(
    'stability',
    [RankerStability.UNCALIBRATED, RankerStability.CALIBRATING, RankerStability.ORDER_UNCERTAIN],
)
def test_unstable_rank_results_do_not_create_suggestions(stability):
    result = _generate(
        current_scores=[70, 80, 85, 90, 95, 95],
        anchors=[80, 80, 85, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
    )
    # Re-run with the requested stability on every preference result.
    candidates, preferences, ratings = _inputs(
        current_scores=[70, 80, 85, 90, 95, 95],
        anchors=[80, 80, 85, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
        stability=stability,
    )
    unstable = generate_score_calibrations(candidates, preferences, ratings, config=_config())
    assert unstable.suggestions == ()
    assert all(item.exclusion_reason == 'STABILITY_INSUFFICIENT' for item in unstable.evaluations)
    assert result.diagnostics.candidate_count == 6


def test_comparison_count_and_local_support_are_required():
    candidates, preferences, ratings = _inputs(
        current_scores=[70, 80, 85, 90, 95, 95],
        anchors=[80, 80, 85, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
        comparison_count=3,
    )
    result = generate_score_calibrations(
        candidates,
        preferences,
        ratings,
        config=_config(min_comparisons_for_suggestion=4),
    )
    assert all(item.exclusion_reason == 'COMPARISONS_INSUFFICIENT' for item in result.evaluations)

    sparse = _generate(
        current_scores=[70, 80, 85, 90, 95, 95],
        anchors=[80, 80, 85, 90, 95, 95],
        preferences=[0, 10, 20, 30, 40, 50],
        config=_config(min_local_support=2, local_preference_band_width=0.1),
    )
    assert all(item.exclusion_reason == 'LOCAL_SUPPORT_INSUFFICIENT' for item in sparse.evaluations)


def test_bootstrap_stale_and_fast_freshness_rules():
    kwargs = {
        'current_scores': [70, 80, 85, 90, 95, 95],
        'anchors': [80, 80, 85, 90, 95, 95],
        'preferences': [0, 0.5, 1, 1.5, 2, 2.5],
    }
    bootstrap = _generate(**kwargs, freshness=CalibrationFreshness.BOOTSTRAP)
    stale = _generate(**kwargs, freshness=CalibrationFreshness.STALE_REQUIRES_FULL)
    fast = _generate(
        **kwargs,
        freshness=CalibrationFreshness.FAST,
        config=_config(fast_confidence_threshold=0.78),
    )
    assert bootstrap.suggestions == ()
    assert stale.suggestions == ()
    assert bootstrap.diagnostics.skipped_model_reason == 'BOOTSTRAP_MODEL'
    assert stale.diagnostics.skipped_model_reason == 'STALE_MODEL'
    assert fast.suggestions
    assert all(item.confidence >= 0.78 for item in fast.suggestions)


def test_suggestion_key_is_stable_and_actions_suppress_semantics():
    now = datetime(2026, 1, 1, tzinfo=UTC)
    result = _generate(
        current_scores=[70, 80, 85, 90, 95, 95],
        anchors=[80, 80, 85, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
        now=now,
    )
    suggestion = next(item for item in result.suggestions if item.content_id == 1)
    rejected = CalibrationAction(
        content_id=1,
        suggestion_key=suggestion.suggestion_key,
        action='REJECTED',
        created_at=now,
        comparison_count_at_action=4,
    )
    accepted = _generate(
        current_scores=[70, 80, 85, 90, 95, 95],
        anchors=[80, 80, 85, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
        actions=[rejected],
        now=now,
    )
    assert all(item.content_id != 1 for item in accepted.suggestions)
    assert suggestion.suggestion_key.startswith('sc-v1:1:70:')

    changed_evidence = _generate(
        current_scores=[70, 80, 85, 90, 95, 95],
        anchors=[80, 100, 85, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
        actions=[rejected],
        now=now,
    )
    assert changed_evidence.evaluations[0].suggestion_key != suggestion.suggestion_key

    dismissed = CalibrationAction(
        content_id=1,
        suggestion_key=suggestion.suggestion_key,
        action='DISMISSED',
        created_at=now,
        comparison_count_at_action=4,
    )
    assert not _generate(
        current_scores=[70, 80, 85, 90, 95, 95],
        anchors=[80, 80, 85, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
        actions=[dismissed],
        now=now + timedelta(days=3),
    ).suggestions
    assert any(
        item.content_id == 1
        for item in _generate(
            current_scores=[70, 80, 85, 90, 95, 95],
            anchors=[80, 80, 85, 90, 95, 95],
            preferences=[0, 0.5, 1, 1.5, 2, 2.5],
            actions=[dismissed],
            now=now + timedelta(days=15),
        ).suggestions
    )


def test_accepted_action_is_authoritative_for_the_same_suggestion_key():
    now = datetime(2026, 1, 1, tzinfo=UTC)
    baseline = _generate(
        current_scores=[70, 80, 85, 90, 95, 95],
        anchors=[80, 80, 85, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
        now=now,
    )
    suggestion = next(item for item in baseline.suggestions if item.content_id == 1)
    accepted = CalibrationAction(
        content_id=1,
        suggestion_key=suggestion.suggestion_key,
        action='ACCEPTED',
        created_at=now,
    )
    result = _generate(
        current_scores=[70, 80, 85, 90, 95, 95],
        anchors=[80, 80, 85, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
        actions=[accepted],
        now=now,
    )
    assert all(item.content_id != 1 for item in result.suggestions)


def test_dismissed_is_released_by_new_comparison_evidence():
    now = datetime(2026, 1, 1, tzinfo=UTC)
    baseline = _generate(
        current_scores=[70, 80, 85, 90, 95, 95],
        anchors=[80, 80, 85, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
        now=now,
    )
    suggestion = next(item for item in baseline.suggestions if item.content_id == 1)
    dismissed = CalibrationAction(
        content_id=1,
        suggestion_key=suggestion.suggestion_key,
        action='DISMISSED',
        created_at=now,
        comparison_count_at_action=4,
    )
    result = _generate(
        current_scores=[70, 80, 85, 90, 95, 95],
        anchors=[80, 80, 85, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
        actions=[dismissed],
        now=now + timedelta(days=1),
    )
    assert all(item.content_id != 1 for item in result.suggestions)

    candidates, preferences, ratings = _inputs(
        current_scores=[70, 80, 85, 90, 95, 95],
        anchors=[80, 80, 85, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
        comparison_count=6,
    )
    new_evidence = generate_score_calibrations(
        candidates,
        preferences,
        ratings,
        previous_actions=[dismissed],
        config=_config(),
        now=now + timedelta(days=1),
    )
    assert any(item.content_id == 1 for item in new_evidence.suggestions)


def test_hysteresis_keeps_a_previous_suggestion_visible():
    config = _config(
        confidence_threshold=0.80,
        fast_confidence_threshold=0.90,
        hysteresis_confidence_threshold=0.60,
        calibration_noise_floor=2.0,
        confidence_uncertainty_scale=100.0,
        local_support_saturation=2,
        prediction_interval_probability=0.90,
    )
    baseline = _generate(
        current_scores=[75, 80, 85, 90, 95, 95],
        anchors=[80, 80, 85, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
        config=config,
    )
    target = next(item for item in baseline.evaluations if item.content_id == 1)
    assert not target.eligible
    assert target.exclusion_reason == 'CONFIDENCE_INSUFFICIENT'
    previous = PreviousCalibrationSuggestion(
        content_id=1,
        suggestion_key=target.suggestion_key or 'previous',
        confidence=target.confidence,
    )
    visible = _generate(
        current_scores=[75, 80, 85, 90, 95, 95],
        anchors=[80, 80, 85, 90, 95, 95],
        preferences=[0, 0.5, 1, 1.5, 2, 2.5],
        config=config,
        previous_suggestions=[previous],
    )
    assert any(item.content_id == 1 for item in visible.suggestions)


def test_fast_result_is_conservative_relative_to_full_result():
    kwargs = {
        'current_scores': [70, 80, 85, 90, 95, 95],
        'anchors': [80, 80, 85, 90, 95, 95],
        'preferences': [0, 0.5, 1, 1.5, 2, 2.5],
    }
    full = _generate(**kwargs, freshness=CalibrationFreshness.FULL)
    fast = _generate(**kwargs, freshness=CalibrationFreshness.FAST)
    assert {item.content_id for item in fast.suggestions} <= {
        item.content_id for item in full.suggestions
    }


@pytest.mark.parametrize('count', [50, 100, 500, 1000])
def test_calibration_performance(count):
    current_scores = [50 + min(index // max(count // 10, 1), 10) * 5 for index in range(count)]
    preferences = [index / max(count - 1, 1) * 5 for index in range(count)]
    candidates, preference_results, ratings = _inputs(
        current_scores=current_scores,
        anchors=current_scores,
        preferences=preferences,
        comparison_count=4,
    )
    started = time.perf_counter()
    result = generate_score_calibrations(
        candidates,
        preference_results,
        ratings,
        config=ScoreCalibrationConfig(
            min_calibration_samples=5,
            min_local_support=2,
            local_preference_band_width=0.2,
            max_suggestions=10,
        ),
    )
    elapsed = time.perf_counter() - started
    assert len(result.evaluations) == count
    assert result.diagnostics.total_seconds <= elapsed + 0.05
    print(f'RED_BLUE_CALIBRATION_BENCH count={count} seconds={elapsed:.6f} suggestions={len(result.suggestions)}')
