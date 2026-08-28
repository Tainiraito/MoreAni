import { useState } from 'react'

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
  const minPercent = scorePercent(value.min)
  const maxPercent = scorePercent(value.max)

  const updateMin = (nextValue: number): void => {
    setActiveHandle('min')
    onChange({ min: Math.min(nextValue, value.max - SCORE_STEP), max: value.max })
  }

  const updateMax = (nextValue: number): void => {
    setActiveHandle('max')
    onChange({ min: value.min, max: Math.max(nextValue, value.min + SCORE_STEP) })
  }

  return (
    <div className="space-y-3" data-testid="score-range-slider">
      <div className="flex items-center justify-between gap-4 text-sm">
        <span style={{ color: 'var(--text-secondary)' }}>评分区间</span>
        <output className="font-semibold tabular-nums" style={{ color: 'var(--brand)' }}>
          {value.min.toFixed(1)} – {value.max.toFixed(1)}
        </output>
      </div>

      <div className="relative flex h-8 touch-none items-center">
        <div
          className="absolute left-0 right-0 h-1.5 rounded-full"
          style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }}
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
