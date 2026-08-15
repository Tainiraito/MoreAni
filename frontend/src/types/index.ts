export type ContentType = 'anime' | 'movie' | 'game' | 'software' | 'website' | 'book'

export type WatchStatus = 'want' | 'watching' | 'watched' | 'dropped'

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
  created_by: number
  created_at: string
  updated_at: string
  // Computed
  avg_score?: number
  avg_recommend?: number
  rating_count?: number
  my_rating?: Rating | null
  my_status?: WatchStatus | null
  my_score?: number | null
  my_has_review?: boolean
  tags?: Tag[]
}

export interface Rating {
  id: number
  content_id: number
  user_id: number
  username?: string
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
  role: string
  created_at: string
}

export interface Tag {
  id: number
  name: string
  tag_type: 'bangumi' | 'custom'
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  size: number
}
