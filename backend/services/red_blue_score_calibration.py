"""红蓝合战阶段 5：个人评分校准纯算法。

本模块只把个人偏好结果转换为评分建议，不查询数据库、不写入 Rating 或
RatingRevision，也不修改 ScoreSuggestion。训练标签永远使用 score_anchor，
当前 Rating.score 只用于判断是否需要提示。

核心流程：

``score_anchor`` 训练标签 -> 每个目标作品的 Leave-One-Out PAVA -> 预测区间
-> 偏差/稳定性/置信度过滤 -> ScoreCalibrationSuggestion。

PAVA 的输出允许平台区间，因此同一评分档可以覆盖多个 preference；它不会把
排名顺序强行映射成严格递增的评分。
"""

from __future__ import annotations

import json
import math
import time
from bisect import bisect_left
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from enum import StrEnum
from statistics import NormalDist
from typing import cast

from services.red_blue_ranker import RankerStability


class CalibrationFreshness(StrEnum):
    """校准算法允许使用的模型新鲜度。"""

    FULL = 'FULL'
    FAST = 'FAST'
    BOOTSTRAP = 'BOOTSTRAP'
    STALE_REQUIRES_FULL = 'STALE_REQUIRES_FULL'


class ScoreCalibrationDirection(StrEnum):
    """评分建议方向。"""

    UP = 'UP'
    DOWN = 'DOWN'


class ScoreCalibrationReasonCode(StrEnum):
    """供未来 UI 映射的稳定原因码，不包含中文展示文案。"""

    PREFERENCE_HIGHER_THAN_SCORE = 'PREFERENCE_HIGHER_THAN_SCORE'
    PREFERENCE_LOWER_THAN_SCORE = 'PREFERENCE_LOWER_THAN_SCORE'


class CalibrationExclusionReason(StrEnum):
    """诊断中说明作品为什么没有生成建议。"""

    BOOTSTRAP_MODEL = 'BOOTSTRAP_MODEL'
    STALE_MODEL = 'STALE_MODEL'
    CALIBRATION_SAMPLES_INSUFFICIENT = 'CALIBRATION_SAMPLES_INSUFFICIENT'
    COMPARISONS_INSUFFICIENT = 'COMPARISONS_INSUFFICIENT'
    STABILITY_INSUFFICIENT = 'STABILITY_INSUFFICIENT'
    LOCAL_SUPPORT_INSUFFICIENT = 'LOCAL_SUPPORT_INSUFFICIENT'
    CURRENT_SCORE_WITHIN_INTERVAL = 'CURRENT_SCORE_WITHIN_INTERVAL'
    SCORE_DELTA_INSUFFICIENT = 'SCORE_DELTA_INSUFFICIENT'
    CONFIDENCE_INSUFFICIENT = 'CONFIDENCE_INSUFFICIENT'
    ACTION_SUPPRESSED = 'ACTION_SUPPRESSED'


@dataclass(frozen=True, slots=True)
class CalibrationCandidate:
    """本次校准的候选作品 ID。"""

    content_id: int


@dataclass(frozen=True, slots=True)
class CalibrationPreferenceResult:
    """可来自 Full PreferenceResult 或 Fast State 的统一输入。"""

    content_id: int
    preference_mean: float
    preference_std: float
    expected_rank: float
    rank_low: int
    rank_high: int
    stability: RankerStability | str
    comparison_count: int
    order_uncertain: bool = False


@dataclass(frozen=True, slots=True)
class CalibrationRating:
    """当前显示评分和独立评分锚点。"""

    content_id: int
    current_score: int
    score_anchor: int


@dataclass(frozen=True, slots=True)
class CalibrationAction:
    """用户对历史建议的事实动作；算法不修改它。"""

    content_id: int
    suggestion_key: str
    action: str
    created_at: datetime | None = None
    comparison_count_at_action: int | None = None
    comparison_state_version_at_action: int | None = None
    effective_comparison_max_id_at_action: int | None = None


@dataclass(frozen=True, slots=True)
class PreviousCalibrationSuggestion:
    """用于 hysteresis 的上一轮待展示建议状态。"""

    content_id: int
    suggestion_key: str
    confidence: float
    active: bool = True


