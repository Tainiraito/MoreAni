"""红蓝合战阶段 4A：纯实时排名快速路径实验。

本模块只验证 Davidson/Bayesian 偏好模型的增量近似，不连接数据库、FastAPI、
Service 或后台任务。完整 Ranker 仍然是权威结果来源；这里的结果明确标记为
``provisional``，只负责更新 preference mean 和临时顺序。

提供三种可以直接对比的策略：

* :class:`FastUpdateStrategy.WARM_START_MAP`：使用上一状态作为完整 MAP 的初始值；
* :class:`FastUpdateStrategy.LOCAL_LAPLACE`：只对本次 A/B 做一次 Davidson 局部
  Laplace 更新；
* :class:`FastUpdateStrategy.LOCAL_NEIGHBORHOOD_MAP`：在排名邻域和 comparison
  图构成的 active set 上重算局部 MAP，active set 外固定为当前快速状态。

重复 pair 的权重严格沿用 Ranker 的 ``min(cap, n ** exponent)`` 语义。新增一条
comparison 时，局部路径使用旧观测权重变化加新观测权重的增量，而不是把新观测
永远当作 1.0。Score Anchor 变化、新作品、撤销或算法配置变化不应走这里的普通
comparison 更新；调用方应触发完整 Ranker。
"""

from __future__ import annotations

import math
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum

import numpy as np

from services.red_blue_pair_selector import SelectorCandidate
from services.red_blue_ranker import (
    Candidate,
    Comparison,
    ComparisonOutcome,
    PreferenceResult,
    RankerConfig,
    RankerOutput,
    ScoreAnchor,
    _objective_gradient_hessian,
    _prepare_comparisons,
    _PreparedComparison,
    build_score_priors,
)


class FastUpdateStrategy(StrEnum):
    """阶段 4A 需要比较的快速更新策略。"""

    WARM_START_MAP = 'warm_start_map'
    LOCAL_LAPLACE = 'local_laplace'
    LOCAL_NEIGHBORHOOD_MAP = 'local_neighborhood_map'


class FastPathEvent(StrEnum):
    """判断普通 comparison 快速路径是否仍然安全的输入事件。"""

    COMPARISON = 'comparison'
    SCORE_ANCHOR_CHANGED = 'score_anchor_changed'
    NEW_CONTENT = 'new_content'
    COMPARISON_REVOKED = 'comparison_revoked'
    ALGORITHM_CONFIG_CHANGED = 'algorithm_config_changed'


@dataclass(frozen=True, slots=True)
class FastPreferenceResult:
    """一部作品的快速结果。

    ``provisional_rank`` 是根据当前 ``preference_mean`` 排序后得到的严格
    整数展示序号，不是完整后验的 ``expected_rank``。``preference_std`` 对
    局部路径是局部 Laplace 近似；Selector 不会把它当作权威 rank interval
    的来源。
    """

    content_id: int
    preference_mean: float
    preference_std: float | None
    provisional_rank: int
    comparison_count: int
    provisional: bool


@dataclass(frozen=True, slots=True)
class FastPreferenceState:
    """内存中的快速状态，不代表阶段 4A 要落库的最终结构。

    ``authoritative_results`` 是最近一次完整 Ranker 的结果。每次 Fast Update
    只替换 ``fast_results``，因此 Selector 可以同时使用最新顺序和旧的权威
    uncertainty。``comparisons`` 保存从该权威状态之后收到的全部历史，支持
    重复 pair 权重和局部 MAP 的重建。
    """

    candidates: tuple[Candidate, ...]
    score_anchors: tuple[ScoreAnchor, ...]
    comparisons: tuple[Comparison, ...]
    authoritative_results: tuple[PreferenceResult, ...]
    fast_results: tuple[FastPreferenceResult, ...]
    fast_update_count: int = 0


@dataclass(frozen=True, slots=True)
class FastUpdateConfig:
    """快速路径实验参数，不进入当前 RankerConfig 或数据库。"""

    warm_start_max_iterations: int = 8
    local_max_iterations: int = 12
    local_rank_neighbor_window: int = 8
    local_graph_neighbor_count: int = 16
    local_max_active_candidates: int = 64
    optimizer_tolerance: float = 1e-7
    optimizer_step_tolerance: float = 1e-8
    line_search_min_step: float = 1e-6
    armijo_coefficient: float = 1e-4
    backtracking_factor: float = 0.5

    def __post_init__(self) -> None:
        """校验局部实验参数。"""
        if self.warm_start_max_iterations < 1 or self.local_max_iterations < 1:
            raise ValueError('Fast optimizer iterations 必须至少为 1')
        if self.local_rank_neighbor_window < 0 or self.local_graph_neighbor_count < 0:
            raise ValueError('局部邻域大小不能为负数')
        if self.local_max_active_candidates < 2:
            raise ValueError('local_max_active_candidates 必须至少为 2')
        if self.optimizer_tolerance <= 0 or self.optimizer_step_tolerance <= 0:
            raise ValueError('Fast optimizer tolerance 必须大于 0')
        if not 0 < self.line_search_min_step < 1:
            raise ValueError('line_search_min_step 必须位于 (0, 1)')
        if not 0 < self.armijo_coefficient < 1:
            raise ValueError('armijo_coefficient 必须位于 (0, 1)')
        if not 0 < self.backtracking_factor < 1:
            raise ValueError('backtracking_factor 必须位于 (0, 1)')


