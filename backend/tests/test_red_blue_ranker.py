"""阶段 2 纯偏好 Ranker 的数学、数值和性能测试。"""

import json
import math
import time

from services.red_blue_ranker import (
    Candidate,
    Comparison,
    ComparisonOutcome,
    PreferenceResult,
    RankerConfig,
    RankerStability,
    ScoreAnchor,
    base_stability_for,
    build_score_priors,
    normalize_preference_results,
    pairwise_probability,
    rank_preferences,
)


def _candidates(count: int) -> list[Candidate]:
    return [Candidate(content_id=index) for index in range(1, count + 1)]


def _chain_comparisons(count: int, repeats: int = 1) -> list[Comparison]:
    comparisons: list[Comparison] = []
    comparison_id = 1
    for _ in range(repeats):
        for content_id in range(1, count):
            comparisons.append(
                Comparison(
                    id=comparison_id,
                    left_content_id=content_id,
                    right_content_id=content_id + 1,
                    outcome=ComparisonOutcome.LEFT_WIN,
                ),
            )
            comparison_id += 1
    return comparisons


def _result_map(output):
    return {result.content_id: result for result in output.results}


def test_pairwise_probability_is_davidson_and_sums_to_one():
    probability = pairwise_probability(1.0, 0.0, tie_strength=0.8)

    assert math.isclose(probability.win_a + probability.tie + probability.win_b, 1.0, abs_tol=1e-12)
    assert probability.win_a > probability.win_b
    assert probability.tie > 0
    assert pairwise_probability(0.0, 0.0, 0.8).win_a == pairwise_probability(0.0, 0.0, 0.8).win_b


def test_score_prior_uses_mid_rank_and_same_score_has_same_prior():
    candidates = _candidates(4)
    anchors = [
        ScoreAnchor(1, 85),
        ScoreAnchor(2, 85),
        ScoreAnchor(3, 70),
        ScoreAnchor(4, 55),
    ]
    priors = build_score_priors(candidates, anchors)

    assert priors[1].percentile == priors[2].percentile
    assert priors[1].mean == priors[2].mean
    assert priors[1].percentile == 0.75


def test_all_equal_scores_get_neutral_prior():
    priors = build_score_priors(
        _candidates(4),
        [ScoreAnchor(index, 80) for index in range(1, 5)],
    )

    assert {prior.mean for prior in priors.values()} == {0.0}
    assert {prior.percentile for prior in priors.values()} == {0.5}


def test_config_round_trip_is_json_serializable():
    config = RankerConfig(random_seed=123, posterior_sample_count=64, tie_strength=0.7)

    restored = RankerConfig.from_json(config.to_json())

    assert restored == config
    assert json.loads(config.to_json())['algorithm_version'] == 'ranker-v2'


def test_baseline_prior_precision_scales_with_candidate_pool_size():
    config = RankerConfig()
    expected = {50: 0.001, 100: 0.00025, 500: 0.00001}

    for candidate_count, precision in expected.items():
        priors = build_score_priors(_candidates(candidate_count), [], config)
        assert math.isclose(priors[1].precision, precision, rel_tol=1e-12)


def test_empty_single_and_score_only_inputs_are_finite():
    empty = rank_preferences([], [], [])
    single = rank_preferences(
        [Candidate(1)],
        [ScoreAnchor(1, 90)],
        [],
        RankerConfig(posterior_sample_count=32),
    )

    assert empty.results == ()
    assert len(single.results) == 1
    assert single.results[0].expected_rank == 1.0
    assert single.results[0].stability is RankerStability.UNCALIBRATED
    assert all(
        math.isfinite(value)
        for value in (
            single.results[0].preference_mean,
            single.results[0].preference_std,
            single.results[0].expected_rank,
        )
    )


def test_skip_revoked_invalid_and_non_candidate_comparisons_do_not_affect_result():
    candidates = _candidates(2)
    valid = Comparison(1, 1, 2, ComparisonOutcome.LEFT_WIN)
    ignored = [
        Comparison(2, 1, 2, ComparisonOutcome.SKIP),
        Comparison(3, 1, 2, ComparisonOutcome.LEFT_WIN, revoked=True),
        Comparison(4, 1, 2, 'bad-outcome'),
        Comparison(5, 1, 99, ComparisonOutcome.LEFT_WIN),
    ]
    config = RankerConfig(posterior_sample_count=64)
    baseline = rank_preferences(candidates, [], [valid], config)
    with_ignored = rank_preferences(candidates, [], [valid, *ignored], config)

    assert with_ignored.results == baseline.results
    assert with_ignored.diagnostics.valid_comparison_count == 1
    assert with_ignored.diagnostics.ignored_comparison_count == 4
    assert with_ignored.diagnostics.ignored_comparison_reasons == {
        'content_not_candidate': 1,
        'invalid_outcome': 1,
        'revoked': 1,
        'skip': 1,
    }


