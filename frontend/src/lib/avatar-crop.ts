import type { AvatarCrop } from '@/types'

export const AVATAR_CROP_VIEW_SIZE = 320

export function calculateAvatarCrop(
  img: Pick<HTMLImageElement, 'naturalWidth' | 'naturalHeight'>,
  offset: { x: number; y: number },
  scale: number,
  viewSize = AVATAR_CROP_VIEW_SIZE,
): AvatarCrop {
  const baseScale = viewSize / Math.min(img.naturalWidth, img.naturalHeight)
  const px = baseScale * scale
  return {
    version: 1,
    x: (0 - offset.x) / px,
    y: (0 - offset.y) / px,
    size: viewSize / px,
  }
}
