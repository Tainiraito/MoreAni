"""纯偏好 Ranker。

本模块只处理候选作品、用户独立评分锚点和有效 pairwise comparison，
不依赖 SQLAlchemy，不执行数据库查询，也不负责保存任何结果。

V1 使用带平局的 Davidson likelihood、Gaussian prior、MAP Newton 优化和
Laplace approximation。后验采样使用完整的 latent covariance，而不是将
每部作品当作相互独立的正态变量。
"""

from __future__ import annotations

import json
import math
import time
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import datetime
from enum import StrEnum
from statistics import NormalDist
from typing import cast

import numpy as np

from services.red_blue_math import (
    DEFAULT_TIE_STRENGTH,
    PairwiseProbability,
    pairwise_probability,
    validate_tie_strength,
)


class ComparisonOutcome(StrEnum):
    """Ranker 接受的 comparison 结果。"""

    LEFT_WIN = 'LEFT_WIN'
    RIGHT_WIN = 'RIGHT_WIN'
    TIE = 'TIE'
    SKIP = 'SKIP'


class RankerStability(StrEnum):
    """单个候选作品的排名稳定性。"""

    UNCALIBRATED = 'UNCALIBRATED'
    CALIBRATING = 'CALIBRATING'
    RELATIVELY_STABLE = 'RELATIVELY_STABLE'
    STABLE = 'STABLE'
    ORDER_UNCERTAIN = 'ORDER_UNCERTAIN'


@dataclass(frozen=True, slots=True)
class Candidate:
    """Ranker 已经由上游筛选好的候选作品。"""

    content_id: int


@dataclass(frozen=True, slots=True)
class ScoreAnchor:
    """用户独立表达的评分锚点；不能传入 Rating.score。"""

    content_id: int
    score: int


@dataclass(frozen=True, slots=True)
class Comparison:
    """一条保留左右方向的历史 comparison。"""

    id: int
    left_content_id: int
    right_content_id: int
    outcome: ComparisonOutcome | str
    revoked: bool = False
    revoked_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class ScorePrior:
    """一部作品的 Gaussian prior 参数。"""

    mean: float
    precision: float
    percentile: float | None
    anchor_count: int