def test_left_right_swap_represents_same_unordered_pair():
    config = RankerConfig(posterior_sample_count=128, random_seed=5)
    first = rank_preferences(
        _candidates(2),
        [],
        [Comparison(1, 1, 2, ComparisonOutcome.LEFT_WIN)],
        config,
    )
    swapped = rank_preferences(
        _candidates(2),
        [],
        [Comparison(1, 2, 1, ComparisonOutcome.RIGHT_WIN)],
        config,
    )

    assert first.results == swapped.results
    assert first.diagnostics.effective_pair_count == 1


def test_repeated_pair_has_concave_total_weight_and_conflicts_balance():
    same_direction = rank_preferences(
        _candidates(2),
        [],
        [Comparison(index, 1, 2, ComparisonOutcome.LEFT_WIN) for index in range(1, 21)],
        RankerConfig(posterior_sample_count=64),
    )
    conflicting = rank_preferences(
        _candidates(2),
        [],
        [
            Comparison(index, 1, 2, ComparisonOutcome.LEFT_WIN if index % 2 else ComparisonOutcome.RIGHT_WIN)
            for index in range(1, 21)
        ],
        RankerConfig(posterior_sample_count=64),
    )

    assert same_direction.diagnostics.effective_total_weight < 20
    assert math.isclose(same_direction.diagnostics.effective_total_weight, math.sqrt(20), abs_tol=1e-12)
    assert abs(conflicting.results[0].preference_mean - conflicting.results[1].preference_mean) < 0.2


def test_many_lower_anchor_wins_can_overturn_high_anchor_prior():
    comparisons = [Comparison(index, 2, 1, ComparisonOutcome.LEFT_WIN) for index in range(1, 161)]
    output = rank_preferences(
        _candidates(2),
        [ScoreAnchor(1, 95), ScoreAnchor(2, 80)],
        comparisons,
        RankerConfig(posterior_sample_count=128),
    )
    results = _result_map(output)

    assert results[2].preference_mean > results[1].preference_mean
    assert results[2].expected_rank < results[1].expected_rank


def test_tie_and_all_tie_data_are_not_converted_to_half_wins():
    output = rank_preferences(
        _candidates(3),
        [],
        [
            Comparison(1, 1, 2, ComparisonOutcome.TIE),
            Comparison(2, 2, 3, ComparisonOutcome.TIE),
            Comparison(3, 1, 3, ComparisonOutcome.TIE),
        ],
        RankerConfig(posterior_sample_count=128),
    )

    assert output.diagnostics.valid_comparison_count == 3
    assert all(result.comparison_count == 2 for result in output.results)
    assert all(result.stability is not RankerStability.STABLE for result in output.results)
    tie_probability = pairwise_probability(
        output.results[0].preference_mean,
        output.results[1].preference_mean,
    )
    assert tie_probability.tie > 0


def test_new_candidate_is_uncalibrated_but_uses_anchor_prior():
    baseline = rank_preferences(
        _candidates(3),
        [ScoreAnchor(1, 95), ScoreAnchor(2, 85), ScoreAnchor(3, 70)],
        _chain_comparisons(3, repeats=4),
        RankerConfig(posterior_sample_count=128),
    )
    with_new = rank_preferences(
        _candidates(4),
        [ScoreAnchor(1, 95), ScoreAnchor(2, 85), ScoreAnchor(3, 70), ScoreAnchor(4, 90)],
        [*(_chain_comparisons(3, repeats=4)), Comparison(99, 1, 4, ComparisonOutcome.LEFT_WIN)],
        RankerConfig(posterior_sample_count=128),
    )

    result = _result_map(with_new)[4]
    assert result.comparison_count == 1
    assert result.stability is not RankerStability.STABLE
    assert math.isfinite(result.preference_mean)
    assert _result_map(baseline)[1].preference_mean != result.preference_mean


def test_current_score_is_not_an_input_to_ranker():
    config = RankerConfig(posterior_sample_count=128, random_seed=42)
    inputs = (
        _candidates(2),
        [ScoreAnchor(1, 80), ScoreAnchor(2, 70)],
        [Comparison(1, 1, 2, ComparisonOutcome.LEFT_WIN)],
        config,
    )

    first = rank_preferences(*inputs)
    # 这里没有 Rating.score 参数；只要 anchor 和 comparison 不变，结果必须相同。
    second = rank_preferences(*inputs)

    assert first.results == second.results
    assert first.diagnostics.optimizer_objective == second.diagnostics.optimizer_objective


def test_anchor_change_repositions_without_deleting_comparisons():
    comparisons = [Comparison(index, 1, 2, ComparisonOutcome.RIGHT_WIN) for index in range(1, 4)]
    before = rank_preferences(
        _candidates(2),
        [ScoreAnchor(1, 70), ScoreAnchor(2, 80)],
        comparisons,
        RankerConfig(posterior_sample_count=128),
    )
    after = rank_preferences(
        _candidates(2),
        [ScoreAnchor(1, 95), ScoreAnchor(2, 80)],
        comparisons,
        RankerConfig(posterior_sample_count=128),
    )

    assert _result_map(before)[1].comparison_count == 3
    assert _result_map(after)[1].comparison_count == 3
    assert _result_map(after)[1].preference_mean > _result_map(before)[1].preference_mean