@dataclass(frozen=True, slots=True)
class FastUpdateDiagnostics:
    """快速更新的可观测分解。"""

    strategy: FastUpdateStrategy
    update_seconds: float
    reorder_seconds: float
    selector_conversion_seconds: float
    total_seconds: float
    active_candidate_count: int
    optimizer_iterations: int
    previous_pair_count: int
    new_pair_count: int
    effective_weight_increment: float
    used_repeat_pair_reweighting: bool


@dataclass(frozen=True, slots=True)
class FastUpdateOutput:
    """一次纯内存 Fast Update 的完整输出。"""

    state: FastPreferenceState
    results: tuple[FastPreferenceResult, ...]
    selector_candidates: tuple[SelectorCandidate, ...]
    diagnostics: FastUpdateDiagnostics


@dataclass(frozen=True, slots=True)
class FastAccuracyMetrics:
    """Fast State 与 Full Ranker 的可比较指标。"""

    mean_absolute_error: float
    max_mean_absolute_error: float
    mean_rank_absolute_error: float
    max_rank_absolute_error: float
    top_k_agreement: dict[int, float]
    compared_count: int


@dataclass(frozen=True, slots=True)
class _LocalObservation:
    """任意 active set 上的一条 Davidson 观测。"""

    low_feature: np.ndarray
    high_feature: np.ndarray
    low_offset: float
    high_offset: float
    outcome: int
    weight: float


@dataclass(frozen=True, slots=True)
class _LocalFit:
    mean: np.ndarray
    covariance: np.ndarray
    iterations: int


def create_fast_preference_state(
    candidates: Sequence[Candidate],
    score_anchors: Sequence[ScoreAnchor],
    comparisons: Sequence[Comparison],
    authoritative_output: RankerOutput,
) -> FastPreferenceState:
    """以最近一次完整 Ranker 输出创建可增量更新的内存状态。"""
    candidate_ids = tuple(sorted({candidate.content_id for candidate in candidates}))
    authoritative_by_id = {result.content_id: result for result in authoritative_output.results}
    if set(authoritative_by_id) != set(candidate_ids):
        raise ValueError('authoritative_results 必须覆盖全部候选且不能包含额外候选')
    ordered_authoritative = tuple(authoritative_by_id[content_id] for content_id in candidate_ids)
    fast_results = _make_fast_results(ordered_authoritative, provisional=False)
    return FastPreferenceState(
        candidates=tuple(sorted(candidates, key=lambda candidate: candidate.content_id)),
        score_anchors=tuple(score_anchors),
        comparisons=tuple(comparisons),
        authoritative_results=ordered_authoritative,
        fast_results=fast_results,
    )


def requires_full_ranker(event: FastPathEvent | str) -> bool:
    """判断事件是否不能安全地使用普通 comparison Fast Update。"""
    return FastPathEvent(event) is not FastPathEvent.COMPARISON


def fast_update_preference(
    state: FastPreferenceState,
    comparison: Comparison,
    *,
    strategy: FastUpdateStrategy = FastUpdateStrategy.LOCAL_LAPLACE,
    ranker_config: RankerConfig | None = None,
    config: FastUpdateConfig | None = None,
) -> FastUpdateOutput:
    """对一条有效 LEFT/RIGHT/TIE comparison 做纯算法快速更新。

    普通 comparison 不改变 Score Anchor，因此可以使用当前 Fast State 作为
    下一次输入。SKIP、撤销、跨候选或自比较会明确报错；它们应由上游选择
    不更新或触发完整 Ranker，而不是被静默转换成伪观测。
    """
    started_at = time.perf_counter()
    active_ranker_config = ranker_config or RankerConfig()
    active_config = config or FastUpdateConfig()
    _validate_comparison(state, comparison)
    active_strategy = FastUpdateStrategy(strategy)
    previous_pair_count = _pair_count(state.comparisons, comparison)
    new_comparisons = (*state.comparisons, comparison)
    new_pair_count = previous_pair_count + 1
    effective_increment = _effective_pair_weight(
        new_pair_count,
        active_ranker_config,
    ) - _effective_pair_weight(previous_pair_count, active_ranker_config)

    update_started_at = time.perf_counter()
    if active_strategy is FastUpdateStrategy.WARM_START_MAP:
        means, standard_deviations, iterations, active_count = _warm_start_map(
            state,
            new_comparisons,
            active_ranker_config,
            active_config,
        )
    elif active_strategy is FastUpdateStrategy.LOCAL_LAPLACE:
        means, standard_deviations, iterations, active_count = _local_laplace_update(
            state,
            comparison,
            active_ranker_config,
            active_config,
        )
    else:
        means, standard_deviations, iterations, active_count = _local_neighborhood_map(
            state,
            new_comparisons,
            active_ranker_config,
            active_config,
        )
    update_seconds = time.perf_counter() - update_started_at

    reorder_started_at = time.perf_counter()
    fast_results = _make_fast_results_from_arrays(
        state,
        means,
        standard_deviations,
        new_comparisons,
    )
    reorder_seconds = time.perf_counter() - reorder_started_at
    next_state = FastPreferenceState(
        candidates=state.candidates,
        score_anchors=state.score_anchors,
        comparisons=new_comparisons,
        authoritative_results=state.authoritative_results,
        fast_results=fast_results,
        fast_update_count=state.fast_update_count + 1,
    )

    conversion_started_at = time.perf_counter()
    selector_candidates = to_selector_candidates(next_state)
    selector_conversion_seconds = time.perf_counter() - conversion_started_at
    total_seconds = time.perf_counter() - started_at
    diagnostics = FastUpdateDiagnostics(
        strategy=active_strategy,
        update_seconds=_finite(update_seconds),
        reorder_seconds=_finite(reorder_seconds),
        selector_conversion_seconds=_finite(selector_conversion_seconds),
        total_seconds=_finite(total_seconds),
        active_candidate_count=active_count,
        optimizer_iterations=iterations,
        previous_pair_count=previous_pair_count,
        new_pair_count=new_pair_count,
        effective_weight_increment=_finite(effective_increment),
        used_repeat_pair_reweighting=previous_pair_count > 0,
    )
    return FastUpdateOutput(
        state=next_state,
        results=fast_results,
        selector_candidates=selector_candidates,
        diagnostics=diagnostics,
    )


