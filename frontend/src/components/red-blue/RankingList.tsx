import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { RankingRow } from '@/components/red-blue/RankingRow'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
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
    <section aria-label="我的排名" data-testid="red-blue-ranking">
      <div className="flex flex-col items-stretch gap-3 pt-4 pb-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <div className="relative min-w-[160px] max-w-xs flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }}
              aria-hidden="true"
            />
            <Input
              aria-label="搜索作品"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="搜索作品..."
              clearable
              onClear={() => setQuery('')}
              className="pl-9 text-sm"
            />
          </div>
          <div role="group" aria-label="排名筛选">
            <Select
              value={filter}
              onChange={value => setFilter(value as RankingFilter)}
              className="w-[144px]"
              options={FILTERS.map(option => ({
                value: option.key,
                label: `${option.label} (${filterCounts[option.key]})`,
              }))}
            />
          </div>
        </div>
      </div>

      <div className="mt-0 overflow-hidden rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}>
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
