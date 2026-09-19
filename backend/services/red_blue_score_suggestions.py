"""红蓝合战评分建议的持久化编排与用户动作事务。

阶段 5 的 ``red_blue_score_calibration`` 仍然是无副作用纯算法；本模块只负责
把算法输入从 ORM 事实组装后的结果 reconciliation 到派生 suggestion，并把
用户 Action 作为不可丢失事实写入。它不负责 Ranker、Pair Selector 或页面逻辑。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import (
    Rating,
    RedBlueComparison,
    RedBlueOutcome,
    RedBlueUserState,
    ScoreSuggestion,
    ScoreSuggestionAction,
    ScoreSuggestionActionType,
    ScoreSuggestionStatus,
)
from services import rating as rating_service
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
    ScoreCalibrationSuggestion,
    generate_score_calibrations,
)


class ScoreSuggestionConflictError(ValueError):
    """客户端提交的建议动作与当前事实不一致。"""


class ScoreSuggestionNotFoundError(ValueError):
    """当前用户看不到目标 suggestion。"""


@dataclass(frozen=True, slots=True)
class ScoreSuggestionView:
    """可返回给排名行的评分建议字段。"""

    id: int
    content_id: int
    suggestion_key: str
    current_score: int
    suggested_score_low: int
    suggested_score_high: int
    recommended_score: int
    direction: str
    confidence: float
    severity: float
    reason_code: str


@dataclass(frozen=True, slots=True)
class ScoreSuggestionDelta:
    """一次校准 reconciliation 的增量。"""

    added: tuple[ScoreSuggestionView, ...] = ()
    updated: tuple[ScoreSuggestionView, ...] = ()
    removed: tuple[int, ...] = ()


@dataclass(frozen=True, slots=True)
class ScoreSuggestionActionResult:
    """一次用户动作事务的结果。"""

    action_id: int
    suggestion_id: int
    content_id: int
    action: str
    current_score: int
    updated_score: int
    comparison_state_version: int
    idempotent_replay: bool


class ScoreSuggestionService:
    """评分建议的派生缓存和用户事实 Action 编排。"""

    def __init__(self, config: ScoreCalibrationConfig | None = None) -> None:
        self.config = config or ScoreCalibrationConfig()

    def refresh_score_suggestions(
        self,
        db: Session,
        *,
        user_id: int,
        model_run_id: int | None,
        model_freshness: CalibrationFreshness | str,
        comparison_state_version: int,
        effective_comparison_max_id: int | None,
        candidates: Sequence[CalibrationCandidate],
        preference_results: Sequence[CalibrationPreferenceResult],
        ratings: Sequence[CalibrationRating],
        now: datetime | None = None,
    ) -> tuple[ScoreSuggestionDelta, tuple[ScoreSuggestionView, ...]]:
        """运行纯算法并 reconciliation 当前用户可展示的 suggestion。

        该方法只持久化当前算法正式返回的 Top N；被 max suggestions 截断的
        prediction 不会伪装成 rejected，也不会写入缓存。
        """
        current_time = _aware_datetime(now) or datetime.now(UTC)
        freshness = CalibrationFreshness(_enum_value(model_freshness))
        candidate_ids = tuple(item.content_id for item in candidates)
        old_rows = self._pending_rows(db, user_id=user_id, content_ids=candidate_ids)

        if freshness in {
            CalibrationFreshness.STALE_REQUIRES_FULL,
            CalibrationFreshness.BOOTSTRAP,
        }:
            # Full Ranker 正在等待或运行时，旧 Full Snapshot 仍然是最后一份
            # 可展示结果。不能在每次 GET / comparison 后先把 PENDING 清掉，
            # 否则前端会出现“刷新消失，下一次刷新又回来”的闪烁。下一次
            # 兼容的 Full Snapshot 完成后，正常 reconciliation 会用新结果
            # 更新或过期这些派生行；用户 action 事实始终不受影响。
            old_rows = self._pending_rows(
                db,
                user_id=user_id,
                content_ids=candidate_ids,
            )
            return (
                ScoreSuggestionDelta(),
                tuple(_suggestion_view(row) for row in old_rows),
            )

        if model_run_id is None:
            return ScoreSuggestionDelta(), ()

        actions = self._calibration_actions(db, user_id=user_id)
        previous_suggestions = tuple(
            PreviousCalibrationSuggestion(
                content_id=row.content_id,
                suggestion_key=row.suggestion_key,
                confidence=float(row.confidence or 0.0),
                active=True,
            )
            for row in old_rows
        )
        result = generate_score_calibrations(
            candidates,
            preference_results,
            ratings,
            previous_actions=actions,
            config=self.config,
            model_freshness=freshness,
            previous_suggestions=previous_suggestions,
            comparison_state_version=comparison_state_version,
            effective_comparison_max_id=effective_comparison_max_id,
            now=current_time,
        )
        delta = self._reconcile(
            db,
            user_id=user_id,
            model_run_id=model_run_id,
            old_rows=old_rows,
            suggestions=result.suggestions,
            handled_at=current_time,
        )
        db.commit()
        visible = self._pending_rows(
            db,
            user_id=user_id,
            content_ids=candidate_ids,
        )
        return delta, tuple(_suggestion_view(row) for row in visible)

    def apply_action(
        self,
        db: Session,
        *,
        user_id: int,
        suggestion_id: int,
        suggestion_key: str,
        action: str,
        client_event_id: str,
    ) -> ScoreSuggestionActionResult:
        """在单一事务内写 Action，并在 ACCEPTED 时修改 Rating。"""
        normalized_action = _normalize_action(action)
        if normalized_action not in {item.value for item in ScoreSuggestionActionType}:
            raise ScoreSuggestionConflictError('评分建议 action 无效')
        if not client_event_id or len(client_event_id) > 64:
            raise ScoreSuggestionConflictError('client_event_id 无效')

        existing_event = (
            db.query(ScoreSuggestionAction)
            .filter(
                ScoreSuggestionAction.user_id == user_id,
                ScoreSuggestionAction.client_event_id == client_event_id,
            )
            .one_or_none()
        )
        if existing_event is not None:
            if (
                existing_event.score_suggestion_id != suggestion_id
                or existing_event.suggestion_key != suggestion_key
                or _enum_value(existing_event.action) != normalized_action
            ):
                raise ScoreSuggestionConflictError('client_event_id 已用于不同评分建议动作')
            return self._action_result(db, existing_event, idempotent_replay=True)

        suggestion = (
            db.query(ScoreSuggestion)
            .filter(
                ScoreSuggestion.id == suggestion_id,
                ScoreSuggestion.user_id == user_id,
            )
            .one_or_none()
        )
        if suggestion is None:
            raise ScoreSuggestionNotFoundError('评分建议不存在')
        if suggestion.suggestion_key != suggestion_key:
            raise ScoreSuggestionConflictError('评分建议 key 已变化')
        if suggestion.status != ScoreSuggestionStatus.PENDING:
            raise ScoreSuggestionConflictError('评分建议已失效或已经处理')

        rating = (
            db.query(Rating)
            .filter(
                Rating.user_id == user_id,
                Rating.content_id == suggestion.content_id,
            )
            .one_or_none()
        )
        if rating is None:
            raise ScoreSuggestionConflictError('当前评分不存在')
        if rating.score != suggestion.current_score:
            raise ScoreSuggestionConflictError('当前评分已发生变化，请刷新红蓝合战状态')

        if normalized_action == ScoreSuggestionActionType.ACCEPTED.value and suggestion.recommended_score <= 0:
            raise ScoreSuggestionConflictError('评分建议推荐值必须大于 0')

        state = (
            db.query(RedBlueUserState)
            .filter(RedBlueUserState.user_id == user_id)
            .one_or_none()
        )
        state_version = state.comparison_state_version if state is not None else 0
        effective_max_id = self._effective_comparison_max_id(db, user_id=user_id)
        now = datetime.now(UTC)
        action_row = ScoreSuggestionAction(
            user_id=user_id,
            content_id=suggestion.content_id,
            score_suggestion_id=suggestion.id,
            model_run_id=suggestion.model_run_id,
            suggestion_key=suggestion.suggestion_key,
            action=ScoreSuggestionActionType(normalized_action),
            current_score=rating.score,
            recommended_score=suggestion.recommended_score,
            comparison_state_version_at_action=state_version,
            effective_comparison_max_id_at_action=effective_max_id,
            client_event_id=client_event_id,
            created_at=now,
        )
        db.add(action_row)
        db.flush()

        # 用条件 UPDATE 再确认一次 PENDING，作为跨进程并发下的第二道防线。
        changed_rows = (
            db.query(ScoreSuggestion)
            .filter(
                ScoreSuggestion.id == suggestion.id,
                ScoreSuggestion.user_id == user_id,
                ScoreSuggestion.status == ScoreSuggestionStatus.PENDING,
            )
            .update(
                {
                    ScoreSuggestion.status: ScoreSuggestionStatus(normalized_action),
                    ScoreSuggestion.handled_at: now,
                },
                synchronize_session='fetch',
            )
        )
        if changed_rows != 1:
            raise ScoreSuggestionConflictError('评分建议已被其他请求处理')
        db.flush()

        updated_score = rating.score
        if normalized_action == ScoreSuggestionActionType.ACCEPTED.value:
            rating_service.upsert_rating(
                db,
                user_id=user_id,
                content_id=suggestion.content_id,
                score=suggestion.recommended_score,
                recommend=rating.recommend,
                review=rating.review or '',
                revision_source='pk_suggestion',
                update_score_anchor=False,
                commit=False,
                preserve_metadata=True,
                score_suggestion_id=suggestion.id,
                score_suggestion_action_id=action_row.id,
            )
            updated_score = suggestion.recommended_score

        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            retry = (
                db.query(ScoreSuggestionAction)
                .filter(
                    ScoreSuggestionAction.user_id == user_id,
                    ScoreSuggestionAction.client_event_id == client_event_id,
                )
                .one_or_none()
            )
            if retry is not None:
                if (
                    retry.score_suggestion_id != suggestion_id
                    or retry.suggestion_key != suggestion_key
                    or _enum_value(retry.action) != normalized_action
                ):
                    raise ScoreSuggestionConflictError('client_event_id 已用于不同评分建议动作') from exc
                return self._action_result(db, retry, idempotent_replay=True)
            raise ScoreSuggestionConflictError('评分建议动作幂等键冲突，请重试') from exc

        db.refresh(action_row)
        return ScoreSuggestionActionResult(
            action_id=action_row.id,
            suggestion_id=suggestion.id,
            content_id=suggestion.content_id,
            action=normalized_action,
            current_score=(
                rating.score
                if normalized_action != ScoreSuggestionActionType.ACCEPTED.value
                else suggestion.current_score
            ),
            updated_score=updated_score,
            comparison_state_version=state_version,
            idempotent_replay=False,
        )

    def visible_suggestions(
        self,
        db: Session,
        *,
        user_id: int,
        content_ids: Sequence[int],
    ) -> tuple[ScoreSuggestionView, ...]:
        """读取当前仍处于 PENDING 的派生建议。"""
        return tuple(
            _suggestion_view(row)
            for row in self._pending_rows(db, user_id=user_id, content_ids=content_ids)
        )

    @staticmethod
    def _pending_rows(db: Session, *, user_id: int, content_ids: Sequence[int]) -> list[ScoreSuggestion]:
        if not content_ids:
            return []
        return (
            db.query(ScoreSuggestion)
            .filter(
                ScoreSuggestion.user_id == user_id,
                ScoreSuggestion.content_id.in_(tuple(content_ids)),
                ScoreSuggestion.status == ScoreSuggestionStatus.PENDING,
            )
            .order_by(ScoreSuggestion.severity.desc(), ScoreSuggestion.confidence.desc(), ScoreSuggestion.id.asc())
            .all()
        )

    def _reconcile(
        self,
        db: Session,
        *,
        user_id: int,
        model_run_id: int,
        old_rows: Sequence[ScoreSuggestion],
        suggestions: Sequence[ScoreCalibrationSuggestion],
        handled_at: datetime,
    ) -> ScoreSuggestionDelta:
        old_by_key: dict[tuple[int, str], ScoreSuggestion] = {
            (row.content_id, row.suggestion_key): row for row in old_rows
        }
        # 同一 model run 内，旧的 PENDING 行可能在上一次 reconciliation 中被
        # 标为 EXPIRED；如果新的计算又得到完全相同的 suggestion_key，应复用
        # 这条派生行，而不是撞上 model_run/user/content/key 唯一约束。它没有
        # 用户 action 事实，重新出现仍然由当前纯算法结果决定。
        content_ids = tuple({suggestion.content_id for suggestion in suggestions})
        reusable_rows = (
            db.query(ScoreSuggestion)
            .filter(
                ScoreSuggestion.user_id == user_id,
                ScoreSuggestion.model_run_id == model_run_id,
                ScoreSuggestion.content_id.in_(content_ids),
                ScoreSuggestion.status == ScoreSuggestionStatus.EXPIRED,
            )
            .all()
            if content_ids
            else []
        )
        reusable_by_key = {
            (row.content_id, row.suggestion_key): row
            for row in reusable_rows
        }
        seen_ids: set[int] = set()
        added: list[ScoreSuggestionView] = []
        updated: list[ScoreSuggestionView] = []
        for suggestion in suggestions:
            key = (suggestion.content_id, suggestion.suggestion_key)
            visible_row = old_by_key.get(key)
            row = visible_row or reusable_by_key.get(key)
            is_new = visible_row is None
            if row is None:
                row = ScoreSuggestion(
                    user_id=user_id,
                    content_id=suggestion.content_id,
                    model_run_id=model_run_id,
                    suggestion_key=suggestion.suggestion_key,
                    current_score=suggestion.current_score,
                    suggested_score_low=suggestion.suggested_score_low,
                    suggested_score_high=suggestion.suggested_score_high,
                    recommended_score=suggestion.recommended_score,
                    direction=suggestion.direction.value,
                    confidence=suggestion.confidence,
                    severity=suggestion.severity,
                    reason_code=suggestion.reason_code.value,
                    status=ScoreSuggestionStatus.PENDING,
                    created_at=handled_at,
                )
                db.add(row)
                db.flush()
            else:
                before = _suggestion_signature(row)
                row.model_run_id = model_run_id
                row.current_score = suggestion.current_score
                row.suggested_score_low = suggestion.suggested_score_low
                row.suggested_score_high = suggestion.suggested_score_high
                row.recommended_score = suggestion.recommended_score
                row.direction = suggestion.direction.value
                row.confidence = suggestion.confidence
                row.severity = suggestion.severity
                row.reason_code = suggestion.reason_code.value
                row.status = ScoreSuggestionStatus.PENDING
                row.handled_at = None
                if before != _suggestion_signature(row):
                    updated.append(_suggestion_view(row))
            seen_ids.add(row.id)
            if is_new:
                added.append(_suggestion_view(row))

        removed: list[int] = []
        for row in old_rows:
            if row.id in seen_ids:
                continue
            row.status = ScoreSuggestionStatus.EXPIRED
            row.handled_at = handled_at
            removed.append(row.id)
        return ScoreSuggestionDelta(tuple(added), tuple(updated), tuple(removed))

    @staticmethod
    def _calibration_actions(db: Session, *, user_id: int) -> tuple[CalibrationAction, ...]:
        rows = (
            db.query(ScoreSuggestionAction)
            .filter(ScoreSuggestionAction.user_id == user_id)
            .order_by(ScoreSuggestionAction.created_at.asc(), ScoreSuggestionAction.id.asc())
            .all()
        )
        return tuple(
            CalibrationAction(
                content_id=row.content_id,
                suggestion_key=row.suggestion_key,
                action=_enum_value(row.action),
                created_at=_aware_datetime(row.created_at),
                comparison_state_version_at_action=row.comparison_state_version_at_action,
                effective_comparison_max_id_at_action=row.effective_comparison_max_id_at_action,
            )
            for row in rows
        )

    @staticmethod
    def _effective_comparison_max_id(db: Session, *, user_id: int) -> int | None:
        return db.query(func.max(RedBlueComparison.id)).filter(
            RedBlueComparison.user_id == user_id,
            RedBlueComparison.outcome != RedBlueOutcome.SKIP,
            RedBlueComparison.revoked_at.is_(None),
        ).scalar()

    @staticmethod
    def _action_result(
        db: Session,
        action: ScoreSuggestionAction,
        *,
        idempotent_replay: bool,
    ) -> ScoreSuggestionActionResult:
        rating = (
            db.query(Rating)
            .filter(Rating.user_id == action.user_id, Rating.content_id == action.content_id)
            .one_or_none()
        )
        state = (
            db.query(RedBlueUserState)
            .filter(RedBlueUserState.user_id == action.user_id)
            .one_or_none()
        )
        return ScoreSuggestionActionResult(
            action_id=action.id,
            suggestion_id=action.score_suggestion_id or 0,
            content_id=action.content_id,
            action=_enum_value(action.action),
            current_score=action.current_score,
            updated_score=rating.score if rating is not None else action.recommended_score,
            comparison_state_version=(
                state.comparison_state_version
                if state is not None
                else action.comparison_state_version_at_action
            ),
            idempotent_replay=idempotent_replay,
        )


def _suggestion_view(row: ScoreSuggestion) -> ScoreSuggestionView:
    """兼容早期没有展示诊断列的派生记录。"""
    direction = row.direction or ('UP' if row.recommended_score >= row.current_score else 'DOWN')
    reason_code = row.reason_code or (
        ScoreCalibrationReasonCode.PREFERENCE_HIGHER_THAN_SCORE.value
        if direction == ScoreCalibrationDirection.UP.value
        else ScoreCalibrationReasonCode.PREFERENCE_LOWER_THAN_SCORE.value
    )
    return ScoreSuggestionView(
        id=row.id,
        content_id=row.content_id,
        suggestion_key=row.suggestion_key,
        current_score=row.current_score,
        suggested_score_low=row.suggested_score_low,
        suggested_score_high=row.suggested_score_high,
        recommended_score=row.recommended_score,
        direction=direction,
        confidence=float(row.confidence or 0.0),
        severity=float(row.severity or 0.0),
        reason_code=reason_code,
    )


def _suggestion_signature(row: ScoreSuggestion) -> tuple[object, ...]:
    return (
        row.model_run_id,
        row.current_score,
        row.suggested_score_low,
        row.suggested_score_high,
        row.recommended_score,
        row.direction,
        row.confidence,
        row.severity,
        row.reason_code,
    )


def _normalize_action(value: str) -> str:
    return str(getattr(value, 'value', value)).upper()


def _enum_value(value: object) -> str:
    return str(getattr(value, 'value', value))


def _aware_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


__all__ = [
    'ScoreSuggestionActionResult',
    'ScoreSuggestionConflictError',
    'ScoreSuggestionDelta',
    'ScoreSuggestionNotFoundError',
    'ScoreSuggestionService',
    'ScoreSuggestionView',
]
