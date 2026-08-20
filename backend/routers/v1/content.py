"""Content router — CRUD, list, search, random, share."""

import secrets

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from deps import get_current_user, get_current_user_optional, get_db
from models import ContentItem, ShareLink, User
from schemas import (
    ContentItemCreate,
    ContentItemResponse,
    ContentItemUpdate,
    ContentListResponse,
    RecentReview,
    RecommendationResponse,
    ShareLinkCreate,
    ShareLinkResponse,
    TagResponse,
)
from services import content as content_svc
from services import covers as covers_svc
from services import rating as rating_svc

router = APIRouter(prefix='/content', tags=['content'])


def _to_response(
    item: ContentItem,
    stats_map: dict[int, dict],
    recent_map: dict[int, list[dict]],
    user_ratings_map: dict[int, object],
) -> ContentItemResponse:
    """只组装已批量加载的数据；此函数不得访问数据库。"""
    resp = ContentItemResponse.model_validate(item)
    stats = stats_map.get(
        item.id,
        {'avg_score': None, 'avg_recommend': None, 'rating_count': 0, 'review_count': 0},
    )
    resp.avg_score = stats['avg_score']
    resp.avg_recommend = stats['avg_recommend']
    resp.rating_count = stats['rating_count']
    resp.review_count = stats['review_count']
    resp.tags = [TagResponse.model_validate(t) for t in item.tags]
    resp.recent_reviews = [RecentReview(**r) for r in recent_map.get(item.id, [])]
    my_rating = user_ratings_map.get(item.id)
    if my_rating:
        if my_rating.score > 0:
            resp.my_score = my_rating.score / 10.0
        resp.my_has_review = bool(my_rating.review and my_rating.review.strip())
    return resp


def _build_responses(
    db: Session,
    items: list[ContentItem],
    user_id: int | None = None,
) -> list[ContentItemResponse]:
    """用固定次数查询批量补齐列表/详情所需派生字段。"""
    content_ids = [item.id for item in items]
    stats_map = rating_svc.get_rating_stats_map(db, content_ids)
    recent_map = rating_svc.get_recent_reviews_map(db, content_ids, limit=6)
    user_ratings_map = rating_svc.get_user_ratings_map(db, user_id, content_ids)
    return [_to_response(item, stats_map, recent_map, user_ratings_map) for item in items]


@router.get('', response_model=ContentListResponse)
def list_content(
    db: Session = Depends(get_db),
    type: str | None = Query(None, description='Content type filter'),
    status: str | None = Query(None, alias='status', description='Watch status filter'),
    tag: str | None = Query(None, description='Tag filter'),
    q: str | None = Query(None, description='Search keyword'),
    sort: str = Query(
        'updated_desc',
        description=('Sort: updated_desc/newest/oldest/rating/title/air_date_desc/air_date_asc'),
    ),
    rated: str | None = Query(None, description='rated/unrated filter'),
    reviewed: str | None = Query(None, description='reviewed/unreviewed filter'),
    favorited: str | None = Query(None, description='favorited/unfavorited filter'),
    season: str | None = Query(
        None,
        description='放送季度，如 2026-01=2026年1月番（自动换算 01/04/07/10 对应季度时间段）',
    ),
    rated_by: int | None = Query(None, description='只看该用户评分/评论过的内容'),
    user: User | None = Depends(get_current_user_optional),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=1000),
) -> ContentListResponse:
    """List content items with filters, search, and pagination."""
    items, total = content_svc.list_content(
        db,
        content_type=type,
        status=status,
        tag=tag,
        season=season,
        rated_by=rated_by,
        q=q,
        sort=sort,
        rated=rated,
        reviewed=reviewed,
        favorited=favorited,
        user_id=user.id if user else None,
        page=page,
        size=size,
    )
    return ContentListResponse(
        items=_build_responses(db, items, user.id if user else None),
        total=total,
        page=page,
        size=size,
    )


@router.get('/random', response_model=ContentItemResponse)
def random_content(db: Session = Depends(get_db)) -> ContentItemResponse:
    """Get a random public content item."""
    item = content_svc.get_random_content(db)
    if not item:
        raise HTTPException(status_code=404, detail='No content available')
    return _build_responses(db, [item])[0]


@router.get('/recommendations', response_model=RecommendationResponse)
def recommendations(
    db: Session = Depends(get_db),
    type: str = Query('anime', description='内容类型'),
    size: int = Query(12, ge=1, le=30),
    exclude_id: list[int] = Query(default=[]),
    user: User | None = Depends(get_current_user_optional),
) -> RecommendationResponse:
    """返回首页使用的单一、无重复推荐池。"""
    items = content_svc.get_recommendations(
        db,
        content_type=type,
        size=size,
        exclude_ids=exclude_id,
        user_id=user.id if user else None,
    )
    return RecommendationResponse(items=_build_responses(db, items, user.id if user else None))


