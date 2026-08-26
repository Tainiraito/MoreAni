import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WeeklyAiringPanel } from '@/components/content/WeeklyAiringPanel'
import type { AiringCalendarWeek } from '@/types'

const week: AiringCalendarWeek = {
  timezone: 'Asia/Shanghai',
  week_start: '2026-08-24',
  last_synced_at: '2026-08-25T04:10:00Z',
  sync_status: 'success',
  days: Array.from({ length: 7 }, (_, index) => ({
    date: `2026-08-${24 + index}`,
    weekday: index + 1,
    label: `星期${index + 1}`,
    is_today: index === 1,
    items: index === 1
      ? [{
        subject_id: 1001,
        content_id: 9,
        matched: true,
        title: '本地番剧',
        title_alt: 'Local Anime',
        cover_url: '',
        bangumi_url: 'https://bgm.tv/subject/1001',
      }]
      : index === 0
        ? [{
          subject_id: 1002,
          content_id: null,
          matched: false,
          title: '未关联番剧',
          title_alt: 'Unmatched Anime',
          cover_url: '',
          bangumi_url: 'https://bgm.tv/subject/1002',
        }, {
          subject_id: 1003,
          content_id: null,
          matched: false,
          title: '另一部未关联番剧',
          title_alt: 'Another Unmatched Anime',
          cover_url: '',
          bangumi_url: 'https://bgm.tv/subject/1003',
        }]
      : [],
  })),
}

describe('WeeklyAiringPanel', () => {
  afterEach(() => cleanup())

  it('defaults to today, switches weekday, and opens local detail', () => {
    const onOpenContent = vi.fn()
    const { getByRole, getByTestId, getByText } = render(
      <WeeklyAiringPanel
        week={week}
        loading={false}
        error={null}
        onOpenContent={onOpenContent}
        onAddAnime={vi.fn()}
        isFavorited={() => false}
        onToggleFavorite={vi.fn()}
      />,
    )

    expect(getByTestId('airing-calendar-grid')).toBeInTheDocument()
    expect(getByRole('tab', { name: /周二/ })).toHaveAttribute('aria-selected', 'true')
    expect(getByRole('tab', { name: /周一/ })).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(getByRole('button', { name: '列表视图' }))
    expect(getByTestId('airing-calendar-list')).toBeInTheDocument()
    fireEvent.click(getByRole('button', { name: '卡片视图' }))
    expect(getByTestId('airing-calendar-grid')).toBeInTheDocument()

    fireEvent.click(getByRole('tab', { name: /周一/ }))
    expect(getByRole('tab', { name: /周一/ })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(getByRole('tab', { name: /周二/ }))
    fireEvent.click(getByText('本地番剧'))
    expect(onOpenContent).toHaveBeenCalledWith(9)
  })

  it('shows a fixed skeleton while loading', () => {
    const { getByTestId } = render(
      <WeeklyAiringPanel
        week={null}
        loading
        error={null}
        onOpenContent={vi.fn()}
        onAddAnime={vi.fn()}
        isFavorited={() => false}
        onToggleFavorite={vi.fn()}
      />,
    )
    expect(getByTestId('airing-calendar-skeleton')).toBeTruthy()
  })

  it('reveals in-card actions after clicking an unmatched card', () => {
    const onAddAnime = vi.fn()
    const view = render(
      <WeeklyAiringPanel
        week={week}
        loading={false}
        error={null}
        onOpenContent={vi.fn()}
        onAddAnime={onAddAnime}
        isFavorited={() => false}
        onToggleFavorite={vi.fn()}
      />,
    )

    fireEvent.click(view.getByRole('tab', { name: /周一/ }))

    expect(view.queryByRole('dialog')).not.toBeInTheDocument()
    expect(view.queryByRole('link', { name: '前往 Bangumi 未关联番剧' })).not.toBeInTheDocument()
    fireEvent.click(view.getByRole('button', { name: '打开 未关联番剧 的操作' }))
    expect(view.getByRole('link', { name: '前往 Bangumi 未关联番剧' })).toHaveAttribute('href', 'https://bgm.tv/subject/1002')
    fireEvent.click(view.getByRole('button', { name: '添加番剧 未关联番剧' }))
    expect(onAddAnime).toHaveBeenCalledWith(expect.objectContaining({ subject_id: 1002, title: '未关联番剧' }))
  })

  it('keeps only one unmatched card open and closes it on outside click', async () => {
    const view = render(
      <WeeklyAiringPanel
        week={week}
        loading={false}
        error={null}
        onOpenContent={vi.fn()}
        onAddAnime={vi.fn()}
        isFavorited={() => false}
        onToggleFavorite={vi.fn()}
      />,
    )

    fireEvent.click(view.getByRole('tab', { name: /周一/ }))
    fireEvent.click(view.getByRole('button', { name: '打开 未关联番剧 的操作' }))
    expect(view.getByRole('button', { name: '添加番剧 未关联番剧' })).toBeInTheDocument()

    fireEvent.click(view.getByRole('button', { name: '打开 另一部未关联番剧 的操作' }))
    expect(view.queryByRole('button', { name: '添加番剧 未关联番剧' })).not.toBeInTheDocument()
    expect(view.getByRole('button', { name: '添加番剧 另一部未关联番剧' })).toBeInTheDocument()

    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(view.queryByRole('button', { name: '添加番剧 另一部未关联番剧' })).not.toBeInTheDocument())
  })

  it('matched cards expose a working favorite badge and no detail label', () => {
    const onOpenContent = vi.fn()
    const onToggleFavorite = vi.fn()
    const view = render(
      <WeeklyAiringPanel
        week={week}
        loading={false}
        error={null}
        onOpenContent={onOpenContent}
        onAddAnime={vi.fn()}
        isFavorited={() => false}
        onToggleFavorite={onToggleFavorite}
      />,
    )

    expect(view.queryByText('查看详情')).not.toBeInTheDocument()
    fireEvent.click(view.getByRole('button', { name: '收藏 本地番剧' }))
    expect(onToggleFavorite).toHaveBeenCalledWith(9)
    expect(onOpenContent).not.toHaveBeenCalled()
    expect(view.getByText('本地番剧').closest('div')).toHaveClass('text-left')
  })

  it('also shows inline actions for unmatched list rows', () => {
    const view = render(
      <WeeklyAiringPanel
        week={week}
        loading={false}
        error={null}
        onOpenContent={vi.fn()}
        onAddAnime={vi.fn()}
        isFavorited={() => false}
        onToggleFavorite={vi.fn()}
      />,
    )

    fireEvent.click(view.getByRole('button', { name: '列表视图' }))
    fireEvent.click(view.getByRole('tab', { name: /周一/ }))
    expect(view.getByRole('link', { name: '前往 Bangumi 未关联番剧' })).toBeInTheDocument()
    expect(view.getByRole('button', { name: '添加番剧 未关联番剧' })).toBeInTheDocument()
  })
})
