"""红蓝合战阶段 3：纯 Pair Selector。

本模块只根据当前排名快照、历史 comparison 和临时 SelectorContext 选择下一组
待比较作品。它不查询或写入数据库，不调用 Rating Service，不修改 Ranker 结果，
也不持久化 Focus 状态。

Selector 使用的是 uncertainty-aware acquisition heuristic，而不是严格的
Expected Information Gain：阶段 2 只向外暴露边际排名和区间，没有提供完整后验
协方差，因此本模块不会声称计算了严格的信息增益。
"""

from __future__ import annotations

import heapq
import json
import math
import random
import time
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from enum import StrEnum
from itertools import combinations
from typing import cast

from services.red_blue_math import (
    DEFAULT_TIE_STRENGTH,
    pairwise_probability,
    validate_tie_strength,
)


class SelectorOutcome(StrEnum):
    """Selector 能识别的 comparison 结果。"""

    LEFT_WIN = 'LEFT_WIN'
    RIGHT_WIN = 'RIGHT_WIN'
    TIE = 'TIE'
    SKIP = 'SKIP'


class SelectionReason(StrEnum):
    """选中 Pair 的内部诊断原因。"""

    UNCERTAIN_PAIR = 'UNCERTAIN_PAIR'
    RANK_BOUNDARY = 'RANK_BOUNDARY'
    UNDEREXPLORED = 'UNDEREXPLORED'
    NEW_CONTENT = 'NEW_CONTENT'
    FOCUS_CONTENT = 'FOCUS_CONTENT'
    EXPLORATION = 'EXPLORATION'
    NORMAL = 'NORMAL'
    COOLDOWN = 'COOLDOWN'
    COOLDOWN_FALLBACK = 'COOLDOWN_FALLBACK'
    INSUFFICIENT_CANDIDATES = 'INSUFFICIENT_CANDIDATES'
    NO_PAIR_AVAILABLE = 'NO_PAIR_AVAILABLE'


@dataclass(frozen=True, slots=True)
class SelectorCandidate:
    """Selector 使用的候选作品和当前 Ranker 快照。"""

    content_id: int
    preference_mean: float | None = None
    preference_std: float | None = None
    expected_rank: float | None = None
    rank_low: int | None = None
    rank_high: int | None = None
    comparison_count: int = 0
    stability: str | None = None
    # 仅作为没有完整 Ranker 结果时的粗粒度 fallback，不是 Rating.score。
    score_anchor: float | None = None


@dataclass(frozen=True, slots=True)
class SelectorComparison:
    """Selector 读取的 comparison 历史，不承担数据库模型职责。"""

    left_content_id: int
    right_content_id: int
    outcome: SelectorOutcome | str
    created_at: datetime | None = None
    revoked: bool = False
    revoked_at: datetime | None = None
    id: int = 0


@dataclass(frozen=True, slots=True)
class SelectorContext:
    """一次选择请求的临时上下文。"""

    focus_content_id: int | None = None
    recently_anchor_changed_content_ids: frozenset[int] = frozenset()
    # 必须由当前 RankerConfig / Model Run 传入；None 仅表示使用共享默认值。
    tie_strength: float | None = None
    # 配置了 seconds cooldown 时必须由上游提供 now，避免 Selector 隐式读取系统时间。
    now: datetime | None = None

    def __post_init__(self) -> None:
        """将可迭代输入规范化为不可变集合。"""
        object.__setattr__(
            self,
            'recently_anchor_changed_content_ids',
            frozenset(self.recently_anchor_changed_content_ids),
        )
        if self.tie_strength is not None:
            validate_tie_strength(self.tie_strength)


@dataclass(frozen=True, slots=True)
class SelectorConfig:
    """Selector 的完整、可序列化配置。"""

    selector_version: str = 'selector-v1'

    # Acquisition components
    exploration_rate: float = 0.12
    uncertainty_weight: float = 1.30
    rank_overlap_weight: float = 1.10
    rank_proximity_weight: float = 0.80
    underexplored_weight: float = 1.00
    new_content_weight: float = 1.20
    graph_connectivity_weight: float = 0.90
    rank_boundary_weight: float = 0.55
    anchor_changed_weight: float = 0.75
    focus_weight: float = 1.00
    focus_probability: float = 0.80

    # Exploration and normalization
    preference_std_scale: float = 1.50
    rank_proximity_scale: float = 5.00
    underexplored_scale: float = 3.00
    rank_boundary_scale: float = 1.50
    exploration_graph_weight: float = 0.50
    exploration_underexplored_weight: float = 0.30
    exploration_distance_weight: float = 0.20

    # Recency, cooldown and exposure
    repeat_pair_penalty: float = 0.90
    skip_pair_penalty: float = 1.40
    content_recency_penalty: float = 0.65
    excessive_repeat_penalty: float = 1.00
    pair_cooldown_count: int = 2
    pair_cooldown_seconds: float | None = None
    skip_cooldown_count: int = 5
    skip_cooldown_seconds: float | None = None
    max_recent_exposure: int = 8
    max_consecutive_content_exposure: int = 2

    # Product guidance
    important_rank_boundaries: tuple[int, ...] = (10,)

    # Adaptive Pair Shortlisting
    exhaustive_candidate_threshold: int = 100
    max_pair_evaluations: int = 6000
    rank_neighbor_window: int = 8
    rank_interval_opponent_count: int = 8
    underexplored_content_count: int = 32
    underexplored_opponent_count: int = 8
    focus_opponent_count: int = 16
    anchor_changed_content_count: int = 16
    cross_component_pair_count: int = 6
    exploration_seed_count: int = 24
    exploration_pair_count: int = 64
    boundary_neighbor_window: int = 6

    # Deterministic test and replay support
    random_seed: int | None = None

    def __post_init__(self) -> None:
        """校验配置并规范化 JSON 反序列化得到的 list。"""
        object.__setattr__(self, 'important_rank_boundaries', tuple(self.important_rank_boundaries))
        if not self.selector_version.strip():
            raise ValueError('selector_version 不能为空')
        if not 0 <= self.exploration_rate <= 1:
            raise ValueError('exploration_rate 必须位于 [0, 1]')
        for field_name in (
            'uncertainty_weight',
            'rank_overlap_weight',
            'rank_proximity_weight',
            'underexplored_weight',
            'new_content_weight',
            'graph_connectivity_weight',
            'rank_boundary_weight',
            'anchor_changed_weight',
            'focus_weight',
            'repeat_pair_penalty',
            'skip_pair_penalty',
            'content_recency_penalty',
            'excessive_repeat_penalty',
            'exploration_graph_weight',
            'exploration_underexplored_weight',
            'exploration_distance_weight',
        ):
            if getattr(self, field_name) < 0:
                raise ValueError(f'{field_name} 不能为负数')
        if not 0 <= self.focus_probability <= 1:
            raise ValueError('focus_probability 必须位于 [0, 1]')
        for field_name in (
            'preference_std_scale',
            'rank_proximity_scale',
            'underexplored_scale',
            'rank_boundary_scale',
        ):
            if getattr(self, field_name) <= 0:
                raise ValueError(f'{field_name} 必须大于 0')
        for field_name in (
            'pair_cooldown_count',
            'skip_cooldown_count',
            'max_recent_exposure',
            'max_consecutive_content_exposure',
            'exhaustive_candidate_threshold',
            'max_pair_evaluations',
            'rank_neighbor_window',
            'rank_interval_opponent_count',
            'underexplored_content_count',
            'underexplored_opponent_count',
            'focus_opponent_count',
            'anchor_changed_content_count',
            'cross_component_pair_count',
            'exploration_seed_count',
            'exploration_pair_count',
            'boundary_neighbor_window',
        ):
            if getattr(self, field_name) < 0:
                raise ValueError(f'{field_name} 不能为负数')
        if self.max_pair_evaluations < 1:
            raise ValueError('max_pair_evaluations 必须至少为 1')
        for field_name in ('pair_cooldown_seconds', 'skip_cooldown_seconds'):
            value = getattr(self, field_name)
            if value is not None and value < 0:
                raise ValueError(f'{field_name} 不能为负数')
        if any(boundary < 1 for boundary in self.important_rank_boundaries):
            raise ValueError('important_rank_boundaries 必须使用正整数')

    def to_dict(self) -> dict[str, object]:
        """返回可写入 JSON 的配置字典。"""
        return cast(dict[str, object], asdict(self))

    def to_json(self) -> str:
        """以稳定键顺序序列化配置。"""
        return json.dumps(self.to_dict(), ensure_ascii=False, sort_keys=True, separators=(',', ':'))

    @classmethod
    def from_json(cls, payload: str) -> SelectorConfig:
        """从配置 JSON 恢复 SelectorConfig。"""
        decoded = json.loads(payload)
        if not isinstance(decoded, dict):
            raise ValueError('selector_config 必须是 JSON object')
        return cls(**cast(dict[str, object], decoded))


