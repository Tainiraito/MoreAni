import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useNotificationStore } from '@/stores/notification-store'
import type { NotificationItem, NotificationListResponse, User } from '@/types'

const user: User = {
  id: 901,
  username: 'notification-test',
  nickname: '通知测试用户',
  avatar_id: 1,
  role: 'user',
  created_at: '2026-01-01T00:00:00Z',
}

const notification: NotificationItem = {
  id: 1,
  scope: 'private',
  kind: 'content_activity',
  title: '番剧有新的动态',
  body: '其他用户进行了评分',
  payload: { content_id: 42 },
  created_at: '2026-08-27T00:00:00Z',
  published_at: '2026-08-27T00:00:00Z',
  expires_at: null,
  is_read: false,
}

function notificationResponse(unreadCount = 1): NotificationListResponse {
  return {
    items: [notification],
    total: 1,
    unread_count: unreadCount,
    page: 1,
    size: 30,
  }
}

describe('notification-store 刷新策略', () => {
  afterEach(() => {
    useAuthStore.setState({ user: null, token: null, isGuest: false })
    useNotificationStore.setState({
      open: false,
      filter: 'public',
      items: [],
      total: 0,
      unreadCount: 0,
      publicUnread: 0,
      privateUnread: 0,
      loading: false,
      refreshing: false,
      markingReadIds: [],
      markingAll: false,
    })
    vi.restoreAllMocks()
  })

  it('打开面板时强制刷新通知列表，不使用短期缓存', async () => {
    useAuthStore.setState({ user: { ...user, id: 902 }, token: 'notification-test-token', isGuest: false })
    const listNotifications = vi.spyOn(api, 'listNotifications').mockResolvedValue(notificationResponse())
    vi.spyOn(api, 'getNotificationUnreadCount').mockResolvedValue({ total: 1, public: 0, private: 1 })
    vi.spyOn(api, 'refreshNotifications').mockResolvedValue({ created: 0 })

    useNotificationStore.setState({ filter: 'private' })
    await useNotificationStore.getState().loadNotifications('private')
    await useNotificationStore.getState().openPanel()

    expect(listNotifications).toHaveBeenCalledTimes(2)
    expect(listNotifications).toHaveBeenLastCalledWith({ scope: 'private', page: 1, size: 30 })
  })

  it('面板打开时未读数量变化会同步刷新当前列表', async () => {
    useAuthStore.setState({ user, token: 'notification-test-token', isGuest: false })
    const listNotifications = vi.spyOn(api, 'listNotifications').mockResolvedValue(notificationResponse())
    vi.spyOn(api, 'getNotificationUnreadCount').mockResolvedValue({ total: 1, public: 0, private: 1 })

    useNotificationStore.setState({ open: true, filter: 'private' })
    await useNotificationStore.getState().loadUnreadCount(true)

    expect(listNotifications).toHaveBeenCalledOnce()
    expect(useNotificationStore.getState().privateUnread).toBe(1)
  })
})
