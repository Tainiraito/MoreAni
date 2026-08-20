import { render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

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
})
