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

/** 评论列表视图：每行左侧番剧信息，右侧朋友们的评分评论集合（气泡样式） */
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
            className="flex gap-4 rounded-xl cursor-pointer transition-all duration-150 hover:shadow-lg hover:scale-[1.005] overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}
            onClick={() => onSelect(item.id)}
          >
            {/* 封面：最左侧，占满行高，适配常见 2:3~3:4 封面比例 */}
            <div
              className="w-[150px] shrink-0 self-stretch"
              style={{ background: 'var(--bg-card-warm)' }}
            >
              {item.cover_url ? (
                <img src={secureUrl(item.cover_url)} alt="" className="w-full h-full object-cover" />
              ) : null}
            </div>

            {/* 中间：番剧信息集合 */}
            <div className="flex flex-col justify-center gap-1.5 py-3 w-[190px] shrink-0">
              <p
                className="text-sm font-semibold leading-snug break-words"
                style={{ color: 'var(--text-primary)' }}
              >
                {item.title}
              </p>
              <div>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ background: `${typeColor}1a`, color: typeColor }}
                >
                  {TYPE_LABEL[item.content_type] || item.content_type}
                </span>
              </div>
              {avg && (
                <div className="flex items-center gap-1.5">
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

            {/* 右侧：朋友们的气泡评论集合（左右块状排列） */}
            <div
              className="flex-1 min-w-0 border-l flex flex-col justify-center gap-1.5 py-3 pr-3 pl-4"
              style={{ borderColor: 'var(--border-line)' }}
            >
              {reviews.length === 0 ? (
                <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <MessageCircle size={12} /> 暂无评论
                </p>
              ) : (
                <div className={reviews.length <= 2 ? 'flex flex-col gap-1.5' : 'columns-2 gap-1.5'}>
                  {reviews.map((r, i) => (
                    <div
                      key={i}
                      className="rounded-xl px-3 py-1.5 break-inside-avoid"
                      style={{
                        background: 'var(--bg-card-warm)',
                        border: '1px solid var(--border-line)',
                        marginBottom: reviews.length <= 2 ? 0 : 6,
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <Avatar name={r.nickname || '?'} size={16} />
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
                        <p
                          className="text-xs mt-0.5 leading-relaxed break-words"
                          style={{
                            color: 'var(--text-secondary)',
                            // 评论少时完整显示，瀑布流时最多 3 行
                            display: reviews.length <= 2 ? 'block' : '-webkit-box',
                            WebkitLineClamp: reviews.length <= 2 ? undefined : 3,
                            WebkitBoxOrient: reviews.length <= 2 ? undefined : 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {r.review}
                        </p>
                      )}
                    </div>
                  ))}
                  {/* +N 条评论：作为最后一块跟在后面，不独占一行 */}
                  {(item.review_count ?? 0) > reviews.length && (
                    <button
                      className="inline-flex items-center rounded-xl px-3 py-1.5 text-[11px] font-medium transition-all duration-150 hover:opacity-80 break-inside-avoid"
                      style={{
                        color: '#FB71A7',
                        background: 'rgba(251, 113, 167, 0.08)',
                        border: '1px dashed rgba(251, 113, 167, 0.4)',
                        alignSelf: reviews.length <= 2 ? 'flex-start' : undefined,
                      }}
                      onClick={e => {
                        e.stopPropagation()
                        onSelect(item.id)
                      }}
                    >
                      +{item.review_count! - reviews.length} 条 ›
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