@router.get('/seasons')
def list_seasons(db: Session = Depends(get_db)) -> dict:
    """放送季度分布：按 release_date 聚合出有数据的季度（1/4/7/10 月番口径）。

    返回 [{value: '2026-01', count: N}]，供前端筛选下拉动态生成选项。
    """
    from sqlalchemy import func

    rows = (
        db.query(
            func.substr(ContentItem.release_date, 1, 4).label('y'),
            func.substr(ContentItem.release_date, 6, 2).label('m'),
            func.count(ContentItem.id).label('cnt'),
        )
        .filter(
            ContentItem.release_date.isnot(None),
            ContentItem.release_date != '',
            ContentItem.deleted_at.is_(None),
            ContentItem.is_public == True,  # noqa: E712
        )
        .group_by('y', 'm')
        .all()
    )
    month_to_quarter = {
        '01': '01',
        '02': '01',
        '03': '01',
        '04': '04',
        '05': '04',
        '06': '04',
        '07': '07',
        '08': '07',
        '09': '07',
        '10': '10',
        '11': '10',
        '12': '10',
    }
    season_map: dict[str, int] = {}
    for y, m, cnt in rows:
        q = month_to_quarter.get(m, m)
        key = f'{y}-{q}'
        season_map[key] = season_map.get(key, 0) + cnt
    items = [{'value': k, 'count': v} for k, v in sorted(season_map.items(), reverse=True)]
    return {'items': items}


@router.get('/{content_id}', response_model=ContentItemResponse)
def get_content(
    content_id: int,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
) -> ContentItemResponse:
    """Get content detail by ID."""
    item = content_svc.get_content_by_id(db, content_id)
    if not item:
        raise HTTPException(status_code=404, detail='Content not found')
    if not item.is_public and (
        user is None or (item.created_by != user.id and user.role not in ('admin', 'super_admin'))
    ):
        raise HTTPException(status_code=404, detail='Content not found')
    return _build_responses(db, [item], user.id if user else None)[0]


@router.post('', response_model=ContentItemResponse, status_code=201)
def create_content(
    body: ContentItemCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentItemResponse:
    """Create a new content item.

    Only admins can add new content (friends review & rate, admins curate).
    """
    if user.role not in ('admin', 'super_admin'):
        raise HTTPException(status_code=403, detail='No permission to add content')
    try:
        item = content_svc.create_content(
            db,
            title=body.title,
            title_alt=body.title_alt,
            cover_url=body.cover_url,
            description=body.description,
            content_type=body.content_type,
            episodes=body.episodes,
            status=body.status,
            release_date=body.release_date,
            platform=body.platform,
            source_type=body.source_type,
            source_id=body.source_id,
            source_url=body.source_url,
            content_metadata=body.metadata,
            is_public=body.is_public,
            created_by=user.id,
            tag_names=body.tags,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    # 确认添加后才下载封面到本地（搜索仅预览不下载；失败降级外链）
    covers_svc.localize_cover(item, body.cover_url)
    db.commit()
    item = content_svc.get_content_by_id(db, item.id)
    return _build_responses(db, [item], user.id)[0]


@router.put('/{content_id}', response_model=ContentItemResponse)
def update_content(
    content_id: int,
    body: ContentItemUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ContentItemResponse:
    """Update an existing content item.

    Only the creator or admin can update.
    """
    item = content_svc.get_content_by_id(db, content_id)
    if not item:
        raise HTTPException(status_code=404, detail='Content not found')
    if item.created_by != user.id and user.role not in ('admin', 'super_admin'):
        raise HTTPException(status_code=403, detail='No permission to edit this content')

    update_data = body.model_dump(exclude_unset=True)
    updated = content_svc.update_content(db, item, **update_data)
    # 更新时若换了外链封面 → 下载到本地（失败降级）
    if 'cover_url' in update_data:
        covers_svc.localize_cover(updated, updated.cover_url)
        db.commit()
    updated = content_svc.get_content_by_id(db, updated.id)
    return _build_responses(db, [updated], user.id)[0]


@router.delete('/{content_id}', status_code=204)
def delete_content(
    content_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Delete a content item.

    Only the creator or admin can delete. Cascades to ratings, statuses, tags.
    """
    item = content_svc.get_content_by_id(db, content_id)
    if not item:
        raise HTTPException(status_code=404, detail='Content not found')
    if item.created_by != user.id and user.role not in ('admin', 'super_admin'):
        raise HTTPException(status_code=403, detail='No permission to delete this content')

    content_svc.delete_content(db, item)


@router.post('/{content_id}/share', response_model=ShareLinkResponse)
def create_share_link(
    content_id: int,
    body: ShareLinkCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ShareLinkResponse:
    """Create a share link for a content item.

    Returns a token-based URL for guest access.
    """
    item = content_svc.get_content_by_id(db, content_id)
    if not item:
        raise HTTPException(status_code=404, detail='Content not found')
    # 仅创建者或 admin 可创建分享链接
    if item.created_by != user.id and user.role not in ('admin', 'super_admin'):
        raise HTTPException(status_code=403, detail='No permission to share this content')

    token = secrets.token_urlsafe(24)[:32]
    link = ShareLink(
        token=token,
        created_by=user.id,
        expires_at=body.expires_at,
    )
    db.add(link)
    db.commit()
    db.refresh(link)

    return ShareLinkResponse(
        id=link.id,
        token=link.token,
        url=f'/guest/{link.token}',
        expires_at=link.expires_at,
        view_count=link.view_count,
        created_at=link.created_at,
    )
