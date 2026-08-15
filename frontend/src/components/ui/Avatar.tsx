interface AvatarProps {
  name: string
  size?: number
  className?: string
  style?: React.CSSProperties
}

/**
 * Text avatar — first character of the nickname on a solid brand-color circle.
 * Color uses var(--brand) so it adapts to light/dark theme automatically.
 */
export function Avatar({ name, size = 36, className = '', style }: AvatarProps) {
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
