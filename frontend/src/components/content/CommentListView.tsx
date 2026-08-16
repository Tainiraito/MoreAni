import { Star, Users, MessageCircle } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { secureUrl } from '@/components/ui/CoverImage'
import type { ContentItem } from '@/types'

interface CommentListViewProps {
  items: ContentItem[]
  onSelect: (id: number) => void
}

const TYPE_LABEL: Record<string, string> = {
  anime: '番剧', movie: '电影', game: '游戏', software: '软件', website: '网站', book: '书籍',
}

const TYPE_COLOR: Record<string, string> = {
  anime: '#FB71A7', movie: '#00B894', game: '#E17055', software: '#D4A017', website: '#4DA6FF', book: '#E85D5D',
}

/** 评论列表视图：每行左侧番剧信息，右侧朋友们的评分评论集合 */
export function CommentListView({ items, onSelect }: CommentListViewProps) {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center py-32">
        <p className="text-lg" style={{ color: 'var(--text-muted)' }}>暂无内容</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {items.map(item => {
        const avg = item.avg_score && item.avg_score > 0 ? (item.avg_score / 10).toFixed(1) : null
        const reviews = item.recent_reviews || []
        const typeColor = TYPE_COLOR[item.content_type] || '#FB71A7'
        const ratingCount = item.rating_count ?? 0

        return (
          <div
            key={item.id}
            className="flex gap-4 p-3.5 rounded-xl cursor-pointer transition-all duration-150 hover:shadow-lg hover:scale-[1.005]"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}
            onClick={() => onSelect(item.id)}
          >
            {/* 左：番剧信息集合 */}
            <div className="flex items-center gap-3 w-[240px] shrink-0">
              <div
                className="w-12 h-16 rounded-lg overflow-hidden shrink-0"
                style={{ background: 'var(--bg-card-warm)' }}
              >
                {item.cover_url ? (
                  <img src={secureUrl(item.cover_url)} alt="" className="w-full h-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                  {item.title}
                </p>
                <div className="mt-1">
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: `${typeColor}1a`, color: typeColor }}
                  >
                    {TYPE_LABEL[item.content_type] || item.content_type}
                  </span>
                </div>
                {avg && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <Star size={12} style={{ color: '#FB71A7' }} fill="#FB71A7" />
                    <span className="text-xs font-bold" style={{ color: '#FB71A7' }}>{avg}</span>
                    {ratingCount > 0 && (
                      <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--text-muted)' }}>
                        <Users size={10} /> {ratingCount}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 右：朋友们的评分评论集合 */}
            <div
              className="flex-1 min-w-0 border-l pl-4 space-y-2"
              style={{ borderColor: 'var(--border-line)' }}
            >
              {reviews.length === 0 ? (
                <p className="text-xs py-2 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <MessageCircle size={12} /> 暂无评论
                </p>
              ) : (
                reviews.map((r, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Avatar name={r.nickname || '?'} size={20} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {r.nickname}
                        </span>
                        {r.score > 0 && (
                          <span className="text-[11px] font-semibold shrink-0" style={{ color: '#FB71A7' }}>
                            ★{(r.score / 10).toFixed(1)}
                          </span>
                        )}
                      </div>
                      {r.review && (
                        <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                          {r.review}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