@dataclass(frozen=True, slots=True)
class SelectedPair:
    """最终选中的有向展示 Pair。"""

    left_content_id: int
    right_content_id: int
    selection_reason: SelectionReason
    selector_version: str
    debug_score: float
    components: tuple[tuple[str, float], ...]


@dataclass(frozen=True, slots=True)
class SelectorDiagnostics:
    """选择过程的可解释诊断和阶段耗时。"""

    candidate_count: int
    pair_count: int
    eligible_pair_count: int
    valid_comparison_count: int
    ignored_comparison_count: int
    ignored_comparison_reasons: dict[str, int]
    fallback_used: bool
    exploration_used: bool
    focus_requested: bool
    focus_selected: bool
    shortlist_used: bool
    pair_evaluation_count: int
    total_candidate_pair_count: int
    shortlist_source_counts: dict[str, int]
    shortlist_construction_seconds: float
    full_acquisition_scoring_seconds: float
    pair_construction_seconds: float
    score_seconds: float
    selection_seconds: float
    total_seconds: float


@dataclass(frozen=True, slots=True)
class PairSelectionResult:
    """Selector 的完整输出；selected_pair 可以为 None。"""

    selected_pair: SelectedPair | None
    reason: SelectionReason
    diagnostics: SelectorDiagnostics


@dataclass(frozen=True, slots=True)
class _Interaction:
    pair: tuple[int, int]
    outcome: SelectorOutcome
    created_at: datetime | None
    id: int


@dataclass(frozen=True, slots=True)
class _CandidateFeatures:
    content_id: int
    preference_mean: float
    preference_std: float
    expected_rank: float
    rank_low: int
    rank_high: int
    has_rank_interval: bool
    comparison_count: int
    graph_degree: int
    graph_component: int
    stability: str | None


@dataclass(frozen=True, slots=True)
class _PairScore:
    low_content_id: int
    high_content_id: int
    total_score: float
    exploration_score: float
    components: tuple[tuple[str, float], ...]
    pair_cooldown_blocked: bool
    skip_cooldown_blocked: bool
    excessive_exposure: bool
    primary_reason: SelectionReason


@dataclass(frozen=True, slots=True)
class _PairShortlist:
    """Shortlist 及其来源诊断。"""

    pair_keys: tuple[tuple[int, int], ...]
    source_counts: dict[str, int]
    used: bool
    total_candidate_pair_count: int


def _finite(value: float, fallback: float = 0.0) -> float:
    """将算法输入和输出限制为有限浮点数。"""
    return float(value) if math.isfinite(float(value)) else fallback


def _clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    """将归一化 component 限制在闭区间。"""
    return max(lower, min(upper, _finite(value, lower)))


def _pair_key(first_content_id: int, second_content_id: int) -> tuple[int, int]:
    """将有向输入转换成无向 Pair key。"""
    return tuple(sorted((first_content_id, second_content_id)))


def _timestamp(value: datetime | None) -> float:
    """返回稳定的 UTC timestamp；无时间的历史由 id 决定顺序。"""
    if value is None:
        return 0.0
    normalized = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    return _finite(normalized.astimezone(UTC).timestamp())


def _outcome(value: SelectorOutcome | str) -> SelectorOutcome | None:
    """安全解析历史 outcome。"""
    try:
        return SelectorOutcome(value)
    except (TypeError, ValueError):
        return None


def _prepare_history(
    candidate_ids: set[int],
    comparisons: Sequence[SelectorComparison],
) -> tuple[list[_Interaction], dict[str, int]]:
    """过滤历史并按最近优先排序；SKIP 保留为 interaction。"""
    interactions: list[_Interaction] = []
    ignored: dict[str, int] = {}

    def ignore(reason: str) -> None:
        ignored[reason] = ignored.get(reason, 0) + 1

    for comparison in comparisons:
        if comparison.revoked or comparison.revoked_at is not None:
            ignore('revoked')
            continue
        if comparison.left_content_id == comparison.right_content_id:
            ignore('same_content')
            continue
        if comparison.left_content_id not in candidate_ids or comparison.right_content_id not in candidate_ids:
            ignore('content_not_candidate')
            continue
        parsed_outcome = _outcome(comparison.outcome)
        if parsed_outcome is None:
            ignore('invalid_outcome')
            continue
        interactions.append(
            _Interaction(
                pair=_pair_key(comparison.left_content_id, comparison.right_content_id),
                outcome=parsed_outcome,
                created_at=comparison.created_at,
                id=comparison.id,
            ),
        )

    interactions.sort(
        key=lambda item: (
            -_timestamp(item.created_at),
            -item.id,
            item.pair[0],
            item.pair[1],
            item.outcome.value,
        ),
    )
    return interactions, ignored


