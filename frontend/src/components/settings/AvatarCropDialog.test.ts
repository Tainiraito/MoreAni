import { describe, expect, it } from 'vitest'

import { calculateAvatarCrop } from '@/lib/avatar-crop'

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
