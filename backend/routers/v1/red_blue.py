"""红蓝合战 HTTP API；只做认证、校验、Service 委托和 schema 转换。"""

from collections.abc import Mapping

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session

from deps import get_current_user, get_db
from models import User
from schemas import (
    CreateComparisonRequest,
    CreateComparisonResponse,
    RedBlueComparisonHistoryContentResponse,
    RedBlueComparisonHistoryItemResponse,
    RedBlueComparisonHistoryPageResponse,
    RedBlueComparisonResponse,
    RedBlueContentSummaryResponse,
    RedBluePairResponse,
    RedBlueRankingDeltaResponse,
    RedBlueRankingItemResponse,
    RedBlueScoreSuggestionDeltaResponse,
    RedBlueScoreSuggestionResponse,
    RedBlueStateResponse,
    RevokeComparisonResponse,
    ScoreSuggestionActionRequest,
    ScoreSuggestionActionResponse,
)
from services.red_blue import (
    BattlePair,
    BattleState,
    ComparisonHistoryItem,
    ComparisonResult,
    ContentSnapshot,
    ModelFreshness,
    RedBlueComparisonConflictError,
    RedBlueComparisonNotFoundError,
    RedBlueService,
    red_blue_service,
)
from services.red_blue_score_suggestions import (
    ScoreSuggestionActionResult,
    ScoreSuggestionConflictError,
    ScoreSuggestionNotFoundError,
    ScoreSuggestionView,
)

router = APIRouter(prefix='/red-blue', tags=['red-blue'])


def get_red_blue_service() -> RedBlueService:
    """返回进程级领域 Service；测试可通过 FastAPI dependency override 替换。"""
    return red_blue_service


def _content_summary(snapshot: ContentSnapshot) -> RedBlueContentSummaryResponse:
    """将领域作品摘要转换为公开 API 摘要。"""
    return RedBlueContentSummaryResponse(
        content_id=snapshot.content_id,
        title=snapshot.title,
        description=snapshot.description,
        cover_url=snapshot.cover_url,
        content_type=snapshot.content_type,
    )


def _suggestion_response(view: ScoreSuggestionView) -> RedBlueScoreSuggestionResponse:
    """将领域建议转换为排名行可展示的公共字段。"""
    return RedBlueScoreSuggestionResponse(
        id=view.id,
        content_id=view.content_id,
        suggestion_key=view.suggestion_key,
        current_score=view.current_score,
        suggested_score_low=view.suggested_score_low,
        suggested_score_high=view.suggested_score_high,
        recommended_score=view.recommended_score,
        direction=view.direction,
        confidence=view.confidence,
        severity=view.severity,
        reason_code=view.reason_code,
    )


def _suggestion_delta_response(result: ComparisonResult) -> RedBlueScoreSuggestionDeltaResponse:
    """将建议缓存 reconciliation 的增量转换为 HTTP 响应。"""
    return RedBlueScoreSuggestionDeltaResponse(
        added=[_suggestion_response(item) for item in result.score_suggestion_delta.added],
        updated=[_suggestion_response(item) for item in result.score_suggestion_delta.updated],
        removed=list(result.score_suggestion_delta.removed),
    )


def _pair_response(
    pair: BattlePair | None,
    snapshots: Mapping[int, ContentSnapshot],
) -> RedBluePairResponse | None:
    """将领域 Pair 和批量摘要转换为当前 Pair 响应。"""
    if pair is None:
        return None
    left = snapshots.get(pair.left_content_id)
    right = snapshots.get(pair.right_content_id)
    if left is None or right is None:
        raise HTTPException(status_code=409, detail='当前 Pair 已不再属于候选池，请重新获取状态')
    return RedBluePairResponse(
        left=_content_summary(left),
        right=_content_summary(right),
        selector_version=pair.selector_version,
        selection_reason=pair.selection_reason,
    )


