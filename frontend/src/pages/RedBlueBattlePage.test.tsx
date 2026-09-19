import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '@/lib/api'
import { RedBlueBattlePage } from '@/pages/RedBlueBattlePage'
import type {
  CreateRedBlueComparisonResponse,
  RevokeRedBlueComparisonResponse,
  RedBlueState,
  ScoreSuggestionActionResponse,
} from '@/types/red-blue'

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    readonly status: number

    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  },
  api: {
    getRedBlueState: vi.fn(),
    createRedBlueComparison: vi.fn(),
    handleRedBlueSuggestionAction: vi.fn(),
    revokeRedBlueComparison: vi.fn(),
  },
}))

function content(contentId: number, title: string) {
  return { content_id: contentId, title, cover_url: null, content_type: 'anime' }
}

function baseState(overrides: Partial<RedBlueState> = {}): RedBlueState {
  return {
    state_version: 1,
    model_freshness: 'FULL',
    candidate_count: 2,
    pair_status: 'AVAILABLE',
    current_pair: {
      left: content(1, '左作品'),
      right: content(2, '右作品'),
      selector_version: 'v1',
      selection_reason: 'test',
    },
    ranking: [1, 2].map((id, index) => ({
      content: content(id, id === 1 ? '左作品' : '右作品'),
      rank: index + 1,
      current_score: id === 1 ? 80 : 85,
      preference_mean: 1 - index * 0.1,
      comparison_count: 3,
      stability: 'STABLE',
      rank_low: index + 1,
      rank_high: index + 1,
      score_suggestion: null,
    })),
    full_recalibration_required: false,
    full_recalibration_running: false,
    ...overrides,
  }
}