def to_selector_candidates(state: FastPreferenceState) -> tuple[SelectorCandidate, ...]:
    """将 Fast State 转换为 Selector 的混合输入。

    最新 fast mean / provisional rank 用于下一题的位置判断；
    preference_std、rank_low、rank_high、stability 仍取最近完整 Ranker，
    不把局部近似伪装成权威 uncertainty。
    """
    authoritative_by_id = {result.content_id: result for result in state.authoritative_results}
    anchors_by_id = {anchor.content_id: float(anchor.score) for anchor in state.score_anchors}
    return tuple(
        SelectorCandidate(
            content_id=result.content_id,
            preference_mean=result.preference_mean,
            preference_std=authoritative_by_id[result.content_id].preference_std,
            expected_rank=float(result.provisional_rank),
            rank_low=authoritative_by_id[result.content_id].rank_low,
            rank_high=authoritative_by_id[result.content_id].rank_high,
            comparison_count=result.comparison_count,
            stability=authoritative_by_id[result.content_id].stability,
            score_anchor=anchors_by_id.get(result.content_id),
        )
        for result in sorted(state.fast_results, key=lambda item: item.content_id)
    )


def compare_fast_with_full(
    fast_results: Sequence[FastPreferenceResult],
    full_results: Sequence[PreferenceResult],
    *,
    top_ks: Sequence[int] = (10, 20),
) -> FastAccuracyMetrics:
    """比较快速 mean / 顺序与完整 Ranker 的结果。"""
    fast_by_id = {result.content_id: result for result in fast_results}
    full_ordered = tuple(sorted(full_results, key=lambda result: (result.expected_rank, result.content_id)))
    full_by_id = {result.content_id: result for result in full_ordered}
    common_ids = tuple(sorted(set(fast_by_id) & set(full_by_id)))
    if not common_ids:
        return FastAccuracyMetrics(0.0, 0.0, 0.0, 0.0, {}, 0)
    mean_errors = [
        abs(fast_by_id[content_id].preference_mean - full_by_id[content_id].preference_mean)
        for content_id in common_ids
    ]
    full_rank_by_id = {result.content_id: index for index, result in enumerate(full_ordered, start=1)}
    rank_errors = [
        abs(fast_by_id[content_id].provisional_rank - full_rank_by_id[content_id])
        for content_id in common_ids
    ]
    fast_top_order = tuple(sorted(common_ids, key=lambda content_id: fast_by_id[content_id].provisional_rank))
    full_top_order = tuple(sorted(common_ids, key=lambda content_id: full_rank_by_id[content_id]))
    top_agreement: dict[int, float] = {}
    for top_k in top_ks:
        if top_k <= 0:
            raise ValueError('top_ks 必须为正数')
        actual_k = min(top_k, len(common_ids))
        fast_top = set(fast_top_order[:actual_k])
        full_top = set(full_top_order[:actual_k])
        top_agreement[top_k] = len(fast_top & full_top) / actual_k
    return FastAccuracyMetrics(
        mean_absolute_error=_finite(sum(mean_errors) / len(mean_errors)),
        max_mean_absolute_error=_finite(max(mean_errors)),
        mean_rank_absolute_error=_finite(sum(rank_errors) / len(rank_errors)),
        max_rank_absolute_error=_finite(max(rank_errors)),
        top_k_agreement=top_agreement,
        compared_count=len(common_ids),
    )


def _validate_comparison(state: FastPreferenceState, comparison: Comparison) -> None:
    """验证 Fast Path 只接收一条普通有效 comparison。"""
    candidate_ids = {candidate.content_id for candidate in state.candidates}
    if comparison.left_content_id == comparison.right_content_id:
        raise ValueError('Fast comparison 不能比较同一部作品')
    if comparison.left_content_id not in candidate_ids or comparison.right_content_id not in candidate_ids:
        raise ValueError('Fast comparison 必须属于当前候选集合')
    if comparison.revoked or comparison.revoked_at is not None:
        raise ValueError('撤销 comparison 必须触发 Full Ranker')
    try:
        outcome = ComparisonOutcome(comparison.outcome)
    except (TypeError, ValueError) as exc:
        raise ValueError('Fast comparison outcome 无效') from exc
    if outcome is ComparisonOutcome.SKIP:
        raise ValueError('SKIP 不产生偏好 Fast Update')


