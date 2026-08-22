import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ContentItem } from '@/types'
import { getRecommendationLoopDistance } from '@/lib/content-query'
import { HeroBrand } from '@/components/layout/HeroBrand'

vi.mock('@/stores/auth-store', () => ({ useAuthStore: () => ({ user: null }) }))
vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    openAuth: vi.fn(),
    authOpen: false,
    detailOpen: false,
    openSettings: vi.fn(),
    openDetail: vi.fn(),
  }),
}))
vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }) }))
vi.mock('@/components/content/AnimeCard', () => ({
  AnimeCard: ({ content }: { content: ContentItem }) => (
    <div data-testid="anime-card" data-content-id={content.id}>{content.id}</div>
  ),
}))

function item(id: number): ContentItem {
  return { id } as ContentItem
}

function sequenceIds(sequence: HTMLElement): number[] {
  return Array.from(sequence.querySelectorAll('[data-testid="anime-card"]'))
    .map(card => Number(card.getAttribute('data-content-id')))
}

describe('HeroBrand 横向推荐滚动', () => {
  afterEach(() => cleanup())

  it('保持两份唯一序列，并使用包含边界 gap 的精确循环距离', () => {
    const { getByTestId, getAllByTestId } = render(<HeroBrand items={[item(1), item(2), item(1)]} />)
    const track = getByTestId('hero-brand-scroll-track')
    const sequences = getAllByTestId('hero-brand-scroll-sequence')

    expect(sequences).toHaveLength(2)
    expect(sequenceIds(sequences[0])).toEqual([1, 2])
    expect(sequenceIds(sequences[1])).toEqual([1, 2])
    expect(track.style.getPropertyValue('--loop-distance')).toBe(`${getRecommendationLoopDistance(2)}px`)
    expect(track.style.animationDuration).toBe(`${getRecommendationLoopDistance(2) / 25}s`)
  })

  it('新数据在当前轮次作为第二份序列，animationiteration 后再同步切换', async () => {
    const firstItems = [item(1), item(2)]
    const nextItems = [item(3), item(4)]
    const { getByTestId, getAllByTestId, rerender } = render(<HeroBrand items={firstItems} />)

    rerender(<HeroBrand items={nextItems} />)
    await waitFor(() => {
      const sequences = getAllByTestId('hero-brand-scroll-sequence')
      expect(sequenceIds(sequences[0])).toEqual([1, 2])
      expect(sequenceIds(sequences[1])).toEqual([3, 4])
    })

    fireEvent.animationIteration(getByTestId('hero-brand-scroll-track'), {
      animationName: 'scroll-left',
      elapsedTime: 14.4,
    })
    await waitFor(() => {
      const sequences = getAllByTestId('hero-brand-scroll-sequence')
      expect(sequenceIds(sequences[0])).toEqual([3, 4])
      expect(sequenceIds(sequences[1])).toEqual([3, 4])
    })
  })
})
