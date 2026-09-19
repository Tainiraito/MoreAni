import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ComparisonHistoryList } from '@/components/red-blue/ComparisonHistoryList'
import type { RedBlueComparisonHistoryItem } from '@/types/red-blue'

function item(outcome: RedBlueComparisonHistoryItem['outcome']): RedBlueComparisonHistoryItem {
  return {
    id: 1,
    left_content: { content_id: 1, title: '红方作品' },
    right_content: { content_id: 2, title: '蓝方作品' },
    left_content_id: 1,
    right_content_id: 2,
    outcome,
    client_event_id: 'history-test-1',
    selector_version: 'v1',
    created_at: '2026-09-19T00:00:00Z',
    revoked_at: null,
  }
}

function renderHistory(outcome: RedBlueComparisonHistoryItem['outcome']) {
  return render(
    <ComparisonHistoryList
      history={[item(outcome)]}
      pendingId={null}
      onRevoke={() => undefined}
      page={1}
      pageSize={100}
      total={1}
      onPageChange={() => undefined}
    />,
  )
}

describe('ComparisonHistoryList', () => {
  afterEach(() => cleanup())

  it.each([
    ['LEFT_WIN', 'font-bold', 'font-normal'],
    ['RIGHT_WIN', 'font-normal', 'font-bold'],
    ['TIE', 'font-normal', 'font-normal'],
  ] as const)('renders %s as one result line with the right emphasis', (outcome, leftWeight, rightWeight) => {
    const view = renderHistory(outcome)
    const result = view.getByTestId('comparison-history-result-1')
    const spans = result.querySelectorAll('span')

    expect(result).toHaveTextContent('《红方作品》VS《蓝方作品》')
    expect(result).not.toHaveTextContent('2026')
    expect(spans[0]).toHaveClass(leftWeight)
    expect(spans[2]).toHaveClass(rightWeight)
  })
})
