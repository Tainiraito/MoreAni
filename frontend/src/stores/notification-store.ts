import { create } from 'zustand'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import type { NotificationItem, NotificationListResponse } from '@/types'

export type NotificationFilter = 'public' | 'private'
const ANONYMOUS_READ_KEY = 'moreani-public-notification-reads'

interface NotificationState {
  open: boolean
  filter: NotificationFilter
  items: NotificationItem[]
  total: number
  unreadCount: number
  publicUnread: number
  privateUnread: number
  loading: boolean
  refreshing: boolean
  setFilter: (filter: NotificationFilter) => void
  openPanel: () => Promise<void>
  closePanel: () => void
  loadUnreadCount: (force?: boolean) => Promise<void>
  loadNotifications: (filter?: NotificationFilter) => Promise<void>
  refresh: () => Promise<void>
  markRead: (notification: NotificationItem) => Promise<void>
  markAllRead: () => Promise<void>
}

interface NotificationCacheEntry {
  items: NotificationItem[]
  total: number
  fetchedAt: number
}

const notificationCache = new Map<NotificationFilter, NotificationCacheEntry>()
const notificationRequests = new Map<NotificationFilter, Promise<void>>()
const NOTIFICATION_CACHE_TTL = 30_000
let unreadRequest: Promise<void> | null = null
let lastUnreadLoadedAt = 0
let notificationCacheUserKey = 'anonymous'

function syncNotificationCacheUser(): string {
  const user = useAuthStore.getState().user
  const userKey = user ? `user:${user.id}` : 'anonymous'
  if (userKey !== notificationCacheUserKey) {
    notificationCache.clear()
    notificationRequests.clear()
    unreadRequest = null
    lastUnreadLoadedAt = 0
    notificationCacheUserKey = userKey
  }
  return userKey
}

function mergeReadState(items: NotificationItem[], response: NotificationListResponse): NotificationItem[] {
  const previous = new Map(items.map(item => [item.id, item.is_read]))
  return response.items.map(item => ({ ...item, is_read: item.is_read || previous.get(item.id) === true }))
}

function anonymousReadIds(): Set<number> {
  if (typeof window === 'undefined') return new Set()
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ANONYMOUS_READ_KEY) || '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter(value => Number.isInteger(value)) : [])
  } catch {
    return new Set()
  }
}

