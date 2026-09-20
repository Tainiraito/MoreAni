"""阶段 3 纯 Pair Selector 的行为、确定性和性能测试。"""

import json
import math
import statistics
import time

from services.red_blue_math import pairwise_probability as shared_pairwise_probability
from services.red_blue_pair_selector import (
    SelectedPair,
    SelectionReason,
    SelectorCandidate,
    SelectorComparison,
    SelectorConfig,
    SelectorContext,
    SelectorOutcome,
    select_pair,
)
from services.red_blue_ranker import pairwise_probability as ranker_pairwise_probability


def _candidate(
    content_id: int,
    *,
    mean: float = 0.0,
    expected_rank: float | None = None,
    rank_low: int | None = None,
    rank_high: int | None = None,
    count: int = 5,
    score_anchor: float | None = None,
) -> SelectorCandidate:
    rank = expected_rank if expected_rank is not None else float(content_id)
    return SelectorCandidate(
        content_id=content_id,
        preference_mean=mean,
        preference_std=0.4,
        expected_rank=rank,
        rank_low=rank_low if rank_low is not None else int(rank),
        rank_high=rank_high if rank_high is not None else int(rank),
        comparison_count=count,
        score_anchor=score_anchor,
    )


def _comparison(
    comparison_id: int,
    left_content_id: int,
    right_content_id: int,
    outcome: SelectorOutcome = SelectorOutcome.LEFT_WIN,
) -> SelectorComparison:
    return SelectorComparison(
        id=comparison_id,
        left_content_id=left_content_id,
        right_content_id=right_content_id,
        outcome=outcome,
    )


def _pair_key(pair: SelectedPair | None) -> tuple[int, int] | None:
    if pair is None:
        return None
    return tuple(sorted((pair.left_content_id, pair.right_content_id)))


def test_two_candidates_select_only_available_pair():
    result = select_pair([_candidate(1), _candidate(2)], [], config=SelectorConfig(random_seed=3))

    assert _pair_key(result.selected_pair) == (1, 2)
    assert result.reason is not SelectionReason.INSUFFICIENT_CANDIDATES
    assert result.diagnostics.pair_count == 1


def test_three_candidates_select_a_pair_in_normal_mode():
    result = select_pair(
        [_candidate(1), _candidate(2), _candidate(3)],
        [],
        config=SelectorConfig(exploration_rate=0, random_seed=2),
    )

    assert result.selected_pair is not None
    assert result.diagnostics.eligible_pair_count == 3


def test_close_to_fifty_fifty_pair_has_higher_uncertainty_score():
    candidates = [
        _candidate(1, mean=0.0, expected_rank=5),
        _candidate(2, mean=0.02, expected_rank=6),
        _candidate(3, mean=4.0, expected_rank=85),
    ]
    result = select_pair(candidates, [], config=SelectorConfig(exploration_rate=0, random_seed=0))

    assert _pair_key(result.selected_pair) == (1, 2)
    assert result.reason is SelectionReason.UNCERTAIN_PAIR


def test_overlapping_rank_intervals_are_prioritized():
    candidates = [
        _candidate(1, mean=0.0, expected_rank=5, rank_low=5, rank_high=9),
        _candidate(2, mean=0.1, expected_rank=8, rank_low=6, rank_high=10),
        _candidate(3, mean=0.0, expected_rank=80, rank_low=80, rank_high=90),
    ]
    result = select_pair(candidates, [], config=SelectorConfig(exploration_rate=0, random_seed=0))

    assert _pair_key(result.selected_pair) == (1, 2)
    assert dict(result.selected_pair.components)['rank_interval_overlap'] > 0.5


def test_new_content_is_prioritized_without_ranker_result():
    candidates = [_candidate(1, count=6), _candidate(2, count=6), _candidate(3, count=0)]
    result = select_pair(candidates, [], config=SelectorConfig(exploration_rate=0, random_seed=0))

    assert 3 in _pair_key(result.selected_pair)
    assert result.reason is SelectionReason.NEW_CONTENT


