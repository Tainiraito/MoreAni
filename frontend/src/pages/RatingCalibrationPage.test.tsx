import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { RatingCalibrationPage } from '@/pages/RatingCalibrationPage'
import type { RatingCalibrationCandidate } from '@/types'

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    readonly status: number

    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  },
  api: {
    getCalibrationCandidates: vi.fn(),
    saveCalibration: vi.fn(),
  },
}))

function candidate(contentId: number, score: number): RatingCalibrationCandidate {
  return {
    rating_id: contentId,
    content_id: contentId,
    title: `作品 ${contentId}`,
    title_alt: '',
    cover_url: null,
    content_type: 'anime',
    old_score: score,
    rated_at: '2026-01-01T00:00:00Z',
    last_rated_at: '2026-01-01T00:00:00Z',
  }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ratings/calibration']}>
        <RatingCalibrationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RatingCalibrationPage', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getCalibrationCandidates).mockResolvedValue([
      candidate(1, 80),
      candidate(2, 70),
      candidate(3, 60),
    ])
    vi.mocked(api.saveCalibration).mockResolvedValue({
      comparison_id: 'comparison-1',
      updated_content_ids: [1],
      skipped_content_ids: [],
    })
  })

  it('默认隐藏旧评分且新评分为空', async () => {
    const view = renderPage()

    await waitFor(() => expect(view.getByText('作品 1')).toBeInTheDocument())
    expect(view.getAllByRole('button', { name: /显示《作品 [123]》的旧评分/ })).toHaveLength(2)
    expect(view.getAllByRole('button', { name: /隐藏《作品 [123]》的旧评分/ })).toHaveLength(1)
    const scoreGroups = view.getAllByRole('group', { name: /《作品 [123]》的新评分/ })
    expect(scoreGroups).toHaveLength(3)
    expect(scoreGroups.every(group => group.querySelectorAll('button').length === 10)).toBe(true)
    expect(view.container.querySelectorAll('img[src="/placeholder.png"]')).toHaveLength(3)
    expect(view.queryByText(/原评分于|最近修改/)).not.toBeInTheDocument()
  })

  it('可以追加随机作品、移除作品并批量显示旧评分', async () => {
    const view = renderPage()
    await waitFor(() => expect(view.getByText('作品 1')).toBeInTheDocument())

    vi.mocked(api.getCalibrationCandidates).mockResolvedValueOnce([
      candidate(4, 50),
    ])
    fireEvent.click(view.getByRole('button', { name: '再抽一部' }))
    await waitFor(() => expect(view.getByText('作品 4')).toBeInTheDocument())
    expect(api.getCalibrationCandidates).toHaveBeenLastCalledWith(
      { count: 1, excludeContentIds: [1, 2, 3] },
      { suppressErrorToast: true },
    )

    fireEvent.click(view.getAllByRole('button', { name: '移除本次对比' })[0])
    expect(view.queryByText('作品 1')).not.toBeInTheDocument()
    fireEvent.click(view.getByRole('button', { name: '显示全部旧评分' }))
    expect(view.getAllByRole('button', { name: /隐藏《作品 [234]》的旧评分/ })).toHaveLength(3)
  })

  it('只提交有效且发生变化的新评分', async () => {
    const view = renderPage()
    await waitFor(() => expect(view.getByText('作品 1')).toBeInTheDocument())

    fireEvent.click(view.getByRole('button', { name: '《作品 1》的新评分 8.5 至 9 分' }))
    const secondScoreButton = view.getByRole('button', { name: '《作品 2》的新评分 6.5 至 7 分' })
    fireEvent.click(secondScoreButton)
    fireEvent.click(secondScoreButton)
    fireEvent.click(view.getByRole('button', { name: '保存评分' }))

    await waitFor(() => expect(api.saveCalibration).toHaveBeenCalledWith([
      { content_id: 1, expected_score: 80, new_score: 90 },
    ]))
    expect(view.getByRole('button', { name: '隐藏《作品 1》的旧评分' })).toHaveTextContent('8.0')
    expect(view.getAllByRole('button', { name: /隐藏《作品 [123]》的旧评分/ })).toHaveLength(3)
    expect(view.getByTestId('score-change-1')).toHaveTextContent('↑ 上调 1.0 分')
    expect(view.getByRole('button', { name: '保存评分' })).toBeDisabled()
  })

  it('旧评分显影后实时显示升降幅度并随新评分更新', async () => {
    const view = renderPage()
    await waitFor(() => expect(view.getByText('作品 1')).toBeInTheDocument())

    if (!view.queryByRole('button', { name: '隐藏《作品 1》的旧评分' })) {
      fireEvent.click(view.getByRole('button', { name: '显示《作品 1》的旧评分' }))
    }
    expect(view.queryByTestId('score-change-1')).not.toBeInTheDocument()

    fireEvent.click(view.getByRole('button', { name: '《作品 1》的新评分 8.5 至 9 分' }))
    expect(view.getByTestId('score-change-1')).toHaveTextContent('↑ 上调 1.0 分')

    fireEvent.click(view.getByRole('button', { name: '《作品 1》的新评分 6.5 至 7 分' }))
    expect(view.getByTestId('score-change-1')).toHaveTextContent('↓ 下调 1.0 分')

    fireEvent.click(view.getByRole('button', { name: '隐藏《作品 1》的旧评分' }))
    expect(view.queryByTestId('score-change-1')).not.toBeInTheDocument()
    fireEvent.click(view.getByRole('button', { name: '显示《作品 1》的旧评分' }))
    expect(view.getByTestId('score-change-1')).toHaveTextContent('↓ 下调 1.0 分')
  })

  it('按当前数量重新抽取并替换整批作品', async () => {
    const view = renderPage()
    await waitFor(() => expect(view.getByText('作品 1')).toBeInTheDocument())
    vi.mocked(api.getCalibrationCandidates).mockResolvedValueOnce([
      candidate(4, 50),
      candidate(5, 40),
      candidate(6, 30),
    ])

    fireEvent.click(view.getByRole('button', { name: '重新抽取' }))

    await waitFor(() => expect(view.getByText('作品 4')).toBeInTheDocument())
    expect(view.queryByText('作品 1')).not.toBeInTheDocument()
    expect(api.getCalibrationCandidates).toHaveBeenLastCalledWith(
      { count: 3, excludeContentIds: [1, 2, 3] },
      { suppressErrorToast: true },
    )
  })

  it('重新抽取前使用应用内确认弹窗丢弃未保存修改', async () => {
    const view = renderPage()
    await waitFor(() => expect(view.getByText('作品 1')).toBeInTheDocument())
    fireEvent.click(view.getByRole('button', { name: '《作品 1》的新评分 8.5 至 9 分' }))

    fireEvent.click(view.getByRole('button', { name: '重新抽取' }))
    const dialog = await view.findByTestId('calibration-confirm-dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog.getAttribute('style')).toContain('background: var(--bg-card)')
    expect(dialog.getAttribute('style')).toContain('border: 1px solid var(--border-line)')
    expect(dialog.getAttribute('style')).toContain('box-shadow: var(--shadow-popup)')
    expect(dialog.parentElement?.getAttribute('style')).toContain('background: rgba(0, 0, 0, 0.6)')
    expect(dialog.parentElement?.getAttribute('style')).toContain('backdrop-filter: blur(4px)')
    expect(api.getCalibrationCandidates).toHaveBeenCalledTimes(1)

    fireEvent.click(view.getByRole('button', { name: '取消' }))
    expect(view.queryByTestId('calibration-confirm-dialog')).not.toBeInTheDocument()
    expect(api.getCalibrationCandidates).toHaveBeenCalledTimes(1)

    vi.mocked(api.getCalibrationCandidates).mockResolvedValueOnce([candidate(4, 50)])
    fireEvent.click(view.getByRole('button', { name: '重新抽取' }))
    fireEvent.click(await view.findByRole('button', { name: '继续抽取' }))
    await waitFor(() => expect(view.getByText('作品 4')).toBeInTheDocument())
  })
})
