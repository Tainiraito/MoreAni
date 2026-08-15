import type { ContentItem } from '@/types'
import { Star, Users, Play, Heart, RefreshCw } from 'lucide-react'
import { CoverImage } from '@/components/ui/CoverImage'

const TYPE_LABELS: Record<string, string> = {
  anime: '番剧', movie: '电影', game: '游戏', software: '软件', website: '网站', book: '书籍',
}

const TYPE_COLORS: Record<string, string> = {
  anime: 'bg-type-anime/10 text-type-anime',
  movie: 'bg-type-movie/10 text-type-movie',
  game: 'bg-type-game/10 text-type-game',
  software: 'bg-type-software/10 text-type-software',
  website: 'bg-type-website/10 text-type-website',
  book: 'bg-type-book/10 text-type-book',
}

interface HeroSectionProps {
  content: ContentItem
  isFavorited?: boolean
  onSelect: (id: number) => void
  onToggleFavorite?: () => void
  onRefresh?: () => void
  progress?: number
  autoRefreshMs?: number
}

export function HeroSection({
  content,
  isFavorited = false,
  onSelect,
  onToggleFavorite,
  onRefresh,
  progress = 0,
  autoRefreshMs = 11000,
}: HeroSectionProps) {
  const avgScore = content.avg_score && content.avg_score > 0
    ? (content.avg_score / 10).toFixed(1)
    : null

  const metadata = content.metadata ? (typeof content.metadata === 'string' ? JSON.parse(content.metadata) : content.metadata) : {}
  const tags = metadata.tags || []
  const director = metadata.director
  const studio = metadata.studio

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleFavorite?.()
  }

  const handleRefreshClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onRefresh?.()
  }

  return (
    <div
      className="relative rounded-xl overflow-hidden cursor-pointer group mb-8"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}
      onClick={() => onSelect(content.id)}
    >
      <div className="flex flex-col md:flex-row md:h-[600px]">
        <div className="md:w-2/5 aspect-[3/4] md:aspect-auto overflow-hidden relative" style={{ background: 'var(--bg-card-warm)' }}>
          <CoverImage src={content.cover_url} alt={content.title} imgClassName="group-hover:scale-[1.03] transition-transform duration-600 ease-out" />
        </div>

        <div className="md:w-3/5 p-8 md:p-10 flex flex-col justify-center overflow-hidden">
          <span className={`inline-block w-fit px-3 py-1 text-xs font-medium rounded-lg mb-5 ${TYPE_COLORS[content.content_type] || 'bg-surface text-slate'}`}>
            {TYPE_LABELS[content.content_type] || content.content_type}
          </span>

          <h1 className="text-3xl md:text-[2.5rem] font-bold tracking-tight leading-tight" style={{ color: 'var(--text-primary)' }}>
            {content.title}
          </h1>

          {content.title_alt && (
            <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>{content.title_alt}</p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-4">
            {avgScore && (
              <div className="flex items-center gap-1.5">
                <Star size={18} style={{ color: 'var(--brand)' }} fill="var(--brand)" />
                <span className="text-lg font-bold" style={{ color: 'var(--brand)' }}>
                  {avgScore}
                </span>
              </div>
            )}

            {(content.rating_count ?? 0) > 0 && (
              <div className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                <Users size={14} />
                <span className="text-sm">{content.rating_count}</span>
              </div>
            )}

            {content.episodes > 0 && (
              <div className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                <Play size={14} />
                <span className="text-sm">{content.episodes}集</span>
              </div>
            )}
          </div>

          {tags.length > 0 && (
            <p className="mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
              {tags.slice(0, 10).map((tag: string, index: number) => (
                <span key={index}>#{tag} </span>
              ))}
            </p>
          )}

          {(director || studio) && (
            <div className="mt-3 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              {director && <span>导演: {director}</span>}
              {studio && <span>制作: {studio}</span>}
            </div>
          )}

          {content.description && (
            <p className="mt-5 text-sm leading-relaxed line-clamp-3" style={{ color: 'var(--text-secondary)' }}>
              {content.description}
            </p>
          )}

          {/* 收藏 + 换一个 */}
          <div className="mt-7 flex items-center gap-3">
            {onToggleFavorite && (
              <button
                onClick={handleFavoriteClick}
                className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold rounded-full transition-all duration-200 hover:opacity-80"
                style={{
                  background: isFavorited ? '#FB71A7' : 'var(--bg-card-warm)',
                  border: isFavorited ? 'none' : '1px solid var(--border-line)',
                  color: isFavorited ? 'white' : 'var(--text-primary)',
                }}
              >
                <Heart size={16} fill={isFavorited ? 'white' : 'none'} />
                {isFavorited ? '已收藏' : '收藏'}
              </button>
            )}

            {onRefresh && (
              <button
                onClick={handleRefreshClick}
                className="relative inline-flex items-center gap-1.5 px-6 py-2.5 text-sm font-semibold rounded-full overflow-hidden transition-all duration-200 hover:opacity-80"
                style={{
                  background: 'var(--bg-card-warm)',
                  border: '1px solid var(--border-line)',
                  color: 'var(--text-primary)',
                }}
              >
                {/* 进度填充背景 */}
                <div
                  className="absolute inset-0"
                  style={{
                    width: `${progress}%`,
                    background: 'linear-gradient(90deg, rgba(251,113,167,0.15), rgba(180,144,228,0.15))',
                    transition: progress > 0 ? `width ${autoRefreshMs}ms linear` : 'none',
                  }}
                />
                <RefreshCw size={14} className="relative z-10" />
                <span className="relative z-10">换一个</span>
              </button>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}
