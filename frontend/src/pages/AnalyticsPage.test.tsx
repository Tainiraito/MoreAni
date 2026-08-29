import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { AnalyticsPage } from '@/pages/AnalyticsPage'
import { useAuthStore } from '@/stores/auth-store'
import type { AnalyticsOverview, AnalyticsRecommendations, User } from '@/types'

vi.mock('@/lib/api', () => ({
  api: {
    listUsers: vi.fn(),
    getAnalyticsOverview: vi.fn(),
    getAnalyticsRecommendations: vi.fn(),
  },
}))

vi.mock('@/components/analytics/TagWordCloud', () => ({
  TagWordCloud: ({
    items,
    selectedNames,
    onToggleTag,
  }: {
    items: Array<{ name: string }>
    selectedNames: readonly string[]
    onToggleTag: (name: string) => void
  }) => items.length > 0 ? (
    <div data-testid="mock-word-cloud">
      {items.map(item => (
        <button
          key={item.name}
          type="button"
          aria-pressed={selectedNames.includes(item.name)}
          onClick={() => onToggleTag(item.name)}
        >
          {item.name}
        </button>
      ))}
    </div>
  ) : <div>当前评分区间暂无可分析标签</div>,
}))

const CURRENT_USER: User = {
  id: 7,
  username: 'analytics-user',
  nickname: '分析用户',
  avatar_id: 0,
  role: 'user',
  created_at: '2026-01-01T00:00:00Z',
}

const OVERVIEW: AnalyticsOverview = {
  scope: { type: 'global', user: null },
  min_score: 0.5,
  max_score: 10,
  rating_count: 12,
  title_count: 8,
  user_count: 3,
  average_score: 8.25,
  score_distribution: [
    { score: 8, count: 5 },
    { score: 10, count: 7 },
  ],
  frequency_tags: [
    { name: '恋爱频次', weight: 6, rating_count: 6, title_count: 4, average_score: 8.2 },
  ],
  weighted_tags: [
    { name: '恋爱加权', weight: 5.2, rating_count: 6, title_count: 4, average_score: 8.7 },
    { name: '校园加权', weight: 4.6, rating_count: 5, title_count: 3, average_score: 8.4 },
  ],
  favorites: [
    {
      id: 101,
      title: '全站代表作',
      title_alt: '',
      cover_url: '',
      content_type: 'anime',
      score: 9.3,
      average_score: 9.3,
      rating_count: 3,
    },
  ],
}

const RECOMMENDATIONS: AnalyticsRecommendations = {
  scope: { type: 'global', user: null },
  profile_rating_count: 12,
  confidence: 'medium',
  basis: 'global',
  items: [
    {
      id: 202,
      title: '可能喜欢的番剧',
      title_alt: '',
      cover_url: '',
      content_type: 'anime',
      match_percent: 82,
      confidence: 'medium',
      matched_tags: ['恋爱', '校园'],
      basis: 'global',
      average_score: 8.4,
      rating_count: 2,
    },
  ],
}