function comparisonResponse(): CreateRedBlueComparisonResponse {
  return {
    comparison: {
      id: 11,
      left_content_id: 1,
      right_content_id: 2,
      outcome: 'LEFT_WIN',
      client_event_id: 'event-1',
      selector_version: 'v1',
      created_at: null,
      revoked_at: null,
    },
    state_version: 2,
    ranking_delta: [
      { content_id: 1, old_rank: 1, new_rank: 1, preference_mean: 1.2, comparison_count: 4 },
      { content_id: 2, old_rank: 2, new_rank: 2, preference_mean: 0.7, comparison_count: 4 },
    ],
    score_suggestion_delta: { added: [], updated: [], removed: [] },
    next_pair: {
      left: content(2, '右作品'),
      right: content(1, '左作品'),
      selector_version: 'v1',
      selection_reason: 'test-next',
    },
    pair_status: 'AVAILABLE',
    model_freshness: 'FAST',
    full_recalibration_required: false,
    full_recalibration_running: false,
    idempotent_replay: false,
  }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ratings/battle']}>
        <RedBlueBattlePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RedBlueBattlePage', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getRedBlueState).mockResolvedValue(baseState())
    vi.mocked(api.createRedBlueComparison).mockResolvedValue(comparisonResponse())
  })

  it('loads a pair, submits LEFT and replaces it with the next pair', async () => {
    const view = renderPage()
    await waitFor(() => expect(view.getByText('红蓝合战')).toBeInTheDocument())
    expect(view.getAllByText('左作品').length).toBeGreaterThan(0)
    expect(view.getAllByText('右作品').length).toBeGreaterThan(0)

    fireEvent.click(view.getByRole('button', { name: '更喜欢红方' }))
    await waitFor(() => expect(api.createRedBlueComparison).toHaveBeenCalledWith(expect.objectContaining({
      left_content_id: 1,
      right_content_id: 2,
      outcome: 'LEFT_WIN',
      client_event_id: expect.any(String),
    })))
    await waitFor(() => expect(view.getByTestId('battle-card-blue')).toHaveTextContent('左作品'))
    expect(view.getByTestId('comparison-undo')).toHaveTextContent('已记录：更喜欢《左作品》')
  })

  it('keeps ranking changes through search, focus and skip, then replaces them on the next valid PK', async () => {
    const first = {
      ...comparisonResponse(),
      ranking_delta: [
        { content_id: 1, old_rank: 1, new_rank: 4, preference_mean: 0.8, comparison_count: 4 },
        { content_id: 2, old_rank: 2, new_rank: 1, preference_mean: 1.2, comparison_count: 4 },
      ],
    }
    const skipped = {
      ...comparisonResponse(),
      state_version: 3,
      comparison: { ...comparisonResponse().comparison, id: 12, outcome: 'SKIP' as const },
      ranking_delta: [],
    }
    const second = {
      ...comparisonResponse(),
      state_version: 4,
      comparison: { ...comparisonResponse().comparison, id: 13, outcome: 'RIGHT_WIN' as const },
      ranking_delta: [
        { content_id: 1, old_rank: 4, new_rank: 4, preference_mean: 0.8, comparison_count: 6 },
        { content_id: 2, old_rank: 1, new_rank: 5, preference_mean: 0.7, comparison_count: 6 },
      ],
    }
    vi.mocked(api.createRedBlueComparison)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(skipped)
      .mockResolvedValueOnce(second)

    const view = renderPage()
    await waitFor(() => expect(view.getByText('红蓝合战')).toBeInTheDocument())
    fireEvent.click(view.getByRole('button', { name: '更喜欢红方' }))
    await waitFor(() => expect(view.getByTestId('ranking-change-1')).toHaveTextContent('3'))

    fireEvent.change(view.getByPlaceholderText('搜索作品'), { target: { value: '左' } })
    expect(view.getByTestId('ranking-change-1')).toBeInTheDocument()
    fireEvent.click(view.getByTestId('focus-content-1'))
    expect(view.getByTestId('ranking-change-1')).toBeInTheDocument()

    fireEvent.click(view.getByRole('button', { name: '跳过' }))
    await waitFor(() => expect(api.createRedBlueComparison).toHaveBeenCalledTimes(2))
    expect(view.getByTestId('ranking-change-1')).toBeInTheDocument()

    fireEvent.change(view.getByPlaceholderText('搜索作品'), { target: { value: '' } })
    fireEvent.click(view.getByRole('button', { name: '更喜欢蓝方' }))
    await waitFor(() => expect(api.createRedBlueComparison).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(view.queryByTestId('ranking-change-1')).not.toBeInTheDocument())
    expect(view.getByTestId('ranking-change-2')).toHaveTextContent('4')
  })

  it('clears ranking changes when the last comparison is revoked', async () => {
    const first = {
      ...comparisonResponse(),
      ranking_delta: [
        { content_id: 1, old_rank: 1, new_rank: 4, preference_mean: 0.8, comparison_count: 4 },
      ],
    }
    const revoked: RevokeRedBlueComparisonResponse = {
      comparison: { ...first.comparison, revoked_at: '2026-09-19T00:00:00Z' },
      revoked: true,
      state_version: 3,
      model_freshness: 'STALE_REQUIRES_FULL',
      full_recalibration_required: true,
      full_recalibration_running: false,
    }
    vi.mocked(api.createRedBlueComparison).mockResolvedValueOnce(first)
    vi.mocked(api.revokeRedBlueComparison).mockResolvedValueOnce(revoked)

    const view = renderPage()
    await waitFor(() => expect(view.getByText('红蓝合战')).toBeInTheDocument())
    fireEvent.click(view.getByRole('button', { name: '更喜欢红方' }))
    await waitFor(() => expect(view.getByTestId('ranking-change-1')).toBeInTheDocument())
    fireEvent.click(view.getByRole('button', { name: '撤销' }))
    await waitFor(() => expect(api.revokeRedBlueComparison).toHaveBeenCalledWith(11))
    expect(view.queryByTestId('ranking-change-1')).not.toBeInTheDocument()
  })

  it.each([
    ['a', 'LEFT_WIN'],
    ['ArrowLeft', 'LEFT_WIN'],
    ['d', 'RIGHT_WIN'],
    ['ArrowRight', 'RIGHT_WIN'],
    ['s', 'TIE'],
    ['ArrowDown', 'TIE'],
    ['w', 'SKIP'],
    ['ArrowUp', 'SKIP'],
  ] as const)('maps %s to %s', async (key, outcome) => {
    const view = renderPage()
    await waitFor(() => expect(view.getByText('红蓝合战')).toBeInTheDocument())
    fireEvent.keyDown(window, { key })
    await waitFor(() => expect(api.createRedBlueComparison).toHaveBeenCalledWith(expect.objectContaining({ outcome })))
  })

  it('does not trigger shortcuts in editable content, while pending or on repeated key events', async () => {
    const view = renderPage()
    await waitFor(() => expect(view.getByText('红蓝合战')).toBeInTheDocument())
    const search = view.getByPlaceholderText('搜索作品')
    fireEvent.keyDown(search, { key: 'a' })
    expect(api.createRedBlueComparison).not.toHaveBeenCalled()

    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'plaintext-only')
    document.body.append(editable)
    fireEvent.keyDown(editable, { key: 'd' })
    expect(api.createRedBlueComparison).not.toHaveBeenCalled()
    editable.remove()

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    fireEvent.keyDown(window, { key: 'w' })
    expect(api.createRedBlueComparison).not.toHaveBeenCalled()
    dialog.remove()

    fireEvent.keyDown(window, { key: 'a', repeat: true })
    expect(api.createRedBlueComparison).not.toHaveBeenCalled()

    const keyboardEvent = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    const preventDefault = vi.fn()
    Object.defineProperty(keyboardEvent, 'preventDefault', { configurable: true, value: preventDefault })
    window.dispatchEvent(keyboardEvent)
    await waitFor(() => expect(api.createRedBlueComparison).toHaveBeenCalledTimes(1))
    expect(preventDefault).toHaveBeenCalled()

    let resolveRequest: ((response: CreateRedBlueComparisonResponse) => void) | undefined
    vi.mocked(api.createRedBlueComparison).mockImplementationOnce(async () => new Promise(resolve => {
      resolveRequest = resolve
    }))
    fireEvent.keyDown(window, { key: 'a' })
    await waitFor(() => expect(api.createRedBlueComparison).toHaveBeenCalledTimes(2))
    fireEvent.keyDown(window, { key: 'd' })
    expect(api.createRedBlueComparison).toHaveBeenCalledTimes(2)
    await act(async () => {
      resolveRequest?.(comparisonResponse())
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  })

  it('locks all comparison actions while the request is pending', async () => {
    let resolveRequest: ((response: CreateRedBlueComparisonResponse) => void) | undefined
    vi.mocked(api.createRedBlueComparison).mockImplementation(async () => new Promise(resolve => {
      resolveRequest = resolve
    }))
    const view = renderPage()
    await waitFor(() => expect(view.getByText('红蓝合战')).toBeInTheDocument())
    expect(view.getByRole('button', { name: '差不多' })).not.toBeDisabled()
    fireEvent.click(view.getByRole('button', { name: '差不多' }))
    await waitFor(() => expect(api.createRedBlueComparison).toHaveBeenCalledTimes(1))
    expect(view.getByRole('button', { name: '更喜欢红方' })).toBeDisabled()
    expect(view.getByRole('button', { name: '跳过' })).toBeDisabled()
    expect(resolveRequest).toBeDefined()
    await act(async () => {
      resolveRequest?.(comparisonResponse())
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await waitFor(() => expect(view.getByRole('button', { name: '更喜欢红方' })).not.toBeDisabled())
  })

  it('sends the selected focus content only as temporary selector context', async () => {
    const view = renderPage()
    await waitFor(() => expect(view.getByTestId('ranking-row-1')).toBeInTheDocument())

    fireEvent.click(view.getByTestId('focus-content-1'))
    expect(view.getByTestId('red-blue-focus-status')).toHaveTextContent('左作品')
    fireEvent.click(view.getByRole('button', { name: '更喜欢红方' }))

    await waitFor(() => expect(api.createRedBlueComparison).toHaveBeenCalledWith(expect.objectContaining({
      focus_content_id: 1,
    })))
  })

  it('patches an added suggestion and accepts it without a full state request', async () => {
    const initial = baseState({
      ranking: baseState().ranking.map(item => item.content.content_id === 2
        ? {
          ...item,
          score_suggestion: {
            id: 20,
            content_id: 2,
            suggestion_key: '2:85:90:UP',
            current_score: 85,
            suggested_score_low: 85,
            suggested_score_high: 90,
            recommended_score: 90,
            direction: 'UP',
            confidence: 0.88,
            severity: 0.7,
            reason_code: 'PREFERENCE_HIGHER_THAN_SCORE',
          },
        }
        : item),
    })
    vi.mocked(api.getRedBlueState).mockResolvedValue(initial)
    const actionResponse: ScoreSuggestionActionResponse = {
      suggestion_id: 20,
      action: 'ACCEPTED',
      current_score: 85,
      updated_score: 90,
      state_version: 1,
      updated_ranking_item: { ...initial.ranking[1], current_score: 90, score_suggestion: null },
      idempotent_replay: false,
    }
    vi.mocked(api.handleRedBlueSuggestionAction).mockResolvedValue(actionResponse)
    const view = renderPage()
    await waitFor(() => expect(view.getByTestId('score-suggestion-20')).toBeInTheDocument())
    fireEvent.click(view.getByRole('button', { name: '调整为 9.0' }))
    await waitFor(() => expect(api.handleRedBlueSuggestionAction).toHaveBeenCalledWith(20, expect.objectContaining({ action: 'ACCEPTED', suggestion_key: '2:85:90:UP' })))
    await waitFor(() => expect(view.queryByTestId('score-suggestion-20')).not.toBeInTheDocument())
    expect(view.getByRole('button', { name: /有评分建议 0/ })).toBeInTheDocument()
  })

  it('reloads on a comparison conflict instead of guessing local state', async () => {
    vi.mocked(api.createRedBlueComparison).mockRejectedValue(new ApiError('状态冲突', 409))
    vi.mocked(api.getRedBlueState)
      .mockResolvedValueOnce(baseState())
      .mockResolvedValueOnce(baseState({ state_version: 2, pair_status: 'COOLDOWN' }))
    const view = renderPage()
    await waitFor(() => expect(view.getByText('红蓝合战')).toBeInTheDocument())
    fireEvent.click(view.getByRole('button', { name: '更喜欢蓝方' }))
    await waitFor(() => expect(api.getRedBlueState).toHaveBeenCalledTimes(2))
    expect(view.getByTestId('red-blue-pair-status')).toHaveTextContent('刚刚比较过')
  })

  it('shows empty and cooldown states without treating them as errors', async () => {
    vi.mocked(api.getRedBlueState).mockResolvedValueOnce(baseState({ candidate_count: 0, current_pair: null, ranking: [], pair_status: 'INSUFFICIENT_CANDIDATES' }))
    const empty = renderPage()
    await waitFor(() => expect(empty.getByTestId('red-blue-empty')).toHaveTextContent('还没有可以参加红蓝合战的番剧'))
    cleanup()

    vi.mocked(api.getRedBlueState).mockResolvedValueOnce(baseState({ pair_status: 'COOLDOWN' }))
    const cooldown = renderPage()
    await waitFor(() => expect(cooldown.getByTestId('red-blue-pair-status')).toHaveTextContent('刚刚比较过'))
  })
})
