import { act, cleanup, fireEvent, render as rtlRender, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { HomePage } from '@/pages/HomePage'
import type { ContentItem, PaginatedResponse, User } from '@/types'

const testState = vi.hoisted(() => ({
  user: null as User | null,
  refreshKey: 0,
}))

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

interface RecordedListRequest {
  params: Record<string, string>
  deferred: Deferred<PaginatedResponse<ContentItem>>
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function content(id: number, title: string, contentType: ContentItem['content_type'] = 'anime'): ContentItem {
  return {
    id,
    title,
    title_alt: '',
    cover_url: '',
    description: '',
    content_type: contentType,
    episodes: 0,
    status: '',
    release_date: '',
    platform: '',
    source_type: 'manual',
    source_id: '',
    source_url: '',
    metadata: {},
    is_public: true,
    created_by: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    tags: [],
    recent_reviews: [],
  }
}

const requests: RecordedListRequest[] = []

function renderHomePage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(
    <QueryClientProvider client={queryClient}>
      <HomePage />
    </QueryClientProvider>,
  )
}

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({ user: testState.user }),
}))
vi.mock('@/stores/refresh-store', () => ({
  useRefreshStore: (selector: (state: { refreshKey: number }) => unknown) => selector({ refreshKey: testState.refreshKey }),
}))
vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({ openDetail: vi.fn(), openAddAnime: vi.fn() }),
}))
vi.mock('@/stores/favorite-store', () => ({
  useFavoriteStore: () => ({ isFavorited: vi.fn(() => false), toggleFavorite: vi.fn() }),
}))
vi.mock('@/components/layout/HeroBrand', () => ({
  HeroBrand: () => <div data-testid="hero-brand" />,
}))
vi.mock('@/components/content/HeroSection', () => ({ HeroSection: () => null }))
vi.mock('@/components/content/WeeklyAiringPanel', () => ({ WeeklyAiringPanel: () => null }))
vi.mock('@/components/content/OtherContentList', () => ({
  OtherContentList: ({ items }: { items: ContentItem[] }) => (
    <div data-testid="other-list">
      {items.map(item => <span key={item.id}>{item.title}</span>)}
    </div>
  ),
}))
vi.mock('@/components/content/CommentListView', () => ({
  CommentListView: ({ items }: { items: ContentItem[] }) => (
    <div data-testid="anime-list">
      {items.map(item => <span key={item.id}>{item.title}</span>)}
    </div>
  ),
}))
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()

  return {
    ...actual,
    api: {
      ...actual.api,
      getRecommendations: vi.fn(),
      getRandom: vi.fn(),
      getSeasons: vi.fn(),
      listUsers: vi.fn(),
      listContent: vi.fn(),
    },
  }
})