@dataclass(frozen=True, slots=True)
class ScoreCalibrationConfig:
    """评分校准算法配置；字段均可 JSON 序列化并可被测试覆盖。"""

    algorithm_version: str = 'score-calibration-v1'
    min_calibration_samples: int = 5
    min_comparisons_for_suggestion: int = 4
    min_stability: str = RankerStability.RELATIVELY_STABLE.value
    min_score_delta: float = 5.0
    score_step: int = 5
    prediction_interval_probability: float = 0.80
    local_preference_band_width: float = 0.75
    min_local_support: int = 2
    local_support_saturation: int = 8
    calibration_noise_floor: float = 2.5
    preference_uncertainty_score_scale: float = 8.0
    rank_interval_score_scale: float = 25.0
    confidence_uncertainty_scale: float = 12.0
    confidence_threshold: float = 0.80
    fast_confidence_threshold: float = 0.90
    hysteresis_confidence_threshold: float = 0.70
    dismissed_suppression_days: float = 14.0
    dismissed_new_evidence_comparisons: int = 2
    order_uncertain_min_comparisons: int = 20
    extreme_outlier_min_score_delta: float = 20.0
    extreme_outlier_confidence_threshold: float = 0.60
    max_suggestions: int | None = 10

    def __post_init__(self) -> None:
        """校验会影响建议稳定性和量化结果的参数。"""
        if not self.algorithm_version.strip():
            raise ValueError('algorithm_version 不能为空')
        if self.min_calibration_samples < 1:
            raise ValueError('min_calibration_samples 必须至少为 1')
        if self.min_comparisons_for_suggestion < 0:
            raise ValueError('min_comparisons_for_suggestion 不能为负数')
        if self.min_stability not in {stability.value for stability in RankerStability}:
            raise ValueError('min_stability 不是有效的 RankerStability')
        if self.min_score_delta < 0:
            raise ValueError('min_score_delta 不能为负数')
        if self.score_step < 1 or 100 % self.score_step != 0:
            raise ValueError('score_step 必须是 100 的正因数')
        if not 0.5 < self.prediction_interval_probability < 1:
            raise ValueError('prediction_interval_probability 必须位于 (0.5, 1)')
        if self.local_preference_band_width <= 0:
            raise ValueError('local_preference_band_width 必须大于 0')
        if self.min_local_support < 1 or self.local_support_saturation < self.min_local_support:
            raise ValueError('local support 参数无效')
        for field_name in (
            'calibration_noise_floor',
            'preference_uncertainty_score_scale',
            'rank_interval_score_scale',
            'confidence_uncertainty_scale',
        ):
            if getattr(self, field_name) <= 0:
                raise ValueError(f'{field_name} 必须大于 0')
        for field_name in (
            'confidence_threshold',
            'fast_confidence_threshold',
            'hysteresis_confidence_threshold',
        ):
            value = getattr(self, field_name)
            if not 0 <= value <= 1:
                raise ValueError(f'{field_name} 必须位于 [0, 1]')
        if self.fast_confidence_threshold < self.confidence_threshold:
            raise ValueError('fast_confidence_threshold 不能低于 confidence_threshold')
        if self.hysteresis_confidence_threshold > self.confidence_threshold:
            raise ValueError('hysteresis_confidence_threshold 不能高于 confidence_threshold')
        if self.dismissed_suppression_days < 0:
            raise ValueError('dismissed_suppression_days 不能为负数')
        if self.dismissed_new_evidence_comparisons < 1:
            raise ValueError('dismissed_new_evidence_comparisons 必须至少为 1')
        if self.order_uncertain_min_comparisons < self.min_comparisons_for_suggestion:
            raise ValueError('order_uncertain_min_comparisons 不能低于 min_comparisons_for_suggestion')
        if self.extreme_outlier_min_score_delta < self.min_score_delta:
            raise ValueError('extreme_outlier_min_score_delta 不能低于 min_score_delta')
        if not 0 <= self.extreme_outlier_confidence_threshold <= 1:
            raise ValueError('extreme_outlier_confidence_threshold 必须位于 [0, 1]')
        if self.max_suggestions is not None and self.max_suggestions < 1:
            raise ValueError('max_suggestions 必须为正数或 None')

    def to_dict(self) -> dict[str, object]:
        """返回可写入 model config 的普通字典。"""
        return cast(dict[str, object], asdict(self))

    def to_json(self) -> str:
        """以稳定键顺序序列化配置。"""
        return json.dumps(self.to_dict(), ensure_ascii=False, sort_keys=True, separators=(',', ':'))

    @classmethod
    def from_json(cls, payload: str) -> ScoreCalibrationConfig:
        """从 JSON object 恢复配置。"""
        decoded = json.loads(payload)
        if not isinstance(decoded, dict):
            raise ValueError('score calibration config 必须是 JSON object')
        return cls(**cast(dict[str, object], decoded))


