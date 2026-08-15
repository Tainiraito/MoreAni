"""Pydantic v2 schemas for MoreAni v2 API request/response models."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# =============================================================================
# Tag schemas (defined early — referenced by ContentItemResponse)
# =============================================================================


class TagResponse(BaseModel):
    """Tag response."""

    id: int
    name: str
    tag_type: str  # bangumi / custom

    model_config = {'from_attributes': True}


class TagCreate(BaseModel):
    """Create tag request body."""

    name: str = Field(min_length=1, max_length=50)


# =============================================================================
# Auth schemas
# =============================================================================


class LoginRequest(BaseModel):
    """Login request body."""

    username: str
    password: str


class RegisterRequest(BaseModel):
    """Registration request body."""

    username: str = Field(min_length=3, max_length=50)
    nickname: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=6, max_length=128)
    invite_code: str


class UserResponse(BaseModel):
    """Public user info."""

    id: int
    username: str
    nickname: str
    avatar_id: int = 0
    role: str = 'user'
    created_at: datetime

    model_config = {'from_attributes': True}


class AuthResponse(BaseModel):
    """Login/register success response."""

    user: UserResponse


class AvatarUpdateRequest(BaseModel):
    """Avatar update request body."""

    avatar_id: int = Field(ge=0, le=30)


class PasswordChangeRequest(BaseModel):
    """Password change request body."""

    old_password: str
    new_password: str = Field(min_length=6, max_length=128)


# =============================================================================
# Content schemas
# =============================================================================


class ContentItemCreate(BaseModel):
    """Create content request body."""

    title: str = Field(min_length=1, max_length=200)
    title_alt: str = ''
    cover_url: str = ''
    description: str = ''
    content_type: Literal['anime', 'movie', 'game', 'software', 'website', 'book']
    episodes: int = 0
    status: str = ''
    release_date: str = ''
    platform: str = ''
    source_type: str = 'manual'
    source_id: str = ''
    source_url: str = ''
    metadata: dict = {}
    is_public: bool = True
    tags: list[str] = []


class ContentItemUpdate(BaseModel):
    """Update content request body (all optional)."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    title_alt: str | None = None
    cover_url: str | None = None
    description: str | None = None
    content_type: (
        Literal['anime', 'movie', 'game', 'software', 'website', 'book'] | None
    ) = None
    episodes: int | None = None
    status: str | None = None
    release_date: str | None = None
    platform: str | None = None
    source_type: str | None = None
    source_id: str | None = None
    source_url: str | None = None
    metadata: dict | None = None
    is_public: bool | None = None
    tags: list[str] | None = None


class ContentItemResponse(BaseModel):
    """Content item response."""

    id: int
    title: str
    title_alt: str = ''
    cover_url: str | None = None
    description: str = ''
    content_type: str
    episodes: int = 0
    status: str = ''
    release_date: str = ''
    platform: str = ''
    source_type: str = 'manual'
    source_id: str = ''
    source_url: str = ''
    metadata: dict = Field(default={}, validation_alias='content_metadata')

    @field_validator('metadata', mode='before')
    @classmethod
    def parse_metadata(cls, v):
        if isinstance(v, str):
            import json

            try:
                return json.loads(v)
            except (json.JSONDecodeError, TypeError):
                return {}
        return v or {}

    is_public: bool = True
    created_by: int | None = None
    created_at: datetime
    updated_at: datetime
    # Computed fields
    avg_score: float | None = None
    avg_recommend: float | None = None
    rating_count: int | None = None
    tags: list[TagResponse] = []
    # User-specific fields (only in list endpoint when authenticated)
    my_score: float | None = None
    my_has_review: bool = False

    model_config = {'from_attributes': True, 'populate_by_name': True}


class ContentListResponse(BaseModel):
    """Paginated content list."""

    items: list[ContentItemResponse]
    total: int
    page: int
    size: int


class ShareLinkCreate(BaseModel):
    """Create share link request body."""

    expires_at: datetime | None = None


class ShareLinkResponse(BaseModel):
    """Share link response."""

    id: int
    token: str
    url: str
    expires_at: datetime | None = None
    view_count: int = 0
    created_at: datetime

    model_config = {'from_attributes': True}


# =============================================================================
# Rating schemas
# =============================================================================


class RatingCreate(BaseModel):
    """Create/update rating request body."""

    content_id: int
    score: int = Field(ge=0, le=100)
    recommend: int = Field(ge=0, le=100, default=0)
    review: str = ''


class RatingResponse(BaseModel):
    """Rating response."""

    id: int
    content_id: int
    user_id: int
    username: str = ''
    nickname: str = ''
    score: int
    recommend: int
    review: str = ''
    created_at: datetime
    updated_at: datetime
    # Computed (for activity feed)
    content_title: str | None = None
    content_cover: str | None = None
    content_type: str | None = None

    model_config = {'from_attributes': True}


class RatingHistoryResponse(BaseModel):
    """Paginated rating history."""

    items: list[RatingResponse]
    total: int


# =============================================================================
# User status schemas
# =============================================================================


class StatusSetRequest(BaseModel):
    """Set watch status request body."""

    content_id: int
    status: Literal['want', 'watching', 'watched', 'dropped']


class StatusResponse(BaseModel):
    """User content status response."""

    id: int
    content_id: int
    status: str
    updated_at: datetime
    # Content info (joined)
    content_title: str | None = None
    content_cover: str | None = None
    content_type: str | None = None

    model_config = {'from_attributes': True}


# =============================================================================
# User profile schemas
# =============================================================================


class UserPublicProfile(BaseModel):
    """Public user profile (for /user/:id)."""

    id: int
    username: str
    avatar_id: int = 0
    role: str = 'user'
    created_at: datetime
    rating_count: int = 0
    content_count: int = 0

    model_config = {'from_attributes': True}


# =============================================================================
# Bangumi schemas
# =============================================================================


class BangumiSearchRequest(BaseModel):
    """Bangumi search request body."""

    keyword: str
    limit: int = 10


class BangumiSearchItem(BaseModel):
    """Single Bangumi search result."""

    bgm_id: int
    name: str = ''
    name_cn: str = ''
    cover_url: str = ''
    rating: float = 0.0
    tags: list[str] = []
    eps: int = 0
    air_date: str = ''
    platform: str = ''
    summary: str = ''


class BangumiSearchResponse(BaseModel):
    """Bangumi search response."""

    total: int
    items: list[BangumiSearchItem]


class BangumiImportResponse(BaseModel):
    """Bangumi import response."""

    content_id: int
    status: str  # created / updated


# =============================================================================
# Pagination
# =============================================================================


class PaginatedResponse(BaseModel):
    """Generic paginated response."""

    items: list = []
    total: int = 0
    page: int = 1
    size: int = 20
