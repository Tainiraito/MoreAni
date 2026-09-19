"""阶段 4A 纯实时排名快速路径的正确性、连续性和性能验证。"""

import math
import statistics
import time
from dataclasses import replace

import pytest

from services.red_blue_fast_ranker import (
    FastPathEvent,
    FastUpdateConfig,
    FastUpdateStrategy,
    compare_fast_with_full,
    create_fast_preference_state,
    fast_update_preference,
    requires_full_ranker,
)
from services.red_blue_ranker import (
    Candidate,
    Comparison,
    ComparisonOutcome,
    RankerConfig,
    RankerOutput,
    ScoreAnchor,
    rank_preferences,
)


def _candidates(count: int) -> list[Candidate]:
    return [Candidate(content_id=index) for index in range(1, count + 1)]


def _anchors(count: int) -> list[ScoreAnchor]:
    return [ScoreAnchor(content_id=index, score=50 + (index % 10) * 5) for index in range(1, count + 1)]


def _chain_comparisons(count: int, repeats: int = 1, start_id: int = 1) -> list[Comparison]:
    comparisons: list[Comparison] = []
    comparison_id = start_id
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


def _state(
    count: int = 8,
    *,
    comparisons: list[Comparison] | None = None,
    config: RankerConfig | None = None,
):
    candidates = _candidates(count)
    anchors = _anchors(count)
    history = comparisons if comparisons is not None else _chain_comparisons(count, repeats=2)
    ranker_config = config or RankerConfig(posterior_sample_count=64, random_seed=7)
    authority = rank_preferences(candidates, anchors, history, ranker_config)
    return create_fast_preference_state(candidates, anchors, history, authority), ranker_config


def test_fast_state_keeps_authority_and_updates_only_provisional_fields():
    state, ranker_config = _state()
    output = fast_update_preference(
        state,
        Comparison(1000, 1, 2, ComparisonOutcome.LEFT_WIN),
        ranker_config=ranker_config,
        strategy=FastUpdateStrategy.LOCAL_LAPLACE,
    )

    assert state.fast_update_count == 0
    assert output.state.fast_update_count == 1
    assert all(result.provisional for result in output.results)
    assert output.state.authoritative_results == state.authoritative_results
    authority_by_id = {result.content_id: result for result in state.authoritative_results}
    selector_by_id = {candidate.content_id: candidate for candidate in output.selector_candidates}
    for content_id, candidate in selector_by_id.items():
        assert candidate.rank_low == authority_by_id[content_id].rank_low
        assert candidate.rank_high == authority_by_id[content_id].rank_high
        assert candidate.stability == authority_by_id[content_id].stability
    assert any(
        candidate.preference_mean != authority_by_id[candidate.content_id].preference_mean
        for candidate in output.selector_candidates
    )


def test_fast_display_rank_uses_preference_mean_not_expected_rank():
    """expected_rank 可以是小数，但不得成为 Fast/UI 展示序号。"""
    candidates = _candidates(4)
    anchors = _anchors(4)
    ranker_config = RankerConfig(posterior_sample_count=64, random_seed=3)
    authority = rank_preferences(candidates, anchors, [], ranker_config)
    means = {1: 10.0, 2: 5.0, 3: 0.0, 4: -5.0}
    expected_ranks = {1: 2.37, 2: 1.5, 3: 4.25, 4: 3.1}
    altered_results = tuple(
        replace(
            result,
            preference_mean=means[result.content_id],
            expected_rank=expected_ranks[result.content_id],
        )
        for result in authority.results
    )
    altered_authority = RankerOutput(results=altered_results, diagnostics=authority.diagnostics)

    state = create_fast_preference_state(candidates, anchors, [], altered_authority)
    by_id = {result.content_id: result for result in state.fast_results}

    assert [by_id[content_id].provisional_rank for content_id in (1, 2, 3, 4)] == [1, 2, 3, 4]
    assert {result.provisional_rank for result in state.fast_results} == {1, 2, 3, 4}
    assert expected_ranks[2] != float(by_id[2].provisional_rank)


