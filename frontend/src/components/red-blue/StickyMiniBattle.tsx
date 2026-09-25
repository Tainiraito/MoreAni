import { Swords } from 'lucide-react'

import { BattleActions } from '@/components/red-blue/BattleActions'
import { CoverImage } from '@/components/ui/CoverImage'
import { PageContainer } from '@/components/layout/PageContainer'
import type { RedBlueOutcome, RedBluePair } from '@/types/red-blue'

interface StickyMiniBattleProps {
  pair: RedBluePair
  disabled: boolean
  selectedOutcome: RedBlueOutcome | null
  onChoose: (outcome: RedBlueOutcome) => void
  onOpenContent: (contentId: number) => void
}

interface MiniBattleCardProps {
  title: string
  coverUrl: string | null
  contentId: number
  side: 'red' | 'blue'
  onOpenContent: (contentId: number) => void
}

function MiniBattleCard({ title, coverUrl, contentId, side, onOpenContent }: MiniBattleCardProps) {
  const accent = side === 'red' ? 'var(--battle-red)' : 'var(--battle-blue)'
  return (
    <button
      type="button"
      onClick={() => onOpenContent(contentId)}
      className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-[rgba(251,113,167,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      aria-label={`查看《${title}》详情`}
      data-testid={`sticky-battle-card-${side}`}
      data-content-id={contentId}
    >
      <span className="h-10 w-7 shrink-0 overflow-hidden rounded" style={{ background: 'var(--bg-card-warm)', border: `1px solid ${accent}` }}>
        <CoverImage src={coverUrl ?? ''} alt="" loading="eager" />
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] font-semibold" style={{ color: accent }}>{side === 'red' ? '红方' : '蓝方'}</span>
        <span className="block truncate text-xs font-semibold" style={{ color: 'var(--text-primary)' }} title={title}>{title}</span>
      </span>
    </button>
  )
}

export function StickyMiniBattle({ pair, disabled, selectedOutcome, onChoose, onOpenContent }: StickyMiniBattleProps) {
  return (
    <aside
      className="fixed inset-x-0 top-11 z-40 border-y"
      style={{
        background: 'var(--bg-card)',
        borderColor: 'var(--border-line)',
        boxShadow: '0 10px 28px rgba(0, 0, 0, 0.16)',
        backdropFilter: 'blur(14px)',
      }}
      aria-label="快捷红蓝合战"
      data-testid="red-blue-sticky-battle"
    >
      <PageContainer width="wide" className="py-1.5 sm:py-2">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <MiniBattleCard
              title={pair.left.title}
              coverUrl={pair.left.cover_url}
              contentId={pair.left.content_id}
              side="red"
              onOpenContent={onOpenContent}
            />
            <span className="flex shrink-0 items-center gap-1 px-0.5 text-[10px] font-bold tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>
              <Swords size={13} style={{ color: 'var(--brand)' }} /> VS
            </span>
            <MiniBattleCard
              title={pair.right.title}
              coverUrl={pair.right.cover_url}
              contentId={pair.right.content_id}
              side="blue"
              onOpenContent={onOpenContent}
            />
          </div>
          <div className="sm:w-[min(31rem,44%)]">
            <BattleActions
              compact
              disabled={disabled}
              selectedOutcome={selectedOutcome}
              onChoose={onChoose}
              testIdPrefix="sticky-battle"
            />
          </div>
        </div>
      </PageContainer>
    </aside>
  )
}