def _make_fast_results(
    authoritative_results: Sequence[PreferenceResult],
    *,
    provisional: bool,
) -> tuple[FastPreferenceResult, ...]:
    """从权威结果按实时偏好均值创建严格整数展示顺序。"""
    ordered = tuple(sorted(authoritative_results, key=lambda result: (-result.preference_mean, result.content_id)))
    rank_by_id = {result.content_id: index for index, result in enumerate(ordered, start=1)}
    return tuple(
        sorted(
            (
                FastPreferenceResult(
                    content_id=result.content_id,
                    preference_mean=result.preference_mean,
                    preference_std=result.preference_std,
                    provisional_rank=rank_by_id[result.content_id],
                    comparison_count=result.comparison_count,
                    provisional=provisional,
                )
                for result in authoritative_results
            ),
            key=lambda result: result.content_id,
        ),
    )


def _make_fast_results_from_arrays(
    state: FastPreferenceState,
    means: np.ndarray,
    standard_deviations: np.ndarray,
    comparisons: Sequence[Comparison],
) -> tuple[FastPreferenceResult, ...]:
    """用最新均值和局部标准差创建临时顺序。"""
    candidate_ids = tuple(candidate.content_id for candidate in state.candidates)
    order = sorted(range(len(candidate_ids)), key=lambda index: (-float(means[index]), candidate_ids[index]))
    provisional_rank_by_id = {candidate_ids[index]: rank for rank, index in enumerate(order, start=1)}
    counts = _comparison_counts(candidate_ids, comparisons)
    return tuple(
        FastPreferenceResult(
            content_id=content_id,
            preference_mean=_finite(float(means[index])),
            preference_std=(
                _finite(float(standard_deviations[index]))
                if math.isfinite(float(standard_deviations[index]))
                else None
            ),
            provisional_rank=provisional_rank_by_id[content_id],
            comparison_count=counts.get(content_id, 0),
            provisional=True,
        )
        for index, content_id in enumerate(candidate_ids)
    )


def _comparison_counts(candidate_ids: Sequence[int], comparisons: Sequence[Comparison]) -> dict[int, int]:
    """统计不含 SKIP / 无效 / 撤销记录的 comparison 次数。"""
    candidate_set = set(candidate_ids)
    counts = dict.fromkeys(candidate_ids, 0)
    for comparison in comparisons:
        if comparison.revoked or comparison.revoked_at is not None:
            continue
        try:
            outcome = ComparisonOutcome(comparison.outcome)
        except (TypeError, ValueError):
            continue
        if (
            outcome is ComparisonOutcome.SKIP
            or comparison.left_content_id == comparison.right_content_id
            or comparison.left_content_id not in candidate_set
            or comparison.right_content_id not in candidate_set
        ):
            continue
        counts[comparison.left_content_id] += 1
        counts[comparison.right_content_id] += 1
    return counts


def _pair_count(comparisons: Sequence[Comparison], target: Comparison) -> int:
    """计算 target 的无序 pair 历史有效次数。"""
    target_pair = frozenset((target.left_content_id, target.right_content_id))
    return sum(
        1
        for comparison in comparisons
        if not comparison.revoked
        and comparison.revoked_at is None
        and frozenset((comparison.left_content_id, comparison.right_content_id)) == target_pair
        and comparison.left_content_id != comparison.right_content_id
        and comparison.outcome in {
            ComparisonOutcome.LEFT_WIN,
            ComparisonOutcome.RIGHT_WIN,
            ComparisonOutcome.TIE,
        }
    )


def _effective_pair_weight(pair_count: int, config: RankerConfig) -> float:
    """返回 Ranker 对一个 unordered pair 的总有效权重。"""
    if pair_count <= 0:
        return 0.0
    return min(
        config.repeat_pair_weight_cap,
        max(1.0, pair_count**config.repeat_pair_exponent),
    )


def _warm_start_map(
    state: FastPreferenceState,
    comparisons: Sequence[Comparison],
    ranker_config: RankerConfig,
    fast_config: FastUpdateConfig,
) -> tuple[np.ndarray, np.ndarray, int, int]:
    """用上一 Fast State 作为完整 MAP 的 warm start，跳过 covariance。"""
    candidate_ids = tuple(candidate.content_id for candidate in state.candidates)
    priors = build_score_priors(state.candidates, state.score_anchors, ranker_config)
    prepared, _, _, _, _, _ = _prepare_comparisons(state.candidates, comparisons, ranker_config)
    prior_mean = np.array([priors[content_id].mean for content_id in candidate_ids], dtype=float)
    prior_precision = np.array([priors[content_id].precision for content_id in candidate_ids], dtype=float)
    previous_means = _means_by_candidate(state)
    fit_mean, iterations = _fit_warm_start(
        previous_means,
        prior_mean,
        prior_precision,
        prepared,
        ranker_config,
        fast_config.warm_start_max_iterations,
        optimizer_tolerance=fast_config.optimizer_tolerance,
        step_tolerance=fast_config.optimizer_step_tolerance,
        line_search_min_step=fast_config.line_search_min_step,
        armijo_coefficient=fast_config.armijo_coefficient,
        backtracking_factor=fast_config.backtracking_factor,
    )
    standard_deviations = _stds_by_candidate(state)
    return fit_mean, standard_deviations, iterations, len(candidate_ids)


