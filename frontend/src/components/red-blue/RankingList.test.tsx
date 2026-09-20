import { fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { RankingList } from '@/components/red-blue/RankingList'
import type { RedBlueRankingChange, RedBlueRankingItem, RedBlueScoreSuggestion } from '@/types/red-blue'

function item(contentId: number, title: string, stability: string, orderUncertain = false): RedBlueRankingItem {
  return {
    content: { content_id: contentId, title, description: '', cover_url: null, content_type: 'anime' },
    rank: contentId,
    current_score: 80,
    preference_mean: 1,
    comparison_count: 2,
    stability,
    order_uncertain: orderUncertain,
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

  function chooseFilter(view: ReturnType<typeof render>, label: RegExp): void {
    const filters = within(view.getByRole('group', { name: '排名筛选' }))
    fireEvent.click(filters.getByRole('button'))
    fireEvent.click(view.getByRole('option', { name: label }))
  }

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

    chooseFilter(view, /待确认 \(3\)/)
    expect(view.getByTestId('ranking-row-1')).toBeInTheDocument()
    expect(view.getByTestId('ranking-row-2')).toBeInTheDocument()
    expect(view.getByTestId('ranking-row-3')).toBeInTheDocument()
    expect(view.queryByTestId('ranking-row-4')).not.toBeInTheDocument()
    expect(view.getByText('排名仍在确认中')).toBeInTheDocument()
    const filters = within(view.getByRole('group', { name: '排名筛选' }))
    fireEvent.click(filters.getByRole('button'))
    expect(view.getByRole('option', { name: /稳定 \(1\)/ })).toBeInTheDocument()
  })

  it('does not render the redundant order uncertainty tag', () => {
    const view = render(
      <RankingList
        ranking={[item(1, '稳定但顺序不确定', 'STABLE', true)]}
        rankChanges={{}}
        actionPendingId={null}
        onOpenContent={() => undefined}
        onSuggestionAction={() => undefined}
      />,
    )

    expect(view.getByText('稳定')).toBeInTheDocument()
    expect(view.queryByText('顺序待确认')).not.toBeInTheDocument()
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

    chooseFilter(view, /有评分建议 \(0\)/)
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
        onPageChange={() => undefined}
      />,
    )

    chooseFilter(view, /有评分建议 \(3\)/)
    expect(view.getAllByTestId(/^ranking-row-/)).toHaveLength(3)
    expect(view.getByText('第 1 / 1 页 · 共 100 部作品')).toBeInTheDocument()
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

  it('shows unchanged and one-position ranking changes', () => {
    const rankChanges: Record<number, RedBlueRankingChange> = {
      1: { old_rank: 1, new_rank: 1, direction: 'UNCHANGED', amount: 0 },
      2: { old_rank: 2, new_rank: 1, direction: 'UP', amount: 1 },
    }
    const view = render(
      <RankingList
        ranking={[item(1, '排名不变', 'STABLE'), item(2, '上升一位', 'STABLE')]}
        rankChanges={rankChanges}
        actionPendingId={null}
        onOpenContent={() => undefined}
        onSuggestionAction={() => undefined}
      />,
    )

    expect(view.getByTestId('ranking-change-1')).toHaveTextContent('0')
    expect(view.getByTestId('ranking-change-1')).toHaveAttribute('data-direction', 'UNCHANGED')
    expect(view.getByTestId('ranking-change-2')).toHaveTextContent('1')
    expect(view.getByTestId('ranking-change-2')).toHaveAttribute('data-direction', 'UP')
  })

  it('keeps the calibration card beside the clickable row and exposes three direct actions', () => {
    const opened: number[] = []
    const actions: string[] = []
    const row = { ...item(1, '可点击作品', 'STABLE'), score_suggestion: suggestion(1) }
    const view = render(
      <RankingList
        ranking={[row]}
        rankChanges={{}}
        actionPendingId={null}
        onOpenContent={contentId => opened.push(contentId)}
        onSuggestionAction={(_, action) => actions.push(action)}
      />,
    )

    const rankingRow = view.getByTestId('ranking-row-1')
    const calibrationCard = view.getByTestId('score-suggestion-1001')
    expect(rankingRow).not.toContainElement(calibrationCard)
    expect(rankingRow.parentElement).toContainElement(calibrationCard)
    expect(rankingRow).toHaveAttribute('role', 'button')
    expect(rankingRow).toHaveClass('rounded-xl', 'border')
    expect(rankingRow.querySelector('[aria-hidden="true"]')).not.toHaveClass('rounded-lg')

    fireEvent.click(rankingRow)
    expect(opened).toEqual([1])
    fireEvent.click(view.getByRole('button', { name: '确定' }))
    fireEvent.click(view.getByRole('button', { name: '保持' }))
    fireEvent.click(view.getByRole('button', { name: '暂时忽略' }))
    expect(actions).toEqual(['ACCEPTED', 'REJECTED', 'DISMISSED'])
  })
})
