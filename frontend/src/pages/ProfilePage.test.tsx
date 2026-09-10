import { cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { ProfilePage } from '@/pages/ProfilePage'
import type { User } from '@/types'

vi.mock('@/lib/api', () => ({
  api: {
    getUser: vi.fn(),
    getUserRatings: vi.fn(),
  },
}))

describe('ProfilePage', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('使用接口返回的 avatar_url', async () => {
    vi.mocked(api.getUser).mockResolvedValue({
      id: 7,
      username: 'avatar-user',
      nickname: '头像用户',
      avatar_id: 0,
      avatar_url: '/api/avatars/7.png?v=2',
      role: 'user',
      created_at: '2026-01-01T00:00:00Z',
    } as User)
    vi.mocked(api.getUserRatings).mockResolvedValue({ items: [] })

    const { getByAltText } = render(
      <MemoryRouter initialEntries={['/profile/7']}>
        <Routes><Route path="/profile/:id" element={<ProfilePage />} /></Routes>
      </MemoryRouter>,
    )
    await waitFor(() => expect(getByAltText('头像用户')).toHaveAttribute('src', '/api/avatars/7.png?v=2'))
  })

  it('renders inline review markup in rating history', async () => {
    vi.mocked(api.getUser).mockResolvedValue({
      id: 7,
      username: 'review-user',
      nickname: '评论用户',
      avatar_id: 0,
      role: 'user',
      created_at: '2026-01-01T00:00:00Z',
    } as User)
    vi.mocked(api.getUserRatings).mockResolvedValue({
      items: [{
        id: 1,
        content_id: 88,
        user_id: 7,
        score: 80,
        recommend: 80,
        review: '结局||剧透内容||',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }],
      total: 1,
    })

    const view = render(
      <MemoryRouter initialEntries={['/profile/7']}>
        <Routes><Route path="/profile/:id" element={<ProfilePage />} /></Routes>
      </MemoryRouter>,
    )

    expect(await view.findByText('剧透内容')).toHaveClass('bg-black', 'text-black')
  })
})