def test_cycles_do_not_force_artificially_large_uncertainty():
    output = rank_preferences(
        _candidates(2),
        [],
        [
            Comparison(1, 1, 2, ComparisonOutcome.LEFT_WIN),
            Comparison(2, 2, 1, ComparisonOutcome.LEFT_WIN),
            Comparison(3, 1, 2, ComparisonOutcome.LEFT_WIN),
            Comparison(4, 2, 1, ComparisonOutcome.LEFT_WIN),
        ],
        RankerConfig(posterior_sample_count=128),
    )

    assert all(math.isfinite(result.preference_std) for result in output.results)
    assert abs(output.results[0].preference_mean - output.results[1].preference_mean) < 0.2


def test_disconnected_graph_has_finite_prior_regularized_results():
    output = rank_preferences(
        _candidates(4),
        [ScoreAnchor(1, 90), ScoreAnchor(2, 80)],
        [Comparison(1, 1, 2, ComparisonOutcome.LEFT_WIN)],
        RankerConfig(posterior_sample_count=128),
    )

    assert len(output.results) == 4
    assert output.diagnostics.fallback_reason is None
    assert all(
        math.isfinite(value)
        for result in output.results
        for value in (result.preference_mean, result.preference_std, result.expected_rank)
    )


def test_seed_makes_map_interval_and_stability_reproducible():
    config = RankerConfig(posterior_sample_count=256, random_seed=99)
    inputs = (
        _candidates(5),
        [ScoreAnchor(1, 95), ScoreAnchor(2, 88), ScoreAnchor(3, 80)],
        _chain_comparisons(5, repeats=2),
        config,
    )

    first = rank_preferences(*inputs)
    second = rank_preferences(*inputs)

    assert first.results == second.results
    assert first.diagnostics.converged == second.diagnostics.converged


def test_stable_base_state_can_keep_order_uncertain_flag():
    assert base_stability_for(84, 1) is RankerStability.STABLE
    normalized = normalize_preference_results(
        [
            PreferenceResult(
                content_id=1,
                preference_mean=0.0,
                preference_std=0.4,
                expected_rank=1.0,
                rank_low=1,
                rank_high=2,
                stability=RankerStability.ORDER_UNCERTAIN,
                comparison_count=84,
            ),
        ],
    )
    assert normalized[0].stability is RankerStability.STABLE
    assert normalized[0].order_uncertain is True


def test_order_uncertain_uses_posterior_order_not_davidson_game_probability():
    candidates = _candidates(2)
    config = RankerConfig(posterior_sample_count=128)
    decisive = rank_preferences(
        candidates,
        [],
        [Comparison(index, 1, 2, ComparisonOutcome.LEFT_WIN) for index in range(1, 9)],
        config,
    )
    unresolved = rank_preferences(
        candidates,
        [],
        [Comparison(index, 1, 2, ComparisonOutcome.TIE) for index in range(1, 9)],
        config,
    )

    assert all(result.stability is RankerStability.STABLE for result in decisive.results)
    assert all(result.order_uncertain is False for result in decisive.results)
    assert all(result.stability is RankerStability.STABLE for result in unresolved.results)
    assert all(result.order_uncertain is True for result in unresolved.results)


def test_extreme_inputs_do_not_return_nan_or_infinity():
    candidates = _candidates(8)
    anchors = [ScoreAnchor(index, 100 if index % 2 else 1) for index in range(1, 9)]
    comparisons = [Comparison(index, 1, 2, ComparisonOutcome.LEFT_WIN) for index in range(1, 200)]
    output = rank_preferences(
        candidates,
        anchors,
        comparisons,
        RankerConfig(posterior_sample_count=128, score_percentile_clip=0.01),
    )

    assert output.diagnostics.fallback_reason is None
    assert all(
        math.isfinite(value)
        for result in output.results
        for value in (result.preference_mean, result.preference_std, result.expected_rank)
    )


def test_performance_at_50_100_and_500_candidates(capsys):
    config = RankerConfig(
        posterior_sample_count=64,
        optimizer_max_iterations=40,
        random_seed=7,
    )
    measurements: list[tuple[int, float, float, float, float]] = []
    for count in (50, 100, 500):
        candidates = _candidates(count)
        anchors = [ScoreAnchor(index, 50 + index % 50) for index in range(1, count + 1)]
        comparisons = _chain_comparisons(count, repeats=3)
        started_at = time.perf_counter()
        output = rank_preferences(candidates, anchors, comparisons, config)
        wall_seconds = time.perf_counter() - started_at
        assert len(output.results) == count
        assert output.diagnostics.fallback_reason is None
        measurements.append(
            (
                count,
                output.diagnostics.map_seconds,
                output.diagnostics.covariance_seconds,
                output.diagnostics.posterior_sampling_seconds,
                wall_seconds,
            ),
        )

    for count, map_seconds, covariance_seconds, sampling_seconds, wall_seconds in measurements:
        print(
            f'performance candidates={count} map={map_seconds:.4f}s '
            f'covariance={covariance_seconds:.4f}s sampling={sampling_seconds:.4f}s '
            f'total={wall_seconds:.4f}s',
        )
    captured = capsys.readouterr()
    assert 'candidates=500' in captured.out
