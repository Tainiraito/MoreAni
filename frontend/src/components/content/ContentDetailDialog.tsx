import { useEffect, useState } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useToastStore } from '@/stores/toast-store'
import { api } from '@/lib/api'
import { X, Star, Users, Play, BookOpen, Monitor, Gamepad2, Film, Globe, Building, Calendar, MessageCircle, ExternalLink, Heart } from 'lucide-react'
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

interface Review {
  id: number
  username: string
  avatar_id: number
  score: number
  recommend: number
  review: string
  created_at: string
}

export function ContentDetailDialog() {
  const { detailOpen, detailContentId, closeDetail } = useUIStore()
  const { user } = useAuthStore()
  const toast = useToastStore.getState()
  const [content, setContent] = useState<ContentItem | null>(null)
  const [loading, setLoading] = useState(false)
  const [score, setScore] = useState(0)
  const [hoverScore, setHoverScore] = useState(0)
  const [reviews, setReviews] = useState<Review[]>([])
  const [bangumiScore, setBangumiScore] = useState<number | null>(null)
  const [bangumiLoading, setBangumiLoading] = useState(false)
  const [isFavorited, setIsFavorited] = useState(false)

  useEffect(() => {
    if (detailOpen && detailContentId) {
      setLoading(true)
      setBangumiScore(null)
      setScore(0)
      setIsFavorited(false)
      
      Promise.all([
        api.getContent(detailContentId) as Promise<ContentItem>,
        api.getContentRatings(detailContentId, { size: '10' }),
        user ? api.getMyStatuses() : Promise.resolve({ items: [] }),
      ])
        .then(([c, ratingsRes, statusRes]) => {
          setContent(c)
          setScore(c.my_rating?.score || 0)
          setReviews((ratingsRes.items || []) as Review[])
          
          // 检查收藏状态
          const statuses = (statusRes.items || []) as { content_id: number; status: string }[]
          const found = statuses.find(s => s.content_id === c.id)
          setIsFavorited(found?.status === 'want')
        })
        .catch(() => toast.addToast('error', '加载失败'))
        .finally(() => setLoading(false))
    }
  }, [detailOpen, detailContentId, user])

  if (!detailOpen) return null

  const handleRate = async (newScore: number) => {
    if (!content || !user) return
    setScore(newScore)
    try {
      await api.upsertRating({ content_id: content.id, score: newScore * 10 })
      const updated = await api.getContent(content.id) as ContentItem
      setContent(updated)
      const ratingsRes = await api.getContentRatings(content.id, { size: '10' })
      setReviews((ratingsRes.items || []) as Review[])
      toast.addToast('success', '评分成功')
    } catch {
      toast.addToast('error', '评分失败')
    }
  }

  const handleToggleFavorite = async () => {
    if (!content || !user) return
    try {
      if (isFavorited) {
        await api.clearStatus(content.id)
        setIsFavorited(false)
        toast.addToast('success', '已取消收藏')
      } else {
        await api.setStatus({ content_id: content.id, status: 'want' })
        setIsFavorited(true)
        toast.addToast('success', '已收藏')
      }
    } catch {
      toast.addToast('error', '操作失败')
    }
  }

  const handleFetchBangumiScore = async () => {
    if (!content?.source_id || content.source_type !== 'bangumi') return
    setBangumiLoading(true)
    try {
      const res = await api.getBangumiScore(parseInt(content.source_id))
      setBangumiScore(res.score)
    } catch {
      toast.addToast('error', '查询失败')
    } finally {
      setBangumiLoading(false)
    }
  }

  const typeConfig = content?.content_type ? TYPE_CONFIG[content.content_type] : null
  const TypeIcon = typeConfig?.icon || Star
  const avgScore = content?.avg_score ? (content.avg_score / 10).toFixed(1) : null

  const metadata = content?.metadata 
    ? (typeof content.metadata === 'string' ? JSON.parse(content.metadata) : content.metadata) 
    : {}
  const tags = metadata.tags || []
  const director = metadata.director
  const studio = metadata.studio
  const airDate = metadata.air_date || content?.release_date

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={closeDetail}
      style={{ animation: 'fade-in 200ms ease-out' }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

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
        {/* 顶部按钮区 - 收藏 + 关闭 */}
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          {user && (
            <button
              onClick={handleToggleFavorite}
              className="w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 hover:opacity-80"
              style={{
                background: isFavorited ? 'var(--brand)' : 'var(--bg-card)',
                border: isFavorited ? 'none' : '1px solid var(--border-line)',
                color: isFavorited ? 'white' : 'var(--text-muted)',
              }}
            >
              <Heart size={14} fill={isFavorited ? 'white' : 'none'} />
            </button>
          )}
          <button
            onClick={closeDetail}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 hover:opacity-80"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-line)',
              color: 'var(--text-muted)',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div
              className="animate-spin w-8 h-8 border-2 rounded-full"
              style={{ borderColor: 'var(--border-line)', borderTopColor: 'var(--brand)' }}
            />
          </div>
        ) : content ? (
          <div className="overflow-y-auto max-h-[85vh]">
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
              <div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(transparent 50%, var(--bg-card) 100%)',
                }}
              />
            </div>

            <div className="px-6 pb-6 -mt-16 relative">
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

              <div className="flex flex-wrap items-center gap-4 mb-4">
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

                {content.source_url && (
                  <a
                    href={content.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs"
                    style={{ color: 'var(--text-muted)' }}
                    onClick={e => e.stopPropagation()}
                  >
                    <ExternalLink size={12} />
                    Bangumi
                  </a>
                )}
              </div>

              {tags.length > 0 && (
                <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                  {tags.map((tag: string, index: number) => (
                    <span key={index}>#{tag} </span>
                  ))}
                </p>
              )}

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

              {content.description && (
                <p
                  className="text-sm leading-relaxed mb-6"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {content.description}
                </p>
              )}

              {user && (
                <div
                  className="p-4 rounded-xl mb-6"
                  style={{
                    background: 'var(--bg-card-warm)',
                    border: '1px solid var(--border-line)',
                  }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      我的评分
                    </h3>
                    
                    {content.source_type === 'bangumi' && content.source_id && (
                      <button
                        onClick={handleFetchBangumiScore}
                        disabled={bangumiLoading}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md transition-all duration-200 hover:opacity-80 disabled:opacity-50"
                        style={{
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border-line)',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {bangumiLoading ? (
                          <div
                            className="animate-spin w-3 h-3 border rounded-full"
                            style={{ borderColor: 'var(--border-line)', borderTopColor: 'var(--brand)' }}
                          />
                        ) : (
                          <ExternalLink size={10} />
                        )}
                        {bangumiScore !== null ? `BGM ${bangumiScore}` : 'Bangumi 参考'}
                      </button>
                    )}
                  </div>
                  
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

              {reviews.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <MessageCircle size={16} />
                    站内评论
                  </h3>
                  <div className="space-y-3">
                    {reviews.map((review) => (
                      <div
                        key={review.id}
                        className="p-3 rounded-lg"
                        style={{
                          background: 'var(--bg-card-warm)',
                          border: '1px solid var(--border-line)',
                        }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium"
                              style={{
                                background: 'var(--brand)',
                                color: 'white',
                              }}
                            >
                              {review.username.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                              {review.username}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Star size={12} style={{ color: 'var(--brand)' }} fill="var(--brand)" />
                            <span className="text-xs" style={{ color: 'var(--brand)' }}>
                              {(review.score / 10).toFixed(1)}
                            </span>
                          </div>
                        </div>
                        {review.review && (
                          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {review.review}
                          </p>
                        )}
                      </div>
                    ))}
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
