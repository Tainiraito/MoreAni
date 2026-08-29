import { Star } from 'lucide-react'

import { CoverImage } from '@/components/ui/CoverImage'
import type {
  AnalyticsFavoriteItem,
  AnalyticsRecommendationItem,
  AnalyticsScopeType,
} from '@/types'

const COVER_CARD_GRID_CLASS = 'grid grid-cols-[88px_minmax(0,1fr)]'

interface FavoriteCardProps {
  item: AnalyticsFavoriteItem
  scope: AnalyticsScopeType
  requiredTagNames?: readonly string[]
  onOpen: (id: number) => void
}

export function AnalyticsFavoriteCard({
  item,
  scope,
  requiredTagNames = [],
  onOpen,
}: FavoriteCardProps) {
  return (
    <button
      type="button"
      data-testid="analytics-favorite-card"
      onClick={() => onOpen(item.id)}
      className="group min-w-0 overflow-hidden rounded-xl text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }}
    >
      <div className={COVER_CARD_GRID_CLASS}>
        <div className="min-h-[7.25rem] self-stretch overflow-hidden" data-testid="analytics-card-cover">
          <CoverImage src={item.cover_url} alt={item.title} />
        </div>
        <div className="min-w-0 p-3">
          <p className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.title}</p>
          {item.title_alt ? <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-muted)' }}>{item.title_alt}</p> : null}
          <p className="mt-3 flex items-center gap-1 text-sm font-semibold" style={{ color: 'var(--brand)' }}>
            <Star size={14} fill="currentColor" />
            {item.score.toFixed(1)}
          </p>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {scope === 'global'
              ? `${item.rating_count} 条评分 · 实际均分`
              : `全站 ${item.rating_count} 条评分${item.average_score !== null ? ` · 均分 ${item.average_score.toFixed(1)}` : ''}`}
          </p>
          {requiredTagNames.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1" data-testid="favorite-required-tags">
              {requiredTagNames.map(tag => (
                <span
                  key={tag}
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                  style={{ color: 'var(--brand)', background: 'rgba(251, 113, 167, 0.14)' }}
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </button>
  )
}

interface RecommendationCardProps {
  item: AnalyticsRecommendationItem
  requiredTagNames?: readonly string[]
  onOpen: (id: number) => void
}

export function AnalyticsRecommendationCard({
  item,
  requiredTagNames = [],
  onOpen,
}: RecommendationCardProps) {
  const otherMatchedTags = item.matched_tags.filter(tag => !requiredTagNames.includes(tag))
  const hasVisibleTags = requiredTagNames.length > 0 || otherMatchedTags.length > 0
  return (
    <button
      type="button"
      data-testid="analytics-recommendation-card"
      onClick={() => onOpen(item.id)}
      className="group overflow-hidden rounded-xl text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
      style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }}
    >
      <div className={COVER_CARD_GRID_CLASS}>
        <div className="min-h-[7.25rem] self-stretch overflow-hidden" data-testid="analytics-card-cover">
          <CoverImage src={item.cover_url} alt={item.title} />
        </div>
        <div className="min-w-0 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.title}</p>
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
              style={{ color: 'var(--brand)', background: 'rgba(251, 113, 167, 0.12)' }}
            >
              {item.match_percent}%
            </span>
          </div>
          <p
            className="mt-1 flex items-center gap-1 text-[11px] tabular-nums"
            style={{ color: 'var(--text-muted)' }}
            data-testid="analytics-recommendation-rating"
          >
            <Star size={12} fill={item.average_score !== null ? 'currentColor' : 'none'} />
            {item.average_score !== null
              ? `站内评分 ${item.average_score.toFixed(1)} · ${item.rating_count} 人评分`
              : '暂无站内评分'}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {requiredTagNames.map(tag => (
              <span
                key={tag}
                className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                style={{ color: 'var(--brand)', background: 'rgba(251, 113, 167, 0.14)' }}
              >
                {tag}
              </span>
            ))}
            {otherMatchedTags.map(tag => (
              <span
                key={tag}
                className="rounded-md px-1.5 py-0.5 text-[10px]"
                style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)' }}
              >
                {tag}
              </span>
            ))}
            {!hasVisibleTags ? (
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>暂无强匹配标签</span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  )
}
