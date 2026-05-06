import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import User, Anime
from schemas import BangumiSearchRequest, BangumiSearchResponse, BangumiSearchItem, BangumiImportResponse
from services.bangumi import search_subjects, get_subject, get_subject_summary
from services.infobox import extract_episodes, extract_status, extract_air_date
from auth import get_current_user

router = APIRouter(prefix='/bangumi', tags=['bangumi'])


@router.post('/search', response_model=BangumiSearchResponse)
async def search(req: BangumiSearchRequest):
    try:
        data = await search_subjects(req.keyword, req.limit, req.offset)
    except Exception:
        raise HTTPException(status_code=502, detail='Bangumi 搜索暂不可用，请尝试手动填写')

    results = []
    for item in data.get('data', []):
        results.append(BangumiSearchItem(
            bgm_id=item['id'],
            title_cn=item.get('name_cn') or item['name'],
            title_jp=item['name'],
            cover_url=item.get('images', {}).get('large', ''),
            rating=item.get('rating', {}).get('score') or 0,
            rank=item.get('rating', {}).get('rank') or 0,
            tags=[t['name'] for t in item.get('tags', [])],
            episodes=item.get('eps', 0),
            air_date=item.get('date', ''),
            platform=item.get('platform', ''),
            summary=''
        ))

    return BangumiSearchResponse(
        total=data.get('total', 0),
        animes=results
    )


@router.post('/import/{bgm_id}', response_model=BangumiImportResponse)
async def import_anime(
    bgm_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    existing = db.query(Anime).filter(Anime.bgm_id == bgm_id).first()
    if existing:
        return BangumiImportResponse(anime_id=existing.id, status='already_exists')

    try:
        subject = await get_subject(bgm_id)
        summary = await get_subject_summary(bgm_id)
    except Exception:
        raise HTTPException(status_code=502, detail='无法从 Bangumi 获取数据')

    infobox = subject.get('infobox', [])
    tags_list = [t['name'] for t in subject.get('tags', [])]

    anime = Anime(
        title_cn=subject.get('name_cn') or subject['name'],
        title_jp=subject['name'],
        cover_url=subject.get('images', {}).get('large', ''),
        description=summary or '',
        episodes=extract_episodes(infobox),
        status=extract_status(infobox),
        tags=json.dumps(tags_list, ensure_ascii=False),
        season='',
        air_date=extract_air_date(infobox),
        platform=subject.get('platform', ''),
        bgm_id=bgm_id,
        created_by=current_user.id
    )
    db.add(anime)
    db.commit()
    db.refresh(anime)
    return BangumiImportResponse(anime_id=anime.id, status='created')
