import type { ContentItem } from '@/types'

const TYPE_EMOJI: Record<string, string> = {
  anime: '📺', movie: '🎬', game: '🎮', software: '💻', website: '🌐', book: '📚',
}

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

/** Force HTTPS for external image URLs */
function secureUrl(url: string): string {
  if (!url) return url
  // Proxy external images to bypass CORP/CORS restrictions
  if (url.includes('lain.bgm.tv') || url.includes('bgm.tv') || url.includes('bangumi.tv')) {
    return `/api/v1/proxy/image?url=${encodeURIComponent(url)}`
  }
  return url.replace(/^http:\/\//, 'https://')
}

interface HeroSectionProps {
  content: ContentItem
  onSelect: (id: number) => void
}

export function HeroSection({ content, onSelect }: HeroSectionProps) {
  const avgScore = content.avg_score && content.avg_score > 0
    ? (content.avg_score / 10).toFixed(1)
    : null

  return (
    <div
      className="relative rounded-xl overflow-hidden cursor-pointer group mb-8"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-line)',
      }}
      onClick={() => onSelect(content.id)}
    >
      <div className="flex flex-col md:flex-row">
        {/* Cover */}
        <div className="md:w-2/5 aspect-[3/4] md:aspect-auto md:min-h-[420px] overflow-hidden relative" style={{ background: 'var(--bg-card-warm)' }}>
          {content.cover_url ? (
            <img
              src={secureUrl(content.cover_url)}
              alt={content.title}
              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-600 ease-out"
              onError={(e) => {
                const target = e.target as HTMLImageElement
                target.style.display = 'none'
                const fallback = target.nextElementSibling as HTMLElement
                if (fallback) fallback.style.display = 'flex'
              }}
            />
          ) : null}
          <div
            className={`absolute inset-0 w-full h-full items-center justify-center text-8xl opacity-30 ${content.cover_url ? 'hidden' : 'flex'}`}
          >
            {TYPE_EMOJI[content.content_type] || '📄'}
          </div>
        </div>

        {/* Info */}
        <div className="md:w-3/5 p-8 md:p-10 flex flex-col justify-center">
          <span className={`inline-block w-fit px-3 py-1 text-xs font-medium rounded-lg mb-5 ${TYPE_COLORS[content.content_type] || 'bg-surface text-slate'}`}>
            {TYPE_LABELS[content.content_type] || content.content_type}
          </span>

          <h1 className="text-3xl md:text-[2.5rem] font-bold tracking-tight leading-tight" style={{ color: 'var(--text-primary)' }}>
            {content.title}
          </h1>

          {content.title_alt && (
            <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>{content.title_alt}</p>
          )}

          {avgScore && (
            <div className="mt-5 flex items-center gap-3">
              <div
                className="px-4 py-2 rounded-lg"
                style={{
                  background: 'linear-gradient(135deg, var(--brand), var(--brand-deep))',
                }}
              >
                <span className="font-display text-xl font-bold text-white">{avgScore}</span>
                <span className="text-xs text-white/60 ml-1">/ 10</span>
              </div>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {content.rating_count || 0} 人评分
              </span>
            </div>
          )}

          {content.description && (
            <p className="mt-5 text-sm leading-relaxed line-clamp-3" style={{ color: 'var(--text-secondary)' }}>
              {content.description}
            </p>
          )}

          <div className="mt-7">
            <span
              className="inline-flex items-center px-5 py-2.5 text-white text-sm font-medium rounded-full transition-all duration-200"
              style={{
                background: 'linear-gradient(135deg, var(--brand), var(--brand-deep))',
              }}
            >
              查看详情 →
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