@dataclass(frozen=True, slots=True)
class ScoreCalibrationSuggestion:
    """达到展示阈值的一条评分建议。"""

    content_id: int
    current_score: int
    predicted_score: float
    suggested_score_low: int
    suggested_score_high: int
    recommended_score: int
    direction: ScoreCalibrationDirection
    confidence: float
    severity: float
    reason_code: ScoreCalibrationReasonCode
    suggestion_key: str
    local_support: int
    prediction_std: float
    calibration_sample_count: int


@dataclass(frozen=True, slots=True)
class ScoreCalibrationEvaluation:
    """单部作品的完整诊断，即使没有生成正式 suggestion 也保留。"""

    content_id: int
    current_score: int
    predicted_score: float | None
    suggested_score_low: int | None
    suggested_score_high: int | None
    recommended_score: int | None
    direction: ScoreCalibrationDirection | None
    confidence: float
    severity: float
    reason_code: ScoreCalibrationReasonCode | None
    suggestion_key: str | None
    local_support: int
    prediction_std: float | None
    calibration_sample_count: int
    eligible: bool
    exclusion_reason: str | None = None


@dataclass(frozen=True, slots=True)
class ScoreCalibrationDiagnostics:
    """便于测试和未来观测的阶段耗时及输入统计。"""

    candidate_count: int
    calibration_sample_count: int
    fitted_target_count: int
    suggestion_count: int
    model_freshness: str
    skipped_model_reason: str | None
    fit_seconds: float
    prediction_seconds: float
    filtering_seconds: float
    total_seconds: float


@dataclass(frozen=True, slots=True)
class ScoreCalibrationResult:
    """纯算法调用结果；suggestions 是正式业务输出，evaluations 是诊断输出。"""

    suggestions: tuple[ScoreCalibrationSuggestion, ...]
    evaluations: tuple[ScoreCalibrationEvaluation, ...]
    diagnostics: ScoreCalibrationDiagnostics


@dataclass(frozen=True, slots=True)
class _PavaBlock:
    x_low: float
    x_high: float
    value: float
    weight: float
    count: int


@dataclass(frozen=True, slots=True)
class _PavaModel:
    blocks: tuple[_PavaBlock, ...]
    x_highs: tuple[float, ...]

    def predict(self, x: float) -> float:
        """以单调分段函数预测；平台区间保持相同评分。"""
        if not self.blocks:
            raise ValueError('PAVA model 不能为空')
        if x <= self.blocks[0].x_low:
            return self.blocks[0].value
        # Isotonic regression 的自然外推是阶梯函数，而不是在两个不同的
        # 评分档之间人为插值。这样既保留 PAVA 的平台，也不会把排名分辨率
        # 误认为用户评分拥有更高精度。对空档取左侧平台值，复杂度 O(log n)。
        block_index = bisect_left(self.x_highs, x)
        if block_index >= len(self.blocks):
            block_index = len(self.blocks) - 1
        elif x < self.blocks[block_index].x_low and block_index > 0:
            block_index -= 1
        return self.blocks[block_index].value


def _finite(value: float, fallback: float = 0.0) -> float:
    """把不合法浮点值收敛到确定的有限值。"""
    return float(value) if math.isfinite(float(value)) else fallback


def _clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    """限制置信度和严重度的范围。"""
    return max(lower, min(upper, _finite(value, lower)))


def _normalize_freshness(value: CalibrationFreshness | str) -> CalibrationFreshness:
    """兼容阶段 4B 的 ModelFreshness StrEnum 和普通字符串。"""
    raw = getattr(value, 'value', value)
    return CalibrationFreshness(str(raw))


def _normalize_action(value: str) -> str:
    """规范化 action，避免纯算法依赖 ORM enum 类型。"""
    return str(getattr(value, 'value', value)).upper()


def _normalize_stability(value: RankerStability | str) -> str:
    """规范化 Ranker stability。"""
    return str(getattr(value, 'value', value))


