import { fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { RankingList } from '@/components/red-blue/RankingList'
import type { RedBlueRankingItem, RedBlueScoreSuggestion } from '@/types/red-blue'

function item(contentId: number, title: string, stability: string): RedBlueRankingItem {
  return {
    content: { content_id: contentId, title, description: '', cover_url: null, content_type: 'anime' },
    rank: contentId,
    current_score: 80,
    preference_mean: 1,
    comparison_count: 2,
    stability,
    rank_low: contentId,
    rank_high: contentId + (stability === 'ORDER_UNCERTAIN' ? 8 : 1),
    score_suggestion: null,
  }
}

function suggestion(contentId: number): RedBlueScoreSuggestion {
  return {
    id: contentId + 1000,
    content_id: contentId,
    suggestion_key: `${contentId}:80:90:UP`,
    current_score: 80,
    suggested_score_low: 85,
    suggested_score_high: 90,
    recommended_score: 90,
    direction: 'UP',
    confidence: 0.9,
    severity: 0.8,
    reason_code: 'PREFERENCE_HIGHER_THAN_SCORE',
  }
}

describe('RankingList filters and intervals', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('groups all uncertain stability states under 待确认', () => {
    const view = render(
      <RankingList
        ranking={[
          item(1, '未校准', 'UNCALIBRATED'),
          item(2, '正在校准', 'CALIBRATING'),
          item(3, '顺序待确认', 'ORDER_UNCERTAIN'),
          item(4, '稳定作品', 'STABLE'),
        ]}
        rankChanges={{}}
        actionPendingId={null}
        onOpenContent={() => undefined}
        onSuggestionAction={() => undefined}
      />,
    )

    const filters = within(view.getByRole('group', { name: '排名筛选' }))
    fireEvent.click(filters.getByRole('button', { name: /待确认/ }))
    expect(view.getByTestId('ranking-row-1')).toBeInTheDocument()
    expect(view.getByTestId('ranking-row-2')).toBeInTheDocument()
    expect(view.getByTestId('ranking-row-3')).toBeInTheDocument()
    expect(view.queryByTestId('ranking-row-4')).not.toBeInTheDocument()
    expect(view.getByText('排名仍在确认中')).toBeInTheDocument()
    expect(filters.getByRole('button', { name: /稳定 1/ })).toBeInTheDocument()
  })

  it('counts no suggestions when all 100 rows have null suggestions', () => {
    const view = render(
      <RankingList
        ranking={Array.from({ length: 100 }, (_, index) => item(index + 1, `作品 ${index + 1}`, 'STABLE'))}
        rankChanges={{}}
        actionPendingId={null}
        onOpenContent={() => undefined}
        onSuggestionAction={() => undefined}
      />,
    )

    const filters = within(view.getByRole('group', { name: '排名筛选' }))
    expect(filters.getByRole('button', { name: /有评分建议 0/ })).toBeInTheDocument()
    fireEvent.click(filters.getByRole('button', { name: /有评分建议 0/ }))
    expect(view.getByText('没有符合当前搜索或筛选条件的作品。')).toBeInTheDocument()
  })

  it('counts and filters only the three non-null suggestions', () => {
    const ranking = Array.from({ length: 100 }, (_, index) => {
      const row = item(index + 1, `作品 ${index + 1}`, 'STABLE')
      return index < 3 ? { ...row, score_suggestion: suggestion(index + 1) } : row
    })
    const view = render(
      <RankingList
        ranking={ranking}
        rankChanges={{}}
        actionPendingId={null}
        onOpenContent={() => undefined}
        onSuggestionAction={() => undefined}
      />,
    )

    const filters = within(view.getByRole('group', { name: '排名筛选' }))
    const suggestionFilter = filters.getByRole('button', { name: /有评分建议 3/ })
    expect(suggestionFilter).toBeInTheDocument()
    fireEvent.click(suggestionFilter)
    expect(view.getAllByTestId(/^ranking-row-/)).toHaveLength(3)
    expect(view.getByText('显示 3 / 100 部作品')).toBeInTheDocument()
  })

  it('does not render a fractional rank even for a legacy malformed item', () => {
    const view = render(
      <RankingList
        ranking={[{ ...item(1, '异常名次作品', 'STABLE'), rank: 1.5 }]}
        rankChanges={{}}
        actionPendingId={null}
        onOpenContent={() => undefined}
        onSuggestionAction={() => undefined}
      />,
    )

    expect(view.queryByText('#1.5')).not.toBeInTheDocument()
    expect(view.getByText('#—')).toBeInTheDocument()
  })
})