@dataclass(frozen=True, slots=True)
class RankerConfig:
    """所有影响 Ranker 的参数，能够直接序列化到 algorithm_config_json。"""

    algorithm_version: str = 'ranker-v1'

    # Score Anchor prior
    score_prior_strength: float = 0.65
    score_prior_scale: float = 1.50
    score_percentile_clip: float = 0.02
    score_prior_shrinkage: float = 6.0
    baseline_prior_precision: float = 0.05

    # Davidson tie likelihood
    tie_strength: float = DEFAULT_TIE_STRENGTH

    # Repeated unordered pair evidence
    repeat_pair_exponent: float = 0.50
    repeat_pair_weight_cap: float = 8.0

    # MAP and Laplace
    optimizer_tolerance: float = 1e-7
    optimizer_step_tolerance: float = 1e-8
    optimizer_max_iterations: int = 80
    optimizer_line_search_min_step: float = 1e-6
    optimizer_armijo_coefficient: float = 1e-4
    optimizer_backtracking_factor: float = 0.5
    covariance_jitter: float = 1e-8
    covariance_eigenvalue_floor: float = 1e-10

    # Posterior rank distribution
    posterior_sample_count: int = 512
    rank_interval_probability: float = 0.80
    random_seed: int | None = 0

    # Stability thresholds
    uncalibrated_max_comparisons: int = 0
    relatively_stable_min_comparisons: int = 3
    relatively_stable_max_interval_width: int = 6
    stable_min_comparisons: int = 8
    stable_max_interval_width: int = 2
    order_uncertain_min_comparisons: int = 2
    order_uncertain_pairwise_confidence: float = 0.60
    order_uncertain_tie_probability: float = 0.25
    order_uncertain_neighbor_rank_distance: float = 2.0

    def __post_init__(self) -> None:
        """拒绝会导致数值异常或不可解释状态的配置。"""
        if not self.algorithm_version.strip():
            raise ValueError('algorithm_version 不能为空')
        if self.score_prior_strength < 0:
            raise ValueError('score_prior_strength 不能为负数')
        if self.score_prior_scale <= 0:
            raise ValueError('score_prior_scale 必须大于 0')
        if not 0 < self.score_percentile_clip < 0.5:
            raise ValueError('score_percentile_clip 必须位于 (0, 0.5)')
        if self.score_prior_shrinkage < 0:
            raise ValueError('score_prior_shrinkage 不能为负数')
        if self.baseline_prior_precision <= 0:
            raise ValueError('baseline_prior_precision 必须大于 0')
        validate_tie_strength(self.tie_strength)
        if not 0 < self.repeat_pair_exponent <= 1:
            raise ValueError('repeat_pair_exponent 必须位于 (0, 1]')
        if self.repeat_pair_weight_cap < 1:
            raise ValueError('repeat_pair_weight_cap 必须至少为 1')
        if self.optimizer_tolerance <= 0 or self.optimizer_step_tolerance <= 0:
            raise ValueError('optimizer tolerance 必须大于 0')
        if self.optimizer_max_iterations < 1:
            raise ValueError('optimizer_max_iterations 必须至少为 1')
        if not 0 < self.optimizer_line_search_min_step < 1:
            raise ValueError('optimizer_line_search_min_step 必须位于 (0, 1)')
        if not 0 < self.optimizer_armijo_coefficient < 1:
            raise ValueError('optimizer_armijo_coefficient 必须位于 (0, 1)')
        if not 0 < self.optimizer_backtracking_factor < 1:
            raise ValueError('optimizer_backtracking_factor 必须位于 (0, 1)')
        if self.covariance_jitter < 0 or self.covariance_eigenvalue_floor <= 0:
            raise ValueError('covariance 数值参数无效')
        if self.posterior_sample_count < 1:
            raise ValueError('posterior_sample_count 必须至少为 1')
        if not 0 < self.rank_interval_probability < 1:
            raise ValueError('rank_interval_probability 必须位于 (0, 1)')
        if self.uncalibrated_max_comparisons < 0:
            raise ValueError('uncalibrated_max_comparisons 不能为负数')
        if self.relatively_stable_min_comparisons < 1:
            raise ValueError('relatively_stable_min_comparisons 必须至少为 1')
        if self.stable_min_comparisons < self.relatively_stable_min_comparisons:
            raise ValueError('stable_min_comparisons 不能小于 relatively_stable_min_comparisons')
        if self.relatively_stable_max_interval_width < 0 or self.stable_max_interval_width < 0:
            raise ValueError('稳定性区间宽度不能为负数')
        if self.order_uncertain_min_comparisons < 1:
            raise ValueError('order_uncertain_min_comparisons 必须至少为 1')
        if not 0.5 <= self.order_uncertain_pairwise_confidence <= 1:
            raise ValueError('order_uncertain_pairwise_confidence 必须位于 [0.5, 1]')
        if not 0 <= self.order_uncertain_tie_probability <= 1:
            raise ValueError('order_uncertain_tie_probability 必须位于 [0, 1]')
        if self.order_uncertain_neighbor_rank_distance < 0:
            raise ValueError('order_uncertain_neighbor_rank_distance 不能为负数')

    def to_dict(self) -> dict[str, object]:
        """返回可写入 JSON 的配置字典。"""
        return cast(dict[str, object], asdict(self))

    def to_json(self) -> str:
        """以稳定键顺序序列化配置。"""
        return json.dumps(self.to_dict(), ensure_ascii=False, sort_keys=True, separators=(',', ':'))

    @classmethod
    def from_json(cls, payload: str) -> RankerConfig:
        """从 algorithm_config_json 恢复配置。"""
        decoded = json.loads(payload)
        if not isinstance(decoded, dict):
            raise ValueError('algorithm_config_json 必须是 JSON object')
        return cls(**cast(dict[str, object], decoded))


@dataclass(frozen=True, slots=True)
class PreferenceResult:
    """Ranker 输出的单部作品结果，对应未来的 preference_results 派生字段。"""

    content_id: int
    preference_mean: float
    preference_std: float
    expected_rank: float
    rank_low: int
    rank_high: int
    stability: RankerStability
    comparison_count: int