def _aware_datetime(value: datetime | None) -> datetime:
    """把 action 时间统一成可比较的 UTC datetime。"""
    if value is None:
        return datetime.min.replace(tzinfo=UTC)
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _stability_meets_threshold(value: RankerStability | str, minimum: str) -> bool:
    """使用明确的稳定性序，而不是把字符串排序当作业务语义。"""
    order = {
        RankerStability.UNCALIBRATED.value: 0,
        RankerStability.CALIBRATING.value: 1,
        RankerStability.RELATIVELY_STABLE.value: 2,
        RankerStability.STABLE.value: 3,
        # 旧快照可能仍只保存 ORDER_UNCERTAIN；它现在是附加布尔语义，
        # 兼容读取时按其基础稳定度门槛继续判断。
        RankerStability.ORDER_UNCERTAIN.value: 2,
    }
    return order.get(_normalize_stability(value), -1) >= order[minimum]


def _validate_inputs(
    candidates: Sequence[CalibrationCandidate],
    preference_results: Sequence[CalibrationPreferenceResult],
    ratings: Sequence[CalibrationRating],
) -> tuple[dict[int, CalibrationCandidate], dict[int, CalibrationPreferenceResult], dict[int, CalibrationRating]]:
    """校验并按 content_id 建立纯内存索引。"""
    candidate_map = {item.content_id: item for item in candidates}
    if len(candidate_map) != len(candidates):
        raise ValueError('candidates 不能包含重复 content_id')
    preference_map = {item.content_id: item for item in preference_results}
    rating_map = {item.content_id: item for item in ratings}
    if len(preference_map) != len(preference_results):
        raise ValueError('preference_results 不能包含重复 content_id')
    if len(rating_map) != len(ratings):
        raise ValueError('ratings 不能包含重复 content_id')
    missing_preferences = sorted(set(candidate_map) - set(preference_map))
    missing_ratings = sorted(set(candidate_map) - set(rating_map))
    if missing_preferences:
        raise ValueError(f'缺少 preference result: {missing_preferences}')
    if missing_ratings:
        raise ValueError(f'缺少 rating: {missing_ratings}')
    for rating in ratings:
        if not 0 <= rating.current_score <= 100 or not 0 <= rating.score_anchor <= 100:
            raise ValueError('current_score 和 score_anchor 必须位于 [0, 100]')
    for result in preference_results:
        if not math.isfinite(result.preference_mean) or not math.isfinite(result.preference_std):
            raise ValueError('preference mean/std 必须是有限数')
        if result.preference_std < 0 or result.rank_low > result.rank_high:
            raise ValueError('preference uncertainty 或 rank interval 无效')
        if result.comparison_count < 0:
            raise ValueError('comparison_count 不能为负数')
    return candidate_map, preference_map, rating_map


def _fit_pava(
    points: Sequence[tuple[float, float, int]],
    *,
    assume_sorted: bool = False,
) -> _PavaModel:
    """使用加权 Pool Adjacent Violators Algorithm 拟合非递减曲线。"""
    if not points:
        raise ValueError('PAVA 至少需要一个训练点')
    ordered = list(points) if assume_sorted else sorted(points, key=lambda item: (item[0], item[2]))
    mutable_blocks: list[list[float | int]] = []
    for x_value, y_value, _content_id in ordered:
        mutable_blocks.append([x_value, x_value, y_value, 1.0, 1])
        while len(mutable_blocks) >= 2 and mutable_blocks[-2][2] > mutable_blocks[-1][2]:
            right = mutable_blocks.pop()
            left = mutable_blocks.pop()
            left_weight = float(left[3])
            right_weight = float(right[3])
            total_weight = left_weight + right_weight
            merged_value = (float(left[2]) * left_weight + float(right[2]) * right_weight) / total_weight
            mutable_blocks.append(
                [
                    left[0],
                    right[1],
                    merged_value,
                    total_weight,
                    int(left[4]) + int(right[4]),
                ],
            )
    blocks = tuple(
        _PavaBlock(
            x_low=float(block[0]),
            x_high=float(block[1]),
            value=_finite(float(block[2])),
            weight=float(block[3]),
            count=int(block[4]),
        )
        for block in mutable_blocks
    )
    return _PavaModel(
        blocks=blocks,
        x_highs=tuple(block.x_high for block in blocks),
    )


