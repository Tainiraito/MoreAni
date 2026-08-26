import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { OtherContentList } from '@/components/content/OtherContentList'
import type { ContentItem } from '@/types'

const item = {
  id: 7,
  title: '测试软件',
  content_type: 'software',
  release_date: '2026-08-25',
  updated_at: '2026-08-25T00:00:00Z',
  avg_score: 86,
  review_count: 2,
  platform: 'Windows',
} as ContentItem

describe('OtherContentList', () => {
  it('renders a cover-free row and supports detail/favorite actions', () => {
    const onSelect = vi.fn()
    const onToggleFavorite = vi.fn()
    const { getByRole, queryByRole } = render(
      <OtherContentList items={[item]} onSelect={onSelect} isFavorited={() => false} onToggleFavorite={onToggleFavorite} />,
    )

    expect(getByRole('heading', { name: '测试软件' })).toBeTruthy()
    expect(queryByRole('img')).toBeNull()
    fireEvent.click(getByRole('heading', { name: '测试软件' }))
    fireEvent.click(getByRole('button', { name: '收藏 测试软件' }))
    expect(onSelect).toHaveBeenCalledWith(7)
    expect(onToggleFavorite).toHaveBeenCalledWith(7)
  })
})
