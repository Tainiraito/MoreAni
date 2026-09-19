import { Heart, Minus, SkipForward, type LucideIcon } from 'lucide-react'

import type { RedBlueOutcome } from '@/types/red-blue'

export interface BattleActionsProps {
  disabled: boolean
  selectedOutcome: RedBlueOutcome | null
  onChoose: (outcome: RedBlueOutcome) => void
  compact?: boolean
  testIdPrefix?: string
}

interface BattleActionDefinition {
  outcome: RedBlueOutcome
  label: string
  compactLabel: string
  icon: LucideIcon
  tone: 'red' | 'blue' | 'neutral'
}

const ACTIONS: BattleActionDefinition[] = [
  { outcome: 'LEFT_WIN', label: '更喜欢红方', compactLabel: '红方', icon: Heart, tone: 'red' },
  { outcome: 'TIE', label: '差不多', compactLabel: '≈', icon: Minus, tone: 'neutral' },
  { outcome: 'RIGHT_WIN', label: '更喜欢蓝方', compactLabel: '蓝方', icon: Heart, tone: 'blue' },
  { outcome: 'SKIP', label: '跳过', compactLabel: '跳过', icon: SkipForward, tone: 'neutral' },
]

function actionStyle(
  tone: BattleActionDefinition['tone'],
  selected: boolean,
): { background: string; border: string; color: string } {
  if (tone === 'red') {
    return {
      background: selected ? 'var(--battle-red)' : 'var(--battle-red-soft)',
      border: `1px solid ${selected ? 'var(--battle-red)' : 'var(--battle-red-border)'}`,
      color: selected ? '#fff' : 'var(--battle-red-text)',
    }
  }
  if (tone === 'blue') {
    return {
      background: selected ? 'var(--battle-blue)' : 'var(--battle-blue-soft)',
      border: `1px solid ${selected ? 'var(--battle-blue)' : 'var(--battle-blue-border)'}`,
      color: selected ? '#fff' : 'var(--battle-blue-text)',
    }
  }
  return {
    background: selected ? 'var(--bg-card-warm)' : 'transparent',
    border: '1px solid var(--border-line)',
    color: 'var(--text-secondary)',
  }
}

export function BattleActions({
  disabled,
  selectedOutcome,
  onChoose,
  compact = false,
  testIdPrefix = 'battle',
}: BattleActionsProps) {
  return (
    <div className={compact ? 'grid grid-cols-4 gap-1.5' : 'grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,0.8fr)_minmax(0,1.25fr)_minmax(0,0.7fr)]'}>
      {ACTIONS.map(({ outcome, label, compactLabel, icon: Icon, tone }) => {
        const selected = selectedOutcome === outcome
        const primary = outcome === 'LEFT_WIN' || outcome === 'RIGHT_WIN'
        const skip = outcome === 'SKIP'
        return (
          <button
            key={outcome}
            type="button"
            disabled={disabled}
            onClick={() => onChoose(outcome)}
            className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 transition-all duration-150 hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-55 ${compact ? 'text-xs font-semibold' : primary ? 'gap-2 px-3 text-sm font-bold' : skip ? 'px-3 text-xs font-medium' : 'px-3 text-sm font-semibold'}`}
            style={{
              ...actionStyle(tone, selected),
              boxShadow: primary && !selected
                ? `0 6px 18px color-mix(in srgb, ${tone === 'red' ? 'var(--battle-red)' : 'var(--battle-blue)'} 12%, transparent)`
                : 'none',
            }}
            aria-label={label}
            aria-pressed={selected}
            data-testid={`${testIdPrefix}-action-${outcome.toLowerCase()}`}
          >
            <Icon size={compact ? 14 : 16} fill={primary ? 'currentColor' : 'none'} />
            <span>{compact ? compactLabel : label}</span>
          </button>
        )
      })}
    </div>
  )
}
