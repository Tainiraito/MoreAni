import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CoverImage } from '@/components/ui/CoverImage'

describe('CoverImage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('默认懒加载、异步解码，失败后最多重试一次', () => {
    const view = render(<CoverImage src="/api/covers/bangumi/1001.webp?v=abc" alt="测试封面" />)
    let image = view.getByAltText('测试封面')

    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).toHaveAttribute('decoding', 'async')
    expect(view.container.querySelector('img[alt=""]')).toHaveAttribute('aria-hidden', 'true')

    fireEvent.error(image)
    act(() => vi.advanceTimersByTime(799))
    expect(view.queryByAltText('测试封面')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    image = view.getByAltText('测试封面')
    expect(image.getAttribute('src')).toContain('_retry=1')

    fireEvent.error(image)
    expect(view.queryByAltText('测试封面')).not.toBeInTheDocument()
    expect(view.container.querySelector('img[alt=""]')).toBeInTheDocument()
  })

  it('卸载后清理尚未执行的重试定时器', () => {
    const view = render(<CoverImage src="https://lain.bgm.tv/cover.jpg" alt="待卸载封面" />)
    fireEvent.error(view.getByAltText('待卸载封面'))
    view.unmount()

    expect(() => act(() => vi.advanceTimersByTime(800))).not.toThrow()
  })
})
