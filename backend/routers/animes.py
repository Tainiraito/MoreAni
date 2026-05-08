from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from auth import get_current_user, get_optional_user
from database import get_db
from models import Anime, Rating, User
from schemas import (
    AnimeCreate,
    AnimeDetail,
    AnimeListResponse,
    AnimeSchema,
    AnimeUpdate,
)
from utils import rating_to_schema

router = APIRouter(prefix='/animes', tags=['animes'])


def anime_to_schema(anime: Anime, db: Session) -> AnimeSchema:
    avg_data = (
        db.query(
            func.avg(func.nullif(Rating.anime_score, 0)).label('avg_score'),
            func.avg(func.nullif(Rating.recommend, 0)).label('avg_rec'),
            func.count(Rating.id).label('count'),
        )
        .filter(Rating.anime_id == anime.id)
        .first()
    )

    latest = (
        db.query(Rating)
        .filter(Rating.anime_id == anime.id, Rating.review != '')
        .order_by(Rating.updated_at.desc())
        .first()
    )

    avg_score = (
        round(avg_data.avg_score, 1) if avg_data and avg_data.avg_score else None
    )
    avg_rec = round(avg_data.avg_rec, 1) if avg_data and avg_data.avg_rec else None

    # Calculate rankings using subquery
    score_rank = None
    recommend_rank = None
    total_animes = None
    if avg_score is not None:
        # Get per-anime averages
        per_anime = (
            db.query(
                Rating.anime_id,
                func.avg(func.nullif(Rating.anime_score, 0)).label('a_score'),
                func.avg(func.nullif(Rating.recommend, 0)).label('a_rec'),
            )
            .group_by(Rating.anime_id)
            .all()
        )
        total_animes = len(per_anime) if per_anime else 0
        if total_animes > 0:
            scores = sorted([r.a_score for r in per_anime], reverse=True)
            recs = sorted([r.a_rec for r in per_anime], reverse=True)
            score_rank = next(
                (i + 1 for i, s in enumerate(scores) if s <= avg_score), total_animes
            )
            recommend_rank = next(
                (i + 1 for i, r in enumerate(recs) if r <= avg_rec), total_animes
            )

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
        avg_anime_score=avg_score,
        avg_recommend=avg_rec,
        rating_count=avg_data.count if avg_data else 0,
        latest_review=latest.review if latest else None,
        score_rank=score_rank,
        recommend_rank=recommend_rank,
        total_animes=total_animes,
    )


@router.get('', response_model=AnimeListResponse)
def list_animes(
    search: str = Query(default=''),
    tag: str = Query(default=''),
    season: str = Query(default=''),
    sort: str = Query(default='avg_score'),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=100),
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    avg_score_sub = (
        db.query(
            Rating.anime_id,
            func.avg(func.nullif(Rating.anime_score, 0)).label('avg_score'),
            func.avg(func.nullif(Rating.recommend, 0)).label('avg_rec'),
            func.count(Rating.id).label('rating_count'),
        )
        .group_by(Rating.anime_id)
        .subquery()
    )

    query = db.query(
        Anime,
        func.coalesce(avg_score_sub.c.avg_score, 0).label('avg_score'),
        func.coalesce(avg_score_sub.c.avg_rec, 0).label('avg_rec'),
        func.coalesce(avg_score_sub.c.rating_count, 0).label('rating_count'),
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
    elif sort == 'avg_rec':
        query = query.order_by(desc('avg_rec'))
    else:
        query = query.order_by(desc('avg_score'))

    offset = (page - 1) * limit
    rows = query.offset(offset).limit(limit).all()

    anime_ids = [row[0].id for row in rows]
    latest_reviews = {}
    if anime_ids:
        latest_rows = (
            db.query(Rating.anime_id, Rating.review)
            .filter(Rating.anime_id.in_(anime_ids), Rating.review != '')
            .order_by(Rating.anime_id, Rating.updated_at.desc())
            .all()
        )

        seen = set()
        for aid, review in latest_rows:
            if aid not in seen:
                latest_reviews[aid] = review
                seen.add(aid)

    items = []
    user_rated_ids: set[int] = set()
    if current_user:
        user_rated_ids = {
            row[0]
            for row in db.query(Rating.anime_id)
            .filter(Rating.user_id == current_user.id)
            .all()
        }

    for row in rows:
        anime = row[0]
        items.append(
            AnimeSchema(
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
                latest_review=latest_reviews.get(anime.id),
                user_rated=anime.id in user_rated_ids if current_user else None,
            )
        )

    return AnimeListResponse(items=items, total=total)


@router.get('/random', response_model=AnimeSchema)
def random_unrated(
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    if current_user:
        rated_ids = db.query(Rating.anime_id).filter(Rating.user_id == current_user.id)
        anime = (
            db.query(Anime)
            .filter(~Anime.id.in_(rated_ids))
            .order_by(func.random())
            .first()
        )
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
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    anime = db.query(Anime).filter(Anime.id == anime_id).first()
    if not anime:
        raise HTTPException(status_code=404, detail='番剧不存在')

    my_rating = None
    if current_user:
        my_rating = (
            db.query(Rating)
            .filter(Rating.anime_id == anime_id, Rating.user_id == current_user.id)
            .first()
        )

    all_ratings = db.query(Rating).filter(Rating.anime_id == anime_id).all()

    return AnimeDetail(
        anime=anime_to_schema(anime, db),
        my_rating=rating_to_schema(my_rating) if my_rating else None,
        ratings=[rating_to_schema(r) for r in all_ratings],
    )


@router.post('', response_model=AnimeSchema, status_code=201)
def create_anime(
    data: AnimeCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 去重：按中文名检查
    existing = db.query(Anime).filter(Anime.title_cn == data.title_cn).first()
    if existing:
        raise HTTPException(status_code=409, detail=f'番剧「{data.title_cn}」已存在')

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
        created_by=current_user.id,
    )
    db.add(anime)
    db.commit()
    db.refresh(anime)
    return anime_to_schema(anime, db)


@router.delete('/{anime_id}', status_code=204)
def delete_anime(
    anime_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    anime = db.query(Anime).filter(Anime.id == anime_id).first()
    if not anime:
        raise HTTPException(status_code=404, detail='番剧不存在')
    # 级联删除相关评分
    db.query(Rating).filter(Rating.anime_id == anime_id).delete()
    db.delete(anime)
    db.commit()


@router.put('/{anime_id}', response_model=AnimeSchema)
def update_anime(
    anime_id: int,
    data: AnimeUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
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