@dataclass(frozen=True, slots=True)
class RankerDiagnostics:
    """可解释的优化、输入过滤和性能诊断。"""

    candidate_count: int
    valid_comparison_count: int
    ignored_comparison_count: int
    effective_pair_count: int
    repeated_pair_count: int
    effective_total_weight: float
    ignored_comparison_reasons: dict[str, int]
    converged: bool
    optimizer_iterations: int
    optimizer_objective: float
    gradient_norm: float
    hessian_condition_number: float
    covariance_jitter: float
    fallback_reason: str | None
    map_seconds: float
    covariance_seconds: float
    posterior_sampling_seconds: float
    total_seconds: float


@dataclass(frozen=True, slots=True)
class RankerOutput:
    """纯算法输出。"""

    results: tuple[PreferenceResult, ...]
    diagnostics: RankerDiagnostics


@dataclass(frozen=True, slots=True)
class _PreparedComparison:
    low_index: int
    high_index: int
    outcome: int
    weight: float


@dataclass(frozen=True, slots=True)
class _FitResult:
    mean: np.ndarray
    covariance: np.ndarray
    converged: bool
    iterations: int
    objective: float
    gradient_norm: float
    condition_number: float
    covariance_jitter: float
    fallback_reason: str | None


def _finite(value: float, fallback: float = 0.0) -> float:
    """将诊断和输出中的非有限浮点数转换为有限值。"""
    return float(value) if math.isfinite(float(value)) else fallback


def _normal_quantile(probability: float) -> float:
    """使用 Python 标准库计算有限正态 quantile。"""
    return _finite(NormalDist().inv_cdf(probability))


def build_score_priors(
    candidates: Sequence[Candidate],
    score_anchors: Sequence[ScoreAnchor],
    config: RankerConfig | None = None,
) -> dict[int, ScorePrior]:
    """将用户评分经验分布转换为每部候选作品的弱 Gaussian prior。

    经验 percentile 使用 score level 的 mid-rank：同一评分的作品共享完全
    相同的 percentile，不依赖数据库返回顺序。评分为 0 的 anchor 表示没有
    有效评分信号，不参与经验分布。
    """
    active_config = config or RankerConfig()
    candidate_ids = sorted({candidate.content_id for candidate in candidates})
    anchor_values: dict[int, list[int]] = {}
    for anchor in score_anchors:
        if 0 <= anchor.score <= 100:
            anchor_values.setdefault(anchor.content_id, []).append(anchor.score)

    representative_scores = {
        content_id: float(np.median(values))
        for content_id, values in anchor_values.items()
        if any(score > 0 for score in values)
    }
    positive_scores = sorted(score for score in representative_scores.values() if score > 0)
    sample_count = len(positive_scores)
    prior_by_id: dict[int, ScorePrior] = {}

    for content_id in candidate_ids:
        score = representative_scores.get(content_id)
        if score is None or score <= 0 or sample_count == 0:
            prior_by_id[content_id] = ScorePrior(
                mean=0.0,
                precision=active_config.baseline_prior_precision,
                percentile=None,
                anchor_count=0,
            )
            continue

        less_count = sum(value < score for value in positive_scores)
        equal_count = sum(value == score for value in positive_scores)
        percentile = (less_count + 0.5 * equal_count) / sample_count
        clipped = min(
            1.0 - active_config.score_percentile_clip,
            max(active_config.score_percentile_clip, percentile),
        )
        effective_strength = active_config.score_prior_strength * (
            sample_count / (sample_count + active_config.score_prior_shrinkage)
            if sample_count + active_config.score_prior_shrinkage > 0
            else 1.0
        )
        prior_mean = active_config.score_prior_scale * _normal_quantile(clipped)
        prior_precision = active_config.baseline_prior_precision + (
            effective_strength / (active_config.score_prior_scale**2)
        )
        prior_by_id[content_id] = ScorePrior(
            mean=_finite(prior_mean),
            precision=_finite(prior_precision, active_config.baseline_prior_precision),
            percentile=_finite(percentile, 0.5),
            anchor_count=1,
        )
    return prior_by_id