def _local_laplace_update(
    state: FastPreferenceState,
    comparison: Comparison,
    ranker_config: RankerConfig,
    fast_config: FastUpdateConfig,
) -> tuple[np.ndarray, np.ndarray, int, int]:
    """只对 A/B 的当前边际后验做 Davidson 局部 Laplace 更新。"""
    candidate_ids = tuple(candidate.content_id for candidate in state.candidates)
    index_by_id = {content_id: index for index, content_id in enumerate(candidate_ids)}
    active_ids = tuple(sorted((comparison.left_content_id, comparison.right_content_id)))
    active_index_by_id = {content_id: index for index, content_id in enumerate(active_ids)}
    prior_means_array = _means_by_candidate(state)
    prior_stds_array = _stds_by_candidate(state)
    prior_means_by_id = {
        content_id: float(prior_means_array[index])
        for content_id, index in index_by_id.items()
    }
    prior_stds_by_id = {
        content_id: float(prior_stds_array[index])
        for content_id, index in index_by_id.items()
    }
    prior_mean = np.array([prior_means_by_id[content_id] for content_id in active_ids], dtype=float)
    prior_precision = np.array(
        [1.0 / max(prior_stds_by_id[content_id] ** 2, 1e-10) for content_id in active_ids],
        dtype=float,
    )
    observations = _incremental_pair_observations(
        state.comparisons,
        comparison,
        active_ids,
        active_index_by_id,
        ranker_config,
    )
    fit = _fit_local(
        prior_mean,
        prior_precision,
        observations,
        prior_mean,
        ranker_config.tie_strength,
        max_iterations=fast_config.local_max_iterations,
        optimizer_tolerance=fast_config.optimizer_tolerance,
        step_tolerance=fast_config.optimizer_step_tolerance,
        line_search_min_step=fast_config.line_search_min_step,
        armijo_coefficient=fast_config.armijo_coefficient,
        backtracking_factor=fast_config.backtracking_factor,
    )
    means = np.array([prior_means_by_id[content_id] for content_id in candidate_ids], dtype=float)
    standard_deviations = np.array([prior_stds_by_id[content_id] for content_id in candidate_ids], dtype=float)
    for local_index, content_id in enumerate(active_ids):
        global_index = index_by_id[content_id]
        means[global_index] = fit.mean[local_index]
        standard_deviations[global_index] = math.sqrt(max(0.0, float(fit.covariance[local_index, local_index])))
    return means, standard_deviations, fit.iterations, 2


def _local_neighborhood_map(
    state: FastPreferenceState,
    comparisons: Sequence[Comparison],
    ranker_config: RankerConfig,
    fast_config: FastUpdateConfig,
) -> tuple[np.ndarray, np.ndarray, int, int]:
    """在当前排名/图邻域上做局部 MAP，active set 外固定为 Fast State。"""
    candidate_ids = tuple(candidate.content_id for candidate in state.candidates)
    candidate_index_by_id = {content_id: index for index, content_id in enumerate(candidate_ids)}
    active_ids = _select_active_ids(state, comparisons, fast_config)
    active_index_by_id = {content_id: index for index, content_id in enumerate(active_ids)}
    active_indices = np.array([candidate_index_by_id[content_id] for content_id in active_ids], dtype=int)
    current_means = _means_by_candidate(state)
    priors = build_score_priors(state.candidates, state.score_anchors, ranker_config)
    prior_mean = np.array([priors[content_id].mean for content_id in active_ids], dtype=float)
    prior_precision = np.array([priors[content_id].precision for content_id in active_ids], dtype=float)
    observations = _all_local_observations(
        state.candidates,
        comparisons,
        active_ids,
        active_index_by_id,
        current_means,
        ranker_config,
    )
    initial = current_means[active_indices]
    fit = _fit_local(
        prior_mean,
        prior_precision,
        observations,
        initial,
        ranker_config.tie_strength,
        max_iterations=fast_config.local_max_iterations,
        optimizer_tolerance=fast_config.optimizer_tolerance,
        step_tolerance=fast_config.optimizer_step_tolerance,
        line_search_min_step=fast_config.line_search_min_step,
        armijo_coefficient=fast_config.armijo_coefficient,
        backtracking_factor=fast_config.backtracking_factor,
    )
    means = current_means.copy()
    standard_deviations = _stds_by_candidate(state)
    for local_index, content_id in enumerate(active_ids):
        global_index = candidate_index_by_id[content_id]
        means[global_index] = fit.mean[local_index]
        standard_deviations[global_index] = math.sqrt(max(0.0, float(fit.covariance[local_index, local_index])))
    return means, standard_deviations, fit.iterations, len(active_ids)