function saveAnonymousReadIds(ids: Set<number>): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(ANONYMOUS_READ_KEY, JSON.stringify([...ids]))
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  open: false,
  filter: 'public',
  items: [],
  total: 0,
  unreadCount: 0,
  publicUnread: 0,
  privateUnread: 0,
  loading: false,
  refreshing: false,

  setFilter: (filter) => {
    if (get().filter === filter) return
    set({ filter })
    void get().loadNotifications(filter)
  },

  openPanel: async () => {
    syncNotificationCacheUser()
    set({ open: true })
    const activeFilter = get().filter
    void get().loadNotifications(activeFilter)
    void get().loadUnreadCount(true)
    if (useAuthStore.getState().user) void get().refresh()
  },

  closePanel: () => set({ open: false }),

  loadUnreadCount: async (force = false) => {
    const requestUserKey = syncNotificationCacheUser()
    const now = Date.now()
    if (!force && now - lastUnreadLoadedAt < 15_000) return
    if (unreadRequest) return unreadRequest

    lastUnreadLoadedAt = now
    const request = (async () => {
      try {
        const counts = await api.getNotificationUnreadCount()
        if (syncNotificationCacheUser() !== requestUserKey) return
        if (!useAuthStore.getState().user) {
          const cachedPublic = notificationCache.get('public')
          const readIds = anonymousReadIds()
          const knownRead = cachedPublic?.items.filter(item => readIds.has(item.id)).length || 0
          const unread = Math.max(0, counts.public - knownRead)
          set({ unreadCount: unread, publicUnread: unread, privateUnread: 0 })
        } else {
          set({ unreadCount: counts.total, publicUnread: counts.public, privateUnread: counts.private })
        }
      } catch {
        // 通知故障不应影响站内其他页面。
      }
    })()
    unreadRequest = request

    try {
      await request
    } finally {
      if (unreadRequest === request) unreadRequest = null
    }
  },

  loadNotifications: async (filter = get().filter) => {
    const requestUserKey = syncNotificationCacheUser()
    if (filter === 'private' && !useAuthStore.getState().user) {
      set({ items: [], total: 0, loading: false })
      return
    }

    const cached = notificationCache.get(filter)
    if (cached) {
      set(state => state.filter === filter ? { items: cached.items, total: cached.total, loading: false } : {})
    } else {
      set(state => state.filter === filter ? { loading: true } : {})
    }

    if (cached && Date.now() - cached.fetchedAt < NOTIFICATION_CACHE_TTL) return

    const existingRequest = notificationRequests.get(filter)
    if (existingRequest) return existingRequest

    const request = (async () => {
      try {
        const response = await api.listNotifications({ scope: filter, page: 1, size: 30 })
        if (syncNotificationCacheUser() !== requestUserKey) return
        const readIds = useAuthStore.getState().user ? new Set<number>() : anonymousReadIds()
        const previousItems = notificationCache.get(filter)?.items || []
        const nextItems = mergeReadState(previousItems, response).map(item => ({ ...item, is_read: item.is_read || readIds.has(item.id) }))
        notificationCache.set(filter, { items: nextItems, total: response.total, fetchedAt: Date.now() })
        const scopeUnread = useAuthStore.getState().user
          ? response.unread_count
          : Math.max(0, response.unread_count - response.items.filter(item => readIds.has(item.id)).length)
        set(state => {
          const publicUnread = filter === 'public' ? scopeUnread : state.publicUnread
          const privateUnread = filter === 'private' ? scopeUnread : state.privateUnread
          return {
            ...(state.filter === filter ? { items: nextItems, total: response.total, loading: false } : {}),
            publicUnread,
            privateUnread,
            unreadCount: publicUnread + privateUnread,
          }
        })
      } catch {
        set(state => state.filter === filter ? { loading: false } : {})
      }
    })()

    notificationRequests.set(filter, request)
    try {
      await request
    } finally {
      if (notificationRequests.get(filter) === request) notificationRequests.delete(filter)
    }
  },

  refresh: async () => {
    if (!useAuthStore.getState().user) return
    set({ refreshing: true })
    try {
      const response = await api.refreshNotifications()
      if (response.created > 0) void get().loadUnreadCount(true)
    } catch {
      // 上游 AnimeGarden 暂不可用时继续展示已有通知。
    } finally {
      set({ refreshing: false })
    }
  },

  markRead: async (notification) => {
    if (notification.is_read) return
    set(state => ({
      items: state.items.map(item => item.id === notification.id ? { ...item, is_read: true } : item),
      unreadCount: Math.max(0, state.unreadCount - 1),
      publicUnread: notification.scope === 'public' ? Math.max(0, state.publicUnread - 1) : state.publicUnread,
      privateUnread: notification.scope === 'private' ? Math.max(0, state.privateUnread - 1) : state.privateUnread,
    }))
    const cached = notificationCache.get(notification.scope)
    if (cached) {
      cached.items = cached.items.map(item => item.id === notification.id ? { ...item, is_read: true } : item)
    }
    if (!useAuthStore.getState().user && notification.scope === 'public') {
      const ids = anonymousReadIds()
      ids.add(notification.id)
      saveAnonymousReadIds(ids)
      return
    }
    try {
      await api.markNotificationRead(notification.id)
    } catch {
      await get().loadUnreadCount()
    }
  },

  markAllRead: async () => {
    const filter = get().filter
    if (!useAuthStore.getState().user) {
      const ids = anonymousReadIds()
      get().items.filter(item => item.scope === filter).forEach(item => ids.add(item.id))
      saveAnonymousReadIds(ids)
      set(state => ({
        items: state.items.map(item => item.scope === filter ? { ...item, is_read: true } : item),
        unreadCount: filter === 'public' ? Math.max(0, state.unreadCount - state.publicUnread) : Math.max(0, state.unreadCount - state.privateUnread),
        publicUnread: filter === 'public' ? 0 : state.publicUnread,
        privateUnread: filter === 'private' ? 0 : state.privateUnread,
      }))
      const cached = notificationCache.get(filter)
      if (cached) cached.items = cached.items.map(item => ({ ...item, is_read: true }))
      return
    }
    try {
      await api.markAllNotificationsRead(filter)
      set(state => ({
        items: state.items.map(item => item.scope === filter ? { ...item, is_read: true } : item),
      }))
      const cached = notificationCache.get(filter)
      if (cached) cached.items = cached.items.map(item => ({ ...item, is_read: true }))
      await get().loadUnreadCount()
    } catch {
      // request helper 已经提示错误。
    }
  },
}))