def _sample_std(values: Sequence[float]) -> float:
    """计算局部 residual 的样本标准差。"""
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    return math.sqrt(sum((value - mean) ** 2 for value in values) / (len(values) - 1))


def _quantize_score(value: float, step: int) -> int:
    """将连续分数按 UI 粒度四舍五入并限制到 [0, 100]。"""
    return max(0, min(100, int(math.floor(_finite(value) / step + 0.5)) * step))


def _suggestion_key(
    content_id: int,
    current_score: int,
    recommended_score: int,
    direction: ScoreCalibrationDirection,
) -> str:
    """生成不包含 model_run_id 的稳定建议语义 key。"""
    return f'sc-v1:{content_id}:{current_score}:{recommended_score}:{direction.value}'


def _latest_actions(actions: Sequence[CalibrationAction]) -> dict[tuple[int, str], CalibrationAction]:
    """保留每个作品/建议语义的最新动作。"""
    latest: dict[tuple[int, str], CalibrationAction] = {}
    for action in actions:
        key = (action.content_id, action.suggestion_key)
        previous = latest.get(key)
        if previous is None:
            latest[key] = action
            continue
        previous_time = _aware_datetime(previous.created_at)
        current_time = _aware_datetime(action.created_at)
        if current_time >= previous_time:
            latest[key] = action
    return latest


def _is_suppressed(
    action: CalibrationAction | None,
    *,
    comparison_count: int,
    comparison_state_version: int,
    effective_comparison_max_id: int | None,
    now: datetime,
    config: ScoreCalibrationConfig,
) -> bool:
    """按 REJECTED/ACCEPTED/DISMISSED 语义判断是否抑制。"""
    if action is None:
        return False
    action_type = _normalize_action(action.action)
    if action_type in {'REJECTED', 'ACCEPTED'}:
        return True
    if action_type != 'DISMISSED':
        return False
    if (
        action.comparison_state_version_at_action is not None
        and comparison_state_version < action.comparison_state_version_at_action
    ):
        return True
    if (
        action.effective_comparison_max_id_at_action is not None
        and effective_comparison_max_id is not None
        and effective_comparison_max_id > action.effective_comparison_max_id_at_action
    ):
        return False
    if (
        action.comparison_count_at_action is not None
        and comparison_count - action.comparison_count_at_action >= config.dismissed_new_evidence_comparisons
    ):
        return False
    if action.created_at is None:
        return True
    created_at = action.created_at if action.created_at.tzinfo else action.created_at.replace(tzinfo=UTC)
    age_seconds = max(0.0, (now - created_at).total_seconds())
    return age_seconds < config.dismissed_suppression_days * 86400


def _confidence(
    *,
    current_score: int,
    lower: float,
    upper: float,
    prediction_std: float,
    local_support: int,
    calibration_sample_count: int,
    config: ScoreCalibrationConfig,
) -> float:
    """计算可解释置信度，不直接把 stability 映射为固定分数。"""
    outside_margin = max(lower - current_score, current_score - upper, 0.0)
    disagreement = _clamp(outside_margin / max(config.min_score_delta, 1.0))
    uncertainty = math.exp(-prediction_std / config.confidence_uncertainty_scale)
    support = _clamp(local_support / config.local_support_saturation)
    sample_support = _clamp(calibration_sample_count / max(config.min_calibration_samples * 2, 1))
    return _clamp(
        0.45 * disagreement
        + 0.25 * uncertainty
        + 0.20 * support
        + 0.10 * sample_support
    )


