from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Anime, Rating, User
from schemas import RatingCreate, RatingSchema
from utils import rating_to_schema

router = APIRouter(prefix='/ratings', tags=['ratings'])


@router.post('', response_model=RatingSchema)
def create_or_update_rating(
    data: RatingCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    anime = db.query(Anime).filter(Anime.id == data.anime_id).first()
    if not anime:
        raise HTTPException(status_code=404, detail='番剧不存在')

    existing = (
        db.query(Rating)
        .filter(Rating.anime_id == data.anime_id, Rating.user_id == current_user.id)
        .first()
    )

    if existing:
        existing.anime_score = data.anime_score
        existing.recommend = data.recommend
        existing.review = data.review
        db.commit()
        db.refresh(existing)
        return rating_to_schema(existing)

    rating = Rating(
        anime_id=data.anime_id,
        user_id=current_user.id,
        anime_score=data.anime_score,
        recommend=data.recommend,
        review=data.review,
    )
    db.add(rating)
    db.commit()
    db.refresh(rating)
    return rating_to_schema(rating)


@router.get('/recent', response_model=list[RatingSchema])
def recent_ratings(
    limit: int = Query(default=5, ge=1, le=50), db: Session = Depends(get_db)
):
    ratings = db.query(Rating).order_by(Rating.updated_at.desc()).limit(limit).all()
    return [rating_to_schema(r) for r in ratings]


@router.get('/history', response_model=dict)
def rating_history(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = db.query(Rating).order_by(Rating.updated_at.desc())
    total = query.count()
    offset = (page - 1) * limit
    items = query.offset(offset).limit(limit).all()
    return {
        'items': [rating_to_schema(r) for r in items],
        'total': total,
        'page': page,
        'limit': limit,
    }