def test_low_coverage_content_receives_underexplored_bonus():
    candidates = [_candidate(1, count=10), _candidate(2, count=10), _candidate(3, count=1)]
    result = select_pair(candidates, [], config=SelectorConfig(exploration_rate=0, random_seed=0))

    assert 3 in _pair_key(result.selected_pair)


def test_normal_pair_lifetime_ceiling_skips_repeated_pair_when_alternatives_exist():
    candidates = [_candidate(1, count=8), _candidate(2, count=8), _candidate(3, count=8)]
    history = [
        _comparison(index, 1, 2)
        for index in range(1, 6)
    ]
    result = select_pair(
        candidates,
        history,
        config=SelectorConfig(
            exploration_rate=0,
            pair_cooldown_count=0,
            skip_cooldown_count=0,
            max_consecutive_content_exposure=0,
            random_seed=0,
        ),
    )

    assert _pair_key(result.selected_pair) != (1, 2)


def test_recent_pair_is_cooled_down():
    candidates = [_candidate(1), _candidate(2), _candidate(3)]
    history = [_comparison(1, 1, 2)]
    result = select_pair(candidates, history, config=SelectorConfig(exploration_rate=0, random_seed=0))

    assert _pair_key(result.selected_pair) != (1, 2)
    assert result.diagnostics.eligible_pair_count == 2


def test_left_right_reversal_is_the_same_pair_for_cooldown():
    candidates = [_candidate(1), _candidate(2), _candidate(3)]
    history = [_comparison(1, 2, 1)]
    result = select_pair(candidates, history, config=SelectorConfig(exploration_rate=0, random_seed=0))

    assert _pair_key(result.selected_pair) != (1, 2)


def test_skip_gets_short_cooldown_but_is_not_permanent():
    candidates = [_candidate(1), _candidate(2)]
    skipped = [_comparison(1, 1, 2, SelectorOutcome.SKIP)]
    cooled = select_pair(
        candidates,
        skipped,
        config=SelectorConfig(
            pair_cooldown_count=0,
            skip_cooldown_count=1,
            max_consecutive_content_exposure=0,
            random_seed=0,
        ),
    )
    assert cooled.selected_pair is None
    assert cooled.reason is SelectionReason.COOLDOWN

    after_new_interaction = select_pair(
        candidates,
        [*skipped, _comparison(2, 1, 2, SelectorOutcome.TIE)],
        config=SelectorConfig(
            pair_cooldown_count=0,
            skip_cooldown_count=1,
            max_consecutive_content_exposure=0,
            random_seed=0,
        ),
    )
    assert _pair_key(after_new_interaction.selected_pair) == (1, 2)


def test_consecutive_skips_extend_the_count_cooldown():
    candidates = [_candidate(1), _candidate(2), _candidate(3)]
    history = [
        _comparison(1, 1, 2, SelectorOutcome.SKIP),
        _comparison(2, 1, 2, SelectorOutcome.SKIP),
    ]
    result = select_pair(
        candidates,
        history,
        config=SelectorConfig(
            pair_cooldown_count=0,
            skip_cooldown_count=1,
            max_consecutive_content_exposure=0,
            exploration_rate=0,
            random_seed=0,
        ),
    )

    assert _pair_key(result.selected_pair) != (1, 2)


def test_single_content_is_not_exposed_over_and_over_again():
    candidates = [_candidate(1), _candidate(2), _candidate(3)]
    history = [_comparison(1, 1, 2), _comparison(2, 1, 3)]
    result = select_pair(
        candidates,
        history,
        config=SelectorConfig(
            pair_cooldown_count=0,
            skip_cooldown_count=0,
            max_consecutive_content_exposure=2,
            exploration_rate=0,
            random_seed=0,
        ),
    )

    assert _pair_key(result.selected_pair) == (2, 3)


