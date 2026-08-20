import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { HomePage } from '@/pages/HomePage'
import type { ContentItem } from '@/types'

vi.mock('@/stores/auth-store', () => ({ useAuthStore: () => ({ user: null }) }))
vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({ openDetail: vi.fn(), openAddAnime: vi.fn() }),
}))
vi.mock('@/stores/favorite-store', () => ({
  useFavoriteStore: () => ({ isFavorited: vi.fn(() => false), toggleFavorite: vi.fn() }),
}))
vi.mock('@/stores/refresh-store', () => ({ useRefreshStore: (selector: (state: { refreshKey: number }) => unknown) => selector({ refreshKey: 0 }) }))
vi.mock('@/components/layout/HeroBrand', () => ({
  HeroBrand: ({ items }: { items: ContentItem[] }) => <div data-testid="hero-brand">{items.length}</div>,
}))
vi.mock('@/lib/api', () => ({
  api: {
    getRecommendations: vi.fn(),
  },
}))

describe('HomePage 推荐数据', () => {
  beforeEach(() => {
    vi.mocked(api.getRecommendations).mockResolvedValue({
      items: Array.from({ length: 12 }, (_, index) => ({ id: index + 1 }) as ContentItem),
    })
  })

  it('HomePage 与 HeroBrand 共用一次推荐请求', async () => {
    const { getByTestId } = render(<HomePage />)
    await waitFor(() => expect(getByTestId('hero-brand')).toHaveTextContent('12'))
    expect(api.getRecommendations).toHaveBeenCalledTimes(1)
  })
})
