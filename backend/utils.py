from models import Rating
from schemas import RatingSchema


def rating_to_schema(rating: Rating) -> RatingSchema:
    return RatingSchema(
        id=rating.id,
        anime_id=rating.anime_id,
        user_id=rating.user_id,
        username=rating.user.username if rating.user else '',
        anime_score=rating.anime_score,
        recommend=rating.recommend,
        review=rating.review,
        created_at=rating.created_at,
        updated_at=rating.updated_at,
        anime_title=rating.anime.title_cn if rating.anime else None,
        anime_cover=rating.anime.cover_url if rating.anime else None
    )
