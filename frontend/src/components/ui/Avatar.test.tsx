import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Avatar } from '@/components/ui/Avatar'

describe('Avatar', () => {
  it('没有裁剪参数时保持普通图片展示', () => {
    const { getByAltText } = render(<Avatar name="用户" src="/avatar.jpg" size={32} />)
    const image = getByAltText('用户')

    expect(image.tagName).toBe('IMG')
    expect(image).toHaveStyle({ width: '32px', height: '32px' })
  })

  it('按原图裁剪参数定位 GIF 或其他动画图片', () => {
    const { getByAltText, container } = render(
      <Avatar
        name="GIF 用户"
        src="/avatar.gif"
        crop={{ version: 1, x: 25, y: 10, size: 100 }}
        size={50}
      />,
    )
    const image = getByAltText('GIF 用户') as HTMLImageElement
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 200 })
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 150 })
    fireEvent.load(image)

    expect(container.querySelector('span')).toHaveStyle({ width: '50px', height: '50px' })
    expect(image).toHaveStyle({ width: '100px', height: '75px', left: '-12.5px', top: '-5px' })
  })
})
