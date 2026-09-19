import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { RankingList } from '@/components/red-blue/RankingList'
import type { RedBlueRankingItem } from '@/types/red-blue'

function rankingOf(size: number): RedBlueRankingItem[] {
  return Array.from({ length: size }, (_, index) => ({
    content: {
      content_id: index + 1,
      title: `测试作品 ${index + 1}`,
      description: '',
      cover_url: null,
      content_type: 'anime',
    },
    rank: index + 1,
    current_score: 80,
    preference_mean: 1 - index / Math.max(size, 1),
    comparison_count: index % 12,
    stability: index % 7 === 0 ? 'ORDER_UNCERTAIN' : 'STABLE',
    rank_low: index + 1,
    rank_high: index % 7 === 0 ? index + 2 : index + 1,
    score_suggestion: null,
  }))
}

describe('RankingList render performance', () => {
  afterEach(() => cleanup())

  it.each([100, 500, 1000])('renders %s rows and records the measured duration', size => {
    const startedAt = performance.now()
    const view = render(
      <RankingList
        ranking={rankingOf(size)}
        rankChanges={{}}
        actionPendingId={null}
        onOpenContent={() => undefined}
        onSuggestionAction={() => undefined}
      />,
    )
    const elapsed = performance.now() - startedAt
    expect(view.getByText(`测试作品 1`)).toBeInTheDocument()
    expect(view.getByText(`测试作品 ${size}`)).toBeInTheDocument()
    console.info(`[red-blue-performance] rows=${size} render_ms=${elapsed.toFixed(1)}`)
  })
})