def _evaluate_target(
    *,
    target_id: int,
    preference: CalibrationPreferenceResult,
    rating: CalibrationRating,
    training_points: Sequence[tuple[float, float, int]],
    candidate_count: int,
    model_freshness: CalibrationFreshness,
    previous_actions: dict[tuple[int, str], CalibrationAction],
    previous_suggestions: Sequence[PreviousCalibrationSuggestion],
    comparison_state_version: int,
    effective_comparison_max_id: int | None,
    now: datetime,
    config: ScoreCalibrationConfig,
    timings: dict[str, float],
) -> ScoreCalibrationEvaluation:
    """为一个目标作品执行 Leave-One-Out 拟合和所有过滤。"""
    sample_count = len(training_points)
    base = {
        'content_id': target_id,
        'current_score': rating.current_score,
        'predicted_score': None,
        'suggested_score_low': None,
        'suggested_score_high': None,
        'recommended_score': None,
        'direction': None,
        'confidence': 0.0,
        'severity': 0.0,
        'reason_code': None,
        'suggestion_key': None,
        'local_support': 0,
        'prediction_std': None,
        'calibration_sample_count': sample_count,
        'eligible': False,
        'exclusion_reason': None,
    }

    if model_freshness is CalibrationFreshness.BOOTSTRAP:
        base['exclusion_reason'] = CalibrationExclusionReason.BOOTSTRAP_MODEL.value
        return ScoreCalibrationEvaluation(**base)
    if model_freshness is CalibrationFreshness.STALE_REQUIRES_FULL:
        base['exclusion_reason'] = CalibrationExclusionReason.STALE_MODEL.value
        return ScoreCalibrationEvaluation(**base)
    if sample_count < config.min_calibration_samples:
        base['exclusion_reason'] = CalibrationExclusionReason.CALIBRATION_SAMPLES_INSUFFICIENT.value
        return ScoreCalibrationEvaluation(**base)
    if preference.comparison_count < config.min_comparisons_for_suggestion:
        base['exclusion_reason'] = CalibrationExclusionReason.COMPARISONS_INSUFFICIENT.value
        return ScoreCalibrationEvaluation(**base)
    if not _stability_meets_threshold(preference.stability, config.min_stability):
        base['exclusion_reason'] = CalibrationExclusionReason.STABILITY_INSUFFICIENT.value
        return ScoreCalibrationEvaluation(**base)

    fit_started = time.perf_counter()
    model = _fit_pava(training_points, assume_sorted=True)
    timings['fit'] += time.perf_counter() - fit_started
    prediction_started = time.perf_counter()
    predicted_score = _finite(model.predict(preference.preference_mean))
    local_points = [
        point
        for point in training_points
        if abs(point[0] - preference.preference_mean) <= config.local_preference_band_width
    ]
    local_support = len(local_points)
    residual_points = local_points if len(local_points) >= 2 else list(training_points)
    residuals = [point[1] - model.predict(point[0]) for point in residual_points]
    noise_std = max(config.calibration_noise_floor, _sample_std(residuals))
    preference_component = max(0.0, preference.preference_std) * config.preference_uncertainty_score_scale
    rank_width = max(0, preference.rank_high - preference.rank_low)
    rank_component = rank_width / max(candidate_count - 1, 1) * config.rank_interval_score_scale
    prediction_std = math.sqrt(noise_std**2 + preference_component**2 + rank_component**2)
    quantile = NormalDist().inv_cdf((1.0 + config.prediction_interval_probability) / 2.0)
    lower = max(0.0, predicted_score - quantile * prediction_std)
    upper = min(100.0, predicted_score + quantile * prediction_std)
    base.update(
        predicted_score=predicted_score,
        local_support=local_support,
        prediction_std=prediction_std,
    )

    reason = (
        ScoreCalibrationReasonCode.PREFERENCE_HIGHER_THAN_SCORE
        if predicted_score > rating.current_score
        else ScoreCalibrationReasonCode.PREFERENCE_LOWER_THAN_SCORE
    )
    direction = (
        ScoreCalibrationDirection.UP
        if predicted_score > rating.current_score
        else ScoreCalibrationDirection.DOWN
    )
    confidence = _confidence(
        current_score=rating.current_score,
        lower=lower,
        upper=upper,
        prediction_std=prediction_std,
        local_support=local_support,
        calibration_sample_count=sample_count,
        config=config,
    )
    severity = _clamp(abs(predicted_score - rating.current_score) / max(config.min_score_delta * 2, 1.0)) * confidence
    base.update(
        direction=direction,
        confidence=confidence,
        severity=severity,
        reason_code=reason,
    )

    suggested_low = _quantize_score(lower, config.score_step)
    suggested_high = _quantize_score(upper, config.score_step)
    recommended = _quantize_score(predicted_score, config.score_step)
    if direction is ScoreCalibrationDirection.UP:
        suggested_low = max(suggested_low, _quantize_score(rating.current_score + config.score_step, config.score_step))
        suggested_high = max(suggested_high, suggested_low)
        recommended = max(recommended, suggested_low)
    else:
        suggested_high = min(
            suggested_high,
            _quantize_score(rating.current_score - config.score_step, config.score_step),
        )
        suggested_low = min(suggested_low, suggested_high)
        recommended = min(recommended, suggested_high)
    suggested_low = max(0, min(100, suggested_low))
    suggested_high = max(suggested_low, min(100, suggested_high))
    recommended = max(suggested_low, min(suggested_high, recommended))
    key = _suggestion_key(target_id, rating.current_score, recommended, direction)
    base.update(
        suggested_score_low=suggested_low,
        suggested_score_high=suggested_high,
        recommended_score=recommended,
        suggestion_key=key,
    )
    timings['prediction'] += time.perf_counter() - prediction_started

    filtering_started = time.perf_counter()
    extreme_outlier = (
        preference.comparison_count >= config.order_uncertain_min_comparisons
        and abs(predicted_score - rating.current_score) >= config.extreme_outlier_min_score_delta
        and not lower <= rating.current_score <= upper
    )
    exclusion_reason: str | None = None
    if local_support < config.min_local_support and not extreme_outlier:
        exclusion_reason = CalibrationExclusionReason.LOCAL_SUPPORT_INSUFFICIENT.value
    elif lower <= rating.current_score <= upper:
        exclusion_reason = CalibrationExclusionReason.CURRENT_SCORE_WITHIN_INTERVAL.value
    elif abs(predicted_score - rating.current_score) < config.min_score_delta:
        exclusion_reason = CalibrationExclusionReason.SCORE_DELTA_INSUFFICIENT.value
    else:
        threshold = (
            config.fast_confidence_threshold
            if model_freshness is CalibrationFreshness.FAST
            else config.confidence_threshold
        )
        if extreme_outlier:
            threshold = config.extreme_outlier_confidence_threshold
        if any(
            item.content_id == target_id
            and item.active
            and item.suggestion_key == key
            for item in previous_suggestions
        ):
            threshold = min(threshold, config.hysteresis_confidence_threshold)
        if confidence < threshold:
            exclusion_reason = CalibrationExclusionReason.CONFIDENCE_INSUFFICIENT.value
        elif _is_suppressed(
            previous_actions.get((target_id, key)),
            comparison_count=preference.comparison_count,
            comparison_state_version=comparison_state_version,
            effective_comparison_max_id=effective_comparison_max_id,
            now=now,
            config=config,
        ):
            exclusion_reason = CalibrationExclusionReason.ACTION_SUPPRESSED.value
    if exclusion_reason is not None:
        base['exclusion_reason'] = exclusion_reason
        timings['filter'] += time.perf_counter() - filtering_started
        return ScoreCalibrationEvaluation(**base)
    base['eligible'] = True
    timings['filter'] += time.perf_counter() - filtering_started
    return ScoreCalibrationEvaluation(**base)


