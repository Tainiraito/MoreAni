"""Pydantic v2 schemas for MoreAni v2 API request/response models."""

import json
from datetime import datetime
from typing import Literal
from uuid import UUID

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


# =============================================================================
# Red-blue battle schemas
# =============================================================================


class RedBlueContentSummaryResponse(BaseModel):
    """PK 和排名使用的轻量作品摘要。"""

    content_id: int
    title: str
    description: str = ''
    cover_url: str | None = None
    content_type: str


class RedBluePairResponse(BaseModel):
    """当前待比较的有向 Pair。"""

    left: RedBlueContentSummaryResponse
    right: RedBlueContentSummaryResponse
    selector_version: str
    selection_reason: str


class RedBlueScoreSuggestionResponse(BaseModel):
    """排名行右侧可展示的评分校准建议。"""

    id: int
    content_id: int
    suggestion_key: str
    current_score: int
    suggested_score_low: int
    suggested_score_high: int
    recommended_score: int
    direction: Literal['UP', 'DOWN']
    confidence: float
    severity: float
    reason_code: str


class RedBlueRankingItemResponse(BaseModel):
    """个人排名中的一行；rank 是严格的 UI 展示序号。"""

    content: RedBlueContentSummaryResponse
    rank: int
    current_score: int
    preference_mean: float
    comparison_count: int
    stability: str
    rank_low: int | None = None
    rank_high: int | None = None
    score_suggestion: RedBlueScoreSuggestionResponse | None = None


class RedBlueStateResponse(BaseModel):
    """GET /red-blue/state 的当前排名页和可恢复页面状态。"""

    state_version: int
    model_freshness: str
    candidate_count: int
    pair_status: str
    current_pair: RedBluePairResponse | None = None
    ranking: list[RedBlueRankingItemResponse]
    ranking_total: int = 0
    ranking_page: int = 1
    ranking_size: int = 100
    full_recalibration_required: bool
    full_recalibration_running: bool


class CreateComparisonRequest(BaseModel):
    """提交一次红蓝合战事实。"""

    left_content_id: int = Field(gt=0)
    right_content_id: int = Field(gt=0)
    outcome: Literal['LEFT_WIN', 'RIGHT_WIN', 'TIE', 'SKIP']
    client_event_id: UUID
    focus_content_id: int | None = Field(default=None, gt=0)


class RedBlueComparisonResponse(BaseModel):
    """一条已经写入事实表的 Comparison。"""

    id: int
    left_content_id: int
    right_content_id: int
    outcome: Literal['LEFT_WIN', 'RIGHT_WIN', 'TIE', 'SKIP']
    client_event_id: str
    selector_version: str
    created_at: datetime | None = None
    revoked_at: datetime | None = None


class RedBlueComparisonHistoryContentResponse(BaseModel):
    """PK 历史中用于展示的作品摘要。"""

    content_id: int
    title: str


class RedBlueComparisonHistoryItemResponse(BaseModel):
    """当前用户仍可撤销的一条 PK 历史记录。"""

    id: int
    left_content: RedBlueComparisonHistoryContentResponse
    right_content: RedBlueComparisonHistoryContentResponse
    left_content_id: int
    right_content_id: int
    outcome: Literal['LEFT_WIN', 'RIGHT_WIN', 'TIE', 'SKIP']
    client_event_id: str
    selector_version: str
    created_at: datetime | None = None
    revoked_at: datetime | None = None


class RedBlueComparisonHistoryPageResponse(BaseModel):
    """PK 历史分页响应；已撤销事实不出现在 items 中。"""

    items: list[RedBlueComparisonHistoryItemResponse]
    total: int
    page: int
    size: int


class RedBlueRankingDeltaResponse(BaseModel):
    """一次普通 PK 后需要 patch 的所有榜单行。"""

    content_id: int
    old_rank: int | None = None
    new_rank: int
    preference_mean: float
    comparison_count: int


class RedBlueScoreSuggestionDeltaResponse(BaseModel):
    """一次比较后评分建议的增量变化。"""

    added: list[RedBlueScoreSuggestionResponse] = Field(default_factory=list)
    updated: list[RedBlueScoreSuggestionResponse] = Field(default_factory=list)
    removed: list[int] = Field(default_factory=list)


class CreateComparisonResponse(BaseModel):
    """提交 Comparison 后供前端继续 PK 的增量响应。"""

    comparison: RedBlueComparisonResponse
    state_version: int
    ranking_delta: list[RedBlueRankingDeltaResponse]
    score_suggestion_delta: RedBlueScoreSuggestionDeltaResponse = Field(
        default_factory=RedBlueScoreSuggestionDeltaResponse,
    )
    next_pair: RedBluePairResponse | None = None
    pair_status: str
    model_freshness: str
    full_recalibration_required: bool
    full_recalibration_running: bool
    idempotent_replay: bool


class RevokeComparisonResponse(BaseModel):
    """撤销事实后的状态提示；不伪造尚未完成的全量排名。"""

    comparison: RedBlueComparisonResponse
    revoked: bool
    state_version: int
    model_freshness: str
    full_recalibration_required: bool
    full_recalibration_running: bool


class ScoreSuggestionActionRequest(BaseModel):
    """处理一条评分建议；client_event_id 用于重复点击幂等。"""

    action: Literal['ACCEPTED', 'DISMISSED', 'REJECTED']
    suggestion_key: str = Field(min_length=1, max_length=128)
    client_event_id: UUID


class ScoreSuggestionActionResponse(BaseModel):
    """评分建议动作及其最新排名行。"""

    suggestion_id: int
    action: Literal['ACCEPTED', 'DISMISSED', 'REJECTED']
    current_score: int
    updated_score: int
    state_version: int
    updated_ranking_item: RedBlueRankingItemResponse | None = None
    idempotent_replay: bool = False


class RatingHistoryResponse(BaseModel):
    """Paginated rating history."""

    items: list[RatingResponse]
    total: int


class RatingRevisionResponse(BaseModel):
    """One primary-score revision in a user's rating timeline."""

    id: int
    rating_id: int | None = None
    content_id: int
    user_id: int
    previous_score: int
    new_score: int
    changed_at: datetime
    source: str
    comparison_id: str | None = None
    content_title: str | None = None
    content_cover: str | None = None
    content_type: str | None = None


class RatingRevisionListResponse(BaseModel):
    """Paginated primary-score revision history."""

    items: list[RatingRevisionResponse]
    total: int


class RatingCalibrationCandidateResponse(BaseModel):
    """One randomly selected rated content for score calibration."""

    rating_id: int
    content_id: int
    title: str
    title_alt: str = ''
    cover_url: str | None = None
    content_type: str
    old_score: int
    rated_at: datetime
    last_rated_at: datetime


class RatingCalibrationItem(BaseModel):
    """One pending score update from a calibration session."""

    content_id: int
    expected_score: int = Field(ge=0, le=100)
    new_score: int = Field(ge=0, le=100)


class RatingCalibrationSaveRequest(BaseModel):
    """Batch score updates submitted by a calibration session."""

    items: list[RatingCalibrationItem] = Field(default_factory=list)


class RatingCalibrationSaveResponse(BaseModel):
    """Result of a calibration batch save."""

    comparison_id: str
    updated_content_ids: list[int] = Field(default_factory=list)
    skipped_content_ids: list[int] = Field(default_factory=list)


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
