import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Tooltip } from '@/components/ui/tooltip'

describe('Tooltip', () => {
  it('长文本提示会限制宽度并允许换行', () => {
    const { container, getByRole } = render(
      <Tooltip content="这是一段足够长的提示内容，用来确认 Tooltip 不会把文字撑出页面或承载面板。">
        <button type="button">触发提示</button>
      </Tooltip>,
    )
    const trigger = getByRole('button', { name: '触发提示' })
    const tooltip = container.querySelector('[role="tooltip"]')

    expect(tooltip).not.toBeNull()
    expect(tooltip).toHaveClass('whitespace-normal', 'break-words')
    expect(tooltip).toHaveClass('max-w-[min(18rem,calc(100vw-2rem))]')
    expect(tooltip).toHaveAttribute('aria-hidden', 'true')

    fireEvent.mouseEnter(trigger)
    expect(tooltip).toHaveAttribute('aria-hidden', 'false')
    fireEvent.mouseLeave(trigger)
    expect(tooltip).toHaveAttribute('aria-hidden', 'true')
  })
})
