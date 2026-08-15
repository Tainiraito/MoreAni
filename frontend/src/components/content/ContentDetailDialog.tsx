import { useEffect, useState } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { api } from '@/lib/api'
import { TypeBadge } from '@/components/ui/badge'
import { ScoreBadge } from '@/components/rating/ScoreBadge'
import { RatingForm } from '@/components/rating/RatingForm'
import type { ContentItem, Rating } from '@/types'

/** Force HTTPS for external image URLs */
function secureUrl(url: string): string {
  if (!url) return url
  // Proxy external images to bypass CORP/CORS restrictions
  if (url.includes('lain.bgm.tv') || url.includes('bgm.tv') || url.includes('bangumi.tv')) {
    return `/api/v1/proxy/image?url=${encodeURIComponent(url)}`
  }
  return url.replace(/^http:\/\//, 'https://')
}

export function ContentDetailDialog() {
  const { detailOpen, detailContentId, closeDetail } = useUIStore()
  const [content, setContent] = useState<ContentItem | null>(null)
  const [ratings, setRatings] = useState<Rating[]>([])
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (detailOpen && detailContentId) {
      setLoading(true)
      Promise.all([
        api.getContent(detailContentId) as Promise<ContentItem>,
      ]).then(([c]) => {
        setContent(c)
        setLoading(false)
      }).catch(() => setLoading(false))
    }
  }, [detailOpen, detailContentId])

  if (!detailOpen) return null

  const handleRatingSubmit = async (score: number, recommend: number, review: string) => {
    if (!content) return
    await api.upsertRating({ content_id: content.id, score, recommend, review })
    setEditing(false)
    const updated = await api.getContent(content.id) as ContentItem
    setContent(updated)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={closeDetail}>
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" style={{ animation: 'fade-in 150ms ease-out' }} />

      {/* Panel */}
      <div
        className="relative w-full md:w-[720px] bg-white h-full overflow-y-auto shadow-[-4px_0_24px_rgba(0,0,0,0.08)]"
        onClick={e => e.stopPropagation()}
        style={{ animation: 'slide-in-right 200ms ease-out' }}
      >
        {/* Close */}
        <button
          onClick={closeDetail}
          className="absolute top-5 right-5 z-10 w-8 h-8 flex items-center justify-center
                     bg-white/80 backdrop-blur-sm border border-black/[0.08] rounded-full text-muted hover:text-ink hover:bg-white transition-all duration-200"
        >
          ✕
        </button>

        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin w-8 h-8 border-2 border-brand/30 border-t-brand rounded-full" />
          </div>
        ) : content ? (
          <div className="flex flex-col md:flex-row">
            {/* Cover */}
            <div className="md:w-1/2 aspect-[3/4] md:aspect-auto bg-paper">
              {content.cover_url ? (
                <img src={secureUrl(content.cover_url)} alt={content.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-8xl opacity-30">📺</div>
              )}
            </div>

            {/* Info */}
            <div className="md:w-1/2 p-7 space-y-4">
              <TypeBadge type={content.content_type} />

              <h2 className="text-2xl font-bold text-ink tracking-tight leading-snug">
                {content.title}
              </h2>

              {content.title_alt && (
                <p className="text-sm text-muted">{content.title_alt}</p>
              )}

              {/* Score */}
              <div className="flex items-center gap-3">
                <ScoreBadge score={content.avg_score} size="lg" />
                <span className="text-sm text-muted">
                  {content.rating_count || 0} 人评分
                </span>
              </div>

              {/* Description */}
              {content.description && (
                <p className="text-sm text-slate leading-relaxed">{content.description}</p>
              )}

              {/* Rating Section */}
              <div className="border-t border-black/[0.06] pt-5">
                <h3 className="text-sm font-semibold text-ink mb-3">我的评分</h3>
                {editing ? (
                  <RatingForm
                    initialScore={content.my_rating?.score || 0}
                    initialRecommend={content.my_rating?.recommend || 0}
                    initialReview={content.my_rating?.review || ''}
                    onSubmit={handleRatingSubmit}
                    onCancel={() => setEditing(false)}
                  />
                ) : (
                  <div
                    className="cursor-pointer hover:bg-paper/60 p-2.5 rounded-lg transition-colors duration-200"
                    onClick={() => setEditing(true)}
                  >
                    {content.my_rating ? (
                      <div className="flex items-center gap-3">
                        <ScoreBadge score={content.my_rating.score} />
                        <span className="text-sm text-muted">点击修改</span>
                      </div>
                    ) : (
                      <span className="text-sm text-brand font-medium">点击评分 →</span>
                    )}
                  </div>
                )}
              </div>

              {/* Ratings List */}
              {ratings.length > 0 && (
                <div className="border-t border-black/[0.06] pt-5">
                  <h3 className="text-sm font-semibold text-ink mb-3">评分记录</h3>
                  <div className="space-y-2.5">
                    {ratings.map(r => (
                      <div key={r.id} className="flex items-center gap-2 text-sm">
                        <ScoreBadge score={r.score} size="sm" />
                        <span className="text-muted">{r.username || '匿名用户'}</span>
                        {r.review && <span className="text-slate">— {r.review}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted">内容不存在</div>
        )}
      </div>
    </div>
  )
}
