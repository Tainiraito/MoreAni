import { useToastStore } from '@/stores/toast-store'
import type {
  AiringCalendarWeek,
  AnimeResourceResponse,
  Announcement,
  AvatarCrop,
  ContentItem,
  InviteCode,
  NotificationListResponse,
  NotificationUnreadCount,
  PaginatedResponse,
  ResourceSubscription,
  User,
} from '@/types'

const API_BASE = '/api/v1'
const CONTENT_LIST_TIMEOUT_MS = 15_000

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export class ApiTimeoutError extends Error {
  constructor() {
    super('请求超时')
    this.name = 'ApiTimeoutError'
  }
}

interface RequestSignal {
  signal: AbortSignal
  didTimeout: () => boolean
  cleanup: () => void
}

function createRequestSignal(externalSignal: AbortSignal | null | undefined, timeoutMs?: number): RequestSignal {
  const controller = new AbortController()
  let timedOut = false
  const timeoutId = timeoutMs === undefined
    ? undefined
    : setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
  const abortFromExternal = () => controller.abort()

  if (externalSignal?.aborted) {
    abortFromExternal()
  } else {
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true })
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      externalSignal?.removeEventListener('abort', abortFromExternal)
    },
  }
}

async function request<T>(path: string, options?: RequestInit, timeoutMs?: number): Promise<T> {
  const requestSignal = createRequestSignal(options?.signal, timeoutMs)

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      ...options,
      signal: requestSignal.signal,
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
      } else {
        toast.addToast('error', errorMessage, 3000)
      }

      throw new ApiError(errorMessage, res.status)
    }

    // Handle 204 No Content (e.g., DELETE requests)
    if (res.status === 204) {
      return undefined as T
    }

    return res.json()
  } catch (error) {
    if (requestSignal.didTimeout()) {
      throw new ApiTimeoutError()
    }
    throw error
  } finally {
    requestSignal.cleanup()
  }
}