def _prepare_comparisons(
    candidates: Sequence[Candidate],
    comparisons: Sequence[Comparison],
    config: RankerConfig,
) -> tuple[list[_PreparedComparison], dict[int, int], dict[str, int], int, int, float]:
    """过滤输入、按 unordered pair 聚合并分配边际递减总权重。"""
    candidate_ids = sorted({candidate.content_id for candidate in candidates})
    index_by_id = {content_id: index for index, content_id in enumerate(candidate_ids)}
    raw_by_pair: dict[tuple[int, int], list[tuple[int, int]]] = {}
    comparison_counts = dict.fromkeys(candidate_ids, 0)
    ignored: dict[str, int] = {}

    def ignore(reason: str) -> None:
        ignored[reason] = ignored.get(reason, 0) + 1

    accepted: list[tuple[int, int, int, int]] = []
    for comparison in comparisons:
        if comparison.revoked or comparison.revoked_at is not None:
            ignore('revoked')
            continue
        if comparison.left_content_id == comparison.right_content_id:
            ignore('same_content')
            continue
        try:
            outcome = ComparisonOutcome(comparison.outcome)
        except (TypeError, ValueError):
            ignore('invalid_outcome')
            continue
        if outcome is ComparisonOutcome.SKIP:
            ignore('skip')
            continue
        if comparison.left_content_id not in index_by_id or comparison.right_content_id not in index_by_id:
            ignore('content_not_candidate')
            continue

        left_index = index_by_id[comparison.left_content_id]
        right_index = index_by_id[comparison.right_content_id]
        if left_index < right_index:
            low_index, high_index = left_index, right_index
            normalized_outcome = outcome
        else:
            low_index, high_index = right_index, left_index
            normalized_outcome = (
                ComparisonOutcome.RIGHT_WIN
                if outcome is ComparisonOutcome.LEFT_WIN
                else ComparisonOutcome.LEFT_WIN
                if outcome is ComparisonOutcome.RIGHT_WIN
                else ComparisonOutcome.TIE
            )
        outcome_index = {
            ComparisonOutcome.LEFT_WIN: 0,
            ComparisonOutcome.RIGHT_WIN: 1,
            ComparisonOutcome.TIE: 2,
        }[normalized_outcome]
        accepted.append((comparison.id, low_index, high_index, outcome_index))

    # 统一排序保证数据库返回顺序和浮点累加顺序都不会影响结果。
    accepted.sort(key=lambda item: item)
    for _, low_index, high_index, outcome_index in accepted:
        pair = (low_index, high_index)
        raw_by_pair.setdefault(pair, []).append((outcome_index, 1))
        comparison_counts[candidate_ids[low_index]] += 1
        comparison_counts[candidate_ids[high_index]] += 1

    prepared: list[_PreparedComparison] = []
    effective_total_weight = 0.0
    for (low_index, high_index), observations in sorted(raw_by_pair.items()):
        count = len(observations)
        effective_total = min(
            config.repeat_pair_weight_cap,
            max(1.0, count**config.repeat_pair_exponent),
        )
        per_observation_weight = effective_total / count
        effective_total_weight += effective_total
        for outcome_index, _ in observations:
            prepared.append(
                _PreparedComparison(
                    low_index=low_index,
                    high_index=high_index,
                    outcome=outcome_index,
                    weight=per_observation_weight,
                ),
            )

    repeated_pair_count = sum(len(observations) > 1 for observations in raw_by_pair.values())
    return (
        prepared,
        comparison_counts,
        ignored,
        len(raw_by_pair),
        repeated_pair_count,
        effective_total_weight,
    )


