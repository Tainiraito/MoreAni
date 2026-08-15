import { useToastStore } from '@/stores/toast-store'

const API_BASE = '/api/v1'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })

  if (!res.ok) {
    let errorMessage = '请求失败'

    try {
      const err = await res.json()
      const detail = err.detail
      if (typeof detail === 'string') {
        errorMessage = detail
      } else if (Array.isArray(detail)) {
        // FastAPI 422 validation error: [{ loc, msg, type }, ...] — must flatten to string
        const msgs = detail
          .map((d: { msg?: unknown }) => (typeof d?.msg === 'string' ? d.msg : ''))
          .filter(Boolean)
        errorMessage = msgs.length > 0 ? msgs.join('；') : `HTTP ${res.status}`
      } else {
        errorMessage = `HTTP ${res.status}`
      }
    } catch {
      errorMessage = `HTTP ${res.status}`
    }

    // Show toast for specific errors
    const toast = useToastStore.getState()
    if (res.status === 429) {
      toast.addToast('warning', errorMessage, 5000)
    } else if (res.status === 401) {
      toast.addToast('error', '请先登录', 3000)
    } else if (res.status === 403) {
      toast.addToast('error', '没有权限', 3000)
    } else if (res.status === 500) {
      toast.addToast('error', '服务器错误，请稍后再试', 5000)
    } else if (res.status >= 400) {
      toast.addToast('error', errorMessage, 3000)
    }

    throw new Error(errorMessage)
  }

  // Handle 204 No Content (e.g., DELETE requests)
  if (res.status === 204) {
    return undefined as T
  }

  return res.json()
}

export const api = {
  // Auth
  login: (data: { username: string; password: string }) =>
    request<{ user: unknown; token: string }>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  register: (data: { invite_code: string; username: string; password: string }) =>
    request<{ user: unknown; token: string }>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  getMe: () => request<{ id: number; username: string; avatar_id: number; role: string }>('/auth/me'),
  updateAvatar: (avatar_id: number) =>
    request<{ ok: boolean }>('/auth/me/avatar', { method: 'PUT', body: JSON.stringify({ avatar_id }) }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  // Content
  listContent: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : ''
    return request<{ items: unknown[]; total: number; page: number; size: number }>(`/content${q}`)
  },
  getContent: (id: number) => request<unknown>(`/content/${id}`),
  createContent: (data: unknown) =>
    request<{ id: number }>('/content', { method: 'POST', body: JSON.stringify(data) }),
  updateContent: (id: number, data: unknown) =>
    request<{ ok: boolean }>(`/content/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteContent: (id: number) =>
    request<{ ok: boolean }>(`/content/${id}`, { method: 'DELETE' }),
  getRandom: () => request<unknown>('/content/random'),

  // Rating
  upsertRating: (data: { content_id: number; score: number; recommend?: number; review?: string }) =>
    request<{ id: number }>('/rating', { method: 'POST', body: JSON.stringify(data) }),
  deleteRating: (id: number) =>
    request<{ ok: boolean }>(`/rating/${id}`, { method: 'DELETE' }),
  getRecentRatings: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : ''
    return request<{ items: unknown[] }>(`/rating/recent${q}`)
  },
  getContentRatings: (contentId: number, params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : ''
    return request<{ items: unknown[]; total: number }>(`/rating/content/${contentId}${q}`)
  },
  getMyRatings: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : ''
    return request<{ items: unknown[]; total: number }>(`/rating/history${q}`)
  },

  // Status
  setStatus: (data: { content_id: number; status: string }) =>
    request<{ ok: boolean }>('/status', { method: 'POST', body: JSON.stringify(data) }),
  clearStatus: (content_id: number) =>
    request<{ ok: boolean }>(`/status/${content_id}`, { method: 'DELETE' }),
  getMyStatuses: () => request<{ items: unknown[] }>('/status'),

  // Tags
  searchTags: (q: string) => request<{ items: unknown[] }>(`/tag?q=${encodeURIComponent(q)}`),
  createTag: (name: string) =>
    request<{ id: number; name: string }>('/tag', { method: 'POST', body: JSON.stringify({ name }) }),

  // Bangumi
  searchBangumi: (q: string) => request<{ items: unknown[] }>(`/bangumi/search?q=${encodeURIComponent(q)}`),
  importBangumi: (bgm_id: number) =>
    request<{ id: number }>(`/bangumi/import/${bgm_id}`, { method: 'POST' }),
  getBangumiDetail: (bgm_id: number) =>
    request<Record<string, unknown>>(`/bangumi/detail/${bgm_id}`),
  getBangumiScore: (bgm_id: number) =>
    request<{ score: number }>(`/bangumi/score/${bgm_id}`),

  // User
  getUser: (id: number) => request<unknown>(`/user/${id}`),
  getUserRatings: (id: number) => request<{ items: unknown[] }>(`/user/${id}/ratings`),
}
