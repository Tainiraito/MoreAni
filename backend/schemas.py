"""Pydantic v2 schemas for MoreAni v2 API request/response models."""

import json
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


class AvatarCrop(BaseModel):
    """Source-image square crop used for animated GIF avatars."""

    version: Literal[1] = 1
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    size: float = Field(gt=0)


class UserResponse(BaseModel):
    """Public user info."""

    id: int
    username: str
    nickname: str
    avatar_id: int = 0
    avatar_url: str | None = None
    avatar_crop: AvatarCrop | None = None
    role: str = 'user'
    created_at: datetime

    @field_validator('avatar_crop', mode='before')
    @classmethod
    def parse_avatar_crop(cls, value):
        if isinstance(value, str):
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return None
        return value

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


class NicknameUpdateRequest(BaseModel):
    """Nickname update request body."""

    nickname: str = Field(min_length=1, max_length=50)


# =============================================================================
# Content schemas
# =============================================================================


class ContentItemCreate(BaseModel):
    """Create content request body."""

    title: str = Field(min_length=1, max_length=200)
    title_alt: str = ''
    cover_url: str = ''
    description: str = ''
    content_type: Literal['anime', 'anime_movie', 'movie', 'game', 'software', 'website', 'book']
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
    content_type: Literal['anime', 'anime_movie', 'movie', 'game', 'software', 'website', 'book'] | None = None
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


class RecentReview(BaseModel):
    """A recent rating or review activity shown in list views."""

    nickname: str = ''
    avatar_id: int = 0
    avatar_url: str | None = None
    avatar_crop: AvatarCrop | None = None
    score: int = 0
    review: str = ''
    created_at: datetime | None = None


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
    review_count: int | None = None
    activity_count: int | None = None
    tags: list[TagResponse] = []
    recent_reviews: list[RecentReview] = []
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


class AiringCalendarItemResponse(BaseModel):
    """One persisted Bangumi calendar item with optional local-content match."""

    subject_id: int
    content_id: int | None = None
    matched: bool = False
    title: str
    title_alt: str = ''
    cover_url: str = ''
    bangumi_url: str


class AiringCalendarDayResponse(BaseModel):
    """One weekday in the current local week."""

    date: str
    weekday: int
    label: str
    is_today: bool
    items: list[AiringCalendarItemResponse] = Field(default_factory=list)


class AiringCalendarWeekResponse(BaseModel):
    """Persisted weekly Bangumi calendar response."""

    timezone: str
    week_start: str
    last_synced_at: datetime | None = None
    sync_status: Literal['success', 'failed', 'pending']
    days: list[AiringCalendarDayResponse]


class RecommendationResponse(BaseModel):
    """首页推荐池响应。"""

    items: list[ContentItemResponse]


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
    avatar_url: str | None = None
    avatar_crop: AvatarCrop | None = None
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
# Analytics schemas
# =============================================================================


class AnalyticsUserSummary(BaseModel):
    """被分析用户的公开摘要。"""

    id: int
    username: str
    nickname: str
    avatar_url: str | None = None
    avatar_crop: AvatarCrop | None = None


class AnalyticsScopeResponse(BaseModel):
    """统计分析的全站或单用户范围。"""

    type: Literal['global', 'user']
    user: AnalyticsUserSummary | None = None


class AnalyticsScoreBucket(BaseModel):
    """一个 0.5 分档的评分数量。"""

    score: float
    count: int


class AnalyticsTagStat(BaseModel):
    """词云中的标签统计。"""

    name: str
    weight: float
    rating_count: int
    title_count: int
    average_score: float


class AnalyticsFavoriteItem(BaseModel):
    """分析范围内的代表番剧。"""

    id: int
    title: str
    title_alt: str = ''
    cover_url: str = ''
    content_type: str
    score: float
    average_score: float | None = None
    rating_count: int = 0


class AnalyticsOverviewResponse(BaseModel):
    """评分分布、标签画像和代表作。"""

    scope: AnalyticsScopeResponse
    min_score: float
    max_score: float
    rating_count: int
    title_count: int
    user_count: int
    average_score: float | None = None
    score_distribution: list[AnalyticsScoreBucket] = Field(default_factory=list)
    frequency_tags: list[AnalyticsTagStat] = Field(default_factory=list)
    weighted_tags: list[AnalyticsTagStat] = Field(default_factory=list)
    favorites: list[AnalyticsFavoriteItem] = Field(default_factory=list)


