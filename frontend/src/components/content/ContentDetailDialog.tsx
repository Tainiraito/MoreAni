import { useEffect, useState } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useToastStore } from '@/stores/toast-store'
import { api } from '@/lib/api'
import { X, Star, Users, Play, BookOpen, Monitor, Gamepad2, Film, Globe, Hash, Building, Calendar } from 'lucide-react'
import type { ContentItem } from '@/types'

/** Force HTTPS for external image URLs */
function secureUrl(url: string): string {
  if (!url) return ''
  if (url.includes('lain.bgm.tv') || url.includes('bgm.tv') || url.includes('bangumi.tv')) {
    return `/api/v1/proxy/image?url=${encodeURIComponent(url)}`
  }
  return url.replace(/^http:\/\//, 'https://')
}

const TYPE_CONFIG: Record<string, { label: string; icon: typeof Star; color: string }> = {
  anime: { label: '番剧', icon: Play, color: 'var(--type-anime)' },
  movie: { label: '电影', icon: Film, color: 'var(--type-movie)' },
  game: { label: '游戏', icon: Gamepad2, color: 'var(--type-game)' },
  software: { label: '软件', icon: Monitor, color: 'var(--type-software)' },
  website: { label: '网站', icon: Globe, color: 'var(--type-website)' },
  book: { label: '书籍', icon: BookOpen, color: 'var(--type-book)' },
}

export function ContentDetailDialog() {
  const { detailOpen, detailContentId, closeDetail } = useUIStore()
  const { user } = useAuthStore()
  const toast = useToastStore.getState()
  const [content, setContent] = useState<ContentItem | null>(null)
  const [loading, setLoading] = useState(false)
  const [score, setScore] = useState(0)
  const [hoverScore, setHoverScore] = useState(0)

  useEffect(() => {
    if (detailOpen && detailContentId) {
      setLoading(true)
      api.getContent(detailContentId)
        .then(c => {
          setContent(c as ContentItem)
          setScore((c as ContentItem).my_rating?.score || 0)
        })
        .catch(() => toast.addToast('error', '加载失败'))
        .finally(() => setLoading(false))
    }
  }, [detailOpen, detailContentId])

  if (!detailOpen) return null

  const handleRate = async (newScore: number) => {
    if (!content || !user) return
    setScore(newScore)
    try {
      await api.upsertRating({ content_id: content.id, score: newScore * 10 })
      const updated = await api.getContent(content.id) as ContentItem
      setContent(updated)
      toast.addToast('success', '评分成功')
    } catch {
      toast.addToast('error', '评分失败')
    }
  }

  const typeConfig = content?.content_type ? TYPE_CONFIG[content.content_type] : null
  const TypeIcon = typeConfig?.icon || Star
  const avgScore = content?.avg_score ? (content.avg_score / 10).toFixed(1) : null

  // Parse metadata
  const metadata = content?.metadata 
    ? (typeof content.metadata === 'string' ? JSON.parse(content.metadata) : content.metadata) 
    : {}
  const tags = metadata.tags || []
  const bangumiScore = metadata.bangumi_score
  const bangumiRank = metadata.bangumi_rank
  const director = metadata.director
  const studio = metadata.studio
  const airDate = metadata.air_date || content?.release_date

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={closeDetail}
      style={{ animation: 'fade-in 200ms ease-out' }}
    >
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* 弹窗 */}
      <div
        className="relative w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-line)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          animation: 'scale-in 200ms ease-out',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* 关闭按钮 */}
        <button
          onClick={closeDetail}
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 hover:opacity-80"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-line)',
            color: 'var(--text-muted)',
          }}
        >
          <X size={16} />
        </button>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div
              className="animate-spin w-8 h-8 border-2 rounded-full"
              style={{ borderColor: 'var(--border-line)', borderTopColor: 'var(--brand)' }}
            />
          </div>
        ) : content ? (
          <div className="overflow-y-auto max-h-[85vh]">
            {/* 封面区域 */}
            <div className="relative" style={{ height: '280px', background: 'var(--bg-card-warm)' }}>
              {content.cover_url ? (
                <img
                  src={secureUrl(content.cover_url)}
                  alt={content.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <TypeIcon size={64} style={{ color: 'var(--text-muted)', opacity: 0.3 }} />
                </div>
              )}
              {/* 渐变遮罩 */}
              <div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(transparent 50%, var(--bg-card) 100%)',
                }}
              />
            </div>

            {/* 内容区域 */}
            <div className="px-6 pb-6 -mt-16 relative">
              {/* 类型标签 */}
              {typeConfig && (
                <div
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium mb-3"
                  style={{
                    background: `${typeConfig.color}20`,
                    color: typeConfig.color,
                  }}
                >
                  <TypeIcon size={12} />
                  {typeConfig.label}
                </div>
              )}

              {/* 标题 */}
              <h2
                className="text-2xl font-bold mb-1"
                style={{ color: 'var(--text-primary)' }}
              >
                {content.title}
              </h2>

              {content.title_alt && (
                <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                  {content.title_alt}
                </p>
              )}

              {/* 评分和统计 */}
              <div className="flex flex-wrap items-center gap-4 mb-4">
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
                    <Hash size={14} />
                    <span className="text-sm">BGM {bangumiScore}</span>
                  </div>
                )}

                {/* 排名 */}
                {bangumiRank && (
                  <div className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                    <span className="text-sm">#{bangumiRank}</span>
                  </div>
                )}
              </div>

              {/* 标签 */}
              {tags.length > 0 && (
                <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                  {tags.map((tag: string, index: number) => (
                    <span key={index}>#{tag} </span>
                  ))}
                </p>
              )}

              {/* 制作信息 */}
              {(director || studio || airDate) && (
                <div
                  className="p-3 rounded-lg mb-4 flex flex-wrap gap-4 text-xs"
                  style={{
                    background: 'var(--bg-card-warm)',
                    border: '1px solid var(--border-line)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {director && (
                    <div className="flex items-center gap-1">
                      <Users size={12} />
                      <span>导演: {director}</span>
                    </div>
                  )}
                  {studio && (
                    <div className="flex items-center gap-1">
                      <Building size={12} />
                      <span>制作: {studio}</span>
                    </div>
                  )}
                  {airDate && (
                    <div className="flex items-center gap-1">
                      <Calendar size={12} />
                      <span>放送: {airDate}</span>
                    </div>
                  )}
                </div>
              )}

              {/* 简介 */}
              {content.description && (
                <p
                  className="text-sm leading-relaxed mb-6"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {content.description}
                </p>
              )}

              {/* 我的评分 */}
              {user && (
                <div
                  className="p-4 rounded-xl"
                  style={{
                    background: 'var(--bg-card-warm)',
                    border: '1px solid var(--border-line)',
                  }}
                >
                  <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
                    我的评分
                  </h3>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => (
                      <button
                        key={i}
                        className="transition-transform duration-150 hover:scale-125"
                        onMouseEnter={() => setHoverScore(i)}
                        onMouseLeave={() => setHoverScore(0)}
                        onClick={() => handleRate(i)}
                      >
                        <Star
                          size={24}
                          style={{
                            color: (hoverScore || score) >= i ? 'var(--brand)' : 'var(--border-line)',
                            fill: (hoverScore || score) >= i ? 'var(--brand)' : 'transparent',
                          }}
                        />
                      </button>
                    ))}
                    {(hoverScore || score) > 0 && (
                      <span
                        className="ml-2 text-sm font-medium"
                        style={{ color: 'var(--brand)' }}
                      >
                        {hoverScore || score}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-muted)' }}>
            内容不存在
          </div>
        )}
      </div>
    </div>
  )
}
