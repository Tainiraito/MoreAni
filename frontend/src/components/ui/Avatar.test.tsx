import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Avatar } from '@/components/ui/Avatar'

describe('Avatar', () => {
  afterEach(cleanup)

  it('没有裁剪参数时保持普通图片展示', () => {
    const { getByAltText } = render(<Avatar name="用户" src="/avatar.jpg" size={32} />)
    const image = getByAltText('用户')

    expect(image.tagName).toBe('IMG')
    expect(image).toHaveStyle({ width: '100%', height: '100%', objectFit: 'cover' })
    expect(image.parentElement).toHaveAttribute('data-testid', 'avatar-frame')
    expect(image.parentElement?.parentElement).toHaveStyle({ width: '32px', height: '32px', boxSizing: 'border-box' })
  })

  it.each([24, 32, 40, 64])('在 %dpx 尺寸下按原图裁剪参数定位 GIF', size => {
    const { getByAltText, getByTestId } = render(
      <Avatar
        name="GIF 用户"
        src="/avatar.gif"
        crop={{ version: 1, x: 25, y: 10, size: 100 }}
        size={size}
      />,
    )
    const image = getByAltText('GIF 用户') as HTMLImageElement
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 200 })
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 150 })
    fireEvent.load(image)

    const fit = size / 100
    expect(getByTestId('avatar-root')).toHaveStyle({ width: `${size}px`, height: `${size}px` })
    expect(image).toHaveStyle({
      width: `${200 * fit}px`,
      height: `${150 * fit}px`,
      left: `${-25 * fit}px`,
      top: `${-10 * fit}px`,
    })
  })

  it('带边框时按内部圆形区域计算裁剪缩放', () => {
    const { getByAltText, getByTestId } = render(
      <Avatar
        name="带边框 GIF"
        src="/avatar.gif"
        crop={{ version: 1, x: 25, y: 10, size: 100 }}
        size={64}
        style={{ border: '2px solid var(--brand)' }}
      />,
    )
    const frame = getByTestId('avatar-frame')
    Object.defineProperty(frame, 'clientWidth', { configurable: true, value: 60 })
    Object.defineProperty(frame, 'clientHeight', { configurable: true, value: 60 })
    const image = getByAltText('带边框 GIF') as HTMLImageElement
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 200 })
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 150 })
    fireEvent.load(image)

    expect(image).toHaveStyle({ width: '120px', height: '90px', left: '-15px', top: '-6px' })
  })

  it('图片加载完成前隐藏未定位的裁剪图像', () => {
    const { getByAltText } = render(
      <Avatar
        name="加载中的 GIF"
        src="/avatar.gif"
        crop={{ version: 1, x: 25, y: 10, size: 100 }}
        size={32}
      />,
    )

    expect(getByAltText('加载中的 GIF')).toHaveStyle({ visibility: 'hidden' })
  })

  it('图片已缓存时仍能从 natural 尺寸同步完成裁剪定位', () => {
    const { getByAltText, rerender } = render(
      <Avatar
        name="缓存 GIF"
        src="/cached.gif"
        crop={{ version: 1, x: 25, y: 10, size: 100 }}
        size={32}
      />,
    )
    const image = getByAltText('缓存 GIF') as HTMLImageElement
    Object.defineProperty(image, 'complete', { configurable: true, value: true })
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 200 })
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 150 })

    rerender(
      <Avatar
        name="缓存 GIF"
        src="/cached.gif"
        crop={{ version: 1, x: 25, y: 10, size: 100 }}
        size={33}
      />,
    )

    expect(getByAltText('缓存 GIF')).toHaveStyle({ visibility: 'visible', position: 'absolute' })
  })

  it('裁剪区域越界时回退到居中裁剪', () => {
    const { getByAltText } = render(
      <Avatar
        name="越界 GIF"
        src="/avatar.gif"
        crop={{ version: 1, x: 90, y: 10, size: 100 }}
        size={32}
      />,
    )
    const image = getByAltText('越界 GIF') as HTMLImageElement
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 150 })
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 150 })
    fireEvent.load(image)

    expect(image).toHaveStyle({ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' })
    expect(image).not.toHaveStyle({ position: 'absolute' })
  })

  it('切换图片后不会复用旧图片的裁剪定位', () => {
    const { getByAltText, rerender } = render(
      <Avatar
        name="旧 GIF"
        src="/old.gif"
        crop={{ version: 1, x: 25, y: 10, size: 100 }}
        size={32}
      />,
    )
    const oldImage = getByAltText('旧 GIF') as HTMLImageElement
    Object.defineProperty(oldImage, 'naturalWidth', { configurable: true, value: 200 })
    Object.defineProperty(oldImage, 'naturalHeight', { configurable: true, value: 150 })
    fireEvent.load(oldImage)

    rerender(
      <Avatar
        name="新 GIF"
        src="/new.gif"
        crop={{ version: 1, x: 0, y: 0, size: 100 }}
        size={32}
      />,
    )

    expect(getByAltText('新 GIF')).toHaveStyle({ visibility: 'hidden' })
  })
})
