import { Swords } from 'lucide-react'

import { BattleAnimeCard } from '@/components/red-blue/BattleAnimeCard'
import { BattleActions } from '@/components/red-blue/BattleActions'
import { BATTLE_PAIR_GRID_CLASS_NAME } from '@/components/red-blue/battle-layout'
import type { RedBlueOutcome, RedBluePair } from '@/types/red-blue'

interface BattlePairProps {
  pair: RedBluePair | null
  disabled: boolean
  selectedOutcome: RedBlueOutcome | null
  onChoose: (outcome: RedBlueOutcome) => void
  onOpenContent: (contentId: number) => void
}

export function BattlePair({ pair, disabled, selectedOutcome, onChoose, onOpenContent }: BattlePairProps) {
  if (pair === null) {
    return (
      <section className="rounded-2xl p-6 sm:p-8" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }} data-testid="battle-pair-empty">
        <div className="flex min-h-36 flex-col items-center justify-center text-center">
          <Swords size={24} style={{ color: 'var(--brand)' }} />
          <p className="mt-3 font-medium" style={{ color: 'var(--text-primary)' }}>暂时没有下一组作品</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>排名仍会保留在下方，稍后可以继续回来比较。</p>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-2xl p-3 sm:p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }} data-testid="battle-pair">
      <div className={`${BATTLE_PAIR_GRID_CLASS_NAME} items-center`}>
        <BattleAnimeCard content={pair.left} side="red" onOpen={() => onOpenContent(pair.left.content_id)} />
        <div className="flex flex-col items-center gap-1 px-0.5 sm:px-2" aria-hidden="true">
          <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: 'rgba(251,113,167,0.1)', border: '1px solid var(--border-line)' }}>
            <Swords size={18} style={{ color: 'var(--brand)' }} />
          </span>
          <span className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--text-secondary)' }}>VS</span>
        </div>
        <BattleAnimeCard content={pair.right} side="blue" onOpen={() => onOpenContent(pair.right.content_id)} />
      </div>

      <div className="mt-4">
        <BattleActions
          disabled={disabled}
          selectedOutcome={selectedOutcome}
          onChoose={onChoose}
        />
      </div>
    </section>
  )
}
