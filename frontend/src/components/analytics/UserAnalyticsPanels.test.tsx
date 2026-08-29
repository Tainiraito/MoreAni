import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UserAnalyticsPanels } from '@/components/analytics/UserAnalyticsPanels'
import { api } from '@/lib/api'
import type { AnalyticsOverview, AnalyticsRecommendations } from '@/types'

vi.mock('@/lib/api', () => ({
  api: {
    getAnalyticsOverview: vi.fn(),
    getAnalyticsRecommendations: vi.fn(),
  },
}))

vi.mock('@/components/analytics/TagWordCloud', () => ({
  TagWordCloud: ({ items }: { items: Array<{ name: string }> }) => (
    <div data-testid="profile-word-cloud">{items.map(item => item.name).join('、')}</div>
  ),
}))

const overview: AnalyticsOverview = {
  scope: { type: 'user', user: null },
  min_score: 0.5,
  max_score: 10,
  rating_count: 3,
  title_count: 3,
  user_count: 1,
  average_score: 8.7,
  score_distribution: [{ score: 9, count: 3 }],
  frequency_tags: [],
  weighted_tags: [{ name: '治愈', weight: 2.7, rating_count: 3, title_count: 3, average_score: 9 }],
  favorites: [{
    id: 11,
    title: '最喜欢的番剧',
    title_alt: '日本語タイトル',
    cover_url: '',
    content_type: 'anime',
    score: 9,
    average_score: 8.8,
    rating_count: 4,
  }],
}

const recommendations: AnalyticsRecommendations = {
  scope: { type: 'user', user: null },
  profile_rating_count: 3,
  confidence: 'low',
  basis: 'blended',
  items: [{
    id: 12,
    title: '可能喜欢的番剧',
    title_alt: '',
    cover_url: '',
    content_type: 'anime',
    match_percent: 82,
    confidence: 'low',
    matched_tags: ['治愈'],
    basis: 'blended',
    average_score: 8.5,
    rating_count: 7,
  }],
}

describe('UserAnalyticsPanels', () => {
  beforeEach(() => {
    vi.mocked(api.getAnalyticsOverview).mockResolvedValue(overview)
    vi.mocked(api.getAnalyticsRecommendations).mockResolvedValue(recommendations)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('loads the current user dimension and renders four analytics regions', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
      <QueryClientProvider client={client}>
        <UserAnalyticsPanels userId={7} onOpenContent={vi.fn()} />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(view.getByText('最喜欢的番剧')).toBeInTheDocument())
    expect(view.getByText('评分分布')).toBeInTheDocument()
    expect(view.getByText('标签词云')).toBeInTheDocument()
    expect(view.getByText('当前最喜欢')).toBeInTheDocument()
    expect(view.getByText('可能喜欢', { selector: 'h3' })).toBeInTheDocument()
    expect(view.getByTestId('profile-word-cloud')).toHaveTextContent('治愈')
    expect(view.getByText('可能喜欢的番剧')).toBeInTheDocument()
    expect(view.getByTestId('analytics-favorite-card')).not.toHaveTextContent('日本語タイトル')
    expect(view.getByTestId('analytics-favorite-card')).toHaveClass('rounded-xl', 'hover:-translate-y-0.5', 'hover:shadow-lg')
    expect(view.getByTestId('analytics-recommendation-card')).toHaveClass('rounded-xl', 'hover:-translate-y-0.5', 'hover:shadow-lg')
    expect(view.getByTestId('settings-current-favorites-scroll')).toHaveClass('overflow-y-auto')
    expect(view.getByTestId('settings-recommendations-scroll')).toHaveClass('overflow-y-auto')
    expect(api.getAnalyticsOverview).toHaveBeenCalledWith(
      { scope: 'user', userId: 7, minScore: 0.5, maxScore: 10 },
      { signal: expect.any(AbortSignal) },
    )
    expect(api.getAnalyticsRecommendations).toHaveBeenCalledWith(
      { scope: 'user', userId: 7, limit: 6 },
      { signal: expect.any(AbortSignal) },
    )
  })
})