def _build_graph(
    candidate_ids: Sequence[int],
    interactions: Sequence[_Interaction],
) -> tuple[dict[int, int], dict[int, int]]:
    """构建轻量无向 comparison graph，返回 degree 和 component。"""
    parent = {content_id: content_id for content_id in candidate_ids}
    degree = dict.fromkeys(candidate_ids, 0)

    def find(content_id: int) -> int:
        root = content_id
        while parent[root] != root:
            root = parent[root]
        while parent[content_id] != content_id:
            next_content_id = parent[content_id]
            parent[content_id] = root
            content_id = next_content_id
        return root

    def union(first_content_id: int, second_content_id: int) -> None:
        first_root = find(first_content_id)
        second_root = find(second_content_id)
        if first_root != second_root:
            parent[second_root] = first_root

    seen_edges: set[tuple[int, int]] = set()
    for interaction in interactions:
        if interaction.outcome is SelectorOutcome.SKIP or interaction.pair in seen_edges:
            continue
        seen_edges.add(interaction.pair)
        first_content_id, second_content_id = interaction.pair
        degree[first_content_id] += 1
        degree[second_content_id] += 1
        union(first_content_id, second_content_id)

    components = {content_id: find(content_id) for content_id in candidate_ids}
    return degree, components


def _fallback_ranks(candidates: Sequence[SelectorCandidate]) -> dict[int, float]:
    """在 Ranker 结果不完整时，用 Score Anchor 或输入顺序提供粗 rank。"""
    anchored = [
        candidate
        for candidate in candidates
        if candidate.score_anchor is not None and math.isfinite(float(candidate.score_anchor))
    ]
    if anchored:
        order = sorted(
            candidates,
            key=lambda candidate: (
                -_finite(float(candidate.score_anchor), -math.inf)
                if candidate.score_anchor is not None
                else math.inf,
                candidate.content_id,
            ),
        )
    else:
        order = sorted(candidates, key=lambda candidate: candidate.content_id)
    return {candidate.content_id: float(index + 1) for index, candidate in enumerate(order)}


def _candidate_features(
    candidates: Sequence[SelectorCandidate],
    degree: Mapping[int, int],
    components: Mapping[int, int],
) -> dict[int, _CandidateFeatures]:
    """规范化候选字段，但不重新拟合 Ranker。"""
    fallback_ranks = _fallback_ranks(candidates)
    features: dict[int, _CandidateFeatures] = {}
    for candidate in candidates:
        expected_rank = (
            _finite(float(candidate.expected_rank), fallback_ranks[candidate.content_id])
            if candidate.expected_rank is not None
            else fallback_ranks[candidate.content_id]
        )
        has_rank_interval = candidate.rank_low is not None and candidate.rank_high is not None
        rank_low = int(candidate.rank_low) if candidate.rank_low is not None else int(round(expected_rank))
        rank_high = int(candidate.rank_high) if candidate.rank_high is not None else int(round(expected_rank))
        rank_low, rank_high = sorted((max(1, rank_low), max(1, rank_high)))
        preference_mean = (
            _finite(float(candidate.preference_mean))
            if candidate.preference_mean is not None
            else (
                _finite((float(candidate.score_anchor) - 50.0) / 25.0)
                if candidate.score_anchor is not None
                and math.isfinite(float(candidate.score_anchor))
                else 0.0
            )
        )
        preference_std = (
            _finite(float(candidate.preference_std), 1.0)
            if candidate.preference_std is not None
            else 1.0
        )
        features[candidate.content_id] = _CandidateFeatures(
            content_id=candidate.content_id,
            preference_mean=preference_mean,
            preference_std=max(0.0, preference_std),
            expected_rank=max(1.0, expected_rank),
            rank_low=rank_low,
            rank_high=rank_high,
            has_rank_interval=has_rank_interval,
            comparison_count=max(0, int(candidate.comparison_count)),
            graph_degree=degree.get(candidate.content_id, 0),
            graph_component=components.get(candidate.content_id, candidate.content_id),
            stability=candidate.stability,
        )
    return features


def _entropy(probabilities: Sequence[float]) -> float:
    """计算离散分布熵。"""
    return -sum(probability * math.log(probability) for probability in probabilities if probability > 0)


def _interval_overlap(first: _CandidateFeatures, second: _CandidateFeatures) -> float:
    """返回 rank interval 的 IoU；缺少区间时返回中性分。"""
    if not first.has_rank_interval or not second.has_rank_interval:
        return 0.5
    intersection = max(0, min(first.rank_high, second.rank_high) - max(first.rank_low, second.rank_low) + 1)
    union = max(first.rank_high, second.rank_high) - min(first.rank_low, second.rank_low) + 1
    return _clamp(intersection / union if union > 0 else 0.0)


def _boundary_score(
    first: _CandidateFeatures,
    second: _CandidateFeatures,
    boundaries: Sequence[int],
    scale: float,
) -> float:
    """计算两部作品接近重要排名边界的程度。"""
    if not boundaries:
        return 0.0
    distances = [
        min(abs(first.expected_rank - boundary), abs(second.expected_rank - boundary))
        for boundary in boundaries
    ]
    return _clamp(math.exp(-min(distances) / scale))


def _primary_reason(components: Mapping[str, float]) -> SelectionReason:
    """把最大 acquisition component 映射为内部原因。"""
    reason_by_component = (
        ('new_content', SelectionReason.NEW_CONTENT, 5),
        ('uncertainty_score', SelectionReason.UNCERTAIN_PAIR, 4),
        ('rank_interval_overlap', SelectionReason.UNCERTAIN_PAIR, 3),
        ('rank_boundary', SelectionReason.RANK_BOUNDARY, 2),
        ('underexplored', SelectionReason.UNDEREXPLORED, 1),
        ('anchor_changed', SelectionReason.UNDEREXPLORED, 0),
    )
    candidates = [
        (components.get(name, 0.0), priority, reason)
        for name, reason, priority in reason_by_component
    ]
    best_value, _, best_reason = max(candidates, key=lambda item: (item[0], item[1]))
    if best_value <= 0:
        return SelectionReason.NORMAL
    return best_reason


def _build_recent_statistics(
    interactions: Sequence[_Interaction],
    candidate_ids: Sequence[int],
    config: SelectorConfig,
) -> tuple[dict[tuple[int, int], tuple[int, ...]], dict[int, tuple[int, int]]]:
    """一次性建立 Pair 位置和作品近期/连续曝光统计。"""
    positions_by_pair: dict[tuple[int, int], list[int]] = {}
    for position, interaction in enumerate(interactions):
        positions_by_pair.setdefault(interaction.pair, []).append(position)

    exposure_by_content: dict[int, tuple[int, int]] = {}
    for content_id in candidate_ids:
        recent_count, consecutive_count = _content_exposure(
            interactions,
            content_id,
            config.max_recent_exposure,
        )
        exposure_by_content[content_id] = (recent_count, consecutive_count)
    return (
        {pair: tuple(positions) for pair, positions in positions_by_pair.items()},
        exposure_by_content,
    )


