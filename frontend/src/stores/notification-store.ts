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
  loadUnreadCount: () => Promise<void>
  loadNotifications: (filter?: NotificationFilter) => Promise<void>
  refresh: () => Promise<void>
  markRead: (notification: NotificationItem) => Promise<void>
  markAllRead: () => Promise<void>
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
    set({ filter })
    void get().loadNotifications(filter)
  },

  openPanel: async () => {
    set({ open: true, loading: true })
    await get().refresh()
    await get().loadNotifications(get().filter)
  },

  closePanel: () => set({ open: false }),

  loadUnreadCount: async () => {
    try {
      const counts = await api.getNotificationUnreadCount()
      if (!useAuthStore.getState().user) {
        const response = await api.listNotifications({ scope: 'public', page: 1, size: 100 })
        const readIds = anonymousReadIds()
        const knownRead = response.items.filter(item => readIds.has(item.id)).length
        const unread = Math.max(0, counts.public - knownRead)
        set({ unreadCount: unread, publicUnread: unread, privateUnread: 0 })
      } else {
        set({ unreadCount: counts.total, publicUnread: counts.public, privateUnread: counts.private })
      }
    } catch {
      // 通知故障不应影响站内其他页面。
    }
  },

  loadNotifications: async (filter = get().filter) => {
    if (filter === 'private' && !useAuthStore.getState().user) {
      set({ items: [], total: 0, loading: false })
      return
    }
    set({ loading: true })
    try {
      const response = await api.listNotifications({ scope: filter, page: 1, size: 30 })
      const readIds = useAuthStore.getState().user ? new Set<number>() : anonymousReadIds()
      set(state => ({
        items: mergeReadState(state.items, response).map(item => ({ ...item, is_read: item.is_read || readIds.has(item.id) })),
        total: response.total,
        loading: false,
      }))
    } catch {
      set({ loading: false })
    }
  },

  refresh: async () => {
    if (useAuthStore.getState().user) {
      set({ refreshing: true })
      try {
        await api.refreshNotifications()
      } catch {
        // 上游 AnimeGarden 暂不可用时继续展示已有通知。
      } finally {
        set({ refreshing: false })
      }
    }
    await get().loadUnreadCount()
  },

  markRead: async (notification) => {
    if (notification.is_read) return
    set(state => ({
      items: state.items.map(item => item.id === notification.id ? { ...item, is_read: true } : item),
      unreadCount: Math.max(0, state.unreadCount - 1),
      publicUnread: notification.scope === 'public' ? Math.max(0, state.publicUnread - 1) : state.publicUnread,
      privateUnread: notification.scope === 'private' ? Math.max(0, state.privateUnread - 1) : state.privateUnread,
    }))
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
      return
    }
    try {
      await api.markAllNotificationsRead(filter)
      set(state => ({
        items: state.items.map(item => item.scope === filter ? { ...item, is_read: true } : item),
      }))
      await get().loadUnreadCount()
    } catch {
      // request helper 已经提示错误。
    }
  },
}))
