import { useState, type MouseEvent } from 'react'
import { Star } from 'lucide-react'

interface StarRatingProps {
  value: number
  onChange: (score: number) => void
  ariaLabel: string
  size?: number
}

/** 十分制、半分刻度的星级评分输入，与详情弹窗共用。 */
export function StarRating({ value, onChange, ariaLabel, size = 24 }: StarRatingProps) {
  const [hoverScore, setHoverScore] = useState(0)
  const displayScore = hoverScore || value

  const getPointerScore = (event: MouseEvent<HTMLButtonElement>, index: number): number => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return event.clientX - bounds.left < bounds.width / 2 ? index - 0.5 : index
  }

  return (
    <div className="flex shrink-0 items-center gap-1 whitespace-nowrap" role="group" aria-label={ariaLabel}>
      {Array.from({ length: 10 }, (_, offset) => {
        const index = offset + 1
        const isFull = displayScore >= index
        const isHalf = !isFull && displayScore >= index - 0.5
        return (
          <button
            key={index}
            type="button"
            aria-label={`${ariaLabel} ${index - 0.5} 至 ${index} 分`}
            className="relative shrink-0 transition-transform duration-150 hover:scale-125"
            style={{ cursor: 'pointer' }}
            onMouseMove={event => setHoverScore(getPointerScore(event, index))}
            onMouseLeave={() => setHoverScore(0)}
            onClick={event => {
              const nextScore = getPointerScore(event, index)
              onChange(value === nextScore ? 0 : nextScore)
            }}
          >
            <Star size={size} style={{ color: 'var(--border-line)', fill: 'transparent' }} />
            {(isFull || isHalf) && (
              <div className="absolute inset-0 overflow-hidden" style={{ width: isHalf ? '50%' : '100%' }}>
                <Star size={size} style={{ color: 'var(--brand)', fill: 'var(--brand)' }} />
              </div>
            )}
          </button>
        )
      })}
      {displayScore > 0 && (
        <span className="ml-2 shrink-0 text-sm font-medium" style={{ color: 'var(--brand)' }}>
          {displayScore.toFixed(1)}
        </span>
      )}
    </div>
  )
}