def test_exploration_prefers_cross_component_pair():
    candidates = [_candidate(index, expected_rank=index) for index in range(1, 5)]
    history = [_comparison(1, 1, 2), _comparison(2, 3, 4)]
    result = select_pair(
        candidates,
        history,
        config=SelectorConfig(
            pair_cooldown_count=0,
            skip_cooldown_count=0,
            exploration_rate=1,
            random_seed=0,
        ),
    )

    assert result.diagnostics.exploration_used is True
    assert _pair_key(result.selected_pair) in {(1, 3), (1, 4), (2, 3), (2, 4)}
    assert result.reason is SelectionReason.EXPLORATION


def test_isolated_low_coverage_content_is_found_by_exploration():
    candidates = [_candidate(1, count=8), _candidate(2, count=8), _candidate(3, count=8), _candidate(4, count=0)]
    history = [_comparison(1, 1, 2), _comparison(2, 2, 3)]
    result = select_pair(
        candidates,
        history,
        config=SelectorConfig(
            pair_cooldown_count=0,
            skip_cooldown_count=0,
            exploration_rate=1,
            random_seed=0,
        ),
    )

    assert 4 in _pair_key(result.selected_pair)


def test_focus_content_has_nearby_rank_opponent():
    candidates = [
        _candidate(1, mean=0, expected_rank=27),
        _candidate(2, mean=0.1, expected_rank=24),
        _candidate(3, mean=0.2, expected_rank=2),
    ]
    result = select_pair(
        candidates,
        [],
        context=SelectorContext(focus_content_id=1),
        config=SelectorConfig(focus_probability=1, exploration_rate=0, random_seed=0),
    )

    assert _pair_key(result.selected_pair) == (1, 2)
    assert result.reason is SelectionReason.FOCUS_CONTENT
    assert result.diagnostics.focus_selected is True


def test_focus_is_not_forced_when_probability_is_zero():
    candidates = [
        _candidate(1, mean=4, expected_rank=1),
        _candidate(2, mean=0, expected_rank=50),
        _candidate(3, mean=0.01, expected_rank=51),
    ]
    result = select_pair(
        candidates,
        [],
        context=SelectorContext(focus_content_id=1),
        config=SelectorConfig(focus_probability=0, focus_weight=0, exploration_rate=0, random_seed=0),
    )

    assert _pair_key(result.selected_pair) == (2, 3)
    assert result.diagnostics.focus_selected is False


def test_anchor_changed_content_receives_bonus():
    candidates = [_candidate(1), _candidate(2), _candidate(3)]
    result = select_pair(
        candidates,
        [],
        context=SelectorContext(recently_anchor_changed_content_ids=frozenset({1})),
        config=SelectorConfig(exploration_rate=0, random_seed=0),
    )

    assert 1 in _pair_key(result.selected_pair)


def test_top_rank_boundary_receives_bonus():
    candidates = [
        _candidate(1, expected_rank=2),
        _candidate(2, expected_rank=10),
        _candidate(3, expected_rank=40),
    ]
    result = select_pair(
        candidates,
        [],
        config=SelectorConfig(
            important_rank_boundaries=(10,),
            rank_boundary_weight=3,
            exploration_rate=0,
            random_seed=0,
        ),
    )

    assert 2 in _pair_key(result.selected_pair)


def test_all_pairs_in_cooldown_use_fallback_for_three_or_more_candidates():
    candidates = [_candidate(1), _candidate(2), _candidate(3)]
    history = [_comparison(1, 1, 2), _comparison(2, 1, 3), _comparison(3, 2, 3)]
    result = select_pair(
        candidates,
        history,
        config=SelectorConfig(pair_cooldown_count=3, skip_cooldown_count=0, random_seed=0),
    )

    assert result.selected_pair is not None
    assert result.reason is SelectionReason.COOLDOWN_FALLBACK
    assert result.diagnostics.fallback_used is True
    assert result.diagnostics.eligible_pair_count == 0


def test_no_complete_ranker_snapshot_uses_anchor_fallback_without_crashing():
    candidates = [
        SelectorCandidate(content_id=1, score_anchor=90),
        SelectorCandidate(content_id=2, score_anchor=80),
        SelectorCandidate(content_id=3),
    ]
    result = select_pair(candidates, [], config=SelectorConfig(random_seed=0))

    assert result.selected_pair is not None
    assert result.diagnostics.pair_count == 3


