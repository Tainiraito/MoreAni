import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useUIStore } from '@/stores/ui-store'
import type { User } from '@/types'

vi.mock('@/lib/api', () => ({
  api: {
    getUser: vi.fn(),
    getUserActivity: vi.fn(),
  },
}))

vi.mock('@/components/analytics/UserAnalyticsPanels', () => ({
  UserAnalyticsPanels: ({ userId }: { userId: number }) => (
    <div data-testid="mock-user-analytics">用户 {userId} 的统计区域</div>
  ),
}))

const currentUser: User = {
  id: 7,
  username: 'settings-user',
  nickname: '设置用户',
  avatar_id: 0,
  role: 'user',
  created_at: '2026-01-01T00:00:00Z',
}

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: currentUser, token: 'token', isGuest: false })
    useUIStore.setState({ settingsOpen: true })
    vi.mocked(api.getUser).mockResolvedValue({
      rating_count: 3,
      review_count: 2,
      favorite_count: 1,
      avg_score: 85,
    })
    vi.mocked(api.getUserActivity).mockResolvedValue({ items: [], total: 0 })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    useUIStore.setState({ settingsOpen: false })
    useAuthStore.setState({ user: null, token: null, isGuest: false })
  })

  it('keeps account details on the left and opens the global analytics route', async () => {
    const view = render(
      <MemoryRouter initialEntries={['/']}>
        <SettingsDialog />
        <LocationProbe />
      </MemoryRouter>,
    )

    expect(view.getByTestId('settings-profile-grid')).toBeInTheDocument()
    expect(view.getByTestId('settings-profile-left')).toHaveTextContent('设置用户')
    expect(view.getByTestId('mock-user-analytics')).toHaveTextContent('用户 7 的统计区域')
    expect(view.getByTestId('settings-profile-grid')).not.toHaveClass('overflow-y-auto')
    expect(view.getByRole('dialog')).toHaveClass('overflow-hidden')
    expect(view.getByRole('dialog').parentElement).toHaveClass('z-[60]')
    expect(view.queryByText('MoreAni v2.0 — 又看一集')).not.toBeInTheDocument()
    await waitFor(() => expect(api.getUserActivity).toHaveBeenCalledWith(7, { page: '1', size: '10' }))

    fireEvent.click(view.getByRole('button', { name: '全站分析' }))
    expect(view.getByTestId('location')).toHaveTextContent('/analytics')
    expect(useUIStore.getState().settingsOpen).toBe(false)
  })

  it('renders rich text in the current user activity feed', async () => {
    vi.mocked(api.getUserActivity).mockResolvedValue({
      items: [{
        type: 'review',
        content_id: 88,
        content_title: '富文本番剧',
        content_cover: null,
        content_type: 'anime',
        score: 80,
        review: '**重要剧情** ||我的防剧透||',
        updated_at: '2026-01-02T00:00:00Z',
      }],
      total: 1,
    })

    const view = render(
      <MemoryRouter initialEntries={['/']}>
        <SettingsDialog />
      </MemoryRouter>,
    )

    await waitFor(() => expect(view.getByText('重要剧情')).toBeInTheDocument())
    expect(view.getByText('我的防剧透')).toHaveClass('text-black', 'bg-black')
  })
})
