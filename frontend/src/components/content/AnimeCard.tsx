import { useState } from 'react'
import { Star, Users, Play, Heart } from 'lucide-react'
import type { ContentItem } from '@/types'

/** Force HTTPS for external image URLs */
function secureUrl(url: string): string {
  if (!url) return ''
  if (url.includes('lain.bgm.tv') || url.includes('bgm.tv') || url.includes('bangumi.tv')) {
    return `/api/v1/proxy/image?url=${encodeURIComponent(url)}`
  }
  return url.replace(/^http:\/\//, 'https://')
}

/** 带占位的封面图片 */
function CoverImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const imageSrc = (!error && src) ? secureUrl(src) : '/placeholder.png'

  return (
    <div className="relative w-full h-full" style={{ background: 'var(--bg-card-warm)' }}>
      {!loaded && (
        <img src="/placeholder.png" alt={alt} className="absolute inset-0 w-full h-full object-cover" />
      )}
      {src && !error && (
        <img
          src={imageSrc}
          alt={alt}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
        />
      )}
    </div>
  )
}

type CardMode = 'grid' | 'scroll'

interface AnimeCardProps {
  content: ContentItem
  mode?: CardMode
  isFavorited?: boolean
  onSelect?: (id: number) => void
  onToggleFavorite?: (id: number) => void
}

export function AnimeCard({ content, mode = 'grid', isFavorited = false, onSelect, onToggleFavorite }: AnimeCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const avgScore = content.avg_score && content.avg_score > 0
    ? (content.avg_score / 10).toFixed(1)
    : null

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleFavorite?.(content.id)
  }

  // Grid 模式：用于内容列表
  if (mode === 'grid') {
    return (
      <article
        className="group cursor-pointer overflow-hidden rounded-xl transition-all duration-200 hover:shadow-lg relative"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-line)',
        }}
        onClick={() => onSelect?.(content.id)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* 收藏按钮 - 右上角 */}
        {onToggleFavorite && (
          <button
            onClick={handleFavoriteClick}
            className="absolute top-2 right-2 z-10 w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 hover:scale-110"
            style={{
              background: isFavorited ? 'var(--brand)' : 'rgba(255,255,255,0.9)',
              color: isFavorited ? 'white' : 'var(--text-muted)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            }}
          >
            <Heart size={14} fill={isFavorited ? 'white' : 'none'} />
          </button>
        )}

        {/* 封面 */}
        <div className="aspect-[3/4] overflow-hidden" style={{ background: 'var(--bg-card-warm)' }}>
          <CoverImage src={content.cover_url} alt={content.title} />
        </div>

        {/* 信息 */}
        <div className="p-3 text-center">
          <h3 className="text-sm font-semibold truncate mb-1.5" style={{ color: 'var(--text-primary)' }}>
            {content.title}
          </h3>

          <div className="flex items-center justify-center gap-3">
            {avgScore && (
              <div className="flex items-center gap-1">
                <Star size={12} style={{ color: 'var(--brand)' }} fill="var(--brand)" />
                <span className="text-xs font-semibold" style={{ color: 'var(--brand)' }}>
                  {avgScore}
                </span>
              </div>
            )}
            {(content.rating_count ?? 0) > 0 && (
              <div className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                <Users size={10} />
                <span className="text-xs">{content.rating_count}</span>
              </div>
            )}
            {content.episodes > 0 && (
              <div className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                <Play size={10} />
                <span className="text-xs">{content.episodes}集</span>
              </div>
            )}
          </div>
        </div>
      </article>
    )
  }

  // Scroll 模式：用于首屏滚动卡片
  const coverHeight = 210
  const infoMinHeight = 70

  return (
    <div
      className="flex-shrink-0 cursor-pointer relative"
      style={{
        width: '160px',
        height: `${coverHeight + infoMinHeight}px`,
        transform: isHovered ? 'scale(1.08)' : 'scale(1)',
        zIndex: isHovered ? 20 : 1,
        transformOrigin: 'center bottom',
        transition: 'transform 0.3s ease',
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onSelect?.(content.id)}
    >
      <div
        className="relative w-full h-full rounded-xl overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-line)',
          boxShadow: isHovered
            ? '0 12px 40px rgba(0,0,0,0.2)'
            : '0 2px 8px rgba(0,0,0,0.05)',
          transition: 'box-shadow 0.3s ease',
        }}
      >
        {/* 收藏按钮 - 右上角 */}
        {onToggleFavorite && (
          <button
            onClick={handleFavoriteClick}
            className="absolute top-2 right-2 z-10 w-7 h-7 flex items-center justify-center rounded-full transition-all duration-200 hover:scale-110"
            style={{
              background: isFavorited ? 'var(--brand)' : 'rgba(255,255,255,0.9)',
              color: isFavorited ? 'white' : 'var(--text-muted)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            }}
          >
            <Heart size={12} fill={isFavorited ? 'white' : 'none'} />
          </button>
        )}

        {/* 封面 */}
        <div className="w-full overflow-hidden" style={{ height: `${coverHeight}px` }}>
          <CoverImage src={content.cover_url} alt={content.title} />
        </div>

        {/* 信息区 */}
        <div
          className="absolute left-0 right-0 bottom-0 overflow-hidden"
          style={{
            background: 'var(--bg-card)',
            borderTop: '1px solid var(--border-line)',
            height: isHovered ? '120px' : `${infoMinHeight}px`,
            transition: 'height 0.3s ease',
          }}
        >
          <div className="p-3 text-center">
            <h3 className="text-xs font-semibold truncate mb-1" style={{ color: 'var(--text-primary)' }}>
              {content.title}
            </h3>

            <div className="flex items-center justify-center gap-2">
              {avgScore && (
                <div className="flex items-center gap-0.5">
                  <Star size={10} style={{ color: 'var(--brand)' }} fill="var(--brand)" />
                  <span className="text-xs font-semibold" style={{ color: 'var(--brand)' }}>
                    {avgScore}
                  </span>
                </div>
              )}
              {(content.rating_count ?? 0) > 0 && (
                <div className="flex items-center gap-0.5" style={{ color: 'var(--text-muted)' }}>
                  <Users size={10} />
                  <span className="text-xs">{content.rating_count}</span>
                </div>
              )}
              {content.episodes > 0 && (
                <div className="flex items-center gap-0.5" style={{ color: 'var(--text-muted)' }}>
                  <Play size={10} />
                  <span className="text-xs">{content.episodes}集</span>
                </div>
              )}
            </div>

            <div
              className="overflow-hidden transition-all duration-300"
              style={{
                maxHeight: isHovered ? '60px' : '0px',
                opacity: isHovered ? 1 : 0,
                marginTop: isHovered ? '6px' : '0px',
              }}
            >
              {content.description && (
                <p className="text-xs line-clamp-3 text-center" style={{ color: 'var(--text-secondary)' }}>
                  {content.description}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
