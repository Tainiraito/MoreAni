import { cleanup, createEvent, fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
    expect(minimum).toHaveClass('sr-only', 'pointer-events-none')
    expect(maximum).toHaveClass('sr-only', 'pointer-events-none')

    fireEvent.change(minimum, { target: { value: '4' } })
    expect(minimum).toHaveValue('4')
    expect(view.getByText('4.0 – 10.0')).toBeInTheDocument()

    fireEvent.change(maximum, { target: { value: '8.5' } })
    expect(maximum).toHaveValue('8.5')
    expect(view.getByText('4.0 – 8.5')).toBeInTheDocument()
  })

  it('两个端点可以重合选择单个评分，但不会交叉', () => {
    const view = render(<ControlledSlider />)
    const minimum = view.getByLabelText('最低评分') as HTMLInputElement
    const maximum = view.getByLabelText('最高评分') as HTMLInputElement

    fireEvent.change(minimum, { target: { value: '10' } })
    expect(minimum).toHaveValue('10')
    expect(maximum).toHaveValue('10')
    expect(view.getByText('10.0 – 10.0')).toBeInTheDocument()

    fireEvent.change(maximum, { target: { value: '0.5' } })
    expect(minimum).toHaveValue('10')
    expect(maximum).toHaveValue('10')
  })

  it('悬停和拖动时显示可交互指针反馈', () => {
    const view = render(<ControlledSlider />)
    const track = view.getByTestId('score-range-track')
    Object.assign(track, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => false),
      releasePointerCapture: vi.fn(),
    })

    expect(track).toHaveStyle({ cursor: 'ew-resize' })
    fireEvent.pointerEnter(track)
    expect(track.querySelector('span')).toHaveStyle({ transform: 'translateX(-50%) scale(1.12)' })

    fireEvent.pointerDown(track, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 0 })
    expect(track).toHaveStyle({ cursor: 'grabbing' })
    fireEvent.pointerUp(track, { pointerType: 'mouse', pointerId: 1 })
    expect(track).toHaveStyle({ cursor: 'ew-resize' })
  })

  it('连续两次指针拖动都能更新区间且不会进入原生拖放', () => {
    const view = render(<ControlledSlider />)
    const track = view.getByTestId('score-range-track')
    Object.assign(track, {
      getBoundingClientRect: () => ({ left: 0, width: 100 }),
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    })

    fireEvent.pointerDown(track, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 50 })
    fireEvent.pointerMove(track, { pointerType: 'mouse', pointerId: 1, clientX: 75 })
    fireEvent.pointerUp(track, { pointerType: 'mouse', pointerId: 1, clientX: 75 })
    expect(view.getByText('0.5 – 7.5')).toBeInTheDocument()

    fireEvent.pointerDown(track, { pointerType: 'mouse', button: 0, pointerId: 2, clientX: 0 })
    fireEvent.pointerMove(track, { pointerType: 'mouse', pointerId: 2, clientX: 25 })
    fireEvent.pointerUp(track, { pointerType: 'mouse', pointerId: 2, clientX: 25 })
    expect(view.getByText('3.0 – 7.5')).toBeInTheDocument()

    const dragEvent = createEvent.dragStart(track)
    const preventDefault = vi.spyOn(dragEvent, 'preventDefault')
    fireEvent(track, dragEvent)
    expect(preventDefault).toHaveBeenCalled()
    expect(track).toHaveStyle({ cursor: 'ew-resize' })
  })
})
