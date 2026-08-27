import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NotificationCenter } from '@/components/notification/NotificationFab'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useNotificationStore } from '@/stores/notification-store'
import type { User } from '@/types'

const user: User = {
  id: 1201,
  username: 'notification-focus-test',
  nickname: '通知焦点测试用户',
  avatar_id: 1,
  role: 'user',
  created_at: '2026-01-01T00:00:00Z',
}

describe('NotificationCenter 前台刷新', () => {
  afterEach(() => {
    cleanup()
    useAuthStore.setState({ user: null, token: null, isGuest: false })
    useNotificationStore.setState({ open: false, filter: 'public', unreadCount: 0, publicUnread: 0, privateUnread: 0 })
    vi.restoreAllMocks()
  })

  it('窗口重新获得焦点时立即刷新未读数量', async () => {
    useAuthStore.setState({ user, token: 'notification-focus-token', isGuest: false })
    const getNotificationUnreadCount = vi.spyOn(api, 'getNotificationUnreadCount').mockResolvedValue({ total: 0, public: 0, private: 0 })

    render(<NotificationCenter />)
    await waitFor(() => expect(getNotificationUnreadCount).toHaveBeenCalledOnce())

    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(getNotificationUnreadCount).toHaveBeenCalledTimes(2))
  })
})