def _select_active_ids(
    state: FastPreferenceState,
    comparisons: Sequence[Comparison],
    config: FastUpdateConfig,
) -> tuple[int, ...]:
    """按排名窗口、直接 comparison 图邻居和排序稳定地构造 active set。"""
    fast_by_id = {result.content_id: result for result in state.fast_results}
    ranked_ids = tuple(
        result.content_id
        for result in sorted(state.fast_results, key=lambda result: (result.provisional_rank, result.content_id))
    )
    rank_position = {content_id: index for index, content_id in enumerate(ranked_ids)}
    target_ids = {comparison.left_content_id for comparison in comparisons[-1:]} | {
        comparison.right_content_id for comparison in comparisons[-1:]
    }
    selected: list[int] = []

    def add(content_id: int) -> None:
        if content_id in fast_by_id and content_id not in selected:
            selected.append(content_id)

    for target_id in sorted(target_ids):
        add(target_id)
    for target_id in sorted(target_ids):
        center = rank_position[target_id]
        start = max(0, center - config.local_rank_neighbor_window)
        end = min(len(ranked_ids), center + config.local_rank_neighbor_window + 1)
        for content_id in ranked_ids[start:end]:
            add(content_id)

    graph_neighbors: dict[int, set[int]] = {content_id: set() for content_id in ranked_ids}
    for comparison in comparisons:
        try:
            outcome = ComparisonOutcome(comparison.outcome)
        except (TypeError, ValueError):
            continue
        if (
            outcome is ComparisonOutcome.SKIP
            or comparison.revoked
            or comparison.revoked_at is not None
            or comparison.left_content_id == comparison.right_content_id
            or comparison.left_content_id not in graph_neighbors
            or comparison.right_content_id not in graph_neighbors
        ):
            continue
        graph_neighbors[comparison.left_content_id].add(comparison.right_content_id)
        graph_neighbors[comparison.right_content_id].add(comparison.left_content_id)
    graph_candidates = {
        neighbor
        for target_id in target_ids
        for neighbor in graph_neighbors[target_id]
        if neighbor not in selected
    }
    for content_id in sorted(
        graph_candidates,
        key=lambda item: (abs(rank_position[item] - min(rank_position[target] for target in target_ids)), item),
    )[: config.local_graph_neighbor_count]:
        add(content_id)

    # max_active_candidates 是实验上限，不是最终产品常数；保留目标和最近排名邻域。
    return tuple(selected[: config.local_max_active_candidates])


def _incremental_pair_observations(
    previous_comparisons: Sequence[Comparison],
    new_comparison: Comparison,
    active_ids: Sequence[int],
    active_index_by_id: Mapping[int, int],
    ranker_config: RankerConfig,
) -> tuple[_LocalObservation, ...]:
    """将同一 pair 的总权重变化展开为旧观测重加权和新观测。"""
    pair = frozenset((new_comparison.left_content_id, new_comparison.right_content_id))
    previous_pair = tuple(
        comparison
        for comparison in previous_comparisons
        if not comparison.revoked
        and comparison.revoked_at is None
        and frozenset((comparison.left_content_id, comparison.right_content_id)) == pair
        and comparison.left_content_id != comparison.right_content_id
        and comparison.outcome in {
            ComparisonOutcome.LEFT_WIN,
            ComparisonOutcome.RIGHT_WIN,
            ComparisonOutcome.TIE,
        }
    )
    old_count = len(previous_pair)
    new_count = old_count + 1
    old_per_observation = _effective_pair_weight(old_count, ranker_config) / old_count if old_count else 0.0
    new_per_observation = _effective_pair_weight(new_count, ranker_config) / new_count
    observations: list[_LocalObservation] = []
    for old_comparison in previous_pair:
        observations.append(
            _make_local_observation(
                old_comparison,
                active_ids,
                active_index_by_id,
                new_per_observation - old_per_observation,
                dict.fromkeys(active_ids, 0.0),
            ),
        )
    observations.append(
        _make_local_observation(
            new_comparison,
            active_ids,
            active_index_by_id,
            new_per_observation,
            dict.fromkeys(active_ids, 0.0),
        ),
    )
    return tuple(observations)


def _all_local_observations(
    candidates: Sequence[Candidate],
    comparisons: Sequence[Comparison],
    active_ids: Sequence[int],
    active_index_by_id: Mapping[int, int],
    current_means: np.ndarray,
    ranker_config: RankerConfig,
) -> tuple[_LocalObservation, ...]:
    """把全量 Ranker comparison 投影到 active set，固定外部 latent value。"""
    prepared, _, _, _, _, _ = _prepare_comparisons(candidates, comparisons, ranker_config)
    candidate_ids = tuple(sorted({candidate.content_id for candidate in candidates}))
    global_id_by_index = dict(enumerate(candidate_ids))
    observations: list[_LocalObservation] = []
    for prepared_comparison in prepared:
        low_id = global_id_by_index[prepared_comparison.low_index]
        high_id = global_id_by_index[prepared_comparison.high_index]
        observations.append(
            _make_projected_observation(
                low_id,
                high_id,
                prepared_comparison.outcome,
                prepared_comparison.weight,
                active_ids,
                active_index_by_id,
                current_means,
                candidate_ids,
            ),
        )
    return tuple(observations)


def _make_local_observation(
    comparison: Comparison,
    active_ids: Sequence[int],
    active_index_by_id: Mapping[int, int],
    weight: float,
    offsets: Mapping[int, float],
) -> _LocalObservation:
    """创建只有 active A/B 的观测，canonical 化左右方向。"""
    left_id = comparison.left_content_id
    right_id = comparison.right_content_id
    try:
        outcome = ComparisonOutcome(comparison.outcome)
    except (TypeError, ValueError) as exc:
        raise ValueError('comparison outcome 无效') from exc
    if left_id > right_id:
        low_id, high_id = right_id, left_id
        normalized_outcome = (
            ComparisonOutcome.RIGHT_WIN
            if outcome is ComparisonOutcome.LEFT_WIN
            else ComparisonOutcome.LEFT_WIN
            if outcome is ComparisonOutcome.RIGHT_WIN
            else ComparisonOutcome.TIE
        )
    else:
        low_id, high_id, normalized_outcome = left_id, right_id, outcome
    target = {
        ComparisonOutcome.LEFT_WIN: 0,
        ComparisonOutcome.RIGHT_WIN: 1,
        ComparisonOutcome.TIE: 2,
    }[normalized_outcome]
    dimension = len(active_ids)
    low_feature = np.zeros(dimension, dtype=float)
    high_feature = np.zeros(dimension, dtype=float)
    low_feature[active_index_by_id[low_id]] = 1.0
    high_feature[active_index_by_id[high_id]] = 1.0
    return _LocalObservation(
        low_feature=low_feature,
        high_feature=high_feature,
        low_offset=float(offsets.get(low_id, 0.0)),
        high_offset=float(offsets.get(high_id, 0.0)),
        outcome=target,
        weight=weight,
    )