def _objective_gradient_hessian(
    theta: np.ndarray,
    prior_mean: np.ndarray,
    prior_precision: np.ndarray,
    comparisons: Sequence[_PreparedComparison],
    tie_strength: float,
    with_hessian: bool = True,
) -> tuple[float, np.ndarray, np.ndarray | None]:
    """计算负 log posterior、梯度和 Hessian。"""
    gradient = prior_precision * (theta - prior_mean)
    hessian = np.diag(prior_precision) if with_hessian else None
    negative_log_posterior = 0.5 * float(np.sum(prior_precision * (theta - prior_mean) ** 2))
    tie_log_strength = math.log(tie_strength)

    for comparison in comparisons:
        low = comparison.low_index
        high = comparison.high_index
        low_value = float(theta[low])
        high_value = float(theta[high])
        logits = np.array(
            [low_value, high_value, (low_value + high_value) / 2 + tie_log_strength],
            dtype=float,
        )
        maximum = float(np.max(logits))
        exponentials = np.exp(logits - maximum)
        probability = exponentials / float(np.sum(exponentials))
        log_normalizer = maximum + math.log(float(np.sum(exponentials)))
        target_logit = float(logits[comparison.outcome])
        weight = comparison.weight
        negative_log_posterior -= weight * (target_logit - log_normalizer)

        expected_low = float(probability[0] + 0.5 * probability[2])
        expected_high = float(probability[1] + 0.5 * probability[2])
        target_low, target_high = {
            0: (1.0, 0.0),
            1: (0.0, 1.0),
            2: (0.5, 0.5),
        }[comparison.outcome]
        gradient[low] -= weight * (target_low - expected_low)
        gradient[high] -= weight * (target_high - expected_high)

        if hessian is not None:
            expected_low_square = float(probability[0] + 0.25 * probability[2])
            expected_high_square = float(probability[1] + 0.25 * probability[2])
            expected_product = float(0.25 * probability[2])
            covariance_low_low = expected_low_square - expected_low**2
            covariance_high_high = expected_high_square - expected_high**2
            covariance_low_high = expected_product - expected_low * expected_high
            hessian[low, low] += weight * covariance_low_low
            hessian[high, high] += weight * covariance_high_high
            hessian[low, high] += weight * covariance_low_high
            hessian[high, low] += weight * covariance_low_high

    if not np.all(np.isfinite(gradient)) or not math.isfinite(negative_log_posterior):
        raise FloatingPointError('posterior 计算产生非有限值')
    if hessian is not None and not np.all(np.isfinite(hessian)):
        raise FloatingPointError('Hessian 计算产生非有限值')
    return _finite(negative_log_posterior), gradient, hessian


def _fit_map(
    prior_mean: np.ndarray,
    prior_precision: np.ndarray,
    comparisons: Sequence[_PreparedComparison],
    config: RankerConfig,
) -> _FitResult:
    """使用带回溯线搜索的 Newton 方法求 MAP。"""
    dimension = prior_mean.shape[0]
    theta = prior_mean.copy()
    converged = False
    iterations = 0
    fallback_reason: str | None = None
    last_jitter = 0.0

    try:
        for iteration in range(1, config.optimizer_max_iterations + 1):
            objective, gradient, hessian = _objective_gradient_hessian(
                theta,
                prior_mean,
                prior_precision,
                comparisons,
                config.tie_strength,
            )
            assert hessian is not None
            gradient_norm = float(np.linalg.norm(gradient, ord=np.inf))
            iterations = iteration
            if gradient_norm <= config.optimizer_tolerance:
                converged = True
                break

            jitter = 0.0
            try:
                step = np.linalg.solve(hessian, gradient)
            except np.linalg.LinAlgError:
                jitter = config.covariance_jitter
                step = np.linalg.solve(hessian + jitter * np.eye(dimension), gradient)
            last_jitter = max(last_jitter, jitter)
            directional_derivative = float(np.dot(gradient, step))
            if not math.isfinite(directional_derivative) or directional_derivative <= 0:
                step = gradient.copy()
                directional_derivative = float(np.dot(gradient, step))

            step_size = 1.0
            accepted = False
            while step_size >= config.optimizer_line_search_min_step:
                candidate = theta - step_size * step
                candidate_objective, _, _ = _objective_gradient_hessian(
                    candidate,
                    prior_mean,
                    prior_precision,
                    comparisons,
                    config.tie_strength,
                    with_hessian=False,
                )
                if candidate_objective <= objective - (
                    config.optimizer_armijo_coefficient
                    * step_size
                    * directional_derivative
                ):
                    theta = candidate
                    accepted = True
                    break
                step_size *= config.optimizer_backtracking_factor
            if not accepted:
                fallback_reason = 'line_search_failed'
                break
            if float(np.linalg.norm(step_size * step, ord=np.inf)) <= config.optimizer_step_tolerance * (
                1.0 + float(np.linalg.norm(theta, ord=np.inf))
            ):
                converged = True
                break
        final_objective, final_gradient, final_hessian = _objective_gradient_hessian(
            theta,
            prior_mean,
            prior_precision,
            comparisons,
            config.tie_strength,
        )
        assert final_hessian is not None
        condition_number = _finite(float(np.linalg.cond(final_hessian)), 1e12)
        return _FitResult(
            mean=theta,
            covariance=final_hessian,
            converged=converged,
            iterations=iterations,
            objective=final_objective,
            gradient_norm=_finite(float(np.linalg.norm(final_gradient, ord=np.inf)), 1e12),
            condition_number=min(condition_number, 1e12),
            covariance_jitter=last_jitter,
            fallback_reason=fallback_reason,
        )
    except (FloatingPointError, np.linalg.LinAlgError, ValueError) as exc:
        # Gaussian baseline prior 保证正常输入不会走到这里；异常时返回可诊断
        # 的稳定退化结果，而不是把 NaN 传播给页面或数据库。
        fallback_reason = f'numeric_fallback:{type(exc).__name__}'
        fallback_hessian = np.diag(prior_precision)
        return _FitResult(
            mean=prior_mean.copy(),
            covariance=fallback_hessian,
            converged=False,
            iterations=iterations,
            objective=_finite(0.5 * float(np.sum(prior_precision * prior_mean**2))),
            gradient_norm=0.0,
            condition_number=1.0,
            covariance_jitter=0.0,
            fallback_reason=fallback_reason,
        )


