import { render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AvatarCropDialog } from '@/components/settings/AvatarCropDialog'
import { calculateAvatarCrop } from '@/lib/avatar-crop'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('calculateAvatarCrop', () => {
  it('将预览窗口位置换算为原图像素裁剪区域', () => {
    expect(calculateAvatarCrop(
      { naturalWidth: 640, naturalHeight: 480 },
      { x: -40, y: -20 },
      2,
      320,
    )).toEqual({ version: 1, x: 30, y: 15, size: 240 })
  })
})

describe('AvatarCropDialog', () => {
  it('用圆形遮罩预览最终头像显示区域', () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:avatar'),
      revokeObjectURL: vi.fn(),
    })

    const { getByTestId } = render(createElement(AvatarCropDialog, {
      file: new File(['GIF89a'], 'avatar.gif', { type: 'image/gif' }),
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    }))

    const mask = getByTestId('avatar-crop-mask')
    expect(mask).toHaveClass('rounded-full')
    expect(mask.getAttribute('style')).toContain('border: 2px solid var(--brand)')
    expect(mask.getAttribute('style')).toContain('box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.62)')
  })
})