def _make_projected_observation(
    low_id: int,
    high_id: int,
    outcome: int,
    weight: float,
    active_ids: Sequence[int],
    active_index_by_id: Mapping[int, int],
    current_means: np.ndarray,
    candidate_ids: Sequence[int],
) -> _LocalObservation:
    """为局部 MAP 创建包含 active / fixed 外部值的观测。"""
    dimension = len(active_ids)
    low_feature = np.zeros(dimension, dtype=float)
    high_feature = np.zeros(dimension, dtype=float)
    low_offset = 0.0
    high_offset = 0.0
    global_index_by_id = {content_id: index for index, content_id in enumerate(candidate_ids)}
    if low_id in active_index_by_id:
        low_feature[active_index_by_id[low_id]] = 1.0
    else:
        low_offset = float(current_means[global_index_by_id[low_id]])
    if high_id in active_index_by_id:
        high_feature[active_index_by_id[high_id]] = 1.0
    else:
        high_offset = float(current_means[global_index_by_id[high_id]])
    return _LocalObservation(
        low_feature=low_feature,
        high_feature=high_feature,
        low_offset=low_offset,
        high_offset=high_offset,
        outcome=outcome,
        weight=weight,
    )


def _fit_local(
    prior_mean: np.ndarray,
    prior_precision: np.ndarray,
    observations: Sequence[_LocalObservation],
    initial: np.ndarray,
    tie_strength: float,
    *,
    max_iterations: int,
    optimizer_tolerance: float,
    step_tolerance: float,
    line_search_min_step: float,
    armijo_coefficient: float,
    backtracking_factor: float,
) -> _LocalFit:
    """对任意 active set 做小规模 Davidson MAP / Laplace 拟合。"""
    theta = initial.copy()
    final_hessian = np.diag(prior_precision)
    iterations = 0
    for iteration in range(1, max_iterations + 1):
        objective, gradient, hessian = _local_objective_gradient_hessian(
            theta,
            prior_mean,
            prior_precision,
            observations,
            tie_strength,
        )
        final_hessian = hessian
        iterations = iteration
        if float(np.linalg.norm(gradient, ord=np.inf)) <= optimizer_tolerance:
            break
        try:
            step = np.linalg.solve(hessian, gradient)
        except np.linalg.LinAlgError:
            step = np.linalg.solve(hessian + 1e-8 * np.eye(len(theta)), gradient)
        directional_derivative = float(np.dot(gradient, step))
        if not math.isfinite(directional_derivative) or directional_derivative <= 0:
            step = gradient.copy()
            directional_derivative = float(np.dot(gradient, step))
        step_size = 1.0
        accepted = False
        while step_size >= line_search_min_step:
            candidate = theta - step_size * step
            candidate_objective, _, _ = _local_objective_gradient_hessian(
                candidate,
                prior_mean,
                prior_precision,
                observations,
                tie_strength,
                with_hessian=False,
            )
            if candidate_objective <= objective - armijo_coefficient * step_size * directional_derivative:
                theta = candidate
                accepted = True
                break
            step_size *= backtracking_factor
        if not accepted:
            break
        if float(np.linalg.norm(step_size * step, ord=np.inf)) <= step_tolerance * (
            1.0 + float(np.linalg.norm(theta, ord=np.inf))
        ):
            break
    _, _, final_hessian = _local_objective_gradient_hessian(
        theta,
        prior_mean,
        prior_precision,
        observations,
        tie_strength,
    )
    symmetric_hessian = (final_hessian + final_hessian.T) / 2.0
    try:
        covariance = np.linalg.inv(symmetric_hessian)
    except np.linalg.LinAlgError:
        covariance = np.linalg.inv(symmetric_hessian + 1e-8 * np.eye(len(theta)))
    covariance = (covariance + covariance.T) / 2.0
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    covariance = (eigenvectors * np.maximum(eigenvalues, 1e-10)) @ eigenvectors.T
    return _LocalFit(mean=theta, covariance=(covariance + covariance.T) / 2.0, iterations=iterations)