def test_invalid_and_revoked_history_is_ignored():
    result = select_pair(
        [_candidate(1), _candidate(2), _candidate(3)],
        [
            _comparison(1, 1, 2),
            SelectorComparison(2, 1, 3, 'invalid'),
            SelectorComparison(3, 1, 2, SelectorOutcome.LEFT_WIN, revoked=True),
            _comparison(4, 2, 2),
        ],
        config=SelectorConfig(random_seed=0),
    )

    assert result.diagnostics.valid_comparison_count == 1
    assert result.diagnostics.ignored_comparison_count == 3


def test_fixed_seed_repeats_pair_reason_components_and_orientation():
    candidates = [_candidate(1), _candidate(2), _candidate(3)]
    history = [_comparison(1, 1, 2)]
    config = SelectorConfig(random_seed=123, exploration_rate=0)
    first = select_pair(candidates, history, config=config)
    second = select_pair(candidates, history, config=config)

    assert first.selected_pair == second.selected_pair
    assert first.reason is second.reason


def test_left_right_orientation_is_randomized_by_seed():
    candidates = [_candidate(1), _candidate(2)]
    orientations = {
        (select_pair(candidates, [], config=SelectorConfig(random_seed=seed)).selected_pair.left_content_id,
         select_pair(candidates, [], config=SelectorConfig(random_seed=seed)).selected_pair.right_content_id)
        for seed in range(8)
    }

    assert orientations == {(1, 2), (2, 1)}


def test_selector_config_round_trip_is_json_serializable():
    config = SelectorConfig(
        selector_version='selector-test',
        important_rank_boundaries=(5, 10, 20),
        pair_cooldown_seconds=30,
        random_seed=42,
    )

    restored = SelectorConfig.from_json(config.to_json())

    assert restored == config
    assert json.loads(config.to_json())['selector_version'] == 'selector-test'


def test_ranker_and_selector_use_the_same_davidson_probability_function():
    assert ranker_pairwise_probability is shared_pairwise_probability
    for preference_a, preference_b, tie_strength in ((0.0, 0.0, 0.8), (2.5, -1.0, 1.0), (-4.0, 3.0, 0.35)):
        probability = shared_pairwise_probability(preference_a, preference_b, tie_strength)
        assert math.isclose(probability.win_a + probability.tie + probability.win_b, 1.0, abs_tol=1e-12)
        assert probability == ranker_pairwise_probability(preference_a, preference_b, tie_strength)


def test_tie_strength_is_request_context_not_selector_config():
    candidates = [_candidate(1, mean=0), _candidate(2, mean=0.1), _candidate(3, mean=3)]
    low_tie = select_pair(
        candidates,
        [],
        context=SelectorContext(tie_strength=0.35),
        config=SelectorConfig(exploration_rate=0, random_seed=0),
    )
    high_tie = select_pair(
        candidates,
        [],
        context=SelectorContext(tie_strength=1.2),
        config=SelectorConfig(exploration_rate=0, random_seed=0),
    )

    low_components = dict(low_tie.selected_pair.components)
    high_components = dict(high_tie.selected_pair.components)
    assert low_components['outcome_entropy'] != high_components['outcome_entropy']


def test_none_seed_is_valid_for_production_random_source():
    result = select_pair(
        [_candidate(1), _candidate(2), _candidate(3)],
        [],
        config=SelectorConfig(random_seed=None),
    )

    assert result.selected_pair is not None


def test_shortlist_preserves_focus_and_core_source_categories():
    candidates = [_candidate(index, expected_rank=index, count=5) for index in range(1, 501)]
    result = select_pair(
        candidates,
        [],
        context=SelectorContext(focus_content_id=250, recently_anchor_changed_content_ids=frozenset({251})),
        config=SelectorConfig(focus_probability=1, random_seed=0),
    )

    assert result.selected_pair is not None
    assert 250 in _pair_key(result.selected_pair)
    assert result.diagnostics.shortlist_used is True
    assert result.diagnostics.pair_evaluation_count <= result.diagnostics.total_candidate_pair_count
    assert 'rank_neighbors' in result.diagnostics.shortlist_source_counts
    assert 'focus' in result.diagnostics.shortlist_source_counts


