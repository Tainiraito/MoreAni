export interface User {
  id: number
  username: string
  created_at: string
}

export interface Anime {
  id: number
  title_cn: string
  title_jp: string
  cover_url: string
  description: string
  episodes: number
  status: string
  tags: string
  season: string
  air_date: string
  platform: string
  bgm_id: number | null
  created_by: number
  created_at: string
  updated_at: string
  avg_anime_score?: number
  avg_recommend?: number
  rating_count?: number
  latest_review?: string
  user_rated?: boolean
}

export interface Rating {
  id: number
  anime_id: number
  user_id: number
  username: string
  anime_score: number
  recommend: number
  review: string
  created_at: string
  updated_at: string
  anime_title?: string
  anime_cover?: string
}

export interface AnimeDetail {
  anime: Anime
  my_rating: Rating | null
  ratings: Rating[]
}

export interface AnimeListResponse {
  items: Anime[]
  total: number
}

export interface BangumiSearchResult {
  bgm_id: number
  title_cn: string
  title_jp: string
  cover_url: string
  rating: number
  rank: number
  tags: string[]
  episodes: number
  air_date: string
  platform: string
  summary: string
  status: string
  season: string
}

export interface BangumiSearchResponse {
  total: number
  animes: BangumiSearchResult[]
}

export interface LoginRequest {
  username: string
  password: string
}

export interface RegisterRequest {
  username: string
  password: string
  invite_code: string
}

export interface AuthResponse {
  access_token: string
  token_type: string
  user: User
}

export interface CreateAnimeRequest {
  title_cn: string
  title_jp: string
  cover_url: string
  description: string
  episodes: number
  status: string
  tags: string
  season: string
  air_date: string
  platform: string
}

export interface CreateRatingRequest {
  anime_id: number
  anime_score: number
  recommend: number
  review: string
}

export interface BangumiDetailResponse {
  bgm_id: number
  title_cn: string
  title_jp: string
  cover_url: string
  description: string
  episodes: number
  status: string
  season: string
  air_date: string
  platform: string
  tags: string[]
}

export interface RatingHistoryResponse {
  items: Rating[]
  total: number
  page: number
  limit: number
}
