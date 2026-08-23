import { useLayoutEffect, useRef, useState } from 'react'
import type { AvatarCrop } from '@/types'

interface AvatarProps {
  name: string
  src?: string | null
  crop?: AvatarCrop | null
  size?: number
  className?: string
  style?: React.CSSProperties
}

interface NaturalSize {
  width: number
  height: number
}

function InitialAvatar({ name, size, className, style }: Omit<AvatarProps, 'src' | 'crop'>) {
  const firstChar = (name || '?').charAt(0).toUpperCase()
  return (
    <div
      className={`rounded-full flex items-center justify-center shrink-0 ${className || ''}`}
      style={{
        width: size,
        height: size,
        background: 'var(--brand)',
        color: '#fff',
        fontSize: Math.round((size || 36) * 0.45),
        fontWeight: 600,
        lineHeight: 1,
        userSelect: 'none',
        ...style,
      }}
    >
      {firstChar}
    </div>
  )
}

function cropShapeIsValid(crop: AvatarCrop | null | undefined): crop is AvatarCrop {
  return Boolean(
    crop
      && crop.version === 1
      && Number.isFinite(crop.x)
      && Number.isFinite(crop.y)
      && Number.isFinite(crop.size)
      && crop.x >= 0
      && crop.y >= 0
      && crop.size > 0,
  )
}

function cropFitsImage(crop: AvatarCrop, naturalSize: NaturalSize): boolean {
  return crop.x + crop.size <= naturalSize.width
    && crop.y + crop.size <= naturalSize.height
}

/** Avatar — all image formats share one circular frame; GIFs use the persisted source crop. */
export function Avatar({ name, src, crop, size = 36, className = '', style }: AvatarProps) {
  const avatarSize = Math.max(1, size)
  const frameRef = useRef<HTMLSpanElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const imageKey = `${src || ''}|${crop?.version ?? ''}|${crop?.x ?? ''}|${crop?.y ?? ''}|${crop?.size ?? ''}`
  const [frameSize, setFrameSize] = useState(avatarSize)
  const [naturalSize, setNaturalSize] = useState<NaturalSize | null>(null)
  const [loadedImageKey, setLoadedImageKey] = useState<string | null>(null)
  const [imageError, setImageError] = useState(false)

  useLayoutEffect(() => {
    const frame = frameRef.current
    const updateFrameSize = () => {
      if (!frame) return
      const measured = Math.min(frame.clientWidth, frame.clientHeight)
      setFrameSize(measured > 0 ? measured : avatarSize)
    }

    updateFrameSize()
    if (typeof ResizeObserver === 'undefined' || !frame) return
    const observer = new ResizeObserver(updateFrameSize)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [avatarSize])

  useLayoutEffect(() => {
    setFrameSize(avatarSize)
    setNaturalSize(null)
    setLoadedImageKey(null)
    setImageError(false)
    const frame = frameRef.current
    if (frame) {
      const measured = Math.min(frame.clientWidth, frame.clientHeight)
      if (measured > 0) setFrameSize(measured)
    }
    const image = imageRef.current
    if (image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight })
      setLoadedImageKey(imageKey)
    }
  }, [avatarSize, imageKey])

  if (!src || imageError) {
    return <InitialAvatar name={name} size={avatarSize} className={className} style={style} />
  }

  const hasCrop = cropShapeIsValid(crop)
  const imageLoaded = loadedImageKey === imageKey && naturalSize !== null
  const preciseCrop = hasCrop && imageLoaded && naturalSize && cropFitsImage(crop, naturalSize)
  const fit = preciseCrop ? frameSize / crop.size : 1
  const imageStyle: React.CSSProperties = preciseCrop
    ? {
        position: 'absolute',
        left: -crop.x * fit,
        top: -crop.y * fit,
        width: naturalSize.width * fit,
        height: naturalSize.height * fit,
        maxWidth: 'none',
        display: 'block',
      }
    : {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        objectPosition: 'center',
        display: 'block',
        visibility: hasCrop && !imageLoaded ? 'hidden' : 'visible',
      }

  return (
    <span
      data-testid="avatar-root"
      className={`relative inline-block shrink-0 rounded-full ${className}`}
      style={{ ...style, width: avatarSize, height: avatarSize, boxSizing: 'border-box' }}
    >
      <span
        ref={frameRef}
        data-testid="avatar-frame"
        className="absolute inset-0 overflow-hidden rounded-full"
        style={{ background: 'var(--bg-card-warm)' }}
      >
        <img
          ref={imageRef}
          src={src}
          alt={name}
          draggable={false}
          style={imageStyle}
          onLoad={event => {
            const width = event.currentTarget.naturalWidth
            const height = event.currentTarget.naturalHeight
            if (width > 0 && height > 0) {
              const frame = frameRef.current
              if (frame) {
                const measured = Math.min(frame.clientWidth, frame.clientHeight)
                if (measured > 0) setFrameSize(measured)
              }
              setNaturalSize({ width, height })
              setLoadedImageKey(imageKey)
            }
          }}
          onError={() => setImageError(true)}
        />
      </span>
    </span>
  )
}
