from datetime import datetime

from pydantic import BaseModel, Field


class CheckUsernameRequest(BaseModel):
    username: str


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
    bgm_id: int | None = None
    created_by: int
    created_at: datetime
    updated_at: datetime
    avg_anime_score: float | None = None
    avg_recommend: float | None = None
    rating_count: int | None = None
    latest_review: str | None = None
    user_rated: bool | None = None
    score_rank: int | None = None
    recommend_rank: int | None = None
    total_animes: int | None = None

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
    title_cn: str | None = None
    title_jp: str | None = None
    cover_url: str | None = None
    description: str | None = None
    episodes: int | None = None
    status: str | None = None
    tags: str | None = None
    season: str | None = None
    air_date: str | None = None
    platform: str | None = None


class RatingSchema(BaseModel):
    id: int
    anime_id: int
    user_id: int
    username: str = ''
    anime_score: int = Field(ge=0, le=10)
    recommend: int = Field(ge=0, le=10)
    review: str = ''
    created_at: datetime
    updated_at: datetime
    anime_title: str | None = None
    anime_cover: str | None = None

    model_config = {'from_attributes': True}


class RatingCreate(BaseModel):
    anime_id: int
    anime_score: int = Field(ge=0, le=10)
    recommend: int = Field(ge=0, le=10)
    review: str = ''


class AnimeDetail(BaseModel):
    anime: AnimeSchema
    my_rating: RatingSchema | None = None
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
    air_date: str | None = ''
    platform: str | None = ''
    summary: str | None = ''
    status: str = ''
    season: str = ''


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


class ChangeUsernameRequest(BaseModel):
    new_username: str = Field(..., min_length=2, max_length=50)


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(..., min_length=6)