def generate_score_calibrations(
    candidates: Sequence[CalibrationCandidate],
    preference_results: Sequence[CalibrationPreferenceResult],
    ratings: Sequence[CalibrationRating],
    previous_actions: Sequence[CalibrationAction] = (),
    config: ScoreCalibrationConfig | None = None,
    *,
    model_freshness: CalibrationFreshness | str = CalibrationFreshness.FULL,
    previous_suggestions: Sequence[PreviousCalibrationSuggestion] = (),
    comparison_state_version: int = 0,
    effective_comparison_max_id: int | None = None,
    now: datetime | None = None,
) -> ScoreCalibrationResult:
    """根据当前个人偏好生成评分校准 suggestions，不产生任何持久化副作用。

    ``score_anchor`` 只出现在训练点；目标作品自己的 anchor 会被 Leave-One-Out
    排除。``current_score`` 只参与偏差检测、方向和稳定 key，不参与 PAVA 拟合。
    """
    active_config = config or ScoreCalibrationConfig()
    freshness = _normalize_freshness(model_freshness)
    active_now = now or datetime.now(UTC)
    if active_now.tzinfo is None:
        active_now = active_now.replace(tzinfo=UTC)
    candidate_map, preference_map, rating_map = _validate_inputs(candidates, preference_results, ratings)
    started_at = time.perf_counter()
    candidate_ids = tuple(sorted(candidate_map))
    training_by_target: dict[int, list[tuple[float, float, int]]] = {}
    valid_training = sorted(
        [
        (preference_map[content_id].preference_mean, rating_map[content_id].score_anchor, content_id)
        for content_id in candidate_ids
        if rating_map[content_id].score_anchor > 0
        ],
        key=lambda item: (item[0], item[2]),
    )
    for target_id in candidate_ids:
        training_by_target[target_id] = [point for point in valid_training if point[2] != target_id]
    calibration_sample_count = len(valid_training)
    timings = {'fit': 0.0, 'prediction': 0.0, 'filter': 0.0}
    evaluations: list[ScoreCalibrationEvaluation] = []
    latest_actions = _latest_actions(previous_actions)
    for target_id in candidate_ids:
        evaluation = _evaluate_target(
            target_id=target_id,
            preference=preference_map[target_id],
            rating=rating_map[target_id],
            training_points=training_by_target[target_id],
            candidate_count=len(candidate_ids),
            model_freshness=freshness,
            previous_actions=latest_actions,
            previous_suggestions=previous_suggestions,
            comparison_state_version=comparison_state_version,
            effective_comparison_max_id=effective_comparison_max_id,
            now=active_now,
            config=active_config,
            timings=timings,
        )
        evaluations.append(evaluation)
    filtering_started_at = time.perf_counter()
    eligible = [
        evaluation
        for evaluation in evaluations
        if evaluation.eligible
        and evaluation.suggestion_key is not None
        and evaluation.direction is not None
        and evaluation.predicted_score is not None
        and evaluation.suggested_score_low is not None
        and evaluation.suggested_score_high is not None
        and evaluation.recommended_score is not None
        and evaluation.reason_code is not None
        and evaluation.prediction_std is not None
    ]
    eligible.sort(key=lambda item: (-item.severity, -item.confidence, item.content_id))
    if active_config.max_suggestions is not None:
        eligible = eligible[: active_config.max_suggestions]
    suggestions = tuple(
        ScoreCalibrationSuggestion(
            content_id=evaluation.content_id,
            current_score=evaluation.current_score,
            predicted_score=cast(float, evaluation.predicted_score),
            suggested_score_low=cast(int, evaluation.suggested_score_low),
            suggested_score_high=cast(int, evaluation.suggested_score_high),
            recommended_score=cast(int, evaluation.recommended_score),
            direction=cast(ScoreCalibrationDirection, evaluation.direction),
            confidence=evaluation.confidence,
            severity=evaluation.severity,
            reason_code=cast(ScoreCalibrationReasonCode, evaluation.reason_code),
            suggestion_key=cast(str, evaluation.suggestion_key),
            local_support=evaluation.local_support,
            prediction_std=cast(float, evaluation.prediction_std),
            calibration_sample_count=evaluation.calibration_sample_count,
        )
        for evaluation in eligible
    )
    filtering_seconds = timings['filter'] + time.perf_counter() - filtering_started_at
    skipped_model_reason = None
    if freshness is CalibrationFreshness.BOOTSTRAP:
        skipped_model_reason = CalibrationExclusionReason.BOOTSTRAP_MODEL.value
    elif freshness is CalibrationFreshness.STALE_REQUIRES_FULL:
        skipped_model_reason = CalibrationExclusionReason.STALE_MODEL.value
    diagnostics = ScoreCalibrationDiagnostics(
        candidate_count=len(candidate_ids),
        calibration_sample_count=calibration_sample_count,
        fitted_target_count=sum(
            evaluation.predicted_score is not None for evaluation in evaluations
        ),
        suggestion_count=len(suggestions),
        model_freshness=freshness.value,
        skipped_model_reason=skipped_model_reason,
        fit_seconds=timings['fit'],
        prediction_seconds=timings['prediction'],
        filtering_seconds=filtering_seconds,
        total_seconds=time.perf_counter() - started_at,
    )
    return ScoreCalibrationResult(
        suggestions=suggestions,
        evaluations=tuple(evaluations),
        diagnostics=diagnostics,
    )


__all__ = [
    'CalibrationAction',
    'CalibrationCandidate',
    'CalibrationExclusionReason',
    'CalibrationFreshness',
    'CalibrationPreferenceResult',
    'CalibrationRating',
    'PreviousCalibrationSuggestion',
    'ScoreCalibrationConfig',
    'ScoreCalibrationDirection',
    'ScoreCalibrationEvaluation',
    'ScoreCalibrationReasonCode',
    'ScoreCalibrationResult',
    'ScoreCalibrationSuggestion',
    'generate_score_calibrations',
]