def test_comparison_below_top_two_does_not_move_top_two_display_ranks():
    """C/D 未穿过 A/B 时，C/D 的单次 PK 不得改写 A/B 展示名次。"""
    candidates = _candidates(4)
    anchors = _anchors(4)
    ranker_config = RankerConfig(posterior_sample_count=64, random_seed=5)
    authority = rank_preferences(candidates, anchors, [], ranker_config)
    means = {1: 10.0, 2: 5.0, 3: 0.0, 4: -5.0}
    altered_results = tuple(
        replace(result, preference_mean=means[result.content_id])
        for result in authority.results
    )
    state = create_fast_preference_state(
        candidates,
        anchors,
        [],
        RankerOutput(results=altered_results, diagnostics=authority.diagnostics),
    )
    output = fast_update_preference(
        state,
        Comparison(1, 3, 4, ComparisonOutcome.LEFT_WIN),
        ranker_config=ranker_config,
        strategy=FastUpdateStrategy.LOCAL_LAPLACE,
    )
    by_id = {result.content_id: result for result in output.results}

    assert by_id[1].provisional_rank == 1
    assert by_id[2].provisional_rank == 2
    assert sorted(result.provisional_rank for result in output.results) == [1, 2, 3, 4]


def test_left_win_moves_local_direction_and_tie_reduces_gap():
    state, ranker_config = _state(
        2,
        comparisons=[],
        config=RankerConfig(posterior_sample_count=64, random_seed=1),
    )
    left_win = fast_update_preference(
        state,
        Comparison(1, 1, 2, ComparisonOutcome.LEFT_WIN),
        ranker_config=ranker_config,
        strategy=FastUpdateStrategy.LOCAL_LAPLACE,
    )
    before = {result.content_id: result.preference_mean for result in state.fast_results}
    after_win = {result.content_id: result.preference_mean for result in left_win.results}
    assert after_win[1] > before[1]
    assert after_win[2] < before[2]

    tie = fast_update_preference(
        state,
        Comparison(2, 1, 2, ComparisonOutcome.TIE),
        ranker_config=ranker_config,
        strategy=FastUpdateStrategy.LOCAL_LAPLACE,
    )
    before_gap = abs(before[1] - before[2])
    after_gap = abs(tie.results[0].preference_mean - tie.results[1].preference_mean)
    assert after_gap < before_gap


def test_repeat_pair_uses_concave_increment_not_full_weight():
    state, ranker_config = _state(
        2,
        comparisons=[
            Comparison(1, 1, 2, ComparisonOutcome.LEFT_WIN),
            Comparison(2, 1, 2, ComparisonOutcome.LEFT_WIN),
            Comparison(3, 2, 1, ComparisonOutcome.RIGHT_WIN),
            Comparison(4, 1, 2, ComparisonOutcome.LEFT_WIN),
        ],
    )
    output = fast_update_preference(
        state,
        Comparison(5, 1, 2, ComparisonOutcome.LEFT_WIN),
        ranker_config=ranker_config,
        strategy=FastUpdateStrategy.LOCAL_LAPLACE,
    )

    expected_increment = math.sqrt(5) - math.sqrt(4)
    assert math.isclose(output.diagnostics.effective_weight_increment, expected_increment, abs_tol=1e-12)
    assert output.diagnostics.used_repeat_pair_reweighting is True
    assert output.diagnostics.effective_weight_increment < 1


def test_all_strategies_are_davidson_updates_and_can_be_compared_to_full_ranker():
    state, ranker_config = _state(10)
    new_comparison = Comparison(1000, 1, 10, ComparisonOutcome.TIE)
    full = rank_preferences(
        state.candidates,
        state.score_anchors,
        [*state.comparisons, new_comparison],
        ranker_config,
    )
    metrics = {}
    for strategy in FastUpdateStrategy:
        output = fast_update_preference(
            state,
            new_comparison,
            ranker_config=ranker_config,
            strategy=strategy,
            config=FastUpdateConfig(local_rank_neighbor_window=4, local_graph_neighbor_count=8),
        )
        metrics[strategy] = compare_fast_with_full(output.results, full.results)
        assert math.isfinite(metrics[strategy].mean_absolute_error)
        assert math.isfinite(metrics[strategy].mean_rank_absolute_error)
        assert output.diagnostics.total_seconds >= output.diagnostics.update_seconds
    assert metrics[FastUpdateStrategy.LOCAL_NEIGHBORHOOD_MAP].mean_absolute_error <= (
        metrics[FastUpdateStrategy.LOCAL_LAPLACE].mean_absolute_error + 1e-9
    )


