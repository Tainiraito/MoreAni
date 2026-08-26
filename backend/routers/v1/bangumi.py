"""Bangumi router — search and import anime from Bangumi API."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from deps import get_current_user, get_db
from models import User
from schemas import (
    BangumiImportResponse,
    BangumiSearchItem,
    BangumiSearchResponse,
)
from services import bangumi as bangumi_svc
from services import content as content_svc

router = APIRouter(prefix='/bangumi', tags=['bangumi'])


@router.get('/search', response_model=BangumiSearchResponse)
async def search_bangumi(
    q: str = Query(..., min_length=1, description='Search keyword'),
    limit: int = Query(10, ge=1, le=25),
    user: User = Depends(get_current_user),
) -> BangumiSearchResponse:
    """Search Bangumi for anime/movie content.

    Returns matching subjects with cover images, ratings, and metadata.
    """
    try:
        result = await bangumi_svc.search_subjects(q, limit=limit)
    except bangumi_svc.BangumiError as exc:
        raise HTTPException(status_code=502, detail='Bangumi 服务暂时不可用，请稍后重试') from exc
    items = []
    for item in result.get('items', []):
        items.append(
            BangumiSearchItem(
                bgm_id=item['bgm_id'],
                name=item.get('name', ''),
                name_cn=item.get('name_cn', ''),
                cover_url=item.get('cover_url', ''),
                rating=item.get('rating', 0),
                tags=item.get('tags', []),
                eps=item.get('eps', 0),
                air_date=item.get('air_date', ''),
                platform=item.get('platform', ''),
                summary=item.get('summary', ''),
            )
        )
    return BangumiSearchResponse(total=result.get('total', 0), items=items)


@router.post('/import/{bgm_id}', response_model=BangumiImportResponse)
async def import_from_bangumi(
    bgm_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BangumiImportResponse:
    """Import content from Bangumi by subject ID.

    Fetches cover image, metadata, and tags from Bangumi API.
    Checks for duplicates via source_id.
    """
    # Check duplicate
    existing = content_svc.check_source_duplicate(db, 'bangumi', str(bgm_id))
    if existing:
        return BangumiImportResponse(content_id=existing.id, status='exists')

    # Fetch detail from Bangumi v0 API
    try:
        detail = await bangumi_svc.get_subject_detail(bgm_id)
    except bangumi_svc.BangumiError as exc:
        raise HTTPException(status_code=502, detail='Bangumi 服务暂时不可用，请稍后重试') from exc
    if not detail:
        raise HTTPException(status_code=404, detail='Bangumi subject not found')

    # Determine content type from tags or platform
    content_type = 'anime'
    tag_names = detail.get('tags', [])

    # Create content item with full metadata from Bangumi
    content = content_svc.create_content(
        db,
        title=detail.get('name_cn', '') or detail.get('name', ''),
        title_alt=detail.get('name', '') if detail.get('name_cn') else '',
        cover_url=detail.get('cover_url', ''),
        description=detail.get('summary', ''),
        content_type=content_type,
        episodes=detail.get('eps', 0),
        release_date=detail.get('air_date', ''),
        platform=detail.get('platform', ''),
        source_type='bangumi',
        source_id=str(bgm_id),
        source_url=f'https://bangumi.tv/subject/{bgm_id}',
        created_by=user.id,
        tag_names=tag_names,
    )

    return BangumiImportResponse(content_id=content.id, status='created')


@router.get('/score/{bgm_id}')
async def get_bangumi_score(
    bgm_id: int,
) -> dict:
    """Get a short-lived cached score from Bangumi API."""
    try:
        score = await bangumi_svc.get_subject_score(bgm_id)
    except bangumi_svc.BangumiError as exc:
        raise HTTPException(status_code=502, detail='Bangumi 服务暂时不可用，请稍后重试') from exc
    if score is None:
        raise HTTPException(status_code=404, detail='Bangumi subject not found')
    return {'score': score}


@router.get('/detail/{bgm_id}')
async def get_bangumi_detail(bgm_id: int) -> dict:
    """Get full Bangumi subject details (including tags, summary, etc)."""
    try:
        detail = await bangumi_svc.get_subject_detail(bgm_id)
    except bangumi_svc.BangumiError as exc:
        raise HTTPException(status_code=502, detail='Bangumi 服务暂时不可用，请稍后重试') from exc
    if not detail:
        raise HTTPException(status_code=404, detail='Bangumi subject not found')
    return detail
