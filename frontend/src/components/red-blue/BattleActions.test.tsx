import { render, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BattleActions } from '@/components/red-blue/BattleActions'

describe('BattleActions', () => {
  it('让红蓝按钮跨两行，并把跳过放在差不多上方的中间列', () => {
    const view = render(
      <BattleActions
        disabled={false}
        selectedOutcome={null}
        onChoose={() => undefined}
      />,
    )

    const actions = within(view.getByTestId('battle-primary-actions'))

    expect(actions.getByRole('button', { name: '更喜欢红方' })).toHaveClass('w-full', 'row-span-2')
    expect(actions.getByRole('button', { name: '更喜欢蓝方' })).toHaveClass('w-full', 'col-start-3', 'row-span-2')
    expect(actions.getByRole('button', { name: '跳过' })).toHaveClass('col-start-2', 'row-start-1')
    expect(actions.getByRole('button', { name: '差不多' })).toHaveClass('col-start-2', 'row-start-2')
    expect(view.queryByTestId('battle-secondary-actions')).not.toBeInTheDocument()
  })

  it('紧凑模式仍保持四个快捷操作在同一行', () => {
    const view = render(
      <BattleActions
        compact
        disabled={false}
        selectedOutcome={null}
        onChoose={() => undefined}
        testIdPrefix="sticky-battle"
      />,
    )

    expect(view.queryByTestId('sticky-battle-primary-actions')).not.toBeInTheDocument()
    expect(view.getByTestId('sticky-battle-action-left_win')).toHaveTextContent('红方')
    expect(view.getByTestId('sticky-battle-action-tie')).toHaveTextContent('≈')
    expect(view.getByTestId('sticky-battle-action-right_win')).toHaveTextContent('蓝方')
    expect(view.getByTestId('sticky-battle-action-skip')).toHaveTextContent('跳过')
  })
})
