"""红蓝合战阶段 4B 领域 Service、Fast State 缓存和 Full Recalibration。

本模块不提供 HTTP Router。它负责把 SQLAlchemy 事实转换为阶段 4A 的纯算法
输入，并维护可丢弃的进程内 Fast State：

``database facts -> full snapshot/bootstrap -> replay -> fast update -> selector``

Comparison 和 RatingRevision 是事实；Fast State 只是缓存。任何缓存都可以被
删除，下一次访问会从最近兼容的 Full Snapshot 和其后的 comparison 重建。
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
import weakref
from collections import OrderedDict
from collections.abc import Callable, Sequence
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from enum import StrEnum

from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from database import SessionLocal
from models import (
    SCORE_ANCHOR_REVISION_SOURCES,
    ContentItem,
    PreferenceModelRun,
    PreferenceModelRunStatus,
    PreferenceStability,
    Rating,
    RatingRevision,
    RedBlueComparison,
    RedBlueOutcome,
    RedBlueUserState,
)
from models import (
    PreferenceResult as ORMPreferenceResult,
)
from services.content import ANIME_CONTENT_TYPES
from services.red_blue_fast_ranker import (
    FastPreferenceState as AlgorithmFastPreferenceState,
)
from services.red_blue_fast_ranker import (
    FastUpdateConfig,
    FastUpdateStrategy,
    create_fast_preference_state,
    fast_update_preference,
    to_selector_candidates,
)
from services.red_blue_pair_selector import (
    SelectedPair,
    SelectionReason,
    SelectorComparison,
    SelectorConfig,
    SelectorContext,
    SelectorOutcome,
    select_pair,
)
from services.red_blue_ranker import (
    Candidate,
    Comparison,
    ComparisonOutcome,
    RankerConfig,
    RankerStability,
    ScoreAnchor,
    build_score_priors,
    normalize_preference_results,
    rank_preferences,
)
from services.red_blue_ranker import (
    PreferenceResult as AlgorithmPreferenceResult,
)
from services.red_blue_score_calibration import (
    CalibrationCandidate,
    CalibrationFreshness,
    CalibrationPreferenceResult,
    CalibrationRating,
    ScoreCalibrationConfig,
)
from services.red_blue_score_suggestions import (
    ScoreSuggestionActionResult,
    ScoreSuggestionDelta,
    ScoreSuggestionService,
    ScoreSuggestionView,
)

logger = logging.getLogger(__name__)


class ModelFreshness(StrEnum):
    """领域状态对最近权威 Full Snapshot 的新鲜度。"""

    FULL = 'FULL'
    FAST = 'FAST'
    BOOTSTRAP = 'BOOTSTRAP'
    STALE_REQUIRES_FULL = 'STALE_REQUIRES_FULL'


class PairStatus(StrEnum):
    """下一组 PK 的可用状态，避免 HTTP 客户端从 null 猜原因。"""

    AVAILABLE = 'AVAILABLE'
    INSUFFICIENT_CANDIDATES = 'INSUFFICIENT_CANDIDATES'
    COOLDOWN = 'COOLDOWN'


class FullRecalibrationReason(StrEnum):
    """Full Ranker 触发原因。"""

    FIRST_SNAPSHOT = 'first_snapshot'
    FAST_UPDATE_LIMIT = 'fast_update_limit'
    FAST_STATE_AGE = 'fast_state_age'
    SCORE_ANCHOR_CHANGED = 'score_anchor_changed'
    CANDIDATE_CHANGED = 'candidate_changed'
    COMPARISON_REVOKED = 'comparison_revoked'
    ALGORITHM_CHANGED = 'algorithm_changed'
    MANUAL = 'manual'


@dataclass(frozen=True, slots=True)
class RedBlueServiceConfig:
    """4B 所有缓存、Selector 和 Full 调度参数。"""

    ranker_config: RankerConfig = field(default_factory=RankerConfig)
    selector_config: SelectorConfig = field(default_factory=SelectorConfig)
    fast_update_config: FastUpdateConfig = field(default_factory=FastUpdateConfig)
    score_calibration_config: ScoreCalibrationConfig = field(default_factory=ScoreCalibrationConfig)
    cache_ttl_seconds: float = 900.0
    cache_max_users: int = 128
    selector_history_window: int = 200
    max_fast_updates_before_full: int = 10
    max_fast_state_age_seconds: float = 900.0
    stale_running_seconds: float = 3600.0
    full_worker_max_workers: int = 1

    def __post_init__(self) -> None:
        """校验不会导致无限缓存或失控后台任务的配置。"""
        if self.cache_ttl_seconds <= 0 or self.cache_max_users < 1:
            raise ValueError('Fast cache 参数无效')
        if self.selector_history_window < 1:
            raise ValueError('selector_history_window 必须至少为 1')
        if self.max_fast_updates_before_full < 1:
            raise ValueError('max_fast_updates_before_full 必须至少为 1')
        if self.max_fast_state_age_seconds <= 0 or self.stale_running_seconds <= 0:
            raise ValueError('Full Ranker age 参数必须大于 0')
        if self.full_worker_max_workers < 1:
            raise ValueError('full_worker_max_workers 必须至少为 1')

    @classmethod
    def from_env(cls) -> RedBlueServiceConfig:
        """从环境变量读取运行参数；算法对象仍使用当前默认配置。"""
        return cls(
            cache_ttl_seconds=float(os.getenv('MOREANI_RED_BLUE_CACHE_TTL_SECONDS', '900')),
            cache_max_users=int(os.getenv('MOREANI_RED_BLUE_CACHE_MAX_USERS', '128')),
            selector_history_window=int(os.getenv('MOREANI_RED_BLUE_SELECTOR_HISTORY_WINDOW', '200')),
            max_fast_updates_before_full=int(os.getenv('MOREANI_RED_BLUE_MAX_FAST_UPDATES', '10')),
            max_fast_state_age_seconds=float(os.getenv('MOREANI_RED_BLUE_MAX_FAST_STATE_AGE_SECONDS', '900')),
            stale_running_seconds=float(os.getenv('MOREANI_RED_BLUE_STALE_RUNNING_SECONDS', '3600')),
            full_worker_max_workers=int(os.getenv('MOREANI_RED_BLUE_FULL_WORKERS', '1')),
        )


@dataclass(frozen=True, slots=True)
class FastStateItem:
    """面向领域调用方的单部作品状态。"""

    content_id: int
    preference_mean: float
    preference_std: float | None
    provisional_rank: int
    authoritative_expected_rank: float | None
    authoritative_rank_low: int | None
    authoritative_rank_high: int | None
    authoritative_stability: str
    authoritative_order_uncertain: bool
    comparison_count: int


@dataclass(frozen=True, slots=True)
class ContentSnapshot:
    """API 所需的轻量作品信息；不包含 Content Detail。"""

    content_id: int
    title: str
    description: str
    cover_url: str | None
    content_type: str
    current_score: int


@dataclass(frozen=True, slots=True)
class ComparisonHistoryItem:
    """一条仍可撤销的 PK 历史及其左右作品标题。"""

    id: int
    left_content_id: int
    right_content_id: int
    left_title: str
    right_title: str
    outcome: RedBlueOutcome
    client_event_id: str
    selector_version: str
    created_at: datetime | None
    revoked_at: datetime | None


@dataclass(frozen=True, slots=True)
class ComparisonHistoryPage:
    """当前用户可撤销 PK 历史的一页及总数。"""

    items: tuple[ComparisonHistoryItem, ...]
    total: int
    page: int
    size: int


@dataclass(frozen=True, slots=True)
class RuntimeFastState:
    """纯算法 Fast State 加上数据库 watermark 的运行时封装。"""

    user_id: int
    algorithm_state: AlgorithmFastPreferenceState
    base_model_run_id: int | None
    base_comparison_max_id: int | None
    comparison_state_version: int
    revoke_version: int
    anchor_revision_max_id: int | None
    algorithm_version: str
    algorithm_config_fingerprint: str
    candidate_ids: tuple[int, ...]
    last_applied_comparison_id: int | None
    fast_updates_since_full: int
    created_at: datetime
    last_accessed_at: datetime
    freshness: ModelFreshness
    requires_full_ranker: bool


@dataclass(frozen=True, slots=True)
class BattlePair:
    """领域层下一组有向展示 Pair。"""

    left_content_id: int
    right_content_id: int
    selection_reason: str
    selector_version: str
    components: tuple[tuple[str, float], ...]


@dataclass(frozen=True, slots=True)
class RankingDelta:
    """一次 comparison 后所有受排序挤压影响的作品变化。"""

    content_id: int
    old_rank: int | None
    new_rank: int
    preference_mean: float
    comparison_count: int
    stability: str
    order_uncertain: bool
    rank_low: int | None
    rank_high: int | None


@dataclass(frozen=True, slots=True)
class BattleState:
    """不绑定 FastAPI 的领域状态。"""

    user_id: int
    items: tuple[FastStateItem, ...]
    next_pair: BattlePair | None
    comparison_state_version: int
    base_model_run_id: int | None
    freshness: ModelFreshness
    pair_status: PairStatus
    full_recalibration_required: bool
    full_recalibration_running: bool
    score_suggestions: tuple[ScoreSuggestionView, ...] = ()


@dataclass(frozen=True, slots=True)
class ComparisonResult:
    """record_comparison 的领域结果。"""

    comparison_id: int | None
    left_content_id: int | None
    right_content_id: int | None
    outcome: RedBlueOutcome | None
    client_event_id: str | None
    selector_version: str | None
    created_at: datetime | None
    revoked_at: datetime | None
    ranking_delta: tuple[RankingDelta, ...]
    next_pair: BattlePair | None
    pair_status: PairStatus
    comparison_state_version: int
    base_model_run_id: int | None
    freshness: ModelFreshness
    full_recalibration_required: bool
    full_recalibration_running: bool
    idempotent_replay: bool
    score_suggestion_delta: ScoreSuggestionDelta = ScoreSuggestionDelta()


class RedBlueComparisonConflictError(ValueError):
    """同一幂等键对应了不同事实 payload。"""


class RedBlueComparisonNotFoundError(ValueError):
    """当前用户看不到目标 comparison。"""


@dataclass(frozen=True, slots=True)
class FullRecalibrationResult:
    """Full Ranker 一次运行的可诊断结果。"""

    model_run_id: int | None
    status: PreferenceModelRunStatus
    applied_to_cache: bool
    follow_up_required: bool
    error_message: str | None = None


@dataclass(frozen=True, slots=True)
class _DatabaseContext:
    candidate_ids: tuple[int, ...]
    comparison_max_id: int | None
    comparison_state_version: int
    revoke_version: int
    anchor_revision_max_id: int | None
    algorithm_version: str
    algorithm_config_fingerprint: str
    latest_completed_model_run_id: int | None


@dataclass(frozen=True, slots=True)
class _FullRankerInputSnapshot:
    """一次 Full Ranker 使用的不可变数据库输入及其版本指纹。"""

    context: _DatabaseContext
    candidates: tuple[Candidate, ...]
    anchors: tuple[ScoreAnchor, ...]
    comparisons: tuple[Comparison, ...]
    ranker_config: RankerConfig
    algorithm_config_json: str

    @property
    def fingerprint(self) -> tuple[object, ...]:
        return _full_input_fingerprint(self.context, self.anchors)


@dataclass(frozen=True, slots=True)
class _CacheEntry:
    state: RuntimeFastState
    expires_at: float


class RedBlueFastStateCache:
    """有界 TTL + LRU 的用户 Fast State 缓存。

    全局 mutex 只保护字典和 per-user lock 创建；实际同一用户的领域计算由
    独立 RLock 串行化，不会阻塞其他用户。
    """

    def __init__(self, *, ttl_seconds: float = 900.0, max_users: int = 128) -> None:
        if ttl_seconds <= 0 or max_users < 1:
            raise ValueError('Fast cache 参数无效')
        self.ttl_seconds = ttl_seconds
        self.max_users = max_users
        self._entries: OrderedDict[int, _CacheEntry] = OrderedDict()
        # 弱引用避免大量历史用户只因访问过服务而永久占用 lock 对象。
        self._user_locks: weakref.WeakValueDictionary[int, threading.RLock] = weakref.WeakValueDictionary()
        self._lock = threading.Lock()

    def user_lock(self, user_id: int) -> threading.RLock:
        """返回指定用户的独立锁。"""
        with self._lock:
            return self._user_locks.setdefault(user_id, threading.RLock())

    def get(self, user_id: int, *, now: float | None = None) -> RuntimeFastState | None:
        """读取未过期缓存并更新 LRU / last_accessed。"""
        current = time.monotonic() if now is None else now
        with self._lock:
            entry = self._entries.get(user_id)
            if entry is None:
                return None
            if entry.expires_at <= current:
                self._entries.pop(user_id, None)
                return None
            refreshed = replace(
                entry.state,
                last_accessed_at=datetime.now(UTC),
            )
            self._entries[user_id] = _CacheEntry(refreshed, current + self.ttl_seconds)
            self._entries.move_to_end(user_id)
            return refreshed

    def put(self, state: RuntimeFastState, *, now: float | None = None) -> None:
        """原子替换一个用户的 Fast State。"""
        current = time.monotonic() if now is None else now
        refreshed = replace(state, last_accessed_at=datetime.now(UTC))
        with self._lock:
            self._entries[state.user_id] = _CacheEntry(refreshed, current + self.ttl_seconds)
            self._entries.move_to_end(state.user_id)
            while len(self._entries) > self.max_users:
                self._entries.popitem(last=False)

    def invalidate(self, user_id: int) -> None:
        """删除缓存，不影响数据库事实。"""
        with self._lock:
            self._entries.pop(user_id, None)

    def clear(self) -> None:
        """清空所有缓存。"""
        with self._lock:
            self._entries.clear()

    def size(self) -> int:
        """返回当前缓存用户数，供诊断和测试使用。"""
        with self._lock:
            return len(self._entries)


class RedBlueService:
    """红蓝合战领域服务；不包含 HTTP schema。"""

    def __init__(
        self,
        *,
        session_factory: Callable[[], Session] = SessionLocal,
        config: RedBlueServiceConfig | None = None,
        cache: RedBlueFastStateCache | None = None,
    ) -> None:
        self.session_factory = session_factory
        self.config = config or RedBlueServiceConfig.from_env()
        self.cache = cache or RedBlueFastStateCache(
            ttl_seconds=self.config.cache_ttl_seconds,
            max_users=self.config.cache_max_users,
        )
        self.score_suggestion_service = ScoreSuggestionService(
            self.config.score_calibration_config,
        )
        self._executor = ThreadPoolExecutor(
            max_workers=self.config.full_worker_max_workers,
            thread_name_prefix='moreani-red-blue-full',
        )
        self._coordination_lock = threading.Lock()
        self._running_users: set[int] = set()
        self._pending_reasons: dict[int, FullRecalibrationReason] = {}
        self._running_input_fingerprints: dict[int, tuple[object, ...]] = {}
        self._futures: dict[int, Future[FullRecalibrationResult]] = {}

    def close(self) -> None:
        """停止后台协调器；数据库事实和已完成 Snapshot 不受影响。"""
        self._executor.shutdown(wait=False, cancel_futures=False)

    def get_battle_state(self, db: Session, *, user_id: int) -> BattleState:
        """读取当前状态；缓存 miss 或 watermark 落后时先重建，再返回下一 Pair。"""
        with self.cache.user_lock(user_id):
            state = self._get_or_build_state_locked(db, user_id=user_id)
            if state.requires_full_ranker:
                reason = self._reason_for_state(state)
                self.request_full_recalibration(user_id, reason)
            _delta, suggestions = self._refresh_score_suggestions_locked(db, state)
            return self._battle_state(db, state, score_suggestions=suggestions)

    def handle_score_suggestion(
        self,
        db: Session,
        *,
        user_id: int,
        suggestion_id: int,
        suggestion_key: str,
        action: str,
        client_event_id: str,
    ) -> tuple[ScoreSuggestionActionResult, BattleState]:
        """提交建议动作，并返回动作结果及动作后的可恢复状态。"""
        with self.cache.user_lock(user_id):
            # 先把 suggestion cache 与当前候选/Anchor/Freshness 对齐，避免
            # 客户端绕过 GET 或最近一次 comparison 直接消费 stale PENDING。
            current_state = self._get_or_build_state_locked(db, user_id=user_id)
            self._refresh_score_suggestions_locked(db, current_state)
            action_result = self.score_suggestion_service.apply_action(
                db,
                user_id=user_id,
                suggestion_id=suggestion_id,
                suggestion_key=suggestion_key,
                action=action,
                client_event_id=client_event_id,
            )
            state = self._get_or_build_state_locked(db, user_id=user_id)
            _delta, suggestions = self._refresh_score_suggestions_locked(db, state)
            return action_result, self._battle_state(db, state, score_suggestions=suggestions)

    def get_content_snapshots(
        self,
        db: Session,
        *,
        user_id: int,
        content_ids: Sequence[int],
    ) -> dict[int, ContentSnapshot]:
        """批量读取 API 所需的候选作品摘要和当前评分。"""
        unique_ids = tuple(dict.fromkeys(int(content_id) for content_id in content_ids))
        if not unique_ids:
            return {}
        rows = (
            db.query(ContentItem, Rating.score)
            .join(Rating, Rating.content_id == ContentItem.id)
            .filter(
                Rating.user_id == user_id,
                Rating.score > 0,
                ContentItem.id.in_(unique_ids),
                ContentItem.content_type.in_(ANIME_CONTENT_TYPES),
                ContentItem.is_public.is_(True),
                ContentItem.deleted_at.is_(None),
            )
            .all()
        )
        return {
            content.id: ContentSnapshot(
                content_id=content.id,
                title=content.title,
                description=content.description or '',
                cover_url=content.cover_url or None,
                content_type=content.content_type,
                current_score=int(score),
            )
            for content, score in rows
        }

    def list_active_comparisons(
        self,
        db: Session,
        *,
        user_id: int,
        page: int = 1,
        size: int = 100,
    ) -> ComparisonHistoryPage:
        """分页读取当前用户仍可撤销的 PK 历史，按最新记录优先返回。"""
        if page < 1 or size < 1:
            raise ValueError('PK 历史分页参数无效')
        left_content = aliased(ContentItem)
        right_content = aliased(ContentItem)
        query = (
            db.query(RedBlueComparison, left_content, right_content)
            .join(left_content, left_content.id == RedBlueComparison.left_content_id)
            .join(right_content, right_content.id == RedBlueComparison.right_content_id)
            .filter(
                RedBlueComparison.user_id == user_id,
                RedBlueComparison.revoked_at.is_(None),
                RedBlueComparison.outcome != RedBlueOutcome.SKIP,
            )
        )
        total = query.order_by(None).count()
        rows = (
            query.order_by(RedBlueComparison.created_at.desc(), RedBlueComparison.id.desc())
            .offset((page - 1) * size)
            .limit(size)
            .all()
        )
        items = tuple(
            ComparisonHistoryItem(
                id=comparison.id,
                left_content_id=comparison.left_content_id,
                right_content_id=comparison.right_content_id,
                left_title=left.title,
                right_title=right.title,
                outcome=RedBlueOutcome(comparison.outcome.value),
                client_event_id=comparison.client_event_id,
                selector_version=comparison.selector_version,
                created_at=_aware_datetime(comparison.created_at),
                revoked_at=_aware_datetime(comparison.revoked_at),
            )
            for comparison, left, right in rows
        )
        return ComparisonHistoryPage(items=items, total=total, page=page, size=size)

    def record_comparison(
        self,
        db: Session,
        *,
        user_id: int,
        left_content_id: int,
        right_content_id: int,
        outcome: RedBlueOutcome | str,
        client_event_id: str,
        selector_version: str = 'v1',
        focus_content_id: int | None = None,
    ) -> ComparisonResult:
        """先提交 Comparison 事实，再 replay / Fast Update / 选择下一 Pair。

        ``focus_content_id`` 只是本次响应选择下一组 Pair 的临时上下文，
        不写入 Comparison，也不进入用户的可恢复状态。
        """
        parsed_outcome = _parse_outcome(outcome)
        if not client_event_id or len(client_event_id) > 64:
            raise ValueError('client_event_id 无效')
        if left_content_id == right_content_id:
            raise ValueError('不能比较同一部作品')

        with self.cache.user_lock(user_id):
            # 先建立一个截至写入前的状态，使 bootstrap 也能 replay 刚提交的事实。
            self._get_or_build_state_locked(db, user_id=user_id)
            existing = (
                db.query(RedBlueComparison)
                .filter(
                    RedBlueComparison.user_id == user_id,
                    RedBlueComparison.client_event_id == client_event_id,
                )
                .one_or_none()
            )
            if existing is not None:
                self._validate_idempotent_payload(
                    existing,
                    left_content_id=left_content_id,
                    right_content_id=right_content_id,
                    outcome=parsed_outcome,
                    selector_version=selector_version,
                )
                state = self._get_or_build_state_locked(db, user_id=user_id)
                return self._comparison_result(
                    db,
                    state,
                    existing,
                    old_state=None,
                    idempotent_replay=True,
                    focus_content_id=focus_content_id,
                )

            self._validate_candidate_pair(db, user_id, left_content_id, right_content_id)
            comparison = RedBlueComparison(
                user_id=user_id,
                left_content_id=left_content_id,
                right_content_id=right_content_id,
                outcome=parsed_outcome,
                client_event_id=client_event_id,
                selector_version=selector_version,
            )
            db.add(comparison)
            try:
                db.flush()
                self._increment_comparison_watermark(db, user_id, revoke=False)
                db.commit()
            except IntegrityError:
                # UNIQUE(user_id, client_event_id) 是最终幂等防线；冲突本身不是 500。
                db.rollback()
                existing = (
                    db.query(RedBlueComparison)
                    .filter(
                        RedBlueComparison.user_id == user_id,
                        RedBlueComparison.client_event_id == client_event_id,
                    )
                    .one()
                )
                self._validate_idempotent_payload(
                    existing,
                    left_content_id=left_content_id,
                    right_content_id=right_content_id,
                    outcome=parsed_outcome,
                    selector_version=selector_version,
                )
                state = self._get_or_build_state_locked(db, user_id=user_id)
                return self._comparison_result(
                    db,
                    state,
                    existing,
                    old_state=None,
                    idempotent_replay=True,
                    focus_content_id=focus_content_id,
                )

            db.refresh(comparison)
            old_state = self.cache.get(user_id)
            state = self._get_or_build_state_locked(db, user_id=user_id)
            if state.requires_full_ranker:
                self.request_full_recalibration(user_id, self._reason_for_state(state))
            elif state.fast_updates_since_full >= self.config.max_fast_updates_before_full:
                self.request_full_recalibration(user_id, FullRecalibrationReason.FAST_UPDATE_LIMIT)
            result = self._comparison_result(
                db,
                state,
                comparison,
                old_state=old_state,
                idempotent_replay=False,
                focus_content_id=focus_content_id,
                score_suggestion_delta=(
                    self._refresh_score_suggestions_locked(db, state)[0]
                    if parsed_outcome is not RedBlueOutcome.SKIP
                    else ScoreSuggestionDelta()
                ),
            )
            return result

    def revoke_comparison(
        self,
        db: Session,
        *,
        user_id: int,
        comparison_id: int,
    ) -> ComparisonResult:
        """撤销当前用户的 Comparison；幂等，并立即使 Fast State 失效。"""
        with self.cache.user_lock(user_id):
            comparison = (
                db.query(RedBlueComparison)
                .filter(
                    RedBlueComparison.id == comparison_id,
                    RedBlueComparison.user_id == user_id,
                )
                .one_or_none()
            )
            if comparison is None:
                raise RedBlueComparisonNotFoundError('comparison 不存在')
            was_already_revoked = comparison.revoked_at is not None
            if not was_already_revoked:
                comparison.revoked_at = datetime.now(UTC)
                self._increment_comparison_watermark(db, user_id, revoke=True)
                db.commit()
            else:
                db.rollback()
            self.cache.invalidate(user_id)
            state = self._get_or_build_state_locked(db, user_id=user_id)
            self.request_full_recalibration(user_id, FullRecalibrationReason.COMPARISON_REVOKED)
            return self._comparison_result(
                db,
                state,
                comparison,
                old_state=None,
                idempotent_replay=was_already_revoked,
            )

    def request_full_recalibration(
        self,
        user_id: int,
        reason: FullRecalibrationReason | str,
    ) -> bool:
        """请求用户级 Full；运行期间仅记录相对活动快照有变化的输入。"""
        parsed_reason = FullRecalibrationReason(reason)
        self._recover_stale_runs()
        with self._coordination_lock:
            if user_id in self._running_users:
                running_fingerprint = self._running_input_fingerprints.get(user_id)
                if running_fingerprint is not None:
                    current_fingerprint = self._read_current_full_input_fingerprint(user_id)
                    comparison_only_change = (
                        current_fingerprint[:2] != running_fingerprint[:2]
                        and current_fingerprint[2:] == running_fingerprint[2:]
                    )
                    if current_fingerprint != running_fingerprint and not (
                        parsed_reason is FullRecalibrationReason.FIRST_SNAPSHOT and comparison_only_change
                    ):
                        self._pending_reasons.setdefault(user_id, parsed_reason)
                return False
            db = self.session_factory()
            try:
                running = (
                    db.query(PreferenceModelRun)
                    .filter(
                        PreferenceModelRun.user_id == user_id,
                        PreferenceModelRun.status == PreferenceModelRunStatus.RUNNING,
                    )
                    .first()
                )
            finally:
                db.close()
            if running is not None:
                return False
            self._running_users.add(user_id)
            future = self._executor.submit(self._full_worker, user_id, parsed_reason)
            self._futures[user_id] = future
            return True

    def wait_for_recalibration(self, user_id: int, timeout: float | None = None) -> FullRecalibrationResult | None:
        """测试和轻量部署协调使用的等待方法；HTTP 层不必阻塞调用它。"""
        with self._coordination_lock:
            future = self._futures.get(user_id)
        if future is None:
            return None
        return future.result(timeout=timeout)

    def run_full_recalibration(
        self,
        user_id: int,
        reason: FullRecalibrationReason | str,
    ) -> FullRecalibrationResult:
        """在短一致性读事务内冻结输入，再于事务外计算并校验当前版本。"""
        snapshot_db = self.session_factory()
        try:
            _begin_consistent_read(snapshot_db)
            context = self._read_context_for_user(snapshot_db, user_id)
            candidates, anchors, comparisons = self._read_full_inputs(
                snapshot_db,
                user_id,
                max_comparison_id=context.comparison_max_id or 0,
            )
            if tuple(candidate.content_id for candidate in candidates) != context.candidate_ids:
                raise RuntimeError('Full Ranker 候选输入与快照 watermark 不一致')
            ranker_config = self.config.ranker_config
            algorithm_config_json = ranker_config.to_json()
            if _config_fingerprint(algorithm_config_json) != context.algorithm_config_fingerprint:
                raise RuntimeError('Full Ranker 配置在快照读取期间发生变化')
            snapshot = _FullRankerInputSnapshot(
                context=context,
                candidates=tuple(candidates),
                anchors=tuple(anchors),
                comparisons=tuple(comparisons),
                ranker_config=ranker_config,
                algorithm_config_json=algorithm_config_json,
            )
            snapshot_db.commit()
        except Exception as exc:  # noqa: BLE001
            snapshot_db.rollback()
            return FullRecalibrationResult(None, PreferenceModelRunStatus.FAILED, False, False, str(exc))
        finally:
            snapshot_db.close()

        with self._coordination_lock:
            if user_id in self._running_users:
                self._running_input_fingerprints[user_id] = snapshot.fingerprint
                # 本快照会包含其开始前已提交的全部更新。
                self._pending_reasons.pop(user_id, None)

        run_db = self.session_factory()
        try:
            run = PreferenceModelRun(
                user_id=user_id,
                algorithm_version=snapshot.context.algorithm_version,
                status=PreferenceModelRunStatus.RUNNING,
                input_comparison_max_id=snapshot.context.comparison_max_id,
                input_comparison_state_version=snapshot.context.comparison_state_version,
                input_revoke_version=snapshot.context.revoke_version,
                input_rating_revision_max_id=snapshot.context.anchor_revision_max_id,
                algorithm_config_json=snapshot.algorithm_config_json,
                started_at=datetime.now(UTC),
            )
            run_db.add(run)
            run_db.commit()
            run_db.refresh(run)
            run_id = run.id
        except Exception as exc:  # noqa: BLE001
            run_db.rollback()
            return FullRecalibrationResult(None, PreferenceModelRunStatus.FAILED, False, False, str(exc))
        finally:
            run_db.close()

        try:
            pure_output = rank_preferences(
                snapshot.candidates,
                snapshot.anchors,
                snapshot.comparisons,
                snapshot.ranker_config,
            )
            save_db = self.session_factory()
            try:
                run = save_db.query(PreferenceModelRun).filter(PreferenceModelRun.id == run_id).one()
                save_db.add_all(
                    [
                        ORMPreferenceResult(
                            model_run_id=run_id,
                            user_id=user_id,
                            content_id=result.content_id,
                            preference_mean=result.preference_mean,
                            preference_std=result.preference_std,
                            expected_rank=result.expected_rank,
                            rank_low=result.rank_low,
                            rank_high=result.rank_high,
                            stability=PreferenceStability(result.stability.value),
                            comparison_count=result.comparison_count,
                            order_uncertain=result.order_uncertain,
                        )
                        for result in pure_output.results
                    ],
                )
                run.status = PreferenceModelRunStatus.COMPLETED
                run.completed_at = datetime.now(UTC)
                run.error_message = None
                save_db.commit()
            finally:
                save_db.close()
        except Exception as exc:  # noqa: BLE001
            fail_db = self.session_factory()
            try:
                run = fail_db.query(PreferenceModelRun).filter(PreferenceModelRun.id == run_id).one_or_none()
                if run is not None:
                    run.status = PreferenceModelRunStatus.FAILED
                    run.completed_at = datetime.now(UTC)
                    run.error_message = f'{type(exc).__name__}: {exc}'
                    fail_db.commit()
            finally:
                fail_db.close()
            return FullRecalibrationResult(
                run_id,
                PreferenceModelRunStatus.FAILED,
                False,
                False,
                f'{type(exc).__name__}: {exc}',
            )

        final_db = self.session_factory()
        try:
            _begin_consistent_read(final_db)
            with self.cache.user_lock(user_id):
                final_context = self._read_context_for_user(final_db, user_id)
                final_candidates, final_anchors = self._read_candidate_anchors(final_db, user_id)
                live_fingerprint = _full_input_fingerprint(final_context, final_anchors)
                compatible = (
                    final_context.anchor_revision_max_id == snapshot.context.anchor_revision_max_id
                    and final_context.revoke_version == snapshot.context.revoke_version
                    and final_context.candidate_ids == snapshot.context.candidate_ids
                    and tuple(final_candidates) == snapshot.candidates
                    and tuple(final_anchors) == snapshot.anchors
                    and final_context.algorithm_version == snapshot.context.algorithm_version
                    and final_context.algorithm_config_fingerprint
                    == snapshot.context.algorithm_config_fingerprint
                    and (final_context.comparison_max_id or 0)
                    >= (snapshot.context.comparison_max_id or 0)
                    and final_context.comparison_state_version
                    >= snapshot.context.comparison_state_version
                )
                state: RuntimeFastState | None = None
                if compatible:
                    run_row = final_db.query(PreferenceModelRun).filter(PreferenceModelRun.id == run_id).one()
                    state = self._state_from_completed_run(
                        final_db,
                        user_id=user_id,
                        run=run_row,
                        candidates=snapshot.candidates,
                        anchors=snapshot.anchors,
                    )
                    state = self._replay_new_comparisons_locked(final_db, state, final_context)
                final_db.commit()
                if state is not None:
                    self.cache.put(state)
                    try:
                        self._refresh_score_suggestions_locked(final_db, state)
                    except Exception:  # noqa: BLE001
                        logger.exception('Full Ranker 已完成，但评分建议缓存刷新失败 user_id=%s', user_id)
            return FullRecalibrationResult(
                run_id,
                PreferenceModelRunStatus.COMPLETED,
                compatible,
                not compatible,
            )
        finally:
            final_db.close()

    def _read_current_full_input_fingerprint(self, user_id: int) -> tuple[object, ...]:
        """读取运行中 Full 的当前 watermark 与锚点，用于过滤重复 polling 请求。"""
        db = self.session_factory()
        try:
            _begin_consistent_read(db)
            context = self._read_context_for_user(db, user_id)
            _candidates, anchors = self._read_candidate_anchors(db, user_id)
            fingerprint = _full_input_fingerprint(context, anchors)
            db.commit()
            return fingerprint
        finally:
            db.close()

    def recover_stale_runs(self, db: Session) -> int:
        """把服务重启后遗留的 RUNNING 标记为 FAILED。"""
        cutoff = datetime.now(UTC) - timedelta(seconds=self.config.stale_running_seconds)
        rows = (
            db.query(PreferenceModelRun)
            .filter(PreferenceModelRun.status == PreferenceModelRunStatus.RUNNING)
            .all()
        )
        recovered = 0
        for run in rows:
            started_at = _aware_datetime(run.started_at)
            if started_at is None or started_at < cutoff:
                run.status = PreferenceModelRunStatus.FAILED
                run.completed_at = datetime.now(UTC)
                run.error_message = 'recovered_stale_running_after_process_restart'
                recovered += 1
        if recovered:
            db.commit()
        return recovered

    def _full_worker(
        self,
        user_id: int,
        reason: FullRecalibrationReason,
    ) -> FullRecalibrationResult:
        """串行完成输入变化所需的 Full；相同输入 polling 不会排队。"""
        next_reason = reason
        try:
            while True:
                result = self.run_full_recalibration(user_id, next_reason)
                if result.status is not PreferenceModelRunStatus.COMPLETED:
                    with self._coordination_lock:
                        self._running_users.discard(user_id)
                        self._running_input_fingerprints.pop(user_id, None)
                        self._pending_reasons.pop(user_id, None)
                    return result
                with self._coordination_lock:
                    pending = self._pending_reasons.pop(user_id, None)
                    if not result.follow_up_required and pending is None:
                        self._running_users.discard(user_id)
                        self._running_input_fingerprints.pop(user_id, None)
                        return result
                    next_reason = pending or reason
        except Exception:
            with self._coordination_lock:
                self._running_users.discard(user_id)
                self._running_input_fingerprints.pop(user_id, None)
                self._pending_reasons.pop(user_id, None)
            raise

    def _get_or_build_state_locked(self, db: Session, *, user_id: int) -> RuntimeFastState:
        """在调用者已持有 per-user lock 时取得兼容缓存或完成重建。"""
        self.recover_stale_runs(db)
        context = self._read_context_for_user(db, user_id)
        cached = self.cache.get(user_id)
        if cached is not None and self._cache_context_matches(cached, context):
            if cached.last_applied_comparison_id == context.comparison_max_id:
                return self._refresh_freshness(cached, context)
            if self._can_replay(cached, context):
                replayed = self._replay_new_comparisons_locked(db, cached, context)
                self.cache.put(replayed)
                return replayed

        state = self._build_from_latest_snapshot_or_bootstrap(db, user_id, context)
        self.cache.put(state)
        return state

    def _build_from_latest_snapshot_or_bootstrap(
        self,
        db: Session,
        user_id: int,
        context: _DatabaseContext,
    ) -> RuntimeFastState:
        """加载最近兼容 Full Snapshot；没有时只用 Score Prior bootstrap。"""
        candidates, anchors, _ = self._read_full_inputs(
            db,
            user_id,
            max_comparison_id=context.comparison_max_id or 0,
        )
        run = self._latest_compatible_run(db, user_id, context)
        if run is None:
            return self._build_bootstrap_state(db, user_id, context, candidates, anchors)
        state = self._state_from_completed_run(
            db,
            user_id=user_id,
            run=run,
            candidates=candidates,
            anchors=anchors,
        )
        # Full Snapshot 只覆盖它的输入 watermark；服务重启或 cache miss 后，
        # 必须把之后的 comparison replay 回 Fast State，不能把旧 Full 当作当前状态。
        return self._replay_new_comparisons_locked(db, state, context)

    def _build_bootstrap_state(
        self,
        db: Session,
        user_id: int,
        context: _DatabaseContext,
        candidates: Sequence[Candidate],
        anchors: Sequence[ScoreAnchor],
    ) -> RuntimeFastState:
        """使用 Ranker 的 Score Prior 建立可立即展示但必须 Full 的临时榜单。"""
        priors = build_score_priors(candidates, anchors, self.config.ranker_config)
        candidate_ids = tuple(candidate.content_id for candidate in candidates)
        ordered_ids = tuple(sorted(candidate_ids, key=lambda content_id: (-priors[content_id].mean, content_id)))
        rank_by_id = {content_id: rank for rank, content_id in enumerate(ordered_ids, start=1)}
        comparison_counts = self._comparison_counts(db, user_id, candidate_ids)
        results = tuple(
            AlgorithmPreferenceResult(
                content_id=content_id,
                preference_mean=priors[content_id].mean,
                preference_std=(1.0 / priors[content_id].precision) ** 0.5,
                expected_rank=float(rank_by_id[content_id]),
                rank_low=rank_by_id[content_id],
                rank_high=rank_by_id[content_id],
                stability=RankerStability.UNCALIBRATED,
                comparison_count=comparison_counts.get(content_id, 0),
            )
            for content_id in candidate_ids
        )
        from services.red_blue_ranker import RankerDiagnostics, RankerOutput

        algorithm_state = create_fast_preference_state(
            candidates,
            anchors,
            self._read_comparisons(db, user_id, max_id=context.comparison_max_id),
            RankerOutput(
                results=results,
                diagnostics=RankerDiagnostics(
                    candidate_count=len(candidate_ids),
                    valid_comparison_count=0,
                    ignored_comparison_count=0,
                    effective_pair_count=0,
                    repeated_pair_count=0,
                    effective_total_weight=0.0,
                    ignored_comparison_reasons={},
                    converged=True,
                    optimizer_iterations=0,
                    optimizer_objective=0.0,
                    gradient_norm=0.0,
                    hessian_condition_number=0.0,
                    covariance_jitter=0.0,
                    fallback_reason='bootstrap_score_prior_only',
                    map_seconds=0.0,
                    covariance_seconds=0.0,
                    posterior_sampling_seconds=0.0,
                    total_seconds=0.0,
                ),
            ),
        )
        now = datetime.now(UTC)
        return RuntimeFastState(
            user_id=user_id,
            algorithm_state=algorithm_state,
            base_model_run_id=None,
            base_comparison_max_id=context.comparison_max_id,
            comparison_state_version=context.comparison_state_version,
            revoke_version=context.revoke_version,
            anchor_revision_max_id=context.anchor_revision_max_id,
            algorithm_version=context.algorithm_version,
            algorithm_config_fingerprint=context.algorithm_config_fingerprint,
            candidate_ids=context.candidate_ids,
            last_applied_comparison_id=context.comparison_max_id,
            fast_updates_since_full=0,
            created_at=now,
            last_accessed_at=now,
            freshness=ModelFreshness.BOOTSTRAP,
            requires_full_ranker=True,
        )

    def _state_from_completed_run(
        self,
        db: Session,
        *,
        user_id: int,
        run: PreferenceModelRun,
        candidates: Sequence[Candidate],
        anchors: Sequence[ScoreAnchor],
    ) -> RuntimeFastState:
        """从 Full Snapshot 和完整 base history 构造纯算法状态。"""
        raw_results = tuple(
            AlgorithmPreferenceResult(
                content_id=row.content_id,
                preference_mean=row.preference_mean,
                preference_std=row.preference_std,
                expected_rank=row.expected_rank,
                rank_low=row.rank_low,
                rank_high=row.rank_high,
                stability=RankerStability(row.stability.value),
                comparison_count=row.comparison_count,
                order_uncertain=row.order_uncertain,
            )
            for row in sorted(run.results, key=lambda item: item.content_id)
        )
        try:
            snapshot_ranker_config = RankerConfig.from_json(run.algorithm_config_json)
        except (TypeError, ValueError, json.JSONDecodeError):
            snapshot_ranker_config = self.config.ranker_config
        results = normalize_preference_results(raw_results, snapshot_ranker_config)
        if {result.content_id for result in results} != {candidate.content_id for candidate in candidates}:
            raise ValueError('Full Snapshot candidates 与当前候选集合不一致')
        base_comparisons = self._read_comparisons(db, user_id, max_id=run.input_comparison_max_id or 0)
        from services.red_blue_ranker import RankerDiagnostics, RankerOutput

        algorithm_state = create_fast_preference_state(
            candidates,
            anchors,
            base_comparisons,
            RankerOutput(
                results=results,
                diagnostics=RankerDiagnostics(
                    candidate_count=len(results),
                    valid_comparison_count=0,
                    ignored_comparison_count=0,
                    effective_pair_count=0,
                    repeated_pair_count=0,
                    effective_total_weight=0.0,
                    ignored_comparison_reasons={},
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
                    total_seconds=0.0,
                ),
            ),
        )
        now = datetime.now(UTC)
        return RuntimeFastState(
            user_id=user_id,
            algorithm_state=algorithm_state,
            base_model_run_id=run.id,
            base_comparison_max_id=run.input_comparison_max_id,
            comparison_state_version=run.input_comparison_state_version,
            revoke_version=run.input_revoke_version,
            anchor_revision_max_id=run.input_rating_revision_max_id,
            algorithm_version=run.algorithm_version,
            algorithm_config_fingerprint=_config_fingerprint(run.algorithm_config_json),
            candidate_ids=tuple(sorted(candidate.content_id for candidate in candidates)),
            last_applied_comparison_id=run.input_comparison_max_id,
            fast_updates_since_full=0,
            created_at=now,
            last_accessed_at=now,
            freshness=ModelFreshness.FULL,
            requires_full_ranker=False,
        )

    def _replay_new_comparisons_locked(
        self,
        db: Session,
        state: RuntimeFastState,
        context: _DatabaseContext,
    ) -> RuntimeFastState:
        """按 ID 稳定 replay base 后的新事实；SKIP 只影响 Selector history。"""
        start_id = state.last_applied_comparison_id or 0
        pending = self._read_comparisons(db, state.user_id, min_id=start_id, max_id=context.comparison_max_id)
        current = state
        for comparison in pending:
            if comparison.revoked or comparison.revoked_at is not None:
                continue
            outcome = ComparisonOutcome(comparison.outcome)
            if outcome is ComparisonOutcome.SKIP:
                algorithm_state = replace(
                    current.algorithm_state,
                    comparisons=(*current.algorithm_state.comparisons, comparison),
                )
                current = replace(current, algorithm_state=algorithm_state, last_applied_comparison_id=comparison.id)
                continue
            output = fast_update_preference(
                current.algorithm_state,
                comparison,
                strategy=FastUpdateStrategy.LOCAL_LAPLACE,
                ranker_config=self.config.ranker_config,
                config=self.config.fast_update_config,
            )
            current = replace(
                current,
                algorithm_state=output.state,
                last_applied_comparison_id=comparison.id,
                fast_updates_since_full=current.fast_updates_since_full + 1,
            )
        return self._refresh_freshness(
            replace(
                current,
                comparison_state_version=context.comparison_state_version,
                revoke_version=context.revoke_version,
            ),
            context,
        )

    def _refresh_freshness(self, state: RuntimeFastState, context: _DatabaseContext) -> RuntimeFastState:
        """根据 watermark 和 Fast 次数刷新领域 freshness。"""
        created_at = _aware_datetime(state.created_at) or datetime.now(UTC)
        age_seconds = max(0.0, (datetime.now(UTC) - created_at).total_seconds())
        stale = (
            state.anchor_revision_max_id != context.anchor_revision_max_id
            or state.revoke_version != context.revoke_version
            or state.candidate_ids != context.candidate_ids
            or state.algorithm_version != context.algorithm_version
            or state.algorithm_config_fingerprint != context.algorithm_config_fingerprint
            or age_seconds > self.config.max_fast_state_age_seconds
        )
        requires_full = state.requires_full_ranker or stale
        if requires_full:
            freshness = (
                ModelFreshness.STALE_REQUIRES_FULL
                if state.base_model_run_id is not None
                else ModelFreshness.BOOTSTRAP
            )
        elif state.base_model_run_id is None:
            freshness = ModelFreshness.BOOTSTRAP
        elif state.fast_updates_since_full or state.last_applied_comparison_id != state.base_comparison_max_id:
            freshness = ModelFreshness.FAST
        else:
            freshness = ModelFreshness.FULL
        return replace(
            state,
            comparison_state_version=context.comparison_state_version,
            revoke_version=context.revoke_version,
            freshness=freshness,
            requires_full_ranker=requires_full,
        )

    def _cache_context_matches(self, state: RuntimeFastState, context: _DatabaseContext) -> bool:
        """检查 cache 是否至少能安全开始 replay。"""
        return (
            state.anchor_revision_max_id == context.anchor_revision_max_id
            and state.revoke_version == context.revoke_version
            and state.candidate_ids == context.candidate_ids
            and state.algorithm_version == context.algorithm_version
            and state.algorithm_config_fingerprint == context.algorithm_config_fingerprint
            and (
                context.latest_completed_model_run_id is None
                or state.base_model_run_id == context.latest_completed_model_run_id
            )
            and (state.last_applied_comparison_id or 0) <= (context.comparison_max_id or 0)
        )

    def _can_replay(self, state: RuntimeFastState, context: _DatabaseContext) -> bool:
        """只允许新增 comparison watermark 的兼容 replay。"""
        return (
            self._cache_context_matches(state, context)
            and state.revoke_version == context.revoke_version
            and state.anchor_revision_max_id == context.anchor_revision_max_id
        )

    def _latest_compatible_run(
        self,
        db: Session,
        user_id: int,
        context: _DatabaseContext,
    ) -> PreferenceModelRun | None:
        """找最近完成且输入版本不超过当前事实的 Full Snapshot。"""
        runs = (
            db.query(PreferenceModelRun)
            .filter(
                PreferenceModelRun.user_id == user_id,
                PreferenceModelRun.status == PreferenceModelRunStatus.COMPLETED,
            )
            .order_by(PreferenceModelRun.completed_at.desc(), PreferenceModelRun.id.desc())
            .all()
        )
        for run in runs:
            if (
                run.algorithm_version != context.algorithm_version
                or _config_fingerprint(run.algorithm_config_json) != context.algorithm_config_fingerprint
                or run.input_rating_revision_max_id != context.anchor_revision_max_id
                or run.input_revoke_version != context.revoke_version
                or (run.input_comparison_max_id or 0) > (context.comparison_max_id or 0)
                or run.input_comparison_state_version > context.comparison_state_version
            ):
                continue
            result_ids = tuple(sorted(row.content_id for row in run.results))
            if result_ids == context.candidate_ids:
                return run
        return None

    def _read_context_for_user(self, db: Session, user_id: int) -> _DatabaseContext:
        """读取一个用户的所有兼容性 watermark。"""
        candidate_ids = tuple(
            row[0]
            for row in (
                db.query(ContentItem.id)
                .join(Rating, Rating.content_id == ContentItem.id)
                .filter(
                    Rating.user_id == user_id,
                    Rating.score > 0,
                    ContentItem.content_type.in_(ANIME_CONTENT_TYPES),
                    ContentItem.is_public.is_(True),
                    ContentItem.deleted_at.is_(None),
                )
                .order_by(ContentItem.id.asc())
                .all()
            )
        )
        user_state = db.query(RedBlueUserState).filter(RedBlueUserState.user_id == user_id).one_or_none()
        comparison_max_id = (
            db.query(func.max(RedBlueComparison.id)).filter(RedBlueComparison.user_id == user_id).scalar()
        )
        anchor_revision_max_id = (
            db.query(func.max(RatingRevision.id))
            .filter(
                RatingRevision.user_id == user_id,
                RatingRevision.source.in_(SCORE_ANCHOR_REVISION_SOURCES),
            )
            .scalar()
        )
        latest_completed_model_run_id = (
            db.query(func.max(PreferenceModelRun.id))
            .filter(
                PreferenceModelRun.user_id == user_id,
                PreferenceModelRun.status == PreferenceModelRunStatus.COMPLETED,
            )
            .scalar()
        )
        return _DatabaseContext(
            candidate_ids=candidate_ids,
            comparison_max_id=comparison_max_id,
            comparison_state_version=user_state.comparison_state_version if user_state else 0,
            revoke_version=user_state.revoke_version if user_state else 0,
            anchor_revision_max_id=anchor_revision_max_id,
            algorithm_version=self.config.ranker_config.algorithm_version,
            algorithm_config_fingerprint=_config_fingerprint(self.config.ranker_config.to_json()),
            latest_completed_model_run_id=latest_completed_model_run_id,
        )

    def _read_candidate_anchors(
        self,
        db: Session,
        user_id: int,
    ) -> tuple[list[Candidate], list[ScoreAnchor]]:
        """读取按 content_id 稳定排序的候选与评分锚点。"""
        rows = (
            db.query(Rating)
            .join(ContentItem, Rating.content_id == ContentItem.id)
            .filter(
                Rating.user_id == user_id,
                Rating.score > 0,
                ContentItem.content_type.in_(ANIME_CONTENT_TYPES),
                ContentItem.is_public.is_(True),
                ContentItem.deleted_at.is_(None),
            )
            .order_by(Rating.content_id.asc())
            .all()
        )
        return (
            [Candidate(row.content_id) for row in rows],
            [ScoreAnchor(row.content_id, row.score_anchor) for row in rows],
        )

    def _read_full_inputs(
        self,
        db: Session,
        user_id: int,
        *,
        max_comparison_id: int,
    ) -> tuple[list[Candidate], list[ScoreAnchor], list[Comparison]]:
        """读取 Full Ranker 输入，并限制在已捕获 comparison watermark 内。"""
        candidates, anchors = self._read_candidate_anchors(db, user_id)
        comparisons = self._read_comparisons(db, user_id, max_id=max_comparison_id)
        return candidates, anchors, comparisons

    def _read_comparisons(
        self,
        db: Session,
        user_id: int,
        *,
        min_id: int | None = None,
        max_id: int | None = None,
    ) -> list[Comparison]:
        """按 id 稳定读取 comparison；Ranker 自己负责过滤 revoked / SKIP。"""
        query = db.query(RedBlueComparison).filter(RedBlueComparison.user_id == user_id)
        if min_id is not None:
            query = query.filter(RedBlueComparison.id > min_id)
        if max_id is not None:
            query = query.filter(RedBlueComparison.id <= max_id)
        return [
            Comparison(
                id=row.id,
                left_content_id=row.left_content_id,
                right_content_id=row.right_content_id,
                outcome=ComparisonOutcome(row.outcome.value),
                revoked=row.revoked_at is not None,
                revoked_at=row.revoked_at,
            )
            for row in query.order_by(RedBlueComparison.id.asc()).all()
        ]

    def _comparison_counts(self, db: Session, user_id: int, candidate_ids: Sequence[int]) -> dict[int, int]:
        """只为 bootstrap 统计当前有效非 SKIP comparison 次数。"""
        counts = dict.fromkeys(candidate_ids, 0)
        rows = db.query(RedBlueComparison).filter(RedBlueComparison.user_id == user_id).all()
        candidate_set = set(candidate_ids)
        for row in rows:
            if row.revoked_at is not None or row.outcome is RedBlueOutcome.SKIP:
                continue
            if row.left_content_id in candidate_set and row.right_content_id in candidate_set:
                counts[row.left_content_id] += 1
                counts[row.right_content_id] += 1
        return counts

    def _validate_candidate_pair(self, db: Session, user_id: int, left: int, right: int) -> None:
        """验证两部作品都符合当前候选池规则。"""
        ids = {
            row[0]
            for row in (
                db.query(ContentItem.id)
                .join(Rating, Rating.content_id == ContentItem.id)
                .filter(
                    Rating.user_id == user_id,
                    Rating.score > 0,
                    ContentItem.content_type.in_(ANIME_CONTENT_TYPES),
                    ContentItem.is_public.is_(True),
                    ContentItem.deleted_at.is_(None),
                    ContentItem.id.in_([left, right]),
                )
                .all()
            )
        }
        if ids != {left, right}:
            raise ValueError('两部作品必须都属于当前红蓝候选池')

    def _increment_comparison_watermark(self, db: Session, user_id: int, *, revoke: bool) -> None:
        """在同一数据库事务内原子递增事实状态版本。"""
        db.execute(
            text(
                'INSERT OR IGNORE INTO red_blue_user_states '
                '(user_id, comparison_state_version, revoke_version, updated_at) '
                'VALUES (:user_id, 0, 0, CURRENT_TIMESTAMP)',
            ),
            {'user_id': user_id},
        )
        db.execute(
            text(
                'UPDATE red_blue_user_states '
                'SET comparison_state_version = comparison_state_version + 1, '
                'revoke_version = revoke_version + :revoke, '
                'updated_at = CURRENT_TIMESTAMP '
                'WHERE user_id = :user_id',
            ),
            {'user_id': user_id, 'revoke': 1 if revoke else 0},
        )

    def _refresh_score_suggestions_locked(
        self,
        db: Session,
        state: RuntimeFastState,
    ) -> tuple[ScoreSuggestionDelta, tuple[ScoreSuggestionView, ...]]:
        """以当前 Fast mean + Full uncertainty 刷新建议；失败不影响核心状态。"""
        items = _state_items(state)
        candidate_ids = tuple(item.content_id for item in items)
        if state.freshness is ModelFreshness.STALE_REQUIRES_FULL:
            calibration_freshness = CalibrationFreshness.STALE_REQUIRES_FULL
        else:
            calibration_freshness = CalibrationFreshness(state.freshness.value)

        candidates = tuple(CalibrationCandidate(content_id=item.content_id) for item in items)
        if calibration_freshness in {
            CalibrationFreshness.FULL,
            CalibrationFreshness.FAST,
        }:
            rating_rows = (
                db.query(Rating)
                .filter(
                    Rating.user_id == state.user_id,
                    Rating.content_id.in_(candidate_ids),
                )
                .all()
                if candidate_ids
                else []
            )
            ratings_by_id = {row.content_id: row for row in rating_rows}
            preferences = tuple(
                CalibrationPreferenceResult(
                    content_id=item.content_id,
                    preference_mean=item.preference_mean,
                    preference_std=item.preference_std or 0.0,
                    expected_rank=(
                        item.authoritative_expected_rank
                        if item.authoritative_expected_rank is not None
                        else float(item.provisional_rank)
                    ),
                    rank_low=(
                        item.authoritative_rank_low
                        if item.authoritative_rank_low is not None
                        else item.provisional_rank
                    ),
                    rank_high=(
                        item.authoritative_rank_high
                        if item.authoritative_rank_high is not None
                        else item.provisional_rank
                    ),
                    stability=item.authoritative_stability,
                    comparison_count=item.comparison_count,
                    order_uncertain=item.authoritative_order_uncertain,
                )
                for item in items
            )
            ratings = tuple(
                CalibrationRating(
                    content_id=item.content_id,
                    current_score=ratings_by_id[item.content_id].score,
                    score_anchor=ratings_by_id[item.content_id].score_anchor,
                )
                for item in items
                if item.content_id in ratings_by_id
            )
        else:
            preferences = ()
            ratings = ()

        try:
            _delta, visible = self.score_suggestion_service.refresh_score_suggestions(
                db,
                user_id=state.user_id,
                model_run_id=state.base_model_run_id,
                model_freshness=calibration_freshness,
                comparison_state_version=state.comparison_state_version,
                effective_comparison_max_id=self._effective_comparison_max_id(db, state.user_id),
                candidates=candidates,
                preference_results=preferences,
                ratings=ratings,
            )
            return _delta, visible
        except Exception:  # noqa: BLE001
            logger.exception('红蓝评分建议刷新失败；保留 comparison/ranking 核心响应')
            db.rollback()
            return ScoreSuggestionDelta(), self.score_suggestion_service.visible_suggestions(
                db,
                user_id=state.user_id,
                content_ids=candidate_ids,
            )

    def _effective_comparison_max_id(self, db: Session, user_id: int) -> int | None:
        """返回排除 SKIP 和 revoked 事实后的 comparison watermark。"""
        return (
            db.query(func.max(RedBlueComparison.id))
            .filter(
                RedBlueComparison.user_id == user_id,
                RedBlueComparison.outcome != RedBlueOutcome.SKIP,
                RedBlueComparison.revoked_at.is_(None),
            )
            .scalar()
        )

    def _battle_state(
        self,
        db: Session,
        state: RuntimeFastState,
        *,
        score_suggestions: Sequence[ScoreSuggestionView] = (),
        focus_content_id: int | None = None,
    ) -> BattleState:
        """将运行时状态和最近 Selector history 组合为领域结果。"""
        selector_candidates = to_selector_candidates(state.algorithm_state)
        selector_history, pair_counts = self._selector_history(db, state.user_id)
        selection = select_pair(
            selector_candidates,
            selector_history,
            context=SelectorContext(
                focus_content_id=focus_content_id,
                tie_strength=self.config.ranker_config.tie_strength,
                pair_comparison_counts=pair_counts,
            ),
            config=self.config.selector_config,
        )
        next_pair = _battle_pair(selection.selected_pair)
        if next_pair is not None:
            pair_status = PairStatus.AVAILABLE
        elif len(state.algorithm_state.fast_results) < 2 or selection.reason is SelectionReason.INSUFFICIENT_CANDIDATES:
            pair_status = PairStatus.INSUFFICIENT_CANDIDATES
        else:
            pair_status = PairStatus.COOLDOWN
        return BattleState(
            user_id=state.user_id,
            items=_state_items(state),
            next_pair=next_pair,
            comparison_state_version=state.comparison_state_version,
            base_model_run_id=state.base_model_run_id,
            freshness=state.freshness,
            pair_status=pair_status,
            full_recalibration_required=state.requires_full_ranker,
            full_recalibration_running=self._is_running(state.user_id),
            score_suggestions=tuple(score_suggestions),
        )

    def _comparison_result(
        self,
        db: Session,
        state: RuntimeFastState,
        comparison: RedBlueComparison,
        *,
        old_state: RuntimeFastState | None,
        idempotent_replay: bool,
        score_suggestion_delta: ScoreSuggestionDelta = ScoreSuggestionDelta(),
        focus_content_id: int | None = None,
    ) -> ComparisonResult:
        battle = self._battle_state(db, state, focus_content_id=focus_content_id)
        ranking_delta = () if idempotent_replay or comparison.outcome == RedBlueOutcome.SKIP else _ranking_delta(
            old_state,
            state,
            comparison,
        )
        return ComparisonResult(
            comparison_id=comparison.id,
            left_content_id=comparison.left_content_id,
            right_content_id=comparison.right_content_id,
            outcome=RedBlueOutcome(comparison.outcome.value),
            client_event_id=comparison.client_event_id,
            selector_version=comparison.selector_version,
            created_at=_aware_datetime(comparison.created_at),
            revoked_at=_aware_datetime(comparison.revoked_at),
            ranking_delta=ranking_delta,
            next_pair=battle.next_pair,
            pair_status=battle.pair_status,
            comparison_state_version=state.comparison_state_version,
            base_model_run_id=state.base_model_run_id,
            freshness=state.freshness,
            full_recalibration_required=state.requires_full_ranker,
            full_recalibration_running=battle.full_recalibration_running,
            idempotent_replay=idempotent_replay,
            score_suggestion_delta=score_suggestion_delta,
        )

    @staticmethod
    def _validate_idempotent_payload(
        existing: RedBlueComparison,
        *,
        left_content_id: int,
        right_content_id: int,
        outcome: RedBlueOutcome,
        selector_version: str,
    ) -> None:
        """相同 client_event_id 只有完全相同事实才允许幂等成功。"""
        if (
            existing.left_content_id != left_content_id
            or existing.right_content_id != right_content_id
            or existing.outcome != outcome
            or existing.selector_version != selector_version
        ):
            raise RedBlueComparisonConflictError('client_event_id 已用于不同 Comparison payload')

    def _selector_history(
        self,
        db: Session,
        user_id: int,
    ) -> tuple[tuple[SelectorComparison, ...], dict[tuple[int, int], int]]:
        """读取近期 history，并单独返回全历史 Pair 次数用于硬上限。"""
        rows = (
            db.query(RedBlueComparison)
            .filter(RedBlueComparison.user_id == user_id)
            .order_by(RedBlueComparison.id.desc())
            .limit(self.config.selector_history_window)
            .all()
        )
        pair_counts: dict[tuple[int, int], int] = {}
        for left_content_id, right_content_id in (
            db.query(
                RedBlueComparison.left_content_id,
                RedBlueComparison.right_content_id,
            )
            .filter(
                RedBlueComparison.user_id == user_id,
                RedBlueComparison.outcome != RedBlueOutcome.SKIP,
                RedBlueComparison.revoked_at.is_(None),
            )
            .all()
        ):
            pair = tuple(sorted((left_content_id, right_content_id)))
            pair_counts[pair] = pair_counts.get(pair, 0) + 1
        recent_history = tuple(
            SelectorComparison(
                id=row.id,
                left_content_id=row.left_content_id,
                right_content_id=row.right_content_id,
                outcome=SelectorOutcome(row.outcome.value),
                created_at=_aware_datetime(row.created_at),
                revoked=row.revoked_at is not None,
                revoked_at=_aware_datetime(row.revoked_at),
                pair_comparison_count=pair_counts.get(
                    tuple(sorted((row.left_content_id, row.right_content_id))),
                    0,
                ),
            )
            for row in reversed(rows)
        )
        return recent_history, pair_counts

    def _reason_for_state(self, state: RuntimeFastState) -> FullRecalibrationReason:
        """为状态过期选择可解释的调度原因。"""
        if state.base_model_run_id is None:
            return FullRecalibrationReason.FIRST_SNAPSHOT
        if state.fast_updates_since_full >= self.config.max_fast_updates_before_full:
            return FullRecalibrationReason.FAST_UPDATE_LIMIT
        return FullRecalibrationReason.MANUAL

    def _recover_stale_runs(self) -> None:
        db = self.session_factory()
        try:
            self.recover_stale_runs(db)
        finally:
            db.close()

    def _is_running(self, user_id: int) -> bool:
        with self._coordination_lock:
            return user_id in self._running_users


def _parse_outcome(value: RedBlueOutcome | str) -> RedBlueOutcome:
    """解析并拒绝未知 comparison outcome。"""
    try:
        return RedBlueOutcome(value)
    except (TypeError, ValueError) as exc:
        raise ValueError('comparison outcome 无效') from exc


def _full_input_fingerprint(
    context: _DatabaseContext,
    anchors: Sequence[ScoreAnchor],
) -> tuple[object, ...]:
    """比较 Full 完成时的完整输入版本，含排序候选与评分锚点。"""
    return (
        context.comparison_max_id or 0,
        context.comparison_state_version,
        context.revoke_version,
        context.anchor_revision_max_id or 0,
        context.candidate_ids,
        tuple((anchor.content_id, anchor.score) for anchor in anchors),
        context.algorithm_version,
        context.algorithm_config_fingerprint,
    )


def _begin_consistent_read(db: Session) -> None:
    """显式开启数据库读事务；SQLite 默认延迟 BEGIN，需建立物理快照。"""
    db.begin()
    if db.get_bind().dialect.name == 'sqlite':
        connection = db.connection()
        driver_connection = connection.connection.driver_connection
        if not driver_connection.in_transaction:
            connection.exec_driver_sql('BEGIN')


def _config_fingerprint(config_json: str) -> str:
    """对 canonical algorithm config 生成稳定 fingerprint。"""
    decoded = json.loads(config_json or '{}')
    canonical = json.dumps(decoded, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def _aware_datetime(value: datetime | None) -> datetime | None:
    """统一 SQLite 返回的 naive UTC 时间。"""
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _state_items(state: RuntimeFastState) -> tuple[FastStateItem, ...]:
    """生成包含实时字段和权威字段的领域 item。"""
    authoritative = {result.content_id: result for result in state.algorithm_state.authoritative_results}
    return tuple(
        FastStateItem(
            content_id=result.content_id,
            preference_mean=result.preference_mean,
            preference_std=result.preference_std,
            provisional_rank=result.provisional_rank,
            authoritative_expected_rank=(
                authoritative[result.content_id].expected_rank if result.content_id in authoritative else None
            ),
            authoritative_rank_low=(
                authoritative[result.content_id].rank_low if result.content_id in authoritative else None
            ),
            authoritative_rank_high=(
                authoritative[result.content_id].rank_high if result.content_id in authoritative else None
            ),
            authoritative_stability=(
                authoritative[result.content_id].stability.value
                if result.content_id in authoritative
                else RankerStability.UNCALIBRATED.value
            ),
            authoritative_order_uncertain=(
                authoritative[result.content_id].order_uncertain
                if result.content_id in authoritative
                else False
            ),
            comparison_count=result.comparison_count,
        )
        for result in sorted(state.algorithm_state.fast_results, key=lambda item: item.provisional_rank)
    )


def _battle_pair(pair: SelectedPair | None) -> BattlePair | None:
    """转换纯 Selector 输出为领域 Pair。"""
    if pair is None:
        return None
    return BattlePair(
        left_content_id=pair.left_content_id,
        right_content_id=pair.right_content_id,
        selection_reason=pair.selection_reason.value,
        selector_version=pair.selector_version,
        components=pair.components,
    )


def _ranking_delta(
    old_state: RuntimeFastState | None,
    new_state: RuntimeFastState,
    comparison: RedBlueComparison,
) -> tuple[RankingDelta, ...]:
    """返回所有 rank 发生变化的作品，并保证 A/B 即使同名次也被纳入。"""
    new_results = {result.content_id: result for result in new_state.algorithm_state.fast_results}
    authoritative_results = {
        result.content_id: result
        for result in new_state.algorithm_state.authoritative_results
    }
    old_results = (
        {result.content_id: result for result in old_state.algorithm_state.fast_results}
        if old_state is not None
        else {}
    )
    touched = {comparison.left_content_id, comparison.right_content_id}
    deltas = []
    for content_id, result in new_results.items():
        old = old_results.get(content_id)
        if old is not None and old.provisional_rank == result.provisional_rank and content_id not in touched:
            continue
        deltas.append(
            RankingDelta(
                content_id=content_id,
                old_rank=old.provisional_rank if old is not None else None,
                new_rank=result.provisional_rank,
                preference_mean=result.preference_mean,
                comparison_count=result.comparison_count,
                stability=(
                    authoritative_results[content_id].stability.value
                    if content_id in authoritative_results
                    else RankerStability.UNCALIBRATED.value
                ),
                order_uncertain=(
                    authoritative_results[content_id].order_uncertain
                    if content_id in authoritative_results
                    else False
                ),
                rank_low=(
                    authoritative_results[content_id].rank_low
                    if content_id in authoritative_results
                    else None
                ),
                rank_high=(
                    authoritative_results[content_id].rank_high
                    if content_id in authoritative_results
                    else None
                ),
            ),
        )
    return tuple(sorted(deltas, key=lambda item: (item.new_rank, item.content_id)))


# 供未来 Router / lifespan 使用的进程级服务；不在本阶段注册 HTTP endpoint。
red_blue_service = RedBlueService()


__all__ = [
    'BattlePair',
    'BattleState',
    'ContentSnapshot',
    'ComparisonResult',
    'ComparisonHistoryPage',
    'FastStateItem',
    'FullRecalibrationReason',
    'FullRecalibrationResult',
    'ModelFreshness',
    'PairStatus',
    'RankingDelta',
    'RedBlueFastStateCache',
    'RedBlueComparisonConflictError',
    'RedBlueComparisonNotFoundError',
    'RedBlueService',
    'RedBlueServiceConfig',
    'RuntimeFastState',
    'red_blue_service',
]