def _add_pair_source(
    pair_sources: dict[tuple[int, int], set[str]],
    first_content_id: int,
    second_content_id: int,
    source: str,
) -> None:
    """向去重后的 Pair 集合登记一个来源。"""
    if first_content_id == second_content_id:
        return
    pair_sources.setdefault(_pair_key(first_content_id, second_content_id), set()).add(source)


def _add_rank_neighbor_pairs(
    pair_sources: dict[tuple[int, int], set[str]],
    features: Mapping[int, _CandidateFeatures],
    window: int,
    source: str,
) -> None:
    """按 expected rank 顺序加入局部邻域 Pair。"""
    ordered_ids = sorted(features, key=lambda content_id: (features[content_id].expected_rank, content_id))
    for index, content_id in enumerate(ordered_ids):
        for opponent_index in range(index + 1, min(len(ordered_ids), index + window + 1)):
            _add_pair_source(pair_sources, content_id, ordered_ids[opponent_index], source)


def _add_interval_overlap_pairs(
    pair_sources: dict[tuple[int, int], set[str]],
    features: Mapping[int, _CandidateFeatures],
    opponent_count: int,
    source: str,
) -> None:
    """用 interval sweep 为每个区间加入少量高覆盖重叠对手。

    active interval 使用两个 heap 管理，避免在大量宽区间时退化为全量 Pair 枚举。
    每个新 interval 只取当前仍活跃且 high 最大的有限数量对手。
    """
    if opponent_count <= 0:
        return
    ordered = sorted(
        features.values(),
        key=lambda feature: (feature.rank_low, feature.rank_high, feature.content_id),
    )
    active_ids: set[int] = set()
    expiry_heap: list[tuple[int, int]] = []
    high_heap: list[tuple[int, int]] = []
    for feature in ordered:
        while expiry_heap and expiry_heap[0][0] < feature.rank_low:
            _, expired_id = heapq.heappop(expiry_heap)
            active_ids.discard(expired_id)
        selected: list[tuple[int, int]] = []
        while high_heap and len(selected) < opponent_count:
            negative_high, opponent_id = heapq.heappop(high_heap)
            if opponent_id in active_ids:
                selected.append((negative_high, opponent_id))
                _add_pair_source(pair_sources, feature.content_id, opponent_id, source)
        for item in selected:
            heapq.heappush(high_heap, item)
        active_ids.add(feature.content_id)
        heapq.heappush(expiry_heap, (feature.rank_high, feature.content_id))
        heapq.heappush(high_heap, (-feature.rank_high, feature.content_id))


def _opponent_sort_key(
    seed: _CandidateFeatures,
    opponent: _CandidateFeatures,
    *,
    cross_component: bool,
) -> tuple[float, float, int, int]:
    """为 Focus、低覆盖和图探索提供稳定的轻量对手排序。"""
    overlap = _interval_overlap(seed, opponent)
    rank_distance = abs(seed.expected_rank - opponent.expected_rank)
    if cross_component:
        return (-opponent.graph_degree, -overlap, rank_distance, opponent.content_id)
    return (-overlap, rank_distance, opponent.comparison_count, opponent.content_id)


def _add_seed_opponents(
    pair_sources: dict[tuple[int, int], set[str]],
    features: Mapping[int, _CandidateFeatures],
    seed_ids: Sequence[int],
    opponent_count: int,
    source: str,
    *,
    cross_component: bool = False,
) -> None:
    """为有限 seed 作品生成有限数量的高价值对手。"""
    if opponent_count <= 0:
        return
    all_features = tuple(features.values())
    for seed_id in seed_ids:
        seed = features[seed_id]
        opponents = [
            opponent
            for opponent in all_features
            if opponent.content_id != seed_id
            and (not cross_component or opponent.graph_component != seed.graph_component)
        ]
        opponents.sort(key=lambda opponent: _opponent_sort_key(seed, opponent, cross_component=cross_component))
        for opponent in opponents[:opponent_count]:
            _add_pair_source(pair_sources, seed_id, opponent.content_id, source)


def _underexplored_seed_ids(
    features: Mapping[int, _CandidateFeatures],
    count: int,
) -> tuple[int, ...]:
    """选择新作品、UNCALIBRATED 和低覆盖 seed。"""
    ordered = sorted(
        features.values(),
        key=lambda feature: (
            feature.comparison_count,
            feature.stability != 'UNCALIBRATED',
            feature.graph_degree,
            feature.expected_rank,
            feature.content_id,
        ),
    )
    return tuple(feature.content_id for feature in ordered[:count])


def _add_boundary_pairs(
    pair_sources: dict[tuple[int, int], set[str]],
    features: Mapping[int, _CandidateFeatures],
    boundaries: Sequence[int],
    boundary_window: int,
    source: str,
) -> None:
    """显式加入 Top-K 边界附近的候选 Pair。"""
    ordered_ids = sorted(features, key=lambda content_id: (features[content_id].expected_rank, content_id))
    for boundary in boundaries:
        near_indices = [
            index
            for index, content_id in enumerate(ordered_ids)
            if abs(features[content_id].expected_rank - boundary) <= boundary_window
        ]
        for index in near_indices:
            for opponent_index in near_indices:
                if index < opponent_index:
                    _add_pair_source(pair_sources, ordered_ids[index], ordered_ids[opponent_index], source)


def _preliminary_pair_score(
    first: _CandidateFeatures,
    second: _CandidateFeatures,
    context: SelectorContext,
    config: SelectorConfig,
    tie_strength: float,
) -> float:
    """Shortlist 截断时使用的轻量上界近似，不替代完整 acquisition score。"""
    probability = pairwise_probability(first.preference_mean, second.preference_mean, tie_strength)
    uncertainty = _clamp(
        0.7 * _entropy((probability.win_a, probability.tie, probability.win_b)) / math.log(3.0)
        + 0.3 * ((first.preference_std + second.preference_std) / 2.0) / config.preference_std_scale,
    )
    overlap = _interval_overlap(first, second)
    proximity = _clamp(
        math.exp(-abs(first.expected_rank - second.expected_rank) / config.rank_proximity_scale),
    )
    minimum_comparisons = min(first.comparison_count, second.comparison_count)
    underexplored = _clamp(1.0 / (1.0 + minimum_comparisons / config.underexplored_scale))
    new_content = float(minimum_comparisons == 0)
    graph = 1.0 if first.graph_component != second.graph_component else _clamp(
        1.0 - min(first.graph_degree, second.graph_degree) / max(first.graph_degree, second.graph_degree, 1),
    )
    boundary = _boundary_score(first, second, config.important_rank_boundaries, config.rank_boundary_scale)
    anchor_changed = float(
        first.content_id in context.recently_anchor_changed_content_ids
        or second.content_id in context.recently_anchor_changed_content_ids,
    )
    focus = float(
        context.focus_content_id is not None
        and context.focus_content_id in (first.content_id, second.content_id),
    )
    return _finite(
        config.uncertainty_weight * uncertainty
        + config.rank_overlap_weight * overlap
        + config.rank_proximity_weight * proximity
        + config.underexplored_weight * underexplored
        + config.new_content_weight * new_content
        + config.graph_connectivity_weight * graph
        + config.rank_boundary_weight * boundary
        + config.anchor_changed_weight * anchor_changed
        + config.focus_weight * focus
    )


