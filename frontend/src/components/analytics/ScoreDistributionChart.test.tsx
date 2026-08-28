import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ScoreDistributionChart } from '@/components/analytics/ScoreDistributionChart'

describe('ScoreDistributionChart', () => {
  afterEach(cleanup)

  it('整个评分列都可以点击或用键盘选定单个评分', () => {
    const onSelectScore = vi.fn()
    const view = render(
      <ScoreDistributionChart
        buckets={[
          { score: 9.5, count: 0 },
          { score: 10, count: 1 },
        ]}
        range={{ min: 0.5, max: 10 }}
        onSelectScore={onSelectScore}
      />,
    )
    const emptyColumn = view.getByRole('button', { name: '9.5 分，共 0 条评分，点击仅查看该评分' })
    const fullColumn = view.getByRole('button', { name: '10.0 分，共 1 条评分，点击仅查看该评分' })

    fireEvent.click(emptyColumn)
    expect(onSelectScore).toHaveBeenLastCalledWith(9.5)

    fireEvent.keyDown(fullColumn, { key: 'Enter' })
    expect(onSelectScore).toHaveBeenLastCalledWith(10)

    fireEvent.keyDown(emptyColumn, { key: ' ' })
    expect(onSelectScore).toHaveBeenLastCalledWith(9.5)
  })
})
