import { TypeBadge } from '@/components/ui/badge'
import type { ContentItem } from '@/types'

const TYPE_EMOJI: Record<string, string> = {
  anime: '📺', movie: '🎬', game: '🎮', software: '💻', website: '🌐', book: '📚',
}

/** Force HTTPS for external image URLs (lain.bgm.tv returns 301 for HTTP) */
function secureUrl(url: string): string {
  if (!url) return url
  // Proxy external images to bypass CORP/CORS restrictions
  if (url.includes('lain.bgm.tv') || url.includes('bgm.tv') || url.includes('bangumi.tv')) {
    return `/api/v1/proxy/image?url=${encodeURIComponent(url)}`
  }
  return url.replace(/^http:\/\//, 'https://')
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
      className="group cursor-pointer overflow-hidden rounded-lg border transition-all duration-200 hover:shadow-md"
      style={{ borderColor: 'rgba(44,42,48,0.06)', background: 'var(--bg-card, #fff)' }}
      onClick={() => onSelect(content.id)}
    >
      {/* Cover */}
      <div className="relative aspect-[3/4] overflow-hidden rounded-t-lg bg-[var(--bg-card-warm, #f3ede4)]">
        {content.cover_url ? (
          <img
            src={secureUrl(content.cover_url)}
            alt={content.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            onError={(e) => {
              const target = e.target as HTMLImageElement
              target.style.display = 'none'
              const fallback = target.nextElementSibling as HTMLElement
              if (fallback) fallback.style.display = 'flex'
            }}
          />
        ) : null}
        <div
          className={`absolute inset-0 items-center justify-center text-5xl ${content.cover_url ? 'hidden' : 'flex'}`}
        >
          {TYPE_EMOJI[content.content_type] || '📄'}
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <TypeBadge type={content.content_type} />

        <h3
          className="mt-2 line-clamp-1 text-base font-semibold"
          style={{ color: 'var(--text-primary, #0c0a12)' }}
        >
          {content.title}
        </h3>

        <div className="mt-1 flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted, #8a8590)' }}>
          {avgScore && (
            <span className="font-medium" style={{ color: 'var(--accent-amber, #c4956a)' }}>
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