def _build_pair_shortlist(
    features: Mapping[int, _CandidateFeatures],
    candidate_ids: Sequence[int],
    context: SelectorContext,
    config: SelectorConfig,
    tie_strength: float,
) -> _PairShortlist:
    """根据多来源候选生成 adaptive shortlist。"""
    total_pair_count = len(candidate_ids) * (len(candidate_ids) - 1) // 2
    if len(candidate_ids) <= config.exhaustive_candidate_threshold:
        pairs = tuple(combinations(sorted(candidate_ids), 2))
        return _PairShortlist(
            pair_keys=pairs,
            source_counts={'exhaustive': len(pairs)},
            used=False,
            total_candidate_pair_count=total_pair_count,
        )

    pair_sources: dict[tuple[int, int], set[str]] = {}
    _add_rank_neighbor_pairs(
        pair_sources,
        features,
        config.rank_neighbor_window,
        'rank_neighbors',
    )
    _add_interval_overlap_pairs(
        pair_sources,
        features,
        config.rank_interval_opponent_count,
        'rank_interval_overlap',
    )
    seed_ids = _underexplored_seed_ids(features, config.underexplored_content_count)
    _add_seed_opponents(
        pair_sources,
        features,
        seed_ids,
        config.underexplored_opponent_count,
        'underexplored',
    )
    _add_seed_opponents(
        pair_sources,
        features,
        seed_ids,
        config.cross_component_pair_count,
        'graph_exploration',
        cross_component=True,
    )

    if context.focus_content_id in features:
        _add_seed_opponents(
            pair_sources,
            features,
            (context.focus_content_id,),
            config.focus_opponent_count,
            'focus',
        )
        _add_seed_opponents(
            pair_sources,
            features,
            (context.focus_content_id,),
            config.cross_component_pair_count,
            'focus_graph_exploration',
            cross_component=True,
        )

    changed_ids = tuple(
        content_id
        for content_id in sorted(context.recently_anchor_changed_content_ids)
        if content_id in features
    )[: config.anchor_changed_content_count]
    _add_seed_opponents(
        pair_sources,
        features,
        changed_ids,
        config.underexplored_opponent_count,
        'anchor_changed',
    )
    _add_seed_opponents(
        pair_sources,
        features,
        changed_ids,
        config.cross_component_pair_count,
        'anchor_changed_graph_exploration',
        cross_component=True,
    )

    _add_boundary_pairs(
        pair_sources,
        features,
        config.important_rank_boundaries,
        config.boundary_neighbor_window,
        'rank_boundary',
    )
    exploration_seeds = tuple(
        sorted(
            features.values(),
            key=lambda feature: (
                feature.graph_degree,
                feature.comparison_count,
                feature.expected_rank,
                feature.content_id,
            ),
        )[: config.exploration_seed_count]
    )
    _add_seed_opponents(
        pair_sources,
        features,
        tuple(feature.content_id for feature in exploration_seeds),
        config.exploration_pair_count,
        'exploration_pool',
        cross_component=True,
    )

    if not pair_sources:
        first, second = sorted(candidate_ids)[:2]
        _add_pair_source(pair_sources, first, second, 'fallback_seed')

    def priority(pair: tuple[int, int]) -> float:
        first = features[pair[0]]
        second = features[pair[1]]
        return _preliminary_pair_score(first, second, context, config, tie_strength)

    ordered_pairs = sorted(
        pair_sources,
        key=lambda pair: (priority(pair), pair[0], pair[1]),
        reverse=True,
    )
    if len(ordered_pairs) > config.max_pair_evaluations:
        selected: set[tuple[int, int]] = set()
        source_names = sorted({source for sources in pair_sources.values() for source in sources})
        for source in source_names:
            source_pairs = [pair for pair, sources in pair_sources.items() if source in sources]
            if len(selected) >= config.max_pair_evaluations:
                break
            selected.add(max(source_pairs, key=lambda pair: (priority(pair), pair[0], pair[1])))
        for pair in ordered_pairs:
            if len(selected) >= config.max_pair_evaluations:
                break
            selected.add(pair)
        selected_pairs = tuple(sorted(selected))
    else:
        selected_pairs = tuple(sorted(ordered_pairs))
    source_counts: dict[str, int] = {}
    for pair in selected_pairs:
        for source in pair_sources[pair]:
            source_counts[source] = source_counts.get(source, 0) + 1
    return _PairShortlist(
        pair_keys=selected_pairs,
        source_counts=dict(sorted(source_counts.items())),
        used=True,
        total_candidate_pair_count=total_pair_count,
    )


def _cooldown_blocked(
    pair: tuple[int, int],
    positions: Sequence[int],
    interactions: Sequence[_Interaction],
    config: SelectorConfig,
    context: SelectorContext,
    *,
    skip_only: bool,
) -> bool:
    """判断 Pair 是否处于 count 或 seconds cooldown。"""
    count_limit = config.skip_cooldown_count if skip_only else config.pair_cooldown_count
    seconds_limit = config.skip_cooldown_seconds if skip_only else config.pair_cooldown_seconds
    if skip_only:
        positions = [
            position
            for position in positions
            if interactions[position].outcome is SelectorOutcome.SKIP
        ]
        skip_streak = 0
        for interaction in interactions:
            if interaction.pair != pair or interaction.outcome is not SelectorOutcome.SKIP:
                break
            skip_streak += 1
        count_limit *= max(1, skip_streak)
    if count_limit > 0 and any(position < count_limit for position in positions):
        return True
    if seconds_limit is None or context.now is None:
        return False
    now_timestamp = _timestamp(context.now)
    for position in positions:
        created_at = interactions[position].created_at
        if created_at is not None and now_timestamp - _timestamp(created_at) <= seconds_limit:
            return True
    return False


