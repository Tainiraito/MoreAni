import { useAuth } from './useAuth'
import type {
  AuthResponse,
  User,
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
    if (url === '/auth/login') {
      // 登录接口的 401 应由后端报错文案展示
      const err = await res.json().catch(() => ({ detail: '用户名或密码错误' }))
      throw new Error(err.detail || '用户名或密码错误')
    }
    const { clearAuth } = useAuth()
    clearAuth()
    throw new Error('请先登录')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(err.detail || 'Request failed')
  }

  // 204 No Content — 返回 null 而非尝试解析空 body
  if (res.status === 204) return null as T

  return res.json()
}

export function useApi() {
  const post = <T>(url: string, body?: Record<string, unknown>) =>
    request<T>(url, { method: 'POST', body: JSON.stringify(body) })

  const put = <T>(url: string, body?: Record<string, unknown>) =>
    request<T>(url, { method: 'PUT', body: JSON.stringify(body) })

  return {
    // Auth
    login(username: string, password: string) {
      return post<AuthResponse>('/auth/login', { username, password })
    },
    register(username: string, password: string, invite_code: string) {
      return post<AuthResponse>('/auth/register', { username, password, invite_code })
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
      return post<AnimeDetail['anime']>('/animes', data)
    },
    deleteAnime(id: number) {
      return request<void>(`/animes/${id}`, { method: 'DELETE' })
    },
    updateAnime(id: number, data: Record<string, unknown>) {
      return put<AnimeDetail['anime']>(`/animes/${id}`, data)
    },

    // Bangumi
    searchBangumi(keyword: string, limit = 10, offset = 0) {
      return post<BangumiSearchResponse>('/bangumi/search', { keyword, limit, offset })
    },
    getBangumiDetail(bgmId: number) {
      return request<BangumiDetailResponse>(`/bangumi/detail/${bgmId}`)
    },
    importBangumi(bgmId: number) {
      return post<{ anime_id: number; status: string }>(`/bangumi/import/${bgmId}`)
    },

    // Ratings
    createRating(data: {
      anime_id: number
      anime_score: number
      recommend: number
      review: string
    }) {
      return post<Rating>('/ratings', data)
    },
    getRecentRatings(limit = 5) {
      return request<Rating[]>(`/ratings/recent?limit=${limit}&_t=${Date.now()}`)
    },
    getRatingHistory(page = 1, limit = 20) {
      return request<RatingHistoryResponse>(`/ratings/history?page=${page}&limit=${limit}`)
    },
    changeUsername(newUsername: string) {
      return put<User>('/auth/me/username', { new_username: newUsername })
    },
    checkUsername(username: string) {
      return post<{ available: boolean }>('/auth/check-username', { username })
    },
    changePassword(oldPassword: string, newPassword: string) {
      return put<void>('/auth/me/password', {
        old_password: oldPassword,
        new_password: newPassword
      })
    }
  }
}
