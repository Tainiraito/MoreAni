import type { ContentItem } from '@/types'
import { Star, Users, Play, Award, TrendingUp, Eye } from 'lucide-react'

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

function secureUrl(url: string): string {
  if (!url) return url
  if (url.includes('lain.bgm.tv') || url.includes('bgm.tv') || url.includes('bangumi.tv')) {
    return `/api/v1/proxy/image?url=${encodeURIComponent(url)}`
  }
  return url.replace(/^http:\/\//, 'https://')
}

interface HeroSectionProps {
  content: ContentItem
  onSelect: (id: number) => void
  onWantToWatch?: () => void
}

export function HeroSection({ content, onSelect, onWantToWatch }: HeroSectionProps) {
  const avgScore = content.avg_score && content.avg_score > 0
    ? (content.avg_score / 10).toFixed(1)
    : null

  // Parse metadata if available
  const metadata = content.metadata ? (typeof content.metadata === 'string' ? JSON.parse(content.metadata) : content.metadata) : {}
  const tags = metadata.tags || []
  const bangumiScore = metadata.bangumi_score
  const bangumiRank = metadata.bangumi_rank
  const director = metadata.director
  const studio = metadata.studio

  return (
    <div
      className="relative rounded-xl overflow-hidden cursor-pointer group mb-8"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}
      onClick={() => onSelect(content.id)}
    >
      <div className="flex flex-col md:flex-row">
        <div className="md:w-2/5 aspect-[3/4] md:aspect-auto md:min-h-[420px] overflow-hidden relative" style={{ background: 'var(--bg-card-warm)' }}>
          {content.cover_url ? (
            <img
              src={secureUrl(content.cover_url)}
              alt={content.title}
              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-600 ease-out"
              onError={(e) => {
                const target = e.target as HTMLImageElement
                target.src = '/placeholder.png'
              }}
            />
          ) : (
            <img
              src="/placeholder.png"
              alt={content.title}
              className="w-full h-full object-cover"
            />
          )}
        </div>

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

          {/* 评分和统计 */}
          <div className="mt-5 flex flex-wrap items-center gap-4">
            {/* 我们的评分 */}
            {avgScore && (
              <div className="flex items-center gap-1.5">
                <Star size={18} style={{ color: 'var(--brand)' }} fill="var(--brand)" />
                <span className="text-lg font-bold" style={{ color: 'var(--brand)' }}>
                  {avgScore}
                </span>
              </div>
            )}
            
            {/* 评分人数 */}
            {(content.rating_count ?? 0) > 0 && (
              <div className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                <Users size={14} />
                <span className="text-sm">{content.rating_count}</span>
              </div>
            )}

            {/* 集数 */}
            {content.episodes > 0 && (
              <div className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                <Play size={14} />
                <span className="text-sm">{content.episodes}集</span>
              </div>
            )}

            {/* Bangumi 评分 */}
            {bangumiScore && (
              <div className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                <Award size={14} />
                <span className="text-sm">BGM {bangumiScore}</span>
              </div>
            )}

            {/* 排名 */}
            {bangumiRank && bangumiRank > 0 && (
              <div className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                <TrendingUp size={14} />
                <span className="text-sm">#{bangumiRank}</span>
              </div>
            )}
          </div>

          {/* 标签 */}
          {tags.length > 0 && (
            <p className="mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
              {tags.map((tag: string, index: number) => (
                <span key={index}>#{tag} </span>
              ))}
            </p>
          )}

          {/* 制作信息 */}
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

          {/* 按钮区 */}
          <div className="mt-7 flex items-center gap-3">
            <span
              className="inline-flex items-center px-5 py-2.5 text-sm font-semibold rounded-full transition-all duration-200 hover:opacity-90"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
            >
              查看详情 →
            </span>
            {onWantToWatch && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onWantToWatch()
                }}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-semibold rounded-full transition-all duration-200 hover:opacity-80"
                style={{
                  background: 'var(--bg-card-warm)',
                  border: '1px solid var(--border-line)',
                  color: 'var(--text-primary)',
                }}
              >
                <Eye size={16} />
                想看
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