class AnalyticsRecommendationItem(BaseModel):
    """一条带可解释匹配度的站内推荐。"""

    id: int
    title: str
    title_alt: str = ''
    cover_url: str = ''
    content_type: str
    match_percent: int
    confidence: Literal['low', 'medium', 'high']
    matched_tags: list[str] = Field(default_factory=list)
    basis: Literal['global', 'global_fallback', 'blended', 'personal']
    average_score: float | None = None
    rating_count: int = 0


class AnalyticsRecommendationsResponse(BaseModel):
    """统计画像生成的未评分番剧推荐。"""

    scope: AnalyticsScopeResponse
    profile_rating_count: int
    confidence: Literal['low', 'medium', 'high']
    basis: Literal['global', 'global_fallback', 'blended', 'personal']
    items: list[AnalyticsRecommendationItem] = Field(default_factory=list)


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
    nickname: str = ''
    avatar_id: int = 0
    avatar_url: str | None = None
    avatar_crop: AvatarCrop | None = None
    role: str = 'user'
    created_at: datetime
    rating_count: int = 0
    review_count: int = 0
    favorite_count: int = 0
    avg_score: float | None = None
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
# Anime Garden / notification schemas
# =============================================================================


class ResourcePartyResponse(BaseModel):
    """Anime Garden fansub or publisher summary."""

    id: int | str | None = None
    name: str
    avatar: str | None = None


class AnimeResourceResponseItem(BaseModel):
    """Normalized resource item from one configured source."""

    id: int
    source: Literal['mikan', 'animegarden'] = 'animegarden'
    provider: str
    provider_id: str
    title: str
    href: str
    type: str
    magnet: str
    size: int = 0
    fansub: ResourcePartyResponse | None = None
    publisher: ResourcePartyResponse | None = None
    subject_id: int | None = None
    created_at: datetime
    fetched_at: datetime


class AnimeResourcePagination(BaseModel):
    """Anime Garden pagination state."""

    page: int
    page_size: int
    complete: bool


class AnimeResourceListResponse(BaseModel):
    """Resources for one MoreAni anime."""

    source: Literal['mikan', 'animegarden']
    available: bool
    matched: bool = True
    match_method: Literal['bangumi', 'none'] = 'bangumi'
    subject_id: int | None = None
    resources: list[AnimeResourceResponseItem] = []
    pagination: AnimeResourcePagination
    message: str | None = None


class ResourceSubscriptionResponse(BaseModel):
    """One user's resource subscription."""

    id: int
    content_id: int
    subject_id: int
    source: Literal['mikan', 'animegarden']
    fansub_key: str
    fansub_name: str
    fansub_id: str | None = None
    active: bool
    last_seen_created_at: datetime | None = None
    last_seen_resource_key: str | None = None
    created_at: datetime
    updated_at: datetime


class ResourceSubscriptionCreate(BaseModel):
    """Create a subscription for a Bangumi title, source, and fansub."""

    content_id: int
    source: Literal['mikan', 'animegarden'] = 'animegarden'
    fansub_name: str = Field(min_length=1, max_length=120)
    fansub_id: str | None = Field(default=None, max_length=120)


class NotificationResponse(BaseModel):
    """Notification item with the current user's read state."""

    id: int
    scope: Literal['public', 'private']
    kind: str
    title: str
    body: str
    payload: dict = {}
    created_at: datetime
    published_at: datetime | None = None
    expires_at: datetime | None = None
    is_read: bool = False


class NotificationListResponse(BaseModel):
    """Paginated notification list."""

    items: list[NotificationResponse]
    total: int
    unread_count: int
    page: int
    size: int


class NotificationUnreadCountResponse(BaseModel):
    """Unread notification counters."""

    total: int
    public: int
    private: int


class AnnouncementCreate(BaseModel):
    """Create a public announcement."""

    title: str = Field(min_length=1, max_length=200)
    body: str = Field(default='', max_length=10000)
    is_published: bool = True
    published_at: datetime | None = None
    expires_at: datetime | None = None


class AnnouncementUpdate(BaseModel):
    """Update a public announcement."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    body: str | None = Field(default=None, max_length=10000)
    is_published: bool | None = None
    published_at: datetime | None = None
    expires_at: datetime | None = None


class AnnouncementResponse(BaseModel):
    """Announcement row returned to the admin panel."""

    id: int
    title: str
    body: str
    is_published: bool
    published_at: datetime | None = None
    expires_at: datetime | None = None
    created_at: datetime


# =============================================================================
# Pagination
# =============================================================================


class PaginatedResponse(BaseModel):
    """Generic paginated response."""

    items: list = []
    total: int = 0
    page: int = 1
    size: int = 20