def _laplace_covariance(
    hessian: np.ndarray,
    config: RankerConfig,
) -> tuple[np.ndarray, float, float]:
    """从负 log posterior Hessian 得到有限、对称、半正定 covariance。"""
    dimension = hessian.shape[0]
    symmetric_hessian = (hessian + hessian.T) / 2.0
    jitter = 0.0
    try:
        covariance = np.linalg.inv(symmetric_hessian)
    except np.linalg.LinAlgError:
        jitter = config.covariance_jitter
        covariance = np.linalg.inv(symmetric_hessian + jitter * np.eye(dimension))

    covariance = (covariance + covariance.T) / 2.0
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    clipped_eigenvalues = np.maximum(eigenvalues, config.covariance_eigenvalue_floor)
    covariance = (eigenvectors * clipped_eigenvalues) @ eigenvectors.T
    covariance = (covariance + covariance.T) / 2.0
    condition_number = _finite(float(np.linalg.cond(symmetric_hessian)), 1e12)
    if not np.all(np.isfinite(covariance)):
        raise FloatingPointError('covariance 产生非有限值')
    return covariance, jitter, min(condition_number, 1e12)


def _sample_rank_distribution(
    mean: np.ndarray,
    covariance: np.ndarray,
    config: RankerConfig,
) -> tuple[np.ndarray, float]:
    """保留完整 covariance 地从 Multivariate Normal 采样排名。"""
    dimension = mean.shape[0]
    eigenvalues, eigenvectors = np.linalg.eigh((covariance + covariance.T) / 2.0)
    eigenvalues = np.maximum(eigenvalues, config.covariance_eigenvalue_floor)
    factor = eigenvectors * np.sqrt(eigenvalues)
    rng = np.random.default_rng(config.random_seed)
    standard_samples = rng.standard_normal((config.posterior_sample_count, dimension))
    samples = mean + standard_samples @ factor.T
    orders = np.argsort(-samples, axis=1, kind='stable')
    ranks = np.empty_like(orders, dtype=float)
    rank_values = np.arange(1, dimension + 1, dtype=float)
    np.put_along_axis(ranks, orders, rank_values[None, :], axis=1)
    return ranks, _finite(float(np.max(np.abs(samples))), 0.0)


