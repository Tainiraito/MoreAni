"""登录成员可见的全站与单用户统计分析 API。"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from deps import get_current_user, get_db
from models import User
from schemas import AnalyticsOverviewResponse, AnalyticsRecommendationsResponse
from services import analytics as analytics_svc

router = APIRouter(prefix='/analytics', tags=['analytics'])


@router.get('/overview', response_model=AnalyticsOverviewResponse)
def get_analytics_overview(
    scope: Literal['global', 'user'] = Query('global'),
    user_id: int | None = Query(None, ge=1),
    min_score: float = Query(0.5, ge=0.5, le=10, multiple_of=0.5),
    max_score: float = Query(10, ge=0.5, le=10, multiple_of=0.5),
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AnalyticsOverviewResponse:
    """返回完整评分分布，以及当前评分区间内的标签画像和代表作。"""
    if min_score > max_score:
        raise HTTPException(status_code=422, detail='最低评分不能高于最高评分')
    target_user = _resolve_target_user(db, scope=scope, user_id=user_id)
    return analytics_svc.get_overview(
        db,
        scope=scope,
        target_user=target_user,
        min_score=round(min_score * 10),
        max_score=round(max_score * 10),
    )


@router.get('/recommendations', response_model=AnalyticsRecommendationsResponse)
def get_analytics_recommendations(
    scope: Literal['global', 'user'] = Query('global'),
    user_id: int | None = Query(None, ge=1),
    limit: int = Query(6, ge=1, le=12),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AnalyticsRecommendationsResponse:
    """返回排除相应成员已评分番剧后的可解释站内推荐。"""
    target_user = _resolve_target_user(db, scope=scope, user_id=user_id)
    return analytics_svc.get_recommendations(
        db,
        scope=scope,
        target_user=target_user,
        current_user_id=current_user.id,
        limit=limit,
    )


def _resolve_target_user(
    db: Session,
    *,
    scope: Literal['global', 'user'],
    user_id: int | None,
) -> User | None:
    """校验单用户范围参数，并返回目标成员。"""
    if scope == 'global':
        return None
    if user_id is None:
        raise HTTPException(status_code=422, detail='单用户分析必须提供 user_id')
    target_user = db.query(User).filter(User.id == user_id).first()
    if target_user is None:
        raise HTTPException(status_code=404, detail='用户不存在')
    return target_user
