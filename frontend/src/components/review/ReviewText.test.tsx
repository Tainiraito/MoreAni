import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ReviewText } from '@/components/review/ReviewText'

describe('ReviewText', () => {
  it('renders supported formats as safe React elements', () => {
    const { container } = render(<ReviewText text="*斜体* **加粗** __下划线__ ~~删除线~~" />)

    expect(container.querySelector('.italic')).toHaveTextContent('斜体')
    expect(container.querySelector('.font-semibold')).toHaveTextContent('加粗')
    expect(container.querySelector('.underline')).toHaveTextContent('下划线')
    expect(container.querySelector('.line-through')).toHaveTextContent('删除线')
    expect(container.textContent).toBe('斜体 加粗 下划线 删除线')
  })

  it('renders inline spoilers as black hover-reveal spans', () => {
    const { container } = render(<ReviewText text="公开 ||防剧透||" />)
    const spoiler = container.querySelector('[tabindex="0"]')

    expect(spoiler).toHaveTextContent('防剧透')
    expect(spoiler).toHaveClass('bg-black', 'text-black', 'hover:text-white', 'focus:text-white')
    expect(spoiler).toHaveAttribute('aria-label', '防剧透内容')
    expect(spoiler).not.toHaveAttribute('title')
  })

  it('can disable inline spoiler focus behavior for the live editor preview', () => {
    const { container } = render(<ReviewText text="||防剧透||" interactiveInlineSpoilers={false} />)

    expect(container.querySelector('[tabindex="0"]')).not.toBeInTheDocument()
  })
})