def test_shortlist_cannot_bypass_pair_cooldown():
    candidates = [_candidate(index, expected_rank=index) for index in range(1, 501)]
    result = select_pair(
        candidates,
        [_comparison(1, 250, 251)],
        config=SelectorConfig(exploration_rate=0, random_seed=0),
    )

    assert _pair_key(result.selected_pair) != (250, 251)


def test_shortlist_quality_regression_reports_ratio_statistics(capsys):
    ratios: list[float] = []
    for scenario in range(6):
        count = 20 + scenario * 16
        candidates = [
            _candidate(
                index,
                mean=((index * (scenario + 3)) % 23) / 8,
                expected_rank=index + (index % 3) * 0.25,
                rank_low=max(1, index - 2),
                rank_high=index + 3,
                count=(index + scenario) % 7 + 1,
            )
            for index in range(1, count + 1)
        ]
        exhaustive = select_pair(
            candidates,
            [],
            config=SelectorConfig(
                exhaustive_candidate_threshold=count,
                exploration_rate=0,
                random_seed=0,
            ),
        )
        shortlist = select_pair(
            candidates,
            [],
            config=SelectorConfig(
                exhaustive_candidate_threshold=0,
                max_pair_evaluations=180,
                rank_neighbor_window=5,
                exploration_rate=0,
                random_seed=0,
            ),
        )
        assert exhaustive.selected_pair is not None
        assert shortlist.selected_pair is not None
        assert shortlist.diagnostics.shortlist_used is True
        assert shortlist.diagnostics.pair_evaluation_count <= 180
        exhaustive_score = exhaustive.selected_pair.debug_score
        assert exhaustive_score > 0
        ratios.append(shortlist.selected_pair.debug_score / exhaustive_score)

    print(
        f'quality ratio average={statistics.mean(ratios):.4f} '
        f'p50={statistics.median(ratios):.4f} min={min(ratios):.4f}',
    )
    captured = capsys.readouterr()
    assert 'quality ratio' in captured.out
    assert min(ratios) > 0


def test_performance_at_50_100_500_and_1000_candidates(capsys):
    measurements: list[tuple[int, int, float, float, float, float]] = []
    for count in (50, 100, 500, 1000):
        candidates = [
            _candidate(
                index,
                mean=(index % 20) / 10,
                expected_rank=index,
                rank_low=max(1, index - 1),
                rank_high=index + 1,
                count=index % 9,
            )
            for index in range(1, count + 1)
        ]
        started_at = time.perf_counter()
        result = select_pair(
            candidates,
            [],
            config=SelectorConfig(exploration_rate=0.12, random_seed=7),
        )
        wall_seconds = time.perf_counter() - started_at
        assert result.selected_pair is not None
        if count <= 100:
            assert result.diagnostics.pair_evaluation_count == result.diagnostics.total_candidate_pair_count
            assert result.diagnostics.shortlist_used is False
        else:
            assert result.diagnostics.shortlist_used is True
            assert result.diagnostics.pair_evaluation_count <= result.diagnostics.total_candidate_pair_count
            assert result.diagnostics.pair_evaluation_count <= 6000
        measurements.append(
            (
                count,
                result.diagnostics.pair_evaluation_count,
                result.diagnostics.shortlist_construction_seconds,
                result.diagnostics.full_acquisition_scoring_seconds,
                result.diagnostics.selection_seconds,
                wall_seconds,
            ),
        )

    for count, evaluation_count, pair_seconds, score_seconds, selection_seconds, wall_seconds in measurements:
        print(
            f'performance candidates={count} evaluations={evaluation_count}'
            f' shortlist={pair_seconds:.4f}s score={score_seconds:.4f}s '
            f'selection={selection_seconds:.4f}s total={wall_seconds:.4f}s',
        )
    captured = capsys.readouterr()
    assert 'candidates=500' in captured.out
    assert 'candidates=1000' in captured.out
