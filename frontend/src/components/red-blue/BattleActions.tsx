import { Heart, Minus, SkipForward, type LucideIcon } from 'lucide-react'

import { BATTLE_PAIR_GRID_CLASS_NAME } from '@/components/red-blue/battle-layout'
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
  const renderAction = ({ outcome, label, compactLabel, icon: Icon, tone }: BattleActionDefinition, placementClassName = '') => {
    const selected = selectedOutcome === outcome
    const primary = outcome === 'LEFT_WIN' || outcome === 'RIGHT_WIN'
    const skip = outcome === 'SKIP'
    return (
      <button
        key={outcome}
        type="button"
        disabled={disabled}
        onClick={() => onChoose(outcome)}
        className={`inline-flex min-h-11 items-center justify-center rounded-xl transition-all duration-150 hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-55 ${compact ? 'gap-1.5 px-2 text-xs font-semibold' : primary ? 'w-full gap-2 px-3 text-sm font-bold' : skip ? 'w-full gap-1 px-1 text-xs font-medium' : 'w-full gap-1 px-1 text-xs font-semibold'} ${placementClassName}`}
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
  }

  if (compact) {
    return <div className="grid grid-cols-4 gap-1.5">{ACTIONS.map(action => renderAction(action))}</div>
  }

  return (
    <div
      className={BATTLE_PAIR_GRID_CLASS_NAME}
      data-testid={`${testIdPrefix}-primary-actions`}
    >
      {renderAction(ACTIONS[0], 'row-span-2')}
      {renderAction(ACTIONS[3], 'col-start-2 row-start-1')}
      {renderAction(ACTIONS[1], 'col-start-2 row-start-2')}
      {renderAction(ACTIONS[2], 'col-start-3 row-span-2')}
    </div>
  )
}
