import { CalendarDays, Heart, MessageCircle, Star } from 'lucide-react'
import type { ContentItem } from '@/types'
import { LoadingIcon } from '@/components/ui/loading-icon'

const TYPE_LABELS: Record<string, string> = {
  anime_movie: '动画电影',
  movie: '电影',
  game: '游戏',
  software: '软件',
  website: '网站',
  book: '书籍',
}

interface OtherContentListProps {
  items: ContentItem[]
  onSelect: (id: number) => void
  isFavorited: (id: number) => boolean
  isFavoritePending?: (id: number) => boolean
  onToggleFavorite: (id: number) => void
}

function formatDate(value: string): string | null {
  if (!value) return null
  return value.slice(0, 10).replaceAll('-', '/')
}

export function OtherContentList({ items, onSelect, isFavorited, isFavoritePending, onToggleFavorite }: OtherContentListProps) {
  return (
    <ul data-testid="other-content-list" className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--border-line)', background: 'var(--bg-card)' }}>
      {items.map(item => {
        const score = item.avg_score && item.avg_score > 0 ? (item.avg_score / 10).toFixed(1) : null
        const date = formatDate(item.release_date) || formatDate(item.updated_at)
        const favorited = isFavorited(item.id)

        return (
          <li key={item.id} className="group border-b last:border-b-0" style={{ borderColor: 'var(--border-line)' }}>
            <div className="flex min-w-0 items-center gap-3 px-3 py-3 transition-colors hover:bg-black/[0.025] dark:hover:bg-white/[0.035] sm:px-4">
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="min-w-0 truncate text-sm font-semibold sm:text-base" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                    {item.title}
                  </h3>
                  <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--bg-card-warm)', color: 'var(--text-muted)' }}>
                    {TYPE_LABELS[item.content_type] || item.content_type}
                  </span>
                </div>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {date && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays size={12} />
                      {date}
                    </span>
                  )}
                  {score && (
                    <span className="inline-flex items-center gap-1">
                      <Star size={12} fill="currentColor" />
                      {score}
                    </span>
                  )}
                  {(item.review_count ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle size={12} />
                      {item.review_count}
                    </span>
                  )}
                  {item.platform && <span className="truncate">{item.platform}</span>}
                </div>
              </button>

              <button
                type="button"
                aria-label={favorited ? `取消收藏 ${item.title}` : `收藏 ${item.title}`}
                aria-pressed={favorited}
                title={favorited ? '取消收藏' : '收藏'}
                onClick={() => onToggleFavorite(item.id)}
                disabled={isFavoritePending?.(item.id)}
                aria-busy={isFavoritePending?.(item.id) || undefined}
                className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                style={{ color: favorited ? '#FB71A7' : 'var(--text-muted)' }}
              >
                {isFavoritePending?.(item.id) ? <LoadingIcon size={16} /> : <Heart size={16} fill={favorited ? 'currentColor' : 'none'} />}
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
