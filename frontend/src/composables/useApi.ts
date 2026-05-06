import { useAuth } from './useAuth'
import type {
  AuthResponse,
  AnimeListResponse,
  AnimeDetail,
  Rating,
  BangumiSearchResponse,
  BangumiDetailResponse,
  RatingHistoryResponse
} from '@/types'

const BASE = '/api'

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const { token } = useAuth()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {})
  }

  if (token.value) {
    headers['Authorization'] = `Bearer ${token.value}`
  }

  const res = await fetch(`${BASE}${url}`, { ...options, headers })

  if (res.status === 401) {
    const { clearAuth } = useAuth()
    clearAuth()
    throw new Error('请先登录')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(err.detail || 'Request failed')
  }

  return res.json()
}

export function useApi() {
  return {
    // Auth
    login(username: string, password: string) {
      return request<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      })
    },
    register(username: string, password: string, invite_code: string) {
      return request<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password, invite_code })
      })
    },
    getMe() {
      return request<AuthResponse['user']>('/auth/me')
    },

    // Animes
    getAnimes(params: Record<string, string | number> = {}) {
      const qs = new URLSearchParams()
      Object.entries(params).forEach(([k, v]) => qs.set(k, String(v)))
      return request<AnimeListResponse>(`/animes?${qs}`)
    },
    getAnime(id: number) {
      return request<AnimeDetail>(`/animes/${id}`)
    },
    getRandomUnrated() {
      return request<AnimeDetail['anime']>('/animes/random')
    },
    createAnime(data: Record<string, unknown>) {
      return request<AnimeDetail['anime']>('/animes', {
        method: 'POST',
        body: JSON.stringify(data)
      })
    },
    deleteAnime(id: number) {
      return request<void>(`/animes/${id}`, {
        method: 'DELETE'
      })
    },
    updateAnime(id: number, data: Record<string, unknown>) {
      return request<AnimeDetail['anime']>(`/animes/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      })
    },

    // Bangumi
    searchBangumi(keyword: string, limit = 10, offset = 0) {
      return request<BangumiSearchResponse>('/bangumi/search', {
        method: 'POST',
        body: JSON.stringify({ keyword, limit, offset })
      })
    },
    getBangumiDetail(bgmId: number) {
      return request<BangumiDetailResponse>(`/bangumi/detail/${bgmId}`)
    },
    importBangumi(bgmId: number) {
      return request<{ anime_id: number; status: string }>(`/bangumi/import/${bgmId}`, {
        method: 'POST'
      })
    },

    // Ratings
    createRating(data: {
      anime_id: number
      anime_score: number
      recommend: number
      review: string
    }) {
      return request<Rating>('/ratings', {
        method: 'POST',
        body: JSON.stringify(data)
      })
    },
    getRecentRatings(limit = 5) {
      return request<Rating[]>(`/ratings/recent?limit=${limit}`)
    },
    getRatingHistory(page = 1, limit = 20) {
      return request<RatingHistoryResponse>(`/ratings/history?page=${page}&limit=${limit}`)
    }
  }
}
