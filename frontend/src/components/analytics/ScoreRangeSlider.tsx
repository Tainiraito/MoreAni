import { useRef, useState } from 'react'
import type { PointerEvent } from 'react'

const MIN_SCORE = 0.5
const MAX_SCORE = 10
const SCORE_STEP = 0.5

export interface ScoreRange {
  min: number
  max: number
}

interface ScoreRangeSliderProps {
  value: ScoreRange
  onChange: (value: ScoreRange) => void
}

function scorePercent(score: number): number {
  return ((score - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)) * 100
}

export function ScoreRangeSlider({ value, onChange }: ScoreRangeSliderProps) {
  const [activeHandle, setActiveHandle] = useState<'min' | 'max'>('max')
  const [focusedHandle, setFocusedHandle] = useState<'min' | 'max' | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragHandleRef = useRef<'min' | 'max' | 'both' | null>(null)
  const minPercent = scorePercent(value.min)
  const maxPercent = scorePercent(value.max)

  const updateMin = (nextValue: number): void => {
    setActiveHandle('min')
    onChange({ min: Math.min(nextValue, value.max), max: value.max })
  }

  const updateMax = (nextValue: number): void => {
    setActiveHandle('max')
    onChange({ min: value.min, max: Math.max(nextValue, value.min) })
  }

  const scoreFromPointer = (clientX: number): number => {
    const track = trackRef.current
    if (!track) return value.min
    const bounds = track.getBoundingClientRect()
    if (bounds.width <= 0) return value.min
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width))
    const stepIndex = Math.round((ratio * (MAX_SCORE - MIN_SCORE)) / SCORE_STEP)
    return MIN_SCORE + stepIndex * SCORE_STEP
  }

  const updateFromPointer = (clientX: number): void => {
    const nextScore = scoreFromPointer(clientX)
    const dragHandle = dragHandleRef.current
    if (dragHandle === 'both') {
      if (nextScore < value.min) {
        dragHandleRef.current = 'min'
        updateMin(nextScore)
      } else if (nextScore > value.max) {
        dragHandleRef.current = 'max'
        updateMax(nextScore)
      }
      return
    }
    if (dragHandle === 'min') updateMin(nextScore)
    if (dragHandle === 'max') updateMax(nextScore)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const nextScore = scoreFromPointer(event.clientX)
    if (value.min === value.max && nextScore === value.min) {
      dragHandleRef.current = 'both'
    } else {
      const minDistance = Math.abs(nextScore - value.min)
      const maxDistance = Math.abs(nextScore - value.max)
      const nextHandle = minDistance <= maxDistance ? 'min' : 'max'
      dragHandleRef.current = nextHandle
      setActiveHandle(nextHandle)
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    updateFromPointer(event.clientX)
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    dragHandleRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div className="space-y-3" data-testid="score-range-slider">
      <div className="flex items-center justify-between gap-4 text-sm">
        <span style={{ color: 'var(--text-secondary)' }}>评分区间</span>
        <output className="font-semibold tabular-nums" style={{ color: 'var(--brand)' }}>
          {value.min.toFixed(1)} – {value.max.toFixed(1)}
        </output>
      </div>

      <div
        ref={trackRef}
        className="relative flex h-8 touch-none items-center"
        data-testid="score-range-track"
        onPointerDown={handlePointerDown}
        onPointerMove={event => {
          if (dragHandleRef.current) updateFromPointer(event.clientX)
        }}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className="absolute left-0 right-0 h-1.5 rounded-full"
          style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }}
          aria-hidden="true"
        />
        <span
          className="pointer-events-none absolute h-[18px] w-[18px] rounded-full border-2"
          style={{
            left: `${minPercent}%`,
            zIndex: activeHandle === 'min' ? 6 : 5,
            transform: 'translateX(-50%)',
            background: 'var(--brand)',
            borderColor: 'var(--bg-card)',
            boxShadow: focusedHandle === 'min'
              ? '0 0 0 3px rgba(251, 113, 167, 0.2), 0 0 16px rgba(251, 113, 167, 0.45)'
              : '0 0 0 1px var(--brand), 0 0 12px rgba(251, 113, 167, 0.35)',
          }}
          aria-hidden="true"
        />
        <span
          className="pointer-events-none absolute h-[18px] w-[18px] rounded-full border-2"
          style={{
            left: `${maxPercent}%`,
            zIndex: activeHandle === 'max' ? 6 : 5,
            transform: 'translateX(-50%)',
            background: 'var(--brand)',
            borderColor: 'var(--bg-card)',
            boxShadow: focusedHandle === 'max'
              ? '0 0 0 3px rgba(251, 113, 167, 0.2), 0 0 16px rgba(251, 113, 167, 0.45)'
              : '0 0 0 1px var(--brand), 0 0 12px rgba(251, 113, 167, 0.35)',
          }}
          aria-hidden="true"
        />
        <div
          className="absolute h-1.5 rounded-full"
          style={{
            left: `${minPercent}%`,
            right: `${100 - maxPercent}%`,
            background: 'var(--btn-primary-bg)',
            boxShadow: '0 0 10px rgba(251, 113, 167, 0.25)',
          }}
          aria-hidden="true"
        />
        <input
          className="analytics-range-input"
          type="range"
          min={MIN_SCORE}
          max={MAX_SCORE}
          step={SCORE_STEP}
          value={value.min}
          aria-label="最低评分"
          onPointerDown={() => setActiveHandle('min')}
          onFocus={() => {
            setActiveHandle('min')
            setFocusedHandle('min')
          }}
          onBlur={() => setFocusedHandle(null)}
          onChange={event => updateMin(Number(event.target.value))}
          style={{ zIndex: activeHandle === 'min' ? 4 : 3 }}
        />
        <input
          className="analytics-range-input"
          type="range"
          min={MIN_SCORE}
          max={MAX_SCORE}
          step={SCORE_STEP}
          value={value.max}
          aria-label="最高评分"
          onPointerDown={() => setActiveHandle('max')}
          onFocus={() => {
            setActiveHandle('max')
            setFocusedHandle('max')
          }}
          onBlur={() => setFocusedHandle(null)}
          onChange={event => updateMax(Number(event.target.value))}
          style={{ zIndex: activeHandle === 'max' ? 4 : 3 }}
        />
      </div>

      <div className="flex justify-between text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
        <span>{MIN_SCORE.toFixed(1)}</span>
        <span>{MAX_SCORE.toFixed(1)}</span>
      </div>
    </div>
  )
}
