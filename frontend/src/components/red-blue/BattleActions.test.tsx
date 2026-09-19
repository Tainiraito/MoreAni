import { render, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BattleActions } from '@/components/red-blue/BattleActions'

describe('BattleActions', () => {
  it('将左右选择放在第一行，并让两侧按钮与卡片列对齐', () => {
    const view = render(
      <BattleActions
        disabled={false}
        selectedOutcome={null}
        onChoose={() => undefined}
      />,
    )

    const primary = within(view.getByTestId('battle-primary-actions'))
    const secondary = within(view.getByTestId('battle-secondary-actions'))

    expect(primary.getByRole('button', { name: '更喜欢红方' })).toBeInTheDocument()
    expect(primary.getByRole('button', { name: '更喜欢蓝方' })).toBeInTheDocument()
    expect(secondary.getByRole('button', { name: '差不多' })).toBeInTheDocument()
    expect(secondary.getByRole('button', { name: '跳过' })).toBeInTheDocument()
    expect(primary.getByRole('button', { name: '更喜欢红方' })).toHaveClass('w-full')
    expect(primary.getByRole('button', { name: '更喜欢蓝方' })).toHaveClass('w-full')
    expect(primary.getByRole('button', { name: '更喜欢蓝方' })).toHaveClass('col-start-3')
    expect(secondary.getByRole('button', { name: '跳过' })).toHaveClass('col-start-3')
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