def _state_response(
    db: Session,
    *,
    service: RedBlueService,
    state: BattleState,
    page: int = 1,
    size: int = 100,
) -> RedBlueStateResponse:
    """将领域状态转换为当前排名页和可恢复的页面状态。"""
    ranking_total = len(state.items)
    ranking_items = state.items[(page - 1) * size:page * size]
    content_ids = [item.content_id for item in ranking_items]
    if state.next_pair is not None:
        content_ids.extend((state.next_pair.left_content_id, state.next_pair.right_content_id))
    snapshots = service.get_content_snapshots(db, user_id=state.user_id, content_ids=content_ids)
    suggestions_by_content = {
        view.content_id: _suggestion_response(view)
        for view in state.score_suggestions
    }

    ranking: list[RedBlueRankingItemResponse] = []
    for item in ranking_items:
        snapshot = snapshots.get(item.content_id)
        if snapshot is None:
            continue
        ranking.append(
            RedBlueRankingItemResponse(
                content=_content_summary(snapshot),
                # expected_rank 是后验期望值，只用于诊断和校准输入；
                # API/UI 的 rank 必须始终是当前 preference_mean 的严格整数序号。
                rank=item.provisional_rank,
                current_score=snapshot.current_score,
                preference_mean=item.preference_mean,
                comparison_count=item.comparison_count,
                stability=item.authoritative_stability,
                order_uncertain=item.authoritative_order_uncertain,
                rank_low=item.authoritative_rank_low,
                rank_high=item.authoritative_rank_high,
                score_suggestion=suggestions_by_content.get(item.content_id),
            )
        )
    ranking.sort(key=lambda item: (item.rank, item.content.content_id))

    return RedBlueStateResponse(
        state_version=state.comparison_state_version,
        model_freshness=state.freshness.value,
        candidate_count=len(state.items),
        pair_status=state.pair_status.value,
        current_pair=_pair_response(state.next_pair, snapshots),
        ranking=ranking,
        ranking_total=ranking_total,
        ranking_page=page,
        ranking_size=size,
        full_recalibration_required=state.full_recalibration_required,
        full_recalibration_running=state.full_recalibration_running,
    )


def _comparison_response(result: ComparisonResult) -> RedBlueComparisonResponse:
    """将 Service 的 Comparison 结果转换为事实响应。"""
    if result.comparison_id is None or result.outcome is None or result.client_event_id is None:
        raise HTTPException(status_code=500, detail='Comparison 响应缺少事实字段')
    return RedBlueComparisonResponse(
        id=result.comparison_id,
        left_content_id=result.left_content_id or 0,
        right_content_id=result.right_content_id or 0,
        outcome=result.outcome.value,
        client_event_id=result.client_event_id,
        selector_version=result.selector_version or 'v1',
        created_at=result.created_at,
        revoked_at=result.revoked_at,
    )


def _comparison_history_response(item: ComparisonHistoryItem) -> RedBlueComparisonHistoryItemResponse:
    """将可撤销的领域历史记录转换为列表 API 响应。"""
    return RedBlueComparisonHistoryItemResponse(
        id=item.id,
        left_content=RedBlueComparisonHistoryContentResponse(
            content_id=item.left_content_id,
            title=item.left_title,
        ),
        right_content=RedBlueComparisonHistoryContentResponse(
            content_id=item.right_content_id,
            title=item.right_title,
        ),
        left_content_id=item.left_content_id,
        right_content_id=item.right_content_id,
        outcome=item.outcome.value,
        client_event_id=item.client_event_id,
        selector_version=item.selector_version,
        created_at=item.created_at,
        revoked_at=item.revoked_at,
    )


def _map_service_error(error: ValueError) -> HTTPException:
    """把领域输入/资源错误映射到稳定的 HTTP 语义。"""
    if isinstance(error, RedBlueComparisonConflictError):
        return HTTPException(status_code=409, detail=str(error))
    if isinstance(error, RedBlueComparisonNotFoundError):
        return HTTPException(status_code=404, detail='comparison 不存在')
    if isinstance(error, ScoreSuggestionConflictError):
        return HTTPException(status_code=409, detail=str(error))
    if isinstance(error, ScoreSuggestionNotFoundError):
        return HTTPException(status_code=404, detail='评分建议不存在')
    return HTTPException(status_code=400, detail=str(error))


