from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from typing import Optional
from database import get_db
from models import User, Anime, Rating
from schemas import AnimeSchema, AnimeCreate, AnimeUpdate, AnimeDetail, AnimeListResponse, RatingSchema
from auth import get_current_user, get_optional_user
from utils import rating_to_schema

router = APIRouter(prefix='/animes', tags=['animes'])


def anime_to_schema(anime: Anime, db: Session) -> AnimeSchema:
    avg_data = db.query(
        func.avg(Rating.anime_score).label('avg_score'),
        func.avg(Rating.recommend).label('avg_rec'),
        func.count(Rating.id).label('count')
    ).filter(Rating.anime_id == anime.id).first()

    latest = db.query(Rating).filter(
        Rating.anime_id == anime.id,
        Rating.review != ''
    ).order_by(Rating.updated_at.desc()).first()

    return AnimeSchema(
        id=anime.id,
        title_cn=anime.title_cn,
        title_jp=anime.title_jp,
        cover_url=anime.cover_url,
        description=anime.description,
        episodes=anime.episodes,
        status=anime.status,
        tags=anime.tags,
        season=anime.season,
        air_date=anime.air_date,
        platform=anime.platform,
        bgm_id=anime.bgm_id,
        created_by=anime.created_by,
        created_at=anime.created_at,
        updated_at=anime.updated_at,
        avg_anime_score=round(avg_data.avg_score, 1) if avg_data and avg_data.avg_score else None,
        avg_recommend=round(avg_data.avg_rec, 1) if avg_data and avg_data.avg_rec else None,
        rating_count=avg_data.count if avg_data else 0,
        latest_review=latest.review if latest else None
    )


@router.get('', response_model=AnimeListResponse)
def list_animes(
    search: str = Query(default=''),
    tag: str = Query(default=''),
    season: str = Query(default=''),
    sort: str = Query(default='avg_score'),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db)
):
    avg_score_sub = db.query(
        Rating.anime_id,
        func.avg(Rating.anime_score).label('avg_score'),
        func.avg(Rating.recommend).label('avg_rec'),
        func.count(Rating.id).label('rating_count')
    ).group_by(Rating.anime_id).subquery()

    latest_review_sub = db.query(
        Rating.anime_id,
        func.max(Rating.updated_at).label('max_updated')
    ).filter(Rating.review != '').group_by(Rating.anime_id).subquery()

    query = db.query(
        Anime,
        func.coalesce(avg_score_sub.c.avg_score, 0).label('avg_score'),
        func.coalesce(avg_score_sub.c.avg_rec, 0).label('avg_rec'),
        func.coalesce(avg_score_sub.c.rating_count, 0).label('rating_count')
    ).outerjoin(avg_score_sub, Anime.id == avg_score_sub.c.anime_id)

    if search:
        query = query.filter(
            (Anime.title_cn.contains(search)) | (Anime.title_jp.contains(search))
        )
    if tag:
        query = query.filter(Anime.tags.contains(tag))
    if season:
        query = query.filter(Anime.season == season)

    total = query.count()

    if sort == 'count':
        query = query.order_by(desc('rating_count'))
    else:
        query = query.order_by(desc('avg_score'))

    offset = (page - 1) * limit
    rows = query.offset(offset).limit(limit).all()

    anime_ids = [row[0].id for row in rows]
    latest_reviews = {}
    if anime_ids:
        latest_rows = db.query(Rating.anime_id, Rating.review).filter(
            Rating.anime_id.in_(anime_ids),
            Rating.review != ''
        ).order_by(Rating.anime_id, Rating.updated_at.desc()).all()

        seen = set()
        for aid, review in latest_rows:
            if aid not in seen:
                latest_reviews[aid] = review
                seen.add(aid)

    items = []
    for row in rows:
        anime = row[0]
        items.append(AnimeSchema(
            id=anime.id,
            title_cn=anime.title_cn,
            title_jp=anime.title_jp,
            cover_url=anime.cover_url,
            description=anime.description,
            episodes=anime.episodes,
            status=anime.status,
            tags=anime.tags,
            season=anime.season,
            air_date=anime.air_date,
            platform=anime.platform,
            bgm_id=anime.bgm_id,
            created_by=anime.created_by,
            created_at=anime.created_at,
            updated_at=anime.updated_at,
            avg_anime_score=round(row.avg_score, 1) if row.avg_score else None,
            avg_recommend=round(row.avg_rec, 1) if row.avg_rec else None,
            rating_count=row.rating_count or 0,
            latest_review=latest_reviews.get(anime.id)
        ))

    return AnimeListResponse(items=items, total=total)


@router.get('/random', response_model=AnimeSchema)
def random_unrated(
    current_user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    if current_user:
        rated_ids = db.query(Rating.anime_id).filter(Rating.user_id == current_user.id)
        anime = db.query(Anime).filter(~Anime.id.in_(rated_ids)).order_by(func.random()).first()
        if not anime:
            raise HTTPException(status_code=404, detail='没有未评分的番剧了')
    else:
        anime = db.query(Anime).order_by(func.random()).first()
        if not anime:
            raise HTTPException(status_code=404, detail='暂无番剧')
    return anime_to_schema(anime, db)


@router.get('/{anime_id}', response_model=AnimeDetail)
def get_anime(
    anime_id: int,
    current_user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    anime = db.query(Anime).filter(Anime.id == anime_id).first()
    if not anime:
        raise HTTPException(status_code=404, detail='番剧不存在')

    my_rating = None
    if current_user:
        my_rating = db.query(Rating).filter(
            Rating.anime_id == anime_id,
            Rating.user_id == current_user.id
        ).first()

    all_ratings = db.query(Rating).filter(Rating.anime_id == anime_id).all()

    return AnimeDetail(
        anime=anime_to_schema(anime, db),
        my_rating=rating_to_schema(my_rating) if my_rating else None,
        ratings=[rating_to_schema(r) for r in all_ratings]
    )


@router.post('', response_model=AnimeSchema, status_code=201)
def create_anime(
    data: AnimeCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    anime = Anime(
        title_cn=data.title_cn,
        title_jp=data.title_jp,
        cover_url=data.cover_url,
        description=data.description,
        episodes=data.episodes,
        status=data.status,
        tags=data.tags,
        season=data.season,
        air_date=data.air_date,
        platform=data.platform,
        created_by=current_user.id
    )
    db.add(anime)
    db.commit()
    db.refresh(anime)
    return anime_to_schema(anime, db)


@router.put('/{anime_id}', response_model=AnimeSchema)
def update_anime(
    anime_id: int,
    data: AnimeUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    anime = db.query(Anime).filter(Anime.id == anime_id).first()
    if not anime:
        raise HTTPException(status_code=404, detail='番剧不存在')

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(anime, key, value)

    db.commit()
    db.refresh(anime)
    return anime_to_schema(anime, db)
