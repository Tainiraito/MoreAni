import { useEffect, useState } from 'react'
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

/** Avatar — static images use object-cover; GIFs use the persisted source crop. */
export function Avatar({ name, src, crop, size = 36, className = '', style }: AvatarProps) {
  const [naturalSize, setNaturalSize] = useState<NaturalSize | null>(null)
  const [imageError, setImageError] = useState(false)
  const validCrop = crop && Number.isFinite(crop.x) && Number.isFinite(crop.y)
    && Number.isFinite(crop.size) && crop.x >= 0 && crop.y >= 0 && crop.size > 0

  useEffect(() => {
    setNaturalSize(null)
    setImageError(false)
  }, [src, crop?.version, crop?.x, crop?.y, crop?.size])

  if (!src || imageError) {
    return <InitialAvatar name={name} size={size} className={className} style={style} />
  }

  if (validCrop) {
    const fit = naturalSize ? size / crop.size : 1
    const imageStyle: React.CSSProperties = naturalSize
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
          display: 'block',
        }

    return (
      <span
        className={`relative overflow-hidden rounded-full shrink-0 block ${className}`}
        style={{ width: size, height: size, ...style }}
      >
        <img
          src={src}
          alt={name}
          draggable={false}
          style={imageStyle}
          onLoad={event => setNaturalSize({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })}
          onError={() => setImageError(true)}
        />
      </span>
    )
  }

  return (
    <img
      src={src}
      alt={name}
      className={`rounded-full object-cover shrink-0 ${className}`}
      style={{ width: size, height: size, ...style }}
      onError={() => setImageError(true)}
    />
  )
}
