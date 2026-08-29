export type ContentType = 'anime' | 'anime_movie' | 'movie' | 'game' | 'software' | 'website' | 'book'

export type WatchStatus = 'want' | 'watching' | 'watched' | 'dropped'

export interface AvatarCrop {
  version: 1
  x: number
  y: number
  size: number
}

export interface ContentItem {
  id: number
  title: string
  title_alt: string
  cover_url: string
  description: string
  content_type: ContentType
  episodes: number
  status: string
  release_date: string
  platform: string
  source_type: string
  source_id: string
  source_url: string
  metadata: Record<string, unknown>
  is_public: boolean
  created_by: number | null
  created_at: string
  updated_at: string
  // Computed
  avg_score?: number
  avg_recommend?: number
  rating_count?: number
  review_count?: number
  activity_count?: number
  my_rating?: Rating | null
  my_status?: WatchStatus | null
  my_score?: number | null
  my_has_review?: boolean
  tags?: Tag[]
  recent_reviews?: RecentReview[]
}

export interface RecentReview {
  nickname: string
  avatar_id: number
  avatar_url?: string | null
  avatar_crop?: AvatarCrop | null
  score: number
  review: string
  created_at: string | null
}

export interface Rating {
  id: number
  content_id: number
  user_id: number
  username?: string
  nickname?: string
  avatar_url?: string | null
  avatar_crop?: AvatarCrop | null
  score: number        // 0-100
  recommend: number    // 0-100
  review: string
  created_at: string
  updated_at: string
}

export interface User {
  id: number
  username: string
  nickname: string
  avatar_id: number
  avatar_url?: string | null
  avatar_crop?: AvatarCrop | null
  role: 'user' | 'admin' | 'super_admin'
  created_at: string
}

export interface InviteCode {
  id: number
  code: string
  max_uses: number
  use_count: number
  expires_at: string | null
  created_at: string | null
  status: 'active' | 'used_up' | 'expired'
}

export interface Tag {
  id: number
  name: string
  tag_type: 'bangumi' | 'custom'
}

export type AnalyticsScopeType = 'global' | 'user'

export interface AnalyticsUserSummary {
  id: number
  username: string
  nickname: string
  avatar_url?: string | null
  avatar_crop?: AvatarCrop | null
}

export interface AnalyticsScope {
  type: AnalyticsScopeType
  user: AnalyticsUserSummary | null
}

export interface AnalyticsScoreBucket {
  score: number
  count: number
}

export interface AnalyticsTagStat {
  name: string
  weight: number
  rating_count: number
  title_count: number
  average_score: number
}

export interface AnalyticsFavoriteItem {
  id: number
  title: string
  title_alt: string
  cover_url: string
  content_type: ContentType
  score: number
  average_score: number | null
  rating_count: number
}

export interface AnalyticsOverview {
  scope: AnalyticsScope
  min_score: number
  max_score: number
  rating_count: number
  title_count: number
  user_count: number
  average_score: number | null
  score_distribution: AnalyticsScoreBucket[]
  frequency_tags: AnalyticsTagStat[]
  weighted_tags: AnalyticsTagStat[]
  favorites: AnalyticsFavoriteItem[]
}

export type AnalyticsConfidence = 'low' | 'medium' | 'high'
export type AnalyticsRecommendationBasis = 'global' | 'global_fallback' | 'blended' | 'personal'

export interface AnalyticsRecommendationItem {
  id: number
  title: string
  title_alt: string
  cover_url: string
  content_type: ContentType
  match_percent: number
  confidence: AnalyticsConfidence
  matched_tags: string[]
  basis: AnalyticsRecommendationBasis
  average_score: number | null
  rating_count: number
}

export interface AnalyticsRecommendations {
  scope: AnalyticsScope
  profile_rating_count: number
  confidence: AnalyticsConfidence
  basis: AnalyticsRecommendationBasis
  items: AnalyticsRecommendationItem[]
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  size: number
}

export interface AiringCalendarItem {
  subject_id: number
  content_id: number | null
  matched: boolean
  title: string
  title_alt: string
  cover_url: string
  bangumi_url: string
}

export interface AiringCalendarDay {
  date: string
  weekday: number
  label: string
  is_today: boolean
  items: AiringCalendarItem[]
}

export interface AiringCalendarWeek {
  timezone: string
  week_start: string
  last_synced_at: string | null
  sync_status: 'success' | 'failed' | 'pending'
  days: AiringCalendarDay[]
}

export interface ResourceParty {
  id?: number | string | null
  name: string
  avatar?: string | null
}

export interface AnimeResource {
  id: number
  source: 'mikan' | 'animegarden'
  provider: string
  provider_id: string
  title: string
  href: string
  type: string
  magnet: string
  size: number
  fansub?: ResourceParty | null
  publisher?: ResourceParty | null
  subject_id?: number | null
  created_at: string
  fetched_at: string
}

export interface AnimeResourceResponse {
  source: 'mikan' | 'animegarden'
  available: boolean
  matched: boolean
  match_method: 'bangumi' | 'none'
  subject_id: number | null
  resources: AnimeResource[]
  pagination: {
    page: number
    page_size: number
    complete: boolean
  }
  message: string | null
}

export interface ResourceSubscription {
  id: number
  content_id: number
  subject_id: number
  source: 'mikan' | 'animegarden'
  fansub_key: string
  fansub_name: string
  fansub_id: string | null
  active: boolean
  last_seen_created_at: string | null
  last_seen_resource_key: string | null
  created_at: string
  updated_at: string
}

export type NotificationScope = 'public' | 'private'
export type NotificationKind = 'announcement' | 'resource_update' | 'content_activity' | 'system'

export interface NotificationItem {
  id: number
  scope: NotificationScope
  kind: NotificationKind | string
  title: string
  body: string
  payload: Record<string, unknown>
  created_at: string
  published_at: string | null
  expires_at: string | null
  is_read: boolean
}

export interface NotificationListResponse {
  items: NotificationItem[]
  total: number
  unread_count: number
  page: number
  size: number
}

export interface NotificationUnreadCount {
  total: number
  public: number
  private: number
}

export interface Announcement {
  id: number
  title: string
  body: string
  is_published: boolean
  published_at: string | null
  expires_at: string | null
  created_at: string
}
