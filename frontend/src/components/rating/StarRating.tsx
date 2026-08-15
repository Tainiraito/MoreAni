import { useState } from 'react'
import { cn } from '@/lib/utils'

interface StarRatingProps {
  value: number
  onChange?: (value: number) => void
  readonly?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export function StarRating({ value, onChange, readonly = false, size = 'md' }: StarRatingProps) {
  const [hover, setHover] = useState(0)
  const display = hover || value
  const stars = Array.from({ length: 10 }, (_, i) => {
    const starValue = (i + 1) * 10
    const filled = display >= starValue
    const halfFilled = !filled && display >= starValue - 5
    return { index: i, filled, halfFilled, value: starValue }
  })

  const sizeMap = { sm: 'text-lg', md: 'text-xl', lg: 'text-2xl' }

  return (
    <div className={cn('inline-flex items-center gap-0.5', readonly ? '' : 'cursor-pointer')}>
      {stars.map(star => (
        <button
          key={star.index}
          type="button"
          disabled={readonly}
          className={cn(
            sizeMap[size],
            'transition-all duration-100',
            readonly ? 'cursor-default' : 'hover:scale-110',
            star.filled ? 'text-brand' : star.halfFilled ? 'text-brand-light' : 'text-black/[0.12]'
          )}
          onMouseEnter={() => !readonly && setHover(star.value)}
          onMouseLeave={() => !readonly && setHover(0)}
          onClick={() => !readonly && onChange?.(star.value === value ? 0 : star.value)}
        >
          {star.filled ? '★' : star.halfFilled ? '★' : '☆'}
        </button>
      ))}
    </div>
  )
}