def _local_objective_gradient_hessian(
    theta: np.ndarray,
    prior_mean: np.ndarray,
    prior_precision: np.ndarray,
    observations: Sequence[_LocalObservation],
    tie_strength: float,
    *,
    with_hessian: bool = True,
) -> tuple[float, np.ndarray, np.ndarray]:
    """计算带 fixed 外部 latent value 的 Davidson 负 log posterior。"""
    gradient = prior_precision * (theta - prior_mean)
    hessian = np.diag(prior_precision) if with_hessian else np.diag(prior_precision)
    objective = 0.5 * float(np.sum(prior_precision * (theta - prior_mean) ** 2))
    tie_log_strength = math.log(tie_strength)
    for observation in observations:
        low_value = float(np.dot(observation.low_feature, theta) + observation.low_offset)
        high_value = float(np.dot(observation.high_feature, theta) + observation.high_offset)
        logits = np.array(
            [low_value, high_value, (low_value + high_value) / 2 + tie_log_strength],
            dtype=float,
        )
        maximum = float(np.max(logits))
        exponentials = np.exp(logits - maximum)
        probabilities = exponentials / float(np.sum(exponentials))
        log_normalizer = maximum + math.log(float(np.sum(exponentials)))
        objective -= observation.weight * (float(logits[observation.outcome]) - log_normalizer)
        low_tangent = observation.low_feature
        high_tangent = observation.high_feature
        tie_tangent = (low_tangent + high_tangent) / 2.0
        tangents = (low_tangent, high_tangent, tie_tangent)
        expected = sum(
            (float(probabilities[index]) * tangent for index, tangent in enumerate(tangents)),
            start=np.zeros_like(theta),
        )
        targets = tangents[observation.outcome]
        gradient -= observation.weight * (targets - expected)
        if with_hessian:
            second = sum(
                (
                    float(probabilities[index]) * np.outer(tangent, tangent)
                    for index, tangent in enumerate(tangents)
                ),
                start=np.zeros((len(theta), len(theta)), dtype=float),
            )
            hessian += observation.weight * (second - np.outer(expected, expected))
    if not np.all(np.isfinite(gradient)) or not math.isfinite(objective):
        raise FloatingPointError('Fast posterior 产生非有限值')
    return _finite(objective), gradient, hessian


def _fit_warm_start(
    initial: np.ndarray,
    prior_mean: np.ndarray,
    prior_precision: np.ndarray,
    comparisons: Sequence[_PreparedComparison],
    ranker_config: RankerConfig,
    max_iterations: int,
    *,
    optimizer_tolerance: float,
    step_tolerance: float,
    line_search_min_step: float,
    armijo_coefficient: float,
    backtracking_factor: float,
) -> tuple[np.ndarray, int]:
    """使用 Ranker 同一目标函数的 warm-start Newton。"""
    theta = initial.copy()
    iterations = 0
    for iteration in range(1, max_iterations + 1):
        objective, gradient, hessian = _objective_gradient_hessian(
            theta,
            prior_mean,
            prior_precision,
            comparisons,
            ranker_config.tie_strength,
        )
        assert hessian is not None
        iterations = iteration
        if float(np.linalg.norm(gradient, ord=np.inf)) <= optimizer_tolerance:
            break
        try:
            step = np.linalg.solve(hessian, gradient)
        except np.linalg.LinAlgError:
            step = np.linalg.solve(hessian + ranker_config.covariance_jitter * np.eye(len(theta)), gradient)
        directional_derivative = float(np.dot(gradient, step))
        if not math.isfinite(directional_derivative) or directional_derivative <= 0:
            step = gradient.copy()
            directional_derivative = float(np.dot(gradient, step))
        step_size = 1.0
        accepted = False
        while step_size >= line_search_min_step:
            candidate = theta - step_size * step
            candidate_objective, _, _ = _objective_gradient_hessian(
                candidate,
                prior_mean,
                prior_precision,
                comparisons,
                ranker_config.tie_strength,
                with_hessian=False,
            )
            if candidate_objective <= objective - armijo_coefficient * step_size * directional_derivative:
                theta = candidate
                accepted = True
                break
            step_size *= backtracking_factor
        if not accepted:
            break
        if float(np.linalg.norm(step_size * step, ord=np.inf)) <= step_tolerance * (
            1.0 + float(np.linalg.norm(theta, ord=np.inf))
        ):
            break
    return theta, iterations


def _means_by_candidate(state: FastPreferenceState) -> np.ndarray:
    """按 state.candidates 顺序取得当前 Fast mean。"""
    result_by_id = {result.content_id: result for result in state.fast_results}
    return np.array([result_by_id[candidate.content_id].preference_mean for candidate in state.candidates], dtype=float)


def _stds_by_candidate(state: FastPreferenceState) -> np.ndarray:
    """按 state.candidates 顺序取得当前可用标准差。"""
    result_by_id = {result.content_id: result for result in state.fast_results}
    authoritative_by_id = {result.content_id: result for result in state.authoritative_results}
    return np.array(
        [
            max(
                result_by_id[candidate.content_id].preference_std
                or authoritative_by_id[candidate.content_id].preference_std,
                1e-5,
            )
            for candidate in state.candidates
        ],
        dtype=float,
    )


def _finite(value: float, fallback: float = 0.0) -> float:
    """将实验诊断和输出限制为有限浮点数。"""
    return float(value) if math.isfinite(float(value)) else fallback


__all__ = [
    'FastAccuracyMetrics',
    'FastPathEvent',
    'FastPreferenceResult',
    'FastPreferenceState',
    'FastUpdateConfig',
    'FastUpdateDiagnostics',
    'FastUpdateOutput',
    'FastUpdateStrategy',
    'compare_fast_with_full',
    'create_fast_preference_state',
    'fast_update_preference',
    'requires_full_ranker',
    'to_selector_candidates',
]
