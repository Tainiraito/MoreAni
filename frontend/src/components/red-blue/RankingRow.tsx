import { ArrowDown, ArrowUp, Minus, Target } from 'lucide-react'
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react'

import { CoverImage } from '@/components/ui/CoverImage'
import { StabilityBadge } from '@/components/red-blue/StabilityBadge'
import type { RedBlueRankingChange, RedBlueRankingItem, RedBlueRecalibrationChange } from '@/types/red-blue'

interface RankingRowProps {
  item: RedBlueRankingItem
  rankChange: RedBlueRankingChange | undefined
  recalibrationChange: RedBlueRecalibrationChange | undefined
  onOpenContent: (contentId: number) => void
  candidateCount?: number
  focused?: boolean
  onFocusContent?: (contentId: number) => void
}

function formatScore(score: number): string {
  return (score / 10).toFixed(1)
}

function formatRank(rank: number): string {
  return Number.isSafeInteger(rank) && rank >= 1 ? String(rank) : '—'
}

export function RankingRow({
  item,
  rankChange,
  recalibrationChange,
  onOpenContent,
  candidateCount = 1,
  focused = false,
  onFocusContent,
}: RankingRowProps) {
  const rankIntervalVisible = ['UNCALIBRATED', 'CALIBRATING', 'RELATIVELY_STABLE', 'STABLE', 'ORDER_UNCERTAIN'].includes(item.stability)
  const rankIntervalText = rankIntervalVisible && item.rank_low !== null && item.rank_high !== null && item.rank_low !== item.rank_high
    ? (() => {
      const width = item.rank_high - item.rank_low
      const ratio = width / Math.max(candidateCount - 1, 1)
      if (width <= 5 || ratio <= 0.08) return `大致 #${item.rank_low}～#${item.rank_high}`
      if (ratio <= 0.3) return `大致在 #${formatRank(item.rank)} 附近`
      return '排名仍在确认中'
    })()
    : null

  const openContent = () => onOpenContent(item.content.content_id)
  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    openContent()
  }
  const stopFocusClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
  }
  const stopFocusKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    event.stopPropagation()
  }
  const rowBackground = focused
    ? 'rgba(251,113,167,0.08)'
    : (rankChange !== undefined || recalibrationChange !== undefined)
      ? 'rgba(251,113,167,0.055)'
      : 'transparent'

  return (
    <div
      className={`group grid cursor-pointer rounded-xl border bg-[var(--red-blue-row-background)] px-3 py-3 transition-colors duration-300 hover:bg-[rgba(251,113,167,0.045)] sm:px-4 lg:grid-cols-[4rem_minmax(0,1fr)_auto] lg:items-stretch ${rankChange && !recalibrationChange && !focused ? 'red-blue-rank-moved' : ''} ${recalibrationChange && !focused ? 'red-blue-rank-recalibrated' : ''}`}
      style={{ '--red-blue-row-background': rowBackground, borderColor: 'var(--border-line)', boxShadow: focused ? 'inset 3px 0 0 var(--brand)' : 'none' } as CSSProperties}
      data-testid={`ranking-row-${item.content.content_id}`}
      data-focused={focused ? 'true' : 'false'}
      role="button"
      tabIndex={0}
      aria-label={`查看《${item.content.title}》详情`}
      onClick={openContent}
      onKeyDown={handleRowKeyDown}
    >
      <div className="flex items-center gap-1 self-center lg:flex-col lg:items-start lg:gap-0.5">
        <span className="text-xl font-semibold leading-6" style={{ color: 'var(--text-primary)' }}>#{formatRank(item.rank)}</span>
        {rankChange !== undefined && (
          <span
            className="inline-flex items-center text-xs font-semibold"
            style={{ color: rankChange.direction === 'UP' ? 'var(--brand)' : 'var(--text-muted)' }}
            data-testid={`ranking-change-${item.content.content_id}`}
            data-direction={rankChange.direction}
          >
            {rankChange.direction === 'UP'
              ? <ArrowUp size={12} />
              : rankChange.direction === 'DOWN'
                ? <ArrowDown size={12} />
                : <Minus size={12} />}
            {rankChange.amount}
          </span>
        )}
        {recalibrationChange !== undefined && (
          <span
            className="inline-flex items-center text-[10px] font-medium whitespace-nowrap"
            style={{ color: 'var(--text-muted)' }}
            data-testid={`ranking-recalibration-${item.content.content_id}`}
          >
            校准调整
          </span>
        )}
      </div>

      <div className="flex min-w-0 items-stretch gap-3">
        <div
          className="-my-3 min-h-20 w-16 shrink-0 self-stretch overflow-hidden"
          style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }}
          aria-hidden="true"
        >
          <CoverImage src={item.content.cover_url ?? ''} alt={item.content.title} />
        </div>
        <div className="flex min-w-0 flex-col justify-center">
          <h3 className="truncate text-sm font-semibold" title={item.content.title}>
            <span className="block max-w-full truncate transition-colors group-hover:text-[var(--brand)]" style={{ color: 'var(--text-primary)' }}>
              {item.content.title}
            </span>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="font-semibold" style={{ color: 'var(--brand)' }}>{formatScore(item.current_score)}<span className="ml-0.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>/10</span></span>
            <StabilityBadge stability={item.stability} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>PK {item.comparison_count} 次</span>
          </div>
          {rankIntervalText && (
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{rankIntervalText}</p>
          )}
        </div>
      </div>

      {onFocusContent && (
        <button
          type="button"
          onClick={event => { stopFocusClick(event); onFocusContent(item.content.content_id) }}
          onKeyDown={stopFocusKeyDown}
          className={`inline-flex items-center justify-center gap-1 self-center justify-self-start whitespace-nowrap rounded-lg px-2.5 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] lg:justify-self-end ${focused ? '' : 'opacity-75 hover:opacity-100'}`}
          style={{ color: focused ? 'var(--brand)' : 'var(--text-muted)', background: focused ? 'rgba(251,113,167,0.1)' : 'transparent', border: focused ? '1px solid rgba(251,113,167,0.25)' : '1px solid transparent' }}
          aria-pressed={focused}
          aria-label={focused ? `结束《${item.content.title}》重点校准` : `将《${item.content.title}》设为重点校准`}
          data-testid={`focus-content-${item.content.content_id}`}
        >
          <Target size={14} /> {focused ? '重点校准中' : '重点校准'}
        </button>
      )}
    </div>
  )
}