def _content_exposure(
    interactions: Sequence[_Interaction],
    content_id: int,
    window: int,
) -> tuple[int, int]:
    """返回近期曝光次数和从最新记录开始的连续曝光次数。"""
    recent = interactions[:window] if window > 0 else []
    recent_count = sum(content_id in interaction.pair for interaction in recent)
    consecutive_count = 0
    for interaction in interactions:
        if content_id not in interaction.pair:
            break
        consecutive_count += 1
    return recent_count, consecutive_count


def _score_pair(
    first: _CandidateFeatures,
    second: _CandidateFeatures,
    interactions: Sequence[_Interaction],
    positions_by_pair: Mapping[tuple[int, int], Sequence[int]],
    exposure_by_content: Mapping[int, tuple[int, int]],
    context: SelectorContext,
    config: SelectorConfig,
    tie_strength: float,
    component_count: int,
) -> _PairScore:
    """计算一个 unordered Pair 的归一化 acquisition components。"""
    pair = _pair_key(first.content_id, second.content_id)
    probability = pairwise_probability(
        first.preference_mean,
        second.preference_mean,
        tie_strength,
    )
    outcome_entropy = _clamp(
        _entropy((probability.win_a, probability.tie, probability.win_b)) / math.log(3.0),
    )
    preference_uncertainty = _clamp(
        ((first.preference_std + second.preference_std) / 2.0) / config.preference_std_scale,
    )
    uncertainty_score = _clamp(0.7 * outcome_entropy + 0.3 * preference_uncertainty)
    rank_interval_overlap = _interval_overlap(first, second)
    rank_distance = abs(first.expected_rank - second.expected_rank)
    rank_proximity = _clamp(math.exp(-rank_distance / config.rank_proximity_scale))
    minimum_comparisons = min(first.comparison_count, second.comparison_count)
    underexplored = _clamp(1.0 / (1.0 + minimum_comparisons / config.underexplored_scale))
    new_content = 1.0 if minimum_comparisons == 0 else 0.0

    maximum_degree = max(first.graph_degree, second.graph_degree, 1)
    if first.graph_component != second.graph_component:
        graph_connectivity = 1.0
    else:
        graph_connectivity = _clamp(1.0 - min(first.graph_degree, second.graph_degree) / maximum_degree)
    rank_boundary = _boundary_score(
        first,
        second,
        config.important_rank_boundaries,
        config.rank_boundary_scale,
    )
    anchor_changed = float(
        first.content_id in context.recently_anchor_changed_content_ids
        or second.content_id in context.recently_anchor_changed_content_ids,
    )
    focus = float(
        context.focus_content_id is not None
        and context.focus_content_id in pair,
    )

    positions = positions_by_pair.get(pair, ())
    pair_cooldown_blocked = _cooldown_blocked(
        pair,
        positions,
        interactions,
        config,
        context,
        skip_only=False,
    )
    skip_cooldown_blocked = _cooldown_blocked(
        pair,
        positions,
        interactions,
        config,
        context,
        skip_only=True,
    )
    pair_window = max(config.max_recent_exposure, config.pair_cooldown_count, 1)
    repeat_recency = _clamp(sum(position < pair_window for position in positions) / pair_window)
    skip_recency = _clamp(
        sum(
            position < max(config.max_recent_exposure, config.skip_cooldown_count, 1)
            and interactions[position].outcome is SelectorOutcome.SKIP
            for position in positions
        )
        / max(config.skip_cooldown_count, 1),
    )
    first_exposure, first_consecutive = exposure_by_content.get(first.content_id, (0, 0))
    second_exposure, second_consecutive = exposure_by_content.get(second.content_id, (0, 0))
    if config.max_recent_exposure > 0:
        content_recency = _clamp(
            (first_exposure + second_exposure) / (2.0 * config.max_recent_exposure),
        )
    else:
        content_recency = 0.0
    excessive_exposure = (
        config.max_consecutive_content_exposure > 0
        and max(first_consecutive, second_consecutive) >= config.max_consecutive_content_exposure
        and context.focus_content_id not in pair
    )
    excessive_repeat = _clamp(
        max(first_consecutive, second_consecutive)
        / max(config.max_consecutive_content_exposure, 1),
    )

    positive_components = {
        'uncertainty_score': uncertainty_score,
        'rank_interval_overlap': rank_interval_overlap,
        'rank_proximity': rank_proximity,
        'underexplored': underexplored,
        'new_content': new_content,
        'graph_connectivity': graph_connectivity,
        'rank_boundary': rank_boundary,
        'anchor_changed': anchor_changed,
        'focus': focus,
    }
    total_score = (
        config.uncertainty_weight * uncertainty_score
        + config.rank_overlap_weight * rank_interval_overlap
        + config.rank_proximity_weight * rank_proximity
        + config.underexplored_weight * underexplored
        + config.new_content_weight * new_content
        + config.graph_connectivity_weight * graph_connectivity
        + config.rank_boundary_weight * rank_boundary
        + config.anchor_changed_weight * anchor_changed
        + config.focus_weight * focus
        - config.repeat_pair_penalty * repeat_recency
        - config.skip_pair_penalty * skip_recency
        - config.content_recency_penalty * content_recency
        - config.excessive_repeat_penalty * excessive_repeat
    )
    total_score = _finite(total_score, -1e9)
    exploration_denominator = (
        config.exploration_graph_weight
        + config.exploration_underexplored_weight
        + config.exploration_distance_weight
    )
    long_range = _clamp(rank_distance / max(component_count - 1, 1))
    exploration_score = _clamp(
        (
            config.exploration_graph_weight * graph_connectivity
            + config.exploration_underexplored_weight * underexplored
            + config.exploration_distance_weight * long_range
        )
        / exploration_denominator
        if exploration_denominator > 0
        else 0.0,
    )
    components = tuple(
        sorted(
            {
                **positive_components,
                'outcome_entropy': outcome_entropy,
                'preference_uncertainty': preference_uncertainty,
                'rank_distance': _finite(rank_distance),
                'repeat_recency_penalty': repeat_recency,
                'skip_recency_penalty': skip_recency,
                'content_recency_penalty': content_recency,
                'excessive_repeat_penalty': excessive_repeat,
                'pair_cooldown_blocked': float(pair_cooldown_blocked),
                'skip_cooldown_blocked': float(skip_cooldown_blocked),
                'exploration_score': exploration_score,
                'pair_score': total_score,
            }.items(),
        ),
    )
    return _PairScore(
        low_content_id=pair[0],
        high_content_id=pair[1],
        total_score=total_score,
        exploration_score=exploration_score,
        components=components,
        pair_cooldown_blocked=pair_cooldown_blocked,
        skip_cooldown_blocked=skip_cooldown_blocked,
        excessive_exposure=excessive_exposure,
        primary_reason=_primary_reason(dict(components)),
    )


