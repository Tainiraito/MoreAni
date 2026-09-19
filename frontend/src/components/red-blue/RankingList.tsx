import { ListFilter, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { RankingRow } from '@/components/red-blue/RankingRow'
import type { RedBlueRankingChange, RedBlueRankingItem, RedBlueSuggestionAction } from '@/types/red-blue'

type RankingFilter = 'all' | 'uncertain' | 'suggestion' | 'stable'

interface RankingListProps {
  ranking: RedBlueRankingItem[]
  rankChanges: Record<number, RedBlueRankingChange>
  actionPendingId: number | null
  onOpenContent: (contentId: number) => void
  onSuggestionAction: (suggestion: NonNullable<RedBlueRankingItem['score_suggestion']>, action: RedBlueSuggestionAction) => void
  candidateCount?: number
  focusedContentId?: number | null
  onFocusContent?: (contentId: number) => void
}

const FILTERS: Array<{ key: RankingFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'uncertain', label: '待确认' },
  { key: 'suggestion', label: '有评分建议' },
  { key: 'stable', label: '稳定' },
]

function matchesFilter(item: RedBlueRankingItem, filter: RankingFilter): boolean {
  if (filter === 'uncertain') return ['UNCALIBRATED', 'CALIBRATING', 'ORDER_UNCERTAIN'].includes(item.stability)
  if (filter === 'suggestion') return item.score_suggestion != null
  if (filter === 'stable') return item.stability === 'STABLE' || item.stability === 'RELATIVELY_STABLE'
  return true
}

export function RankingList({
  ranking,
  rankChanges,
  actionPendingId,
  onOpenContent,
  onSuggestionAction,
  candidateCount = ranking.length,
  focusedContentId = null,
  onFocusContent,
}: RankingListProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<RankingFilter>('all')
  const queryFilteredRanking = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return ranking.filter(item => normalizedQuery.length === 0 || item.content.title.toLocaleLowerCase().includes(normalizedQuery))
  }, [query, ranking])
  const visibleRanking = useMemo(
    () => queryFilteredRanking.filter(item => matchesFilter(item, filter)),
    [filter, queryFilteredRanking],
  )
  const filterCounts = useMemo(
    () => Object.fromEntries(FILTERS.map(option => [option.key, queryFilteredRanking.filter(item => matchesFilter(item, option.key)).length])) as Record<RankingFilter, number>,
    [queryFilteredRanking],
  )

  return (
    <section aria-labelledby="red-blue-ranking-title" data-testid="red-blue-ranking">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--brand)' }}>Personal order</p>
          <h2 id="red-blue-ranking-title" className="mt-1 text-xl font-semibold sm:text-2xl" style={{ color: 'var(--text-primary)' }}>我的排名</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>排名会随着你的选择持续变化。</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
          <label className="relative block w-full sm:w-64">
            <span className="sr-only">搜索作品</span>
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜索作品"
              className="h-9 w-full rounded-lg pl-9 pr-3 text-sm outline-none"
              style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-line)' }}
            />
          </label>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="排名筛选">
            <ListFilter size={14} style={{ color: 'var(--text-muted)' }} />
            {FILTERS.map(option => (
              <button
                key={option.key}
                type="button"
                onClick={() => setFilter(option.key)}
                className="rounded-full px-2.5 py-1 text-xs transition-colors"
                style={{
                  color: filter === option.key ? 'var(--brand)' : 'var(--text-muted)',
                  background: filter === option.key ? 'rgba(251,113,167,0.1)' : 'transparent',
                  border: `1px solid ${filter === option.key ? 'rgba(251,113,167,0.3)' : 'transparent'}`,
                }}
                aria-pressed={filter === option.key}
              >
                {option.label} <span className="ml-0.5 opacity-70">{filterCounts[option.key]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}>
        {visibleRanking.length === 0 ? (
          <div className="flex min-h-36 items-center justify-center px-5 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            没有符合当前搜索或筛选条件的作品。
          </div>
        ) : (
          <ol>{visibleRanking.map(item => (
            <RankingRow
              key={item.content.content_id}
              item={item}
              rankChange={rankChanges[item.content.content_id]}
              actionPending={actionPendingId === item.score_suggestion?.id}
              onOpenContent={onOpenContent}
              onSuggestionAction={onSuggestionAction}
              candidateCount={candidateCount}
              focused={focusedContentId === item.content.content_id}
              onFocusContent={onFocusContent}
            />
          ))}</ol>
        )}
      </div>
      <p className="mt-3 text-right text-xs" style={{ color: 'var(--text-muted)' }}>显示 {visibleRanking.length} / {ranking.length} 部作品</p>
    </section>
  )
}