function renderAnalytics(initialEntry = '/analytics') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/analytics" element={<AnalyticsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AnalyticsPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: CURRENT_USER })
    vi.mocked(api.listUsers).mockResolvedValue({ items: [CURRENT_USER] })
    vi.mocked(api.getAnalyticsOverview).mockResolvedValue(OVERVIEW)
    vi.mocked(api.getAnalyticsRecommendations).mockResolvedValue(RECOMMENDATIONS)
  })

  afterEach(() => {
    cleanup()
    useAuthStore.setState({ user: null })
    vi.clearAllMocks()
  })

  it('首次进入默认请求并展示全站分析', async () => {
    const view = renderAnalytics()

    await waitFor(() => expect(api.getAnalyticsOverview).toHaveBeenCalled())
    expect(api.getAnalyticsOverview).toHaveBeenCalledWith(
      { scope: 'global', userId: undefined, minScore: 0.5, maxScore: 10, tags: [] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(api.getAnalyticsRecommendations).toHaveBeenCalledWith(
      { scope: 'global', userId: undefined, limit: 6, tags: [] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(await view.findByText('全站代表作')).toBeInTheDocument()
    expect(view.getByText('可能喜欢的番剧')).toBeInTheDocument()
    expect(view.getByText('站内评分 8.4 · 2 人评分')).toBeInTheDocument()
    expect(view.queryByText('中等置信度')).not.toBeInTheDocument()
    await waitFor(() => expect(view.getByTestId('mock-word-cloud')).toHaveTextContent('恋爱加权'))
    expect(view.getByText('3 条评分 · 实际均分')).toBeInTheDocument()
    expect(view.getByText('全站优先展示高分且评分人数充足的番剧', { exact: false })).toBeInTheDocument()

    fireEvent.click(view.getByRole('button', { name: '出现频次' }))
    await waitFor(() => expect(view.getByTestId('mock-word-cloud')).toHaveTextContent('恋爱频次'))
  })

  it('从 URL 恢复单用户分析范围', async () => {
    const targetUser = { ...CURRENT_USER, id: 8, username: 'target-user', nickname: '目标成员' }
    vi.mocked(api.listUsers).mockResolvedValue({ items: [CURRENT_USER, targetUser] })

    renderAnalytics('/analytics?scope=user&user_id=8')

    await waitFor(() => expect(api.getAnalyticsOverview).toHaveBeenCalled())
    expect(api.getAnalyticsOverview).toHaveBeenCalledWith(
      { scope: 'user', userId: 8, minScore: 0.5, maxScore: 10, tags: [] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(api.getAnalyticsRecommendations).toHaveBeenCalledWith(
      { scope: 'user', userId: 8, limit: 6, tags: [] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('选择成员后切换 URL 对应的分析范围', async () => {
    const view = renderAnalytics()

    await view.findByText('全站代表作')
    fireEvent.click(view.getByRole('button', { name: '全站分析' }))
    fireEvent.click(await view.findByRole('option', { name: '我 · 分析用户' }))

    await waitFor(() => expect(api.getAnalyticsOverview).toHaveBeenCalledWith(
      { scope: 'user', userId: CURRENT_USER.id, minScore: 0.5, maxScore: 10, tags: [] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ))
  })

  it('滑条立即更新显示，150ms 后请求并取消过期请求', async () => {
    const view = renderAnalytics()
    await view.findByText('全站代表作')
    vi.mocked(api.getAnalyticsOverview).mockClear()

    let staleSignal: AbortSignal | null | undefined
    vi.mocked(api.getAnalyticsOverview).mockImplementation((params, options) => {
      if (params.minScore === 4) {
        staleSignal = options?.signal
        return new Promise(() => undefined)
      }
      return Promise.resolve({
        ...OVERVIEW,
        min_score: params.minScore,
        max_score: params.maxScore,
      })
    })

    const minimum = view.getByLabelText('最低评分')
    fireEvent.change(minimum, { target: { value: '4' } })
    expect(view.getByText('4.0 – 10.0')).toBeInTheDocument()
    expect(api.getAnalyticsOverview).not.toHaveBeenCalled()

    await waitFor(() => expect(api.getAnalyticsOverview).toHaveBeenCalledWith(
      { scope: 'global', userId: undefined, minScore: 4, maxScore: 10, tags: [] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ))

    fireEvent.change(minimum, { target: { value: '5' } })
    expect(view.getByText('5.0 – 10.0')).toBeInTheDocument()
    expect(api.getAnalyticsOverview).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(api.getAnalyticsOverview).toHaveBeenCalledWith(
      { scope: 'global', userId: undefined, minScore: 5, maxScore: 10, tags: [] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ))
    expect(staleSignal?.aborted).toBe(true)
  })

  it('再次点击同一评分列会恢复选择单列前的评分区间', async () => {
    const view = renderAnalytics()
    await view.findByText('全站代表作')
    const minimum = view.getByLabelText('最低评分')
    fireEvent.change(minimum, { target: { value: '5' } })
    await waitFor(() => expect(api.getAnalyticsOverview).toHaveBeenCalledWith(
      { scope: 'global', userId: undefined, minScore: 5, maxScore: 10, tags: [] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ))
    vi.mocked(api.getAnalyticsOverview).mockClear()

    const tenPointColumn = view.getByRole('button', { name: '10.0 分，共 7 条评分，点击仅查看该评分' })
    fireEvent.click(tenPointColumn)

    expect(view.getByText('10.0 – 10.0')).toBeInTheDocument()
    await waitFor(() => expect(api.getAnalyticsOverview).toHaveBeenCalledWith(
      { scope: 'global', userId: undefined, minScore: 10, maxScore: 10, tags: [] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ))

    vi.mocked(api.getAnalyticsOverview).mockClear()
    fireEvent.click(tenPointColumn)
    expect(view.getByText('5.0 – 10.0')).toBeInTheDocument()
    await waitFor(() => expect(api.getAnalyticsOverview).toHaveBeenCalledWith(
      { scope: 'global', userId: undefined, minScore: 5, maxScore: 10, tags: [] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ))
  })

  it('标签支持多选和取消，并同时刷新代表作与推荐', async () => {
    const view = renderAnalytics()
    await view.findByText('全站代表作')
    vi.mocked(api.getAnalyticsOverview).mockClear()
    vi.mocked(api.getAnalyticsRecommendations).mockClear()

    const loveTag = await view.findByRole('button', { name: '恋爱加权' })
    fireEvent.click(loveTag)
    expect(view.getByRole('button', { name: '恋爱加权' })).toHaveAttribute('aria-pressed', 'true')
    expect(view.getByRole('button', { name: '取消标签 恋爱加权' })).toBeInTheDocument()
    await waitFor(() => expect(api.getAnalyticsOverview).toHaveBeenCalledWith(
      { scope: 'global', userId: undefined, minScore: 0.5, maxScore: 10, tags: ['恋爱加权'] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ))
    await waitFor(() => expect(api.getAnalyticsRecommendations).toHaveBeenCalledWith(
      { scope: 'global', userId: undefined, limit: 6, tags: ['恋爱加权'] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ))

    fireEvent.click(view.getByRole('button', { name: '校园加权' }))
    await waitFor(() => expect(api.getAnalyticsRecommendations).toHaveBeenCalledWith(
      { scope: 'global', userId: undefined, limit: 6, tags: ['恋爱加权', '校园加权'] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ))

    fireEvent.click(view.getByRole('button', { name: '恋爱加权' }))
    await waitFor(() => expect(api.getAnalyticsRecommendations).toHaveBeenCalledWith(
      { scope: 'global', userId: undefined, limit: 6, tags: ['校园加权'] },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ))
    expect(view.queryByRole('button', { name: '取消标签 恋爱加权' })).not.toBeInTheDocument()
  })

  it('无统计样本和候选时展示完整空状态', async () => {
    vi.mocked(api.getAnalyticsOverview).mockResolvedValue({
      ...OVERVIEW,
      rating_count: 0,
      title_count: 0,
      user_count: 0,
      average_score: null,
      frequency_tags: [],
      weighted_tags: [],
      favorites: [],
    })
    vi.mocked(api.getAnalyticsRecommendations).mockResolvedValue({
      ...RECOMMENDATIONS,
      profile_rating_count: 0,
      confidence: 'low',
      items: [],
    })

    const view = renderAnalytics()

    expect(await view.findByText('当前评分区间暂无可分析标签')).toBeInTheDocument()
    expect(view.getByText('当前评分区间暂无代表作')).toBeInTheDocument()
    expect(view.getByText('暂无未评分候选番剧')).toBeInTheDocument()
  })
})
