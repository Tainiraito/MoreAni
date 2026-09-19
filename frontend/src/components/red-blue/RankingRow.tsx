import { ArrowDown, ArrowUp, Target } from 'lucide-react'

import { CoverImage } from '@/components/ui/CoverImage'
import { ScoreCalibrationCard } from '@/components/red-blue/ScoreCalibrationCard'
import { StabilityBadge } from '@/components/red-blue/StabilityBadge'
import type { RedBlueRankingChange, RedBlueRankingItem, RedBlueSuggestionAction } from '@/types/red-blue'

interface RankingRowProps {
  item: RedBlueRankingItem
  rankChange: RedBlueRankingChange | undefined
  actionPending: boolean
  onOpenContent: (contentId: number) => void
  onSuggestionAction: (suggestion: NonNullable<RedBlueRankingItem['score_suggestion']>, action: RedBlueSuggestionAction) => void
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
  actionPending,
  onOpenContent,
  onSuggestionAction,
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
  const scoreSuggestion = item.score_suggestion
  const hasScoreSuggestion = scoreSuggestion != null
  const rowColumns = hasScoreSuggestion
    ? 'lg:grid-cols-[4rem_minmax(0,1fr)_minmax(14rem,17rem)_auto]'
    : 'lg:grid-cols-[4rem_minmax(0,1fr)_auto]'

  return (
    <li
      className={`group grid gap-3 px-3 py-3 transition-colors duration-300 sm:px-4 ${rowColumns} lg:items-stretch ${rankChange && !focused ? 'red-blue-rank-moved' : ''}`}
      style={{ background: focused ? 'rgba(251,113,167,0.08)' : rankChange ? 'rgba(251,113,167,0.055)' : 'transparent', borderTop: '1px solid var(--border-line)', boxShadow: focused ? 'inset 3px 0 0 var(--brand)' : 'none' }}
      data-testid={`ranking-row-${item.content.content_id}`}
      data-focused={focused ? 'true' : 'false'}
    >
      <div className="flex items-center gap-1 lg:flex-col lg:items-start lg:gap-0.5">
        <span className="text-xl font-semibold leading-6" style={{ color: 'var(--text-primary)' }}>#{formatRank(item.rank)}</span>
        {rankChange !== undefined && rankChange.amount >= 2 && (
          <span
            className="inline-flex items-center text-xs font-semibold"
            style={{ color: rankChange.direction === 'UP' ? 'var(--brand)' : 'var(--text-muted)' }}
            data-testid={`ranking-change-${item.content.content_id}`}
            data-direction={rankChange.direction}
          >
            {rankChange.direction === 'UP' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {rankChange.amount}
          </span>
        )}
      </div>

      <div className="flex min-w-0 items-stretch gap-3">
        <button
          type="button"
          onClick={() => onOpenContent(item.content.content_id)}
          className="-my-3 min-h-20 w-16 shrink-0 self-stretch overflow-hidden rounded-lg transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }}
          aria-label={`查看《${item.content.title}》详情`}
        >
          <CoverImage src={item.content.cover_url ?? ''} alt={item.content.title} />
        </button>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold" title={item.content.title}>
            <button
              type="button"
              onClick={() => onOpenContent(item.content.content_id)}
              className="max-w-full truncate text-left transition-colors hover:text-[var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              style={{ color: 'var(--text-primary)' }}
            >
              {item.content.title}
            </button>
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

      {hasScoreSuggestion && (
        <ScoreCalibrationCard
          suggestion={scoreSuggestion}
          disabled={actionPending}
          onAction={action => onSuggestionAction(scoreSuggestion, action)}
        />
      )}

      {onFocusContent && (
        <button
          type="button"
          onClick={() => onFocusContent(item.content.content_id)}
          className={`inline-flex items-center justify-center gap-1 self-center justify-self-start whitespace-nowrap rounded-lg px-2.5 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] lg:justify-self-end ${focused ? '' : 'opacity-75 hover:opacity-100'}`}
          style={{ color: focused ? 'var(--brand)' : 'var(--text-muted)', background: focused ? 'rgba(251,113,167,0.1)' : 'transparent', border: focused ? '1px solid rgba(251,113,167,0.25)' : '1px solid transparent' }}
          aria-pressed={focused}
          aria-label={focused ? `结束《${item.content.title}》重点校准` : `将《${item.content.title}》设为重点校准`}
          data-testid={`focus-content-${item.content.content_id}`}
        >
          <Target size={14} /> {focused ? '重点校准中' : '重点校准'}
        </button>
      )}
    </li>
  )
}
