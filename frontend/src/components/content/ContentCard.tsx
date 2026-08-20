import { Badge } from '@/components/ui/badge'
import { secureUrl } from '@/lib/image-url'
import type { ContentItem } from '@/types'

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

interface ContentCardProps {
  content: ContentItem
  onSelect: (id: number) => void
}

export function ContentCard({ content, onSelect }: ContentCardProps) {
  const avgScore = content.avg_score && content.avg_score > 0
    ? (content.avg_score / 10).toFixed(1)
    : null

  return (
    <article
      className="group cursor-pointer overflow-hidden rounded-lg transition-all duration-200 hover:shadow-md"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-line)',
      }}
      onClick={() => onSelect(content.id)}
    >
      {/* Cover */}
      <div className="relative aspect-[3/4] overflow-hidden" style={{ background: 'var(--bg-card-warm)' }}>
        {content.cover_url ? (
          <img
            src={secureUrl(content.cover_url)}
            alt={content.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            onError={(e) => {
              const target = e.target as HTMLImageElement
              target.src = '/placeholder.png'
            }}
          />
        ) : (
          <img
            src="/placeholder.png"
            alt={content.title}
            className="h-full w-full object-cover"
          />
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <Badge className={TYPE_COLORS[content.content_type] || ''}>
          {TYPE_LABELS[content.content_type] || content.content_type}
        </Badge>

        <h3
          className="mt-2 line-clamp-1 text-base font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          {content.title}
        </h3>

        <div className="mt-1 flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          {avgScore && (
            <span className="font-medium" style={{ color: 'var(--brand)' }}>
              ★ {avgScore}
            </span>
          )}
          {content.episodes > 0 && (
            <>
              <span>·</span>
              <span>{content.episodes}集</span>
            </>
          )}
        </div>
      </div>
    </article>
  )
}