def _pair_hard_blocked(
    first: _CandidateFeatures,
    second: _CandidateFeatures,
    pair: tuple[int, int],
    interactions: Sequence[_Interaction],
    positions_by_pair: Mapping[tuple[int, int], Sequence[int]],
    exposure_by_content: Mapping[int, tuple[int, int]],
    context: SelectorContext,
    config: SelectorConfig,
) -> bool:
    """判断 Pair 是否会被 cooldown 或曝光规则排除。"""
    if _cooldown_blocked(pair, positions_by_pair.get(pair, ()), interactions, config, context, skip_only=False):
        return True
    if _cooldown_blocked(pair, positions_by_pair.get(pair, ()), interactions, config, context, skip_only=True):
        return True
    _, first_consecutive = exposure_by_content.get(first.content_id, (0, 0))
    _, second_consecutive = exposure_by_content.get(second.content_id, (0, 0))
    return (
        config.max_consecutive_content_exposure > 0
        and max(first_consecutive, second_consecutive) >= config.max_consecutive_content_exposure
        and context.focus_content_id not in pair
    )


def _fallback_pair_keys(
    existing_pairs: set[tuple[int, int]],
    features: Mapping[int, _CandidateFeatures],
    candidate_ids: Sequence[int],
    interactions: Sequence[_Interaction],
    positions_by_pair: Mapping[tuple[int, int], Sequence[int]],
    exposure_by_content: Mapping[int, tuple[int, int]],
    context: SelectorContext,
    config: SelectorConfig,
    tie_strength: float,
) -> tuple[tuple[int, int], ...]:
    """Shortlist 没有合法 Pair 时，扫描规则而非完整 acquisition score。"""
    legal_pairs: list[tuple[float, tuple[int, int]]] = []
    for pair in combinations(sorted(candidate_ids), 2):
        if pair in existing_pairs:
            continue
        if _pair_hard_blocked(
            features[pair[0]],
            features[pair[1]],
            pair,
            interactions,
            positions_by_pair,
            exposure_by_content,
            context,
            config,
        ):
            continue
        legal_pairs.append(
            (
                _preliminary_pair_score(
                    features[pair[0]],
                    features[pair[1]],
                    context,
                    config,
                    tie_strength,
                ),
                pair,
            ),
        )
    legal_pairs.sort(key=lambda item: (item[0], item[1][0], item[1][1]), reverse=True)
    fallback_count = min(config.max_pair_evaluations, 256)
    return tuple(pair for _, pair in legal_pairs[:fallback_count])


def _diagnostics(
    *,
    candidate_count: int,
    pair_count: int,
    eligible_pair_count: int,
    valid_comparison_count: int,
    ignored: Mapping[str, int],
    fallback_used: bool,
    exploration_used: bool,
    focus_requested: bool,
    focus_selected: bool,
    shortlist_used: bool,
    pair_evaluation_count: int,
    total_candidate_pair_count: int,
    shortlist_source_counts: Mapping[str, int],
    shortlist_construction_seconds: float,
    full_acquisition_scoring_seconds: float,
    pair_construction_seconds: float,
    score_seconds: float,
    selection_seconds: float,
    total_seconds: float,
) -> SelectorDiagnostics:
    """集中生成有限诊断值。"""
    return SelectorDiagnostics(
        candidate_count=candidate_count,
        pair_count=pair_count,
        eligible_pair_count=eligible_pair_count,
        valid_comparison_count=valid_comparison_count,
        ignored_comparison_count=sum(ignored.values()),
        ignored_comparison_reasons=dict(sorted(ignored.items())),
        fallback_used=fallback_used,
        exploration_used=exploration_used,
        focus_requested=focus_requested,
        focus_selected=focus_selected,
        shortlist_used=shortlist_used,
        pair_evaluation_count=pair_evaluation_count,
        total_candidate_pair_count=total_candidate_pair_count,
        shortlist_source_counts=dict(sorted(shortlist_source_counts.items())),
        shortlist_construction_seconds=_finite(shortlist_construction_seconds),
        full_acquisition_scoring_seconds=_finite(full_acquisition_scoring_seconds),
        pair_construction_seconds=_finite(pair_construction_seconds),
        score_seconds=_finite(score_seconds),
        selection_seconds=_finite(selection_seconds),
        total_seconds=_finite(total_seconds),
    )