def _ambiguous_candidates(
    mean: np.ndarray,
    expected_rank: np.ndarray,
    rank_low: np.ndarray,
    rank_high: np.ndarray,
    comparison_counts: Mapping[int, int],
    candidate_ids: Sequence[int],
    config: RankerConfig,
) -> set[int]:
    """找出后验上难以与邻近作品分先后的候选。"""
    ambiguous: set[int] = set()
    for first_index, first_id in enumerate(candidate_ids):
        if comparison_counts[first_id] < config.order_uncertain_min_comparisons:
            continue
        for second_index in range(first_index + 1, len(candidate_ids)):
            second_id = candidate_ids[second_index]
            intervals_overlap = not (
                rank_high[first_index] < rank_low[second_index]
                or rank_high[second_index] < rank_low[first_index]
            )
            rank_neighbors = abs(expected_rank[first_index] - expected_rank[second_index]) <= (
                config.order_uncertain_neighbor_rank_distance
            )
            if not intervals_overlap and not rank_neighbors:
                continue
            probability = pairwise_probability(
                float(mean[first_index]),
                float(mean[second_index]),
                config.tie_strength,
            )
            strongest_direction = max(probability.win_a, probability.win_b)
            if (
                strongest_direction < config.order_uncertain_pairwise_confidence
                or probability.tie >= config.order_uncertain_tie_probability
            ):
                ambiguous.add(first_id)
                ambiguous.add(second_id)
    return ambiguous


def _stability_for(
    content_id: int,
    comparison_count: int,
    interval_width: int,
    ambiguous_ids: set[int],
    config: RankerConfig,
) -> RankerStability:
    """按明确优先级输出稳定性。"""
    if comparison_count <= config.uncalibrated_max_comparisons:
        return RankerStability.UNCALIBRATED
    # ORDER_UNCERTAIN 优先于 STABLE，避免“数据很多但附近仍无法分先后”
    # 被狭窄的整体 rank interval 覆盖。
    if content_id in ambiguous_ids:
        return RankerStability.ORDER_UNCERTAIN
    if (
        comparison_count >= config.stable_min_comparisons
        and interval_width <= config.stable_max_interval_width
    ):
        return RankerStability.STABLE
    if (
        comparison_count >= config.relatively_stable_min_comparisons
        and interval_width <= config.relatively_stable_max_interval_width
    ):
        return RankerStability.RELATIVELY_STABLE
    return RankerStability.CALIBRATING