export const api = {
  // Auth
  login: (data: { username: string; password: string }) =>
    request<{ user: User; token: string }>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  register: (data: { invite_code: string; username: string; nickname: string; password: string }) =>
    request<{ user: User; token: string }>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  getMe: () =>
    request<{ id: number; username: string; nickname: string; avatar_id: number; avatar_url?: string | null; avatar_crop?: AvatarCrop | null; role: string }>('/auth/me'),
  changePassword: (data: { old_password: string; new_password: string }) =>
    request<{ detail: string }>('/auth/me/password', { method: 'PUT', body: JSON.stringify(data) }),
  updateNickname: (nickname: string) =>
    request<{ id: number; username: string; nickname: string; avatar_id: number; avatar_url?: string | null; avatar_crop?: AvatarCrop | null; role: string }>(
      '/auth/me/nickname',
      { method: 'PUT', body: JSON.stringify({ nickname }) },
    ),
  updateAvatar: (avatar_id: number) =>
    request<{ ok: boolean }>('/auth/me/avatar', { method: 'PUT', body: JSON.stringify({ avatar_id }) }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  // Content
  listContent: (params?: Record<string, string>, options?: RequestInit) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : ''
    return request<PaginatedResponse<ContentItem>>(`/content${q}`, options, CONTENT_LIST_TIMEOUT_MS)
  },
  getRecommendations: (
    params: { type?: string; size: number; excludeIds?: number[] },
    options?: RequestInit,
  ) => {
    const query = new URLSearchParams({ type: params.type ?? 'anime', size: String(params.size) })
    params.excludeIds?.forEach(id => query.append('exclude_id', String(id)))
    return request<{ items: ContentItem[] }>(`/content/recommendations?${query}`, options)
  },
  getSeasons: () => request<{ items: { value: string; count: number }[] }>('/content/seasons'),
  getAiringWeek: (options?: RequestInit) => request<AiringCalendarWeek>('/airing/week', options),
  getContent: (id: number) => request<unknown>(`/content/${id}`),
  getAnimeResources: (id: number, params?: { source?: 'mikan' | 'animegarden'; page?: number; size?: number }) => {
    const query = new URLSearchParams()
    if (params?.source) query.set('source', params.source)
    if (params?.page) query.set('page', String(params.page))
    if (params?.size) query.set('size', String(params.size))
    const suffix = query.toString() ? `?${query}` : ''
    return request<AnimeResourceResponse>(`/content/${id}/resources${suffix}`)
  },
  createContent: (data: unknown) =>
    request<{ id: number }>('/content', { method: 'POST', body: JSON.stringify(data) }),
  updateContent: (id: number, data: unknown) =>
    request<{ ok: boolean }>(`/content/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteContent: (id: number) =>
    request<{ ok: boolean }>(`/content/${id}`, { method: 'DELETE' }),
  getRandom: (params?: { type?: string; excludeIds?: number[] }, options?: RequestInit) => {
    const query = new URLSearchParams()
    if (params?.type) query.set('type', params.type)
    params?.excludeIds?.forEach(id => query.append('exclude_id', String(id)))
    const suffix = query.toString() ? `?${query}` : ''
    return request<ContentItem>(`/content/random${suffix}`, options)
  },

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
  // Resource subscriptions
  listResourceSubscriptions: (contentId?: number) => {
    const suffix = contentId ? `?content_id=${contentId}` : ''
    return request<ResourceSubscription[]>(`/resource-subscriptions${suffix}`)
  },
  createResourceSubscription: (data: { content_id: number; source: 'mikan' | 'animegarden'; fansub_name: string; fansub_id?: string | null }) =>
    request<ResourceSubscription>('/resource-subscriptions', { method: 'POST', body: JSON.stringify(data) }),
  deleteResourceSubscription: (id: number) =>
    request<undefined>(`/resource-subscriptions/${id}`, { method: 'DELETE' }),
  // Notifications
  listNotifications: (params?: { scope?: 'all' | 'public' | 'private'; page?: number; size?: number }) => {
    const query = new URLSearchParams()
    if (params?.scope) query.set('scope', params.scope)
    if (params?.page) query.set('page', String(params.page))
    if (params?.size) query.set('size', String(params.size))
    const suffix = query.toString() ? `?${query}` : ''
    return request<NotificationListResponse>(`/notifications${suffix}`)
  },
  getNotificationUnreadCount: () => request<NotificationUnreadCount>('/notifications/unread-count'),
  refreshNotifications: () => request<{ created: number }>('/notifications/refresh', { method: 'POST' }),
  markNotificationRead: (id: number) =>
    request<{ ok: boolean }>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: (scope: 'all' | 'public' | 'private' = 'public') =>
    request<{ marked: number }>(`/notifications/read-all?scope=${scope}`, { method: 'POST' }),
  adminListUsers: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : ''
    return request<{ items: User[]; total: number; page: number; size: number }>(`/admin/users${q}`)
  },
  adminCreateUser: (data: { username: string; nickname: string; password: string; role: string }) =>
    request<User>('/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  adminUpdateUser: (id: number, data: Record<string, string>) =>
    request<User>(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  adminDeleteUser: (id: number) =>
    request<undefined>(`/admin/users/${id}`, { method: 'DELETE' }),
  adminListInvites: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : ''
    return request<{ items: InviteCode[]; total: number; page: number; size: number }>(`/admin/invites${q}`)
  },
  adminCreateInvite: (data: Record<string, string>) =>
    request<InviteCode>('/admin/invites', { method: 'POST', body: JSON.stringify(data) }),
  adminUpdateInvite: (id: number, data: Record<string, string>) =>
    request<InviteCode>(`/admin/invites/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  adminDeleteInvite: (id: number) =>
    request<undefined>(`/admin/invites/${id}`, { method: 'DELETE' }),
  adminListAnnouncements: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : ''
    return request<{ items: Announcement[]; total: number; page: number; size: number }>(`/admin/announcements${q}`)
  },
  adminCreateAnnouncement: (data: { title: string; body: string; is_published: boolean; published_at?: string; expires_at?: string }) =>
    request<Announcement>('/admin/announcements', { method: 'POST', body: JSON.stringify(data) }),
  adminUpdateAnnouncement: (id: number, data: Partial<{ title: string; body: string; is_published: boolean; published_at: string | null; expires_at: string | null }>) =>
    request<Announcement>(`/admin/announcements/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  adminDeleteAnnouncement: (id: number) =>
    request<undefined>(`/admin/announcements/${id}`, { method: 'DELETE' }),
  getUserActivity: (id: number, params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : ''
    return request<{ items: unknown[]; total: number }>(`/user/${id}/activity${q}`)
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
  listUsers: () =>
    request<{ items: { id: number; username: string; nickname: string; avatar_id: number; avatar_url?: string | null; avatar_crop?: AvatarCrop | null }[] }>('/user/list'),
  // 上传头像（FormData，不设 Content-Type 让浏览器带 boundary）
  uploadAvatar: (file: File, crop?: AvatarCrop | null) => {
    const fd = new FormData()
    fd.append('file', file)
    if (crop) fd.append('crop', JSON.stringify(crop))
    return fetch(`${API_BASE}/user/avatar`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    }).then(async res => {
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.detail || `HTTP ${res.status}`)
      }
      return res.json() as Promise<{ avatar_url: string; avatar_crop: AvatarCrop | null }>
    })
  },
  // 删除头像
  deleteAvatar: () =>
    fetch(`${API_BASE}/user/avatar`, {
      method: 'DELETE',
      credentials: 'include',
    }).then(async res => {
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.detail || `HTTP ${res.status}`)
      }
      return res.json() as Promise<{ avatar_url: null; avatar_crop: null }>
    }),
}
