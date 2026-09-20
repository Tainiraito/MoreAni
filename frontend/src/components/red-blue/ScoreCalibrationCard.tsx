import { ArrowDown, ArrowUp, LoaderCircle } from 'lucide-react'

import type { RedBlueScoreSuggestion, RedBlueSuggestionAction } from '@/types/red-blue'

interface ScoreCalibrationCardProps {
  suggestion: RedBlueScoreSuggestion
  disabled: boolean
  onAction: (action: RedBlueSuggestionAction) => void
}

function formatScore(score: number): string {
  return (score / 10).toFixed(1)
}

export function ScoreCalibrationCard({ suggestion, disabled, onAction }: ScoreCalibrationCardProps) {
  const DirectionIcon = suggestion.direction === 'UP' ? ArrowUp : ArrowDown

  return (
    <aside className="w-full self-center rounded-xl p-3" style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }} data-testid={`score-suggestion-${suggestion.id}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>评分校准</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <p style={{ color: 'var(--text-muted)' }}>当前</p>
          <p className="mt-1 font-semibold" style={{ color: 'var(--text-primary)' }}>{formatScore(suggestion.current_score)}</p>
        </div>
        <div>
          <p style={{ color: 'var(--text-muted)' }}>更接近</p>
          <p className="mt-1 font-semibold" style={{ color: 'var(--brand)' }}>
            {formatScore(suggestion.suggested_score_low)}–{formatScore(suggestion.suggested_score_high)}
          </p>
        </div>
        <div>
          <p style={{ color: 'var(--text-muted)' }}>置信度</p>
          <p className="mt-1 font-semibold" style={{ color: 'var(--text-primary)' }}>{Math.round(suggestion.confidence * 100)}%</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <DirectionIcon size={14} style={{ color: suggestion.direction === 'UP' ? 'var(--battle-red-text)' : 'var(--battle-blue-text)' }} />
        推荐调整为 <strong style={{ color: 'var(--text-primary)' }}>{formatScore(suggestion.recommended_score)}</strong>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAction('ACCEPTED')}
          className="inline-flex min-h-9 w-full items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold transition-opacity hover:opacity-85 disabled:opacity-50"
          style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
        >
          {disabled && <LoaderCircle size={13} className="animate-spin" />}
          确定
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAction('REJECTED')}
          className="inline-flex min-h-9 w-full items-center justify-center rounded-lg px-2 text-xs font-medium transition-colors hover:bg-[rgba(251,113,167,0.08)] disabled:opacity-50"
          style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-line)' }}
        >
          保持
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAction('DISMISSED')}
          className="inline-flex min-h-9 w-full items-center justify-center rounded-lg px-2 text-xs font-medium transition-colors hover:bg-[rgba(251,113,167,0.08)] disabled:opacity-50"
          style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-line)' }}
        >
          暂时忽略
        </button>
      </div>
    </aside>
  )
}
