import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Anime, User
from schemas import (
    BangumiDetailResponse,
    BangumiImportResponse,
    BangumiSearchItem,
    BangumiSearchRequest,
    BangumiSearchResponse,
)
from services.bangumi import get_subject, search_subjects
from services.infobox import (
    extract_air_date,
    extract_episodes,
    extract_season,
    extract_status,
)

router = APIRouter(prefix='/bangumi', tags=['bangumi'])


@router.post('/search', response_model=BangumiSearchResponse)
async def search(req: BangumiSearchRequest):
    try:
        data = await search_subjects(req.keyword, req.limit, req.offset)
    except Exception:
        raise HTTPException(
            status_code=502, detail='Bangumi 搜索暂不可用，请尝试手动填写'
        ) from None

    results = []
    for item in data.get('data', []):
        # 从 date 推导状态和季度
        import re
        from datetime import datetime as _dt

        air_date = item.get('date', '') or ''
        _status = ''
        _season = ''
        if air_date:
            try:
                d = _dt.strptime(air_date[:10], '%Y-%m-%d')
                _status = '已完结' if d < _dt(2025, 6, 1) else '连载中'
            except ValueError:
                pass
            m = re.search(r'(\d{4})-(\d{2})', air_date)
            if m:
                y, mo = m.group(1), int(m.group(2))
                s = {
                    1: '冬',
                    2: '冬',
                    3: '冬',
                    4: '春',
                    5: '春',
                    6: '春',
                    7: '夏',
                    8: '夏',
                    9: '夏',
                    10: '秋',
                    11: '秋',
                    12: '秋',
                }
                _season = f'{y}年{s.get(mo, "")}'

        results.append(
            BangumiSearchItem(
                bgm_id=item['id'],
                title_cn=item.get('name_cn') or item['name'],
                title_jp=item['name'],
                cover_url=item.get('images', {}).get('large', ''),
                rating=item.get('rating', {}).get('score') or 0,
                rank=item.get('rating', {}).get('rank') or 0,
                tags=[t['name'] for t in item.get('tags', [])],
                episodes=item.get('eps', 0),
                air_date=air_date,
                platform=item.get('platform', ''),
                summary='',
                status=_status,
                season=_season,
            )
        )

    return BangumiSearchResponse(total=data.get('total', 0), animes=results)


@router.post('/import/{bgm_id}', response_model=BangumiImportResponse)
async def import_anime(
    bgm_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    existing = db.query(Anime).filter(Anime.bgm_id == bgm_id).first()
    if existing:
        return BangumiImportResponse(anime_id=existing.id, status='already_exists')

    try:
        subject = await get_subject(bgm_id)
    except Exception:
        raise HTTPException(status_code=502, detail='无法从 Bangumi 获取数据') from None

    summary = subject.get('summary', '') or ''
    infobox = subject.get('infobox', [])
    tags_list = [t['name'] for t in subject.get('tags', [])]

    anime = Anime(
        title_cn=subject.get('name_cn') or subject['name'],
        title_jp=subject['name'],
        cover_url=subject.get('images', {}).get('large', ''),
        description=summary,
        episodes=extract_episodes(infobox),
        status=extract_status(infobox),
        tags=json.dumps(tags_list, ensure_ascii=False),
        season='',
        air_date=extract_air_date(infobox),
        platform=subject.get('platform', ''),
        bgm_id=bgm_id,
        created_by=current_user.id,
    )
    db.add(anime)
    db.commit()
    db.refresh(anime)
    return BangumiImportResponse(anime_id=anime.id, status='created')


@router.get('/detail/{bgm_id}', response_model=BangumiDetailResponse)
async def bangumi_detail(bgm_id: int):
    try:
        subject = await get_subject(bgm_id)
    except Exception:
        raise HTTPException(status_code=502, detail='无法从 Bangumi 获取数据') from None

    summary = subject.get('summary', '') or ''
    infobox = subject.get('infobox', [])
    tags_list = [t['name'] for t in subject.get('tags', [])]

    return BangumiDetailResponse(
        bgm_id=bgm_id,
        title_cn=subject.get('name_cn') or subject['name'],
        title_jp=subject['name'],
        cover_url=subject.get('images', {}).get('large', ''),
        description=summary,
        episodes=extract_episodes(infobox),
        status=extract_status(infobox),
        season=extract_season(infobox),
        air_date=extract_air_date(infobox),
        platform=subject.get('platform', ''),
        tags=tags_list,
    )
