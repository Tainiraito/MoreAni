from typing import Optional
from pydantic import BaseModel, Field
from datetime import datetime


class UserSchema(BaseModel):
    id: int
    username: str
    created_at: datetime

    model_config = {'from_attributes': True}


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str
    invite_code: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = 'bearer'
    user: UserSchema


class AnimeSchema(BaseModel):
    id: int
    title_cn: str
    title_jp: str
    cover_url: str
    description: str
    episodes: int
    status: str
    tags: str
    season: str
    air_date: str
    platform: str
    bgm_id: Optional[int] = None
    created_by: int
    created_at: datetime
    updated_at: datetime
    avg_anime_score: Optional[float] = None
    avg_recommend: Optional[float] = None
    rating_count: Optional[int] = None
    latest_review: Optional[str] = None
    user_rated: Optional[bool] = None
    score_rank: Optional[int] = None
    recommend_rank: Optional[int] = None
    total_animes: Optional[int] = None

    model_config = {'from_attributes': True}


class AnimeCreate(BaseModel):
    title_cn: str
    title_jp: str = ''
    cover_url: str = ''
    description: str = ''
    episodes: int = 0
    status: str = ''
    tags: str = '[]'
    season: str = ''
    air_date: str = ''
    platform: str = ''


class AnimeUpdate(BaseModel):
    title_cn: Optional[str] = None
    title_jp: Optional[str] = None
    cover_url: Optional[str] = None
    description: Optional[str] = None
    episodes: Optional[int] = None
    status: Optional[str] = None
    tags: Optional[str] = None
    season: Optional[str] = None
    air_date: Optional[str] = None
    platform: Optional[str] = None


class RatingSchema(BaseModel):
    id: int
    anime_id: int
    user_id: int
    username: str = ''
    anime_score: int = Field(ge=1, le=10)
    recommend: int = Field(ge=1, le=10)
    review: str = ''
    created_at: datetime
    updated_at: datetime
    anime_title: Optional[str] = None
    anime_cover: Optional[str] = None

    model_config = {'from_attributes': True}


class RatingCreate(BaseModel):
    anime_id: int
    anime_score: int = Field(ge=1, le=10)
    recommend: int = Field(ge=1, le=10)
    review: str = ''


class AnimeDetail(BaseModel):
    anime: AnimeSchema
    my_rating: Optional[RatingSchema] = None
    ratings: list[RatingSchema] = []


class AnimeListResponse(BaseModel):
    items: list[AnimeSchema]
    total: int


class BangumiSearchRequest(BaseModel):
    keyword: str
    limit: int = 10
    offset: int = 0


class BangumiSearchItem(BaseModel):
    bgm_id: int
    title_cn: str
    title_jp: str
    cover_url: str
    rating: float
    rank: int
    tags: list[str]
    episodes: int
    air_date: Optional[str] = ''
    platform: Optional[str] = ''
    summary: Optional[str] = ''


class BangumiSearchResponse(BaseModel):
    total: int
    animes: list[BangumiSearchItem]


class BangumiImportResponse(BaseModel):
    anime_id: int
    status: str


class BangumiDetailResponse(BaseModel):
    bgm_id: int
    title_cn: str
    title_jp: str
    cover_url: str
    description: str
    episodes: int
    status: str
    season: str
    air_date: str
    platform: str
    tags: list[str]