describe('HomePage 内容列表请求', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    requests.length = 0
    testState.user = {
      id: 7,
      username: 'list-test',
      nickname: '列表测试',
      avatar_id: 1,
      avatar_url: null,
      avatar_crop: null,
      role: 'user',
      created_at: '2026-01-01T00:00:00Z',
    }
    testState.refreshKey = 0
    vi.mocked(api.getRecommendations).mockResolvedValue({ items: [] })
    vi.mocked(api.getSeasons).mockResolvedValue({ items: [] })
    vi.mocked(api.listUsers).mockResolvedValue({ items: [] })
    vi.mocked(api.listContent).mockImplementation((params = {}) => {
      const deferred = createDeferred<PaginatedResponse<ContentItem>>()
      requests.push({ params, deferred })
      return deferred.promise
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('刷新期间旧分页响应不能覆盖新列表，也不会留下永久 loading', async () => {
    const view = renderHomePage()
    await waitFor(() => expect(requests).toHaveLength(1))

    requests[0].deferred.resolve({ items: [content(1, '旧列表')], total: 40, page: 1, size: 20 })
    await waitFor(() => expect(view.getByText('旧列表')).toBeInTheDocument())

    fireEvent.scroll(window)
    await waitFor(() => expect(requests).toHaveLength(2))

    const searchInput = view.getByPlaceholderText('搜索番剧、标签...')
    fireEvent.change(searchInput, { target: { value: '新筛选' } })
    fireEvent.keyDown(searchInput, { key: 'Enter' })
    await waitFor(() => expect(requests).toHaveLength(3))
    expect(requests[2].params.q).toBe('新筛选')
    fireEvent.scroll(window)
    expect(requests).toHaveLength(3)
    expect(view.getByRole('status', { name: '列表刷新中' })).toBeInTheDocument()

    requests[2].deferred.resolve({ items: [content(2, '新列表')], total: 20, page: 1, size: 20 })
    await waitFor(() => expect(view.getByText('新列表')).toBeInTheDocument())
    expect(view.queryByRole('status', { name: '列表刷新中' })).not.toBeInTheDocument()

    requests[1].deferred.resolve({ items: [content(99, '旧分页')], total: 40, page: 2, size: 20 })
    await waitFor(() => expect(view.queryByText('旧分页')).not.toBeInTheDocument())
  })

  it('分页失败后关闭底部 loading 并保留已有列表', async () => {
    const view = renderHomePage()
    await waitFor(() => expect(requests).toHaveLength(1))
    requests[0].deferred.resolve({ items: [content(1, '已有列表')], total: 40, page: 1, size: 20 })
    await waitFor(() => expect(view.getByText('已有列表')).toBeInTheDocument())

    fireEvent.scroll(window)
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(view.getByRole('status', { name: '加载更多' })).toBeInTheDocument()
    requests[1].deferred.reject(new Error('network failure'))

    await waitFor(() => expect(view.queryByRole('status', { name: '加载更多' })).not.toBeInTheDocument())
    expect(view.getByText('已有列表')).toBeInTheDocument()
  })

  it('首批请求失败后可以点击重试', async () => {
    const view = renderHomePage()
    await waitFor(() => expect(requests).toHaveLength(1))
    requests[0].deferred.reject(new Error('network failure'))

    await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent('列表加载失败'))
    fireEvent.click(view.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(requests).toHaveLength(2))

    requests[1].deferred.resolve({ items: [content(3, '重试成功')], total: 1, page: 1, size: 20 })
    await waitFor(() => expect(view.getByText('重试成功')).toBeInTheDocument())
    expect(view.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('筛选搜索可以一键清空并立即恢复未筛选列表', async () => {
    const view = renderHomePage()
    await waitFor(() => expect(requests).toHaveLength(1))
    requests[0].deferred.resolve({ items: [content(1, '已有列表')], total: 1, page: 1, size: 20 })
    await waitFor(() => expect(view.getByText('已有列表')).toBeInTheDocument())

    const searchInput = view.getByPlaceholderText('搜索番剧、标签...')
    fireEvent.change(searchInput, { target: { value: '新筛选' } })
    fireEvent.keyDown(searchInput, { key: 'Enter' })
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1].params.q).toBe('新筛选')
    requests[1].deferred.resolve({ items: [content(2, '筛选结果')], total: 1, page: 1, size: 20 })
    await waitFor(() => expect(view.getByText('筛选结果')).toBeInTheDocument())

    fireEvent.click(view.getByRole('button', { name: '清空输入内容' }))
    await waitFor(() => expect(requests).toHaveLength(3))
    expect(searchInput).toHaveValue('')
    expect(requests[2].params.q).toBeUndefined()
  })

  it('切换 Tab 后旧首批响应不能写入新列表', async () => {
    const view = renderHomePage()
    await waitFor(() => expect(requests).toHaveLength(1))

    fireEvent.click(view.getByRole('button', { name: '其他' }))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1].params.type).toBe('other')

    requests[1].deferred.resolve({ items: [content(4, '其他列表', 'movie')], total: 1, page: 1, size: 20 })
    await waitFor(() => expect(view.getByText('其他列表')).toBeInTheDocument())

    requests[0].deferred.resolve({ items: [content(5, '旧番剧')], total: 1, page: 1, size: 20 })
    await waitFor(() => expect(view.queryByText('旧番剧')).not.toBeInTheDocument())
    expect(view.getByTestId('other-list')).toHaveTextContent('其他列表')
  })

  it('中文组合输入期间不请求，完成后 300ms 只提交完整关键词', async () => {
    vi.useFakeTimers()
    const view = renderHomePage()
    expect(requests).toHaveLength(1)

    const searchInput = view.getByPlaceholderText('搜索番剧、标签...')
    fireEvent.compositionStart(searchInput)
    fireEvent.change(searchInput, { target: { value: 'zhong' } })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(requests).toHaveLength(1)

    fireEvent.compositionEnd(searchInput)
    fireEvent.change(searchInput, { target: { value: '中文关键词' } })
    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(requests).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(requests).toHaveLength(2)
    expect(requests[1].params.q).toBe('中文关键词')
  })

  it('中文组合输入期间按 Enter 不提交半成品，完成后 Enter 立即提交', async () => {
    const view = renderHomePage()
    await waitFor(() => expect(requests).toHaveLength(1))

    const searchInput = view.getByPlaceholderText('搜索番剧、标签...')
    fireEvent.compositionStart(searchInput)
    fireEvent.change(searchInput, { target: { value: 'zhong' } })
    fireEvent.keyDown(searchInput, {
      key: 'Enter',
      code: 'Enter',
      keyCode: 229,
      isComposing: true,
    })
    expect(requests).toHaveLength(1)

    fireEvent.compositionEnd(searchInput)
    fireEvent.change(searchInput, { target: { value: '中文' } })
    fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1].params.q).toBe('中文')
  })
})
