import { cleanup, fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { ScoreRangeSlider } from '@/components/analytics/ScoreRangeSlider'
import type { ScoreRange } from '@/components/analytics/ScoreRangeSlider'

function ControlledSlider() {
  const [value, setValue] = useState<ScoreRange>({ min: 0.5, max: 10 })
  return <ScoreRangeSlider value={value} onChange={setValue} />
}

describe('ScoreRangeSlider', () => {
  afterEach(cleanup)

  it('最低分和最高分两个端点都可以独立拖动', () => {
    const view = render(<ControlledSlider />)
    const minimum = view.getByLabelText('最低评分') as HTMLInputElement
    const maximum = view.getByLabelText('最高评分') as HTMLInputElement

    expect(minimum).toHaveValue('0.5')
    expect(maximum).toHaveValue('10')
    expect(minimum).toHaveAttribute('step', '0.5')
    expect(maximum).toHaveAttribute('step', '0.5')

    fireEvent.change(minimum, { target: { value: '4' } })
    expect(minimum).toHaveValue('4')
    expect(view.getByText('4.0 – 10.0')).toBeInTheDocument()

    fireEvent.change(maximum, { target: { value: '8.5' } })
    expect(maximum).toHaveValue('8.5')
    expect(view.getByText('4.0 – 8.5')).toBeInTheDocument()
  })

  it('两个端点不会交叉并保留 0.5 分最小间隔', () => {
    const view = render(<ControlledSlider />)
    const minimum = view.getByLabelText('最低评分') as HTMLInputElement
    const maximum = view.getByLabelText('最高评分') as HTMLInputElement

    fireEvent.change(minimum, { target: { value: '10' } })
    expect(minimum).toHaveValue('9.5')
    expect(maximum).toHaveValue('10')

    fireEvent.change(maximum, { target: { value: '0.5' } })
    expect(minimum).toHaveValue('9.5')
    expect(maximum).toHaveValue('10')
  })
})