def select_pair(
    candidates: Sequence[SelectorCandidate],
    comparisons: Sequence[SelectorComparison],
    context: SelectorContext | None = None,
    config: SelectorConfig | None = None,
) -> PairSelectionResult:
    """根据当前状态选择下一组无序 Pair，并随机化展示左右位置。"""
    active_context = context or SelectorContext()
    active_config = config or SelectorConfig()
    started_at = time.perf_counter()
    unique_candidates = {
        candidate.content_id: candidate
        for candidate in sorted(candidates, key=lambda item: item.content_id)
    }
    candidate_list = tuple(unique_candidates.values())
    candidate_ids = set(unique_candidates)
    if len(candidate_list) < 2:
        diagnostics = _diagnostics(
            candidate_count=len(candidate_list),
            pair_count=0,
            eligible_pair_count=0,
            valid_comparison_count=0,
            ignored={},
            fallback_used=False,
            exploration_used=False,
            focus_requested=active_context.focus_content_id is not None,
            focus_selected=False,
            shortlist_used=False,
            pair_evaluation_count=0,
            total_candidate_pair_count=0,
            shortlist_source_counts={},
            shortlist_construction_seconds=0.0,
            full_acquisition_scoring_seconds=0.0,
            pair_construction_seconds=0.0,
            score_seconds=0.0,
            selection_seconds=0.0,
            total_seconds=time.perf_counter() - started_at,
        )
        return PairSelectionResult(
            selected_pair=None,
            reason=SelectionReason.INSUFFICIENT_CANDIDATES,
            diagnostics=diagnostics,
        )

    pair_started_at = time.perf_counter()
    interactions, ignored = _prepare_history(candidate_ids, comparisons)
    degree, components = _build_graph(tuple(sorted(candidate_ids)), interactions)
    features = _candidate_features(candidate_list, degree, components)
    positions_by_pair, exposure_by_content = _build_recent_statistics(
        interactions,
        tuple(sorted(candidate_ids)),
        active_config,
    )
    tie_strength = validate_tie_strength(
        active_context.tie_strength
        if active_context.tie_strength is not None
        else DEFAULT_TIE_STRENGTH,
    )
    shortlist = _build_pair_shortlist(
        features,
        tuple(sorted(candidate_ids)),
        active_context,
        active_config,
        tie_strength,
    )
    shortlist_construction_seconds = time.perf_counter() - pair_started_at

    score_started_at = time.perf_counter()
    scored_pairs = tuple(
        _score_pair(
            features[first_content_id],
            features[second_content_id],
            interactions,
            positions_by_pair,
            exposure_by_content,
            active_context,
            active_config,
            tie_strength,
            len(candidate_list),
        )
        for first_content_id, second_content_id in shortlist.pair_keys
    )
    eligible_pairs = tuple(
        pair
        for pair in scored_pairs
        if not pair.pair_cooldown_blocked
        and not pair.skip_cooldown_blocked
        and not pair.excessive_exposure
    )
    full_acquisition_scoring_seconds = time.perf_counter() - score_started_at

    focus_requested = active_context.focus_content_id in candidate_ids
    fallback_used = False
    fallback_reason = SelectionReason.NORMAL
    if not eligible_pairs and len(candidate_list) > 2:
        fallback_pairs = _fallback_pair_keys(
            set(shortlist.pair_keys),
            features,
            tuple(sorted(candidate_ids)),
            interactions,
            positions_by_pair,
            exposure_by_content,
            active_context,
            active_config,
            tie_strength,
        )
        if fallback_pairs:
            fallback_scores = tuple(
                _score_pair(
                    features[first_content_id],
                    features[second_content_id],
                    interactions,
                    positions_by_pair,
                    exposure_by_content,
                    active_context,
                    active_config,
                    tie_strength,
                    len(candidate_list),
                )
                for first_content_id, second_content_id in fallback_pairs
            )
            scored_pairs = (*scored_pairs, *fallback_scores)
            shortlist_source_counts = dict(shortlist.source_counts)
            shortlist_source_counts['fallback'] = len(fallback_scores)
            eligible_pairs = tuple(
                pair
                for pair in scored_pairs
                if not pair.pair_cooldown_blocked
                and not pair.skip_cooldown_blocked
                and not pair.excessive_exposure
            )
            fallback_used = bool(eligible_pairs)
            fallback_reason = SelectionReason.COOLDOWN_FALLBACK
        else:
            shortlist_source_counts = dict(shortlist.source_counts)
    else:
        shortlist_source_counts = dict(shortlist.source_counts)
    full_acquisition_scoring_seconds = time.perf_counter() - score_started_at

    focus_pairs = tuple(
        pair
        for pair in eligible_pairs
        if active_context.focus_content_id in (pair.low_content_id, pair.high_content_id)
    )
    selection_pool = eligible_pairs
    if not selection_pool:
        if len(candidate_list) == 2:
            selection_seconds = time.perf_counter() - score_started_at - full_acquisition_scoring_seconds
            diagnostics = _diagnostics(
                candidate_count=len(candidate_list),
                pair_count=len(scored_pairs),
                eligible_pair_count=0,
                valid_comparison_count=sum(
                    interaction.outcome is not SelectorOutcome.SKIP for interaction in interactions
                ),
                ignored=ignored,
                fallback_used=False,
                exploration_used=False,
                focus_requested=focus_requested,
                focus_selected=False,
                shortlist_used=shortlist.used,
                pair_evaluation_count=len(scored_pairs),
                total_candidate_pair_count=shortlist.total_candidate_pair_count,
                shortlist_source_counts=shortlist_source_counts,
                shortlist_construction_seconds=shortlist_construction_seconds,
                full_acquisition_scoring_seconds=full_acquisition_scoring_seconds,
                pair_construction_seconds=shortlist_construction_seconds,
                score_seconds=full_acquisition_scoring_seconds,
                selection_seconds=selection_seconds,
                total_seconds=time.perf_counter() - started_at,
            )
            return PairSelectionResult(
                selected_pair=None,
                reason=SelectionReason.COOLDOWN,
                diagnostics=diagnostics,
            )
        selection_pool = scored_pairs
        fallback_used = True
        fallback_reason = SelectionReason.COOLDOWN_FALLBACK

    rng = random.Random(active_config.random_seed)
    focus_selected = False
    exploration_used = False
    selected_score: _PairScore
    if focus_pairs and rng.random() < active_config.focus_probability:
        selected_score = max(
            focus_pairs,
            key=lambda pair: (pair.total_score, pair.exploration_score, -pair.low_content_id, -pair.high_content_id),
        )
        focus_selected = True
        selected_reason = SelectionReason.FOCUS_CONTENT
    elif not fallback_used and rng.random() < active_config.exploration_rate:
        selected_score = max(
            selection_pool,
            key=lambda pair: (
                pair.exploration_score,
                pair.total_score,
                -pair.low_content_id,
                -pair.high_content_id,
            ),
        )
        exploration_used = True
        selected_reason = SelectionReason.EXPLORATION
    else:
        selected_score = max(
            selection_pool,
            key=lambda pair: (pair.total_score, pair.exploration_score, -pair.low_content_id, -pair.high_content_id),
        )
        selected_reason = fallback_reason if fallback_used else selected_score.primary_reason

    left_content_id, right_content_id = selected_score.low_content_id, selected_score.high_content_id
    if rng.random() < 0.5:
        left_content_id, right_content_id = right_content_id, left_content_id
    selection_seconds = time.perf_counter() - score_started_at - full_acquisition_scoring_seconds
    selected_pair = SelectedPair(
        left_content_id=left_content_id,
        right_content_id=right_content_id,
        selection_reason=selected_reason,
        selector_version=active_config.selector_version,
        debug_score=_finite(selected_score.total_score),
        components=selected_score.components,
    )
    diagnostics = _diagnostics(
        candidate_count=len(candidate_list),
        pair_count=len(scored_pairs),
        eligible_pair_count=len(eligible_pairs),
        valid_comparison_count=sum(
            interaction.outcome is not SelectorOutcome.SKIP for interaction in interactions
        ),
        ignored=ignored,
        fallback_used=fallback_used,
        exploration_used=exploration_used,
        focus_requested=focus_requested,
        focus_selected=focus_selected,
        shortlist_used=shortlist.used,
        pair_evaluation_count=len(scored_pairs),
        total_candidate_pair_count=shortlist.total_candidate_pair_count,
        shortlist_source_counts=shortlist_source_counts,
        shortlist_construction_seconds=shortlist_construction_seconds,
        full_acquisition_scoring_seconds=full_acquisition_scoring_seconds,
        pair_construction_seconds=shortlist_construction_seconds,
        score_seconds=full_acquisition_scoring_seconds,
        selection_seconds=selection_seconds,
        total_seconds=time.perf_counter() - started_at,
    )
    return PairSelectionResult(
        selected_pair=selected_pair,
        reason=selected_reason,
        diagnostics=diagnostics,
    )


__all__ = [
    'PairSelectionResult',
    'SelectedPair',
    'SelectionReason',
    'SelectorCandidate',
    'SelectorComparison',
    'SelectorConfig',
    'SelectorContext',
    'SelectorDiagnostics',
    'SelectorOutcome',
    'select_pair',
]