@router.get('/state', response_model=RedBlueStateResponse)
def get_state(
    page: int = Query(default=1, ge=1),
    size: int = Query(default=100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    service: RedBlueService = Depends(get_red_blue_service),
) -> RedBlueStateResponse:
    """获取当前用户可恢复的 PK、排名和模型状态。"""
    state = service.get_battle_state(db, user_id=user.id)
    return _state_response(db, service=service, state=state, page=page, size=size)


@router.get('/comparisons', response_model=RedBlueComparisonHistoryPageResponse)
def list_comparisons(
    page: int = Query(default=1, ge=1),
    size: int = Query(default=100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    service: RedBlueService = Depends(get_red_blue_service),
) -> RedBlueComparisonHistoryPageResponse:
    """分页获取当前用户仍可撤销的 PK 历史；已撤销事实仍保留在数据库中。"""
    history = service.list_active_comparisons(db, user_id=user.id, page=page, size=size)
    return RedBlueComparisonHistoryPageResponse(
        items=[_comparison_history_response(item) for item in history.items],
        total=history.total,
        page=history.page,
        size=history.size,
    )


@router.post('/comparisons', response_model=CreateComparisonResponse)
def create_comparison(
    body: CreateComparisonRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    service: RedBlueService = Depends(get_red_blue_service),
) -> CreateComparisonResponse:
    """记录一次 PK 事实并返回增量排名和下一组 Pair。"""
    try:
        result = service.record_comparison(
            db,
            user_id=user.id,
            left_content_id=body.left_content_id,
            right_content_id=body.right_content_id,
            outcome=body.outcome,
            client_event_id=str(body.client_event_id),
            selector_version=service.config.selector_config.selector_version,
            focus_content_id=body.focus_content_id,
        )
    except ValueError as error:
        raise _map_service_error(error) from error

    snapshots = service.get_content_snapshots(
        db,
        user_id=user.id,
        content_ids=(
            result.next_pair.left_content_id,
            result.next_pair.right_content_id,
        )
        if result.next_pair is not None
        else (),
    )
    return CreateComparisonResponse(
        comparison=_comparison_response(result),
        state_version=result.comparison_state_version,
        ranking_delta=[
            RedBlueRankingDeltaResponse(
                content_id=item.content_id,
                old_rank=item.old_rank,
                new_rank=item.new_rank,
                preference_mean=item.preference_mean,
                comparison_count=item.comparison_count,
                stability=item.stability,
                order_uncertain=item.order_uncertain,
                rank_low=item.rank_low,
                rank_high=item.rank_high,
            )
            for item in result.ranking_delta
        ],
        next_pair=_pair_response(result.next_pair, snapshots),
        pair_status=result.pair_status.value,
        model_freshness=result.freshness.value,
        full_recalibration_required=result.full_recalibration_required,
        full_recalibration_running=result.full_recalibration_running,
        idempotent_replay=result.idempotent_replay,
        score_suggestion_delta=_suggestion_delta_response(result),
    )


def _action_response(
    result: ScoreSuggestionActionResult,
    state_response: RedBlueStateResponse,
) -> ScoreSuggestionActionResponse:
    """将评分建议动作结果和动作后的排名行转换为 HTTP 响应。"""
    updated_item = next(
        (item for item in state_response.ranking if item.content.content_id == result.content_id),
        None,
    )
    return ScoreSuggestionActionResponse(
        suggestion_id=result.suggestion_id,
        action=result.action,
        current_score=result.current_score,
        updated_score=result.updated_score,
        state_version=result.comparison_state_version,
        updated_ranking_item=updated_item,
        idempotent_replay=result.idempotent_replay,
    )


@router.post('/comparisons/{comparison_id}/revoke', response_model=RevokeComparisonResponse)
def revoke_comparison(
    comparison_id: int = Path(ge=1),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    service: RedBlueService = Depends(get_red_blue_service),
) -> RevokeComparisonResponse:
    """撤销当前用户自己的 PK 事实；实际数据保留，只更新 revoked_at。"""
    try:
        result = service.revoke_comparison(db, user_id=user.id, comparison_id=comparison_id)
    except ValueError as error:
        raise _map_service_error(error) from error
    return RevokeComparisonResponse(
        comparison=_comparison_response(result),
        revoked=result.revoked_at is not None,
        state_version=result.comparison_state_version,
        model_freshness=result.freshness.value,
        full_recalibration_required=result.full_recalibration_required,
        full_recalibration_running=result.full_recalibration_running,
    )


@router.post(
    '/score-suggestions/{suggestion_id}/actions',
    response_model=ScoreSuggestionActionResponse,
)
def handle_score_suggestion_action(
    body: ScoreSuggestionActionRequest,
    suggestion_id: int = Path(ge=1),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    service: RedBlueService = Depends(get_red_blue_service),
) -> ScoreSuggestionActionResponse:
    """处理当前用户的评分建议，并在 ACCEPTED 时更新当前评分。"""
    try:
        result, state = service.handle_score_suggestion(
            db,
            user_id=user.id,
            suggestion_id=suggestion_id,
            suggestion_key=body.suggestion_key,
            action=body.action,
            client_event_id=str(body.client_event_id),
        )
    except ValueError as error:
        raise _map_service_error(error) from error
    return _action_response(
        result,
        _state_response(db, service=service, state=state, page=page, size=size),
    )


__all__ = ['get_red_blue_service', 'router']