def rank_preferences(
    candidates: Sequence[Candidate],
    score_anchors: Sequence[ScoreAnchor],
    comparisons: Sequence[Comparison],
    config: RankerConfig | None = None,
) -> RankerOutput:
    """根据候选、Score Anchor 和有效历史 comparison 计算偏好排名。"""
    active_config = config or RankerConfig()
    started_at = time.perf_counter()
    candidate_ids = sorted({candidate.content_id for candidate in candidates})
    if not candidate_ids:
        total_seconds = time.perf_counter() - started_at
        diagnostics = RankerDiagnostics(
            candidate_count=0,
            valid_comparison_count=0,
            ignored_comparison_count=len(comparisons),
            effective_pair_count=0,
            repeated_pair_count=0,
            effective_total_weight=0.0,
            ignored_comparison_reasons={'no_candidates': len(comparisons)} if comparisons else {},
            converged=True,
            optimizer_iterations=0,
            optimizer_objective=0.0,
            gradient_norm=0.0,
            hessian_condition_number=0.0,
            covariance_jitter=0.0,
            fallback_reason=None,
            map_seconds=0.0,
            covariance_seconds=0.0,
            posterior_sampling_seconds=0.0,
            total_seconds=_finite(total_seconds),
        )
        return RankerOutput(results=(), diagnostics=diagnostics)

    priors = build_score_priors(candidates, score_anchors, active_config)
    prepared, comparison_counts_by_id, ignored_reasons, effective_pair_count, repeated_pair_count, effective_weight = (
        _prepare_comparisons(candidates, comparisons, active_config)
    )
    prior_mean = np.array([priors[content_id].mean for content_id in candidate_ids], dtype=float)
    prior_precision = np.array([priors[content_id].precision for content_id in candidate_ids], dtype=float)

    map_started_at = time.perf_counter()
    fit = _fit_map(prior_mean, prior_precision, prepared, active_config)
    map_seconds = time.perf_counter() - map_started_at

    covariance_started_at = time.perf_counter()
    try:
        covariance, covariance_jitter, covariance_condition = _laplace_covariance(
            fit.covariance,
            active_config,
        )
        covariance_fallback_reason = fit.fallback_reason
    except (FloatingPointError, np.linalg.LinAlgError, ValueError) as exc:
        covariance = np.diag(1.0 / prior_precision)
        covariance_jitter = 0.0
        covariance_condition = 1.0
        covariance_fallback_reason = f'covariance_fallback:{type(exc).__name__}'
    covariance_seconds = time.perf_counter() - covariance_started_at

    sampling_started_at = time.perf_counter()
    ranks, _ = _sample_rank_distribution(fit.mean, covariance, active_config)
    posterior_sampling_seconds = time.perf_counter() - sampling_started_at

    expected_rank = np.mean(ranks, axis=0)
    lower_probability = (1.0 - active_config.rank_interval_probability) / 2.0
    upper_probability = 1.0 - lower_probability
    rank_low = np.floor(np.quantile(ranks, lower_probability, axis=0)).astype(int)
    rank_high = np.ceil(np.quantile(ranks, upper_probability, axis=0)).astype(int)
    rank_low = np.clip(rank_low, 1, len(candidate_ids))
    rank_high = np.clip(rank_high, 1, len(candidate_ids))
    rank_low = np.minimum(rank_low, rank_high)
    ambiguous_ids = _ambiguous_candidates(
        fit.mean,
        expected_rank,
        rank_low,
        rank_high,
        comparison_counts_by_id,
        candidate_ids,
        active_config,
    )

    results_by_id: dict[int, PreferenceResult] = {}
    for index, content_id in enumerate(candidate_ids):
        interval_width = int(rank_high[index] - rank_low[index])
        results_by_id[content_id] = PreferenceResult(
            content_id=content_id,
            preference_mean=_finite(float(fit.mean[index])),
            preference_std=_finite(float(math.sqrt(max(0.0, covariance[index, index])))),
            expected_rank=_finite(float(expected_rank[index])),
            rank_low=int(rank_low[index]),
            rank_high=int(rank_high[index]),
            stability=_stability_for(
                content_id,
                comparison_counts_by_id[content_id],
                interval_width,
                ambiguous_ids,
                active_config,
            ),
            comparison_count=comparison_counts_by_id[content_id],
        )

    # expected_rank 相同时只用 content_id 作技术层确定性 tie-breaker，
    # 不将其写入 latent model，也不把它解释为产品排序依据。
    ordered_results = tuple(
        sorted(
            results_by_id.values(),
            key=lambda result: (result.expected_rank, result.content_id),
        ),
    )
    total_seconds = time.perf_counter() - started_at
    diagnostics = RankerDiagnostics(
        candidate_count=len(candidate_ids),
        valid_comparison_count=len(prepared),
        ignored_comparison_count=sum(ignored_reasons.values()),
        effective_pair_count=effective_pair_count,
        repeated_pair_count=repeated_pair_count,
        effective_total_weight=_finite(effective_weight),
        ignored_comparison_reasons=dict(sorted(ignored_reasons.items())),
        converged=fit.converged,
        optimizer_iterations=fit.iterations,
        optimizer_objective=_finite(fit.objective),
        gradient_norm=_finite(fit.gradient_norm),
        hessian_condition_number=_finite(covariance_condition, 1e12),
        covariance_jitter=_finite(max(fit.covariance_jitter, covariance_jitter)),
        fallback_reason=covariance_fallback_reason,
        map_seconds=_finite(map_seconds),
        covariance_seconds=_finite(covariance_seconds),
        posterior_sampling_seconds=_finite(posterior_sampling_seconds),
        total_seconds=_finite(total_seconds),
    )
    return RankerOutput(results=ordered_results, diagnostics=diagnostics)


__all__ = [
    'Candidate',
    'Comparison',
    'ComparisonOutcome',
    'PairwiseProbability',
    'PreferenceResult',
    'RankerConfig',
    'RankerDiagnostics',
    'RankerOutput',
    'RankerStability',
    'ScoreAnchor',
    'ScorePrior',
    'build_score_priors',
    'pairwise_probability',
    'rank_preferences',
]