def test_continuous_fast_updates_can_be_measured_against_full_history(capsys):
    state, ranker_config = _state(20)
    next_id = 1000
    errors: list[float] = []
    for update_count in range(1, 21):
        left = ((update_count * 3) % 20) + 1
        right = ((update_count * 7 + 5) % 20) + 1
        if left == right:
            right = (right % 20) + 1
        outcome = ComparisonOutcome.TIE if update_count % 4 == 0 else ComparisonOutcome.LEFT_WIN
        comparison = Comparison(next_id, left, right, outcome)
        next_id += 1
        output = fast_update_preference(
            state,
            comparison,
            ranker_config=ranker_config,
            strategy=FastUpdateStrategy.LOCAL_NEIGHBORHOOD_MAP,
            config=FastUpdateConfig(local_rank_neighbor_window=5, local_graph_neighbor_count=12),
        )
        state = output.state
        if update_count in {5, 10, 20}:
            full = rank_preferences(
                state.candidates,
                state.score_anchors,
                state.comparisons,
                ranker_config,
            )
            metric = compare_fast_with_full(state.fast_results, full.results)
            errors.append(metric.mean_absolute_error)
            print(
                f'continuous updates={update_count} mean_error={metric.mean_absolute_error:.6f} '
                f'rank_error={metric.mean_rank_absolute_error:.4f} '
                f'top10={metric.top_k_agreement[10]:.3f}',
            )
    captured = capsys.readouterr()
    assert 'updates=5' in captured.out
    assert 'updates=10' in captured.out
    assert 'updates=20' in captured.out
    assert all(math.isfinite(error) for error in errors)


def test_fast_state_rejects_skip_revoke_and_invalid_inputs():
    state, ranker_config = _state()
    with pytest.raises(ValueError, match='SKIP'):
        fast_update_preference(
            state,
            Comparison(1, 1, 2, ComparisonOutcome.SKIP),
            ranker_config=ranker_config,
        )
    with pytest.raises(ValueError, match='撤销'):
        fast_update_preference(
            state,
            Comparison(1, 1, 2, ComparisonOutcome.LEFT_WIN, revoked=True),
            ranker_config=ranker_config,
        )
    with pytest.raises(ValueError, match='候选集合'):
        fast_update_preference(
            state,
            Comparison(1, 1, 999, ComparisonOutcome.LEFT_WIN),
            ranker_config=ranker_config,
        )


def test_full_ranker_trigger_policy_is_explicit():
    assert requires_full_ranker(FastPathEvent.COMPARISON) is False
    for event in (
        FastPathEvent.SCORE_ANCHOR_CHANGED,
        FastPathEvent.NEW_CONTENT,
        FastPathEvent.COMPARISON_REVOKED,
        FastPathEvent.ALGORITHM_CONFIG_CHANGED,
    ):
        assert requires_full_ranker(event) is True


def test_fast_path_performance_at_50_100_and_500_candidates(capsys):
    measurements: list[tuple[int, float, float, float, float, int]] = []
    for count in (50, 100, 500):
        state, ranker_config = _state(
            count,
            config=RankerConfig(
                posterior_sample_count=16,
                random_seed=0,
                optimizer_max_iterations=20,
            ),
        )
        started_at = time.perf_counter()
        output = fast_update_preference(
            state,
            Comparison(100000 + count, 1, count, ComparisonOutcome.LEFT_WIN),
            ranker_config=ranker_config,
            strategy=FastUpdateStrategy.LOCAL_NEIGHBORHOOD_MAP,
            config=FastUpdateConfig(
                local_rank_neighbor_window=8,
                local_graph_neighbor_count=16,
                local_max_active_candidates=64,
            ),
        )
        wall_seconds = time.perf_counter() - started_at
        measurements.append(
            (
                count,
                output.diagnostics.update_seconds,
                output.diagnostics.reorder_seconds,
                output.diagnostics.selector_conversion_seconds,
                wall_seconds,
                output.diagnostics.active_candidate_count,
            ),
        )
        assert output.results
    for count, update_seconds, reorder_seconds, conversion_seconds, wall_seconds, active_count in measurements:
        print(
            f'fast candidates={count} active={active_count} update={update_seconds:.4f}s '
            f'reorder={reorder_seconds:.4f}s selector={conversion_seconds:.4f}s total={wall_seconds:.4f}s',
        )
    captured = capsys.readouterr()
    assert 'candidates=50' in captured.out
    assert 'candidates=100' in captured.out
    assert 'candidates=500' in captured.out


def test_fast_benchmark_statistics_are_available_for_report():
    state, ranker_config = _state(30)
    durations: list[float] = []
    for index in range(5):
        output = fast_update_preference(
            state,
            Comparison(2000 + index, 1, 2, ComparisonOutcome.LEFT_WIN),
            ranker_config=ranker_config,
            strategy=FastUpdateStrategy.LOCAL_LAPLACE,
        )
        durations.append(output.diagnostics.total_seconds)
        state = output.state
    assert statistics.mean(durations) > 0
    assert all(math.isfinite(duration) for duration in durations)
