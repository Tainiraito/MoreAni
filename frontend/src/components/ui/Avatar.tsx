interface AvatarProps {
  name: string
  src?: string | null
  size?: number
  className?: string
  style?: React.CSSProperties
}

/**
 * Avatar — shows uploaded image if available, otherwise text avatar
 * (first character of the nickname on a solid brand-color circle).
 */
export function Avatar({ name, src, size = 36, className = '', style }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={{ width: size, height: size, ...style }}
        onError={e => {
          // 图片加载失败 → 回退文字头像
          e.currentTarget.style.display = 'none'
        }}
      />
    )
  }
  const firstChar = (name || '?').charAt(0).toUpperCase()
  return (
    <div
      className={`rounded-full flex items-center justify-center shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        background: 'var(--brand)',
        color: '#fff',
        fontSize: Math.round(size * 0.45),
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
