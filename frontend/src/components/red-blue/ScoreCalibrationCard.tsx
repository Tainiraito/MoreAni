import { ArrowDown, ArrowUp, ChevronDown, CircleHelp, LoaderCircle } from 'lucide-react'
import { useState } from 'react'

import type { RedBlueScoreSuggestion, RedBlueSuggestionAction } from '@/types/red-blue'

interface ScoreCalibrationCardProps {
  suggestion: RedBlueScoreSuggestion
  disabled: boolean
  onAction: (action: RedBlueSuggestionAction) => void
}

function formatScore(score: number): string {
  return (score / 10).toFixed(1)
}

function reasonText(reasonCode: string): string {
  if (reasonCode === 'PREFERENCE_HIGHER_THAN_SCORE') {
    return '你的相对偏好明显高于当前评分，更接近你通常给出更高评分的作品。'
  }
  if (reasonCode === 'PREFERENCE_LOWER_THAN_SCORE') {
    return '你的相对偏好低于当前评分，更接近你通常给出较低评分的作品。'
  }
  return '这部作品的相对偏好与当前评分出现了明显偏差。'
}

export function ScoreCalibrationCard({ suggestion, disabled, onAction }: ScoreCalibrationCardProps) {
  const [explanationOpen, setExplanationOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const DirectionIcon = suggestion.direction === 'UP' ? ArrowUp : ArrowDown

  return (
    <aside className="rounded-xl p-3" style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }} data-testid={`score-suggestion-${suggestion.id}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>评分校准</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs transition-opacity hover:opacity-75"
          style={{ color: 'var(--text-muted)' }}
          onClick={() => setExplanationOpen(value => !value)}
          aria-expanded={explanationOpen}
        >
          <CircleHelp size={13} /> 为什么？
        </button>
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
      {explanationOpen && (
        <p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>{reasonText(suggestion.reason_code)}</p>
      )}
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAction('ACCEPTED')}
          className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold transition-opacity hover:opacity-85 disabled:opacity-50"
          style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
        >
          {disabled && <LoaderCircle size={13} className="animate-spin" />}
          调整为 {formatScore(suggestion.recommended_score)}
        </button>
        <div className="relative">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setMenuOpen(value => !value)}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors hover:bg-[rgba(251,113,167,0.08)] disabled:opacity-50"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-line)' }}
            aria-expanded={menuOpen}
          >
            保持当前评分 <ChevronDown size={13} />
          </button>
          {menuOpen && !disabled && (
            <div className="absolute right-0 bottom-full z-10 mb-2 w-36 overflow-hidden rounded-lg p-1" data-red-blue-shortcut-block="true" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', boxShadow: 'var(--shadow-popup)' }}>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onAction('DISMISSED') }}
                className="block w-full rounded-md px-2 py-2 text-left text-xs hover:bg-[rgba(251,113,167,0.08)]"
                style={{ color: 'var(--text-primary)' }}
              >
                暂时忽略
              </button>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onAction('REJECTED') }}
                className="block w-full rounded-md px-2 py-2 text-left text-xs hover:bg-[rgba(251,113,167,0.08)]"
                style={{ color: 'var(--text-primary)' }}
              >
                保持当前评分
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
