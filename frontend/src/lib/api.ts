const API_BASE = '/api/v1'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  // Auth
  login: (data: { username: string; password: string }) =>
    request<{ user: unknown; token: string }>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  register: (data: { code: string; username: string; password: string }) =>
    request<{ user: unknown; token: string }>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  getMe: () => request<{ id: number; username: string; avatar_id: number; role: string }>('/auth/me'),
  updateAvatar: (avatar_id: number) =>
    request<{ ok: boolean }>('/auth/me/avatar', { method: 'PUT', body: JSON.stringify({ avatar_id }) }),

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
    request<{ id: number }>('/bangumi/import', { method: 'POST', body: JSON.stringify({ bgm_id }) }),

  // User
  getUser: (id: number) => request<unknown>(`/user/${id}`),
  getUserRatings: (id: number) => request<{ items: unknown[] }>(`/user/${id}/ratings`),

  // Guest
  getGuestToken: (token: string) => request<{ token: string }>(`/guest/${token}`),
}
