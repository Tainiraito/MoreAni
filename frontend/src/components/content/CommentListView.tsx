import { Star, Users, MessageCircle, Heart } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { CoverImage } from '@/components/ui/CoverImage'
import type { ContentItem } from '@/types'
import { LoadingIcon } from '@/components/ui/loading-icon'

interface CommentListViewProps {
  items: ContentItem[]
  onSelect: (id: number) => void
  isFavorited?: (id: number) => boolean
  onToggleFavorite?: (id: number) => void
  isFavoritePending?: (id: number) => boolean
}

const TYPE_LABEL: Record<string, string> = {
  anime: '番剧', anime_movie: '动画电影', movie: '电影', game: '游戏', software: '软件', website: '网站', book: '书籍',
}

const TYPE_COLOR: Record<string, string> = {
  anime: '#FB71A7', anime_movie: '#FB71A7', movie: '#00B894', game: '#E17055', software: '#D4A017', website: '#4DA6FF', book: '#E85D5D',
}

/** 评论列表视图：每行左侧番剧信息，右侧朋友们的评分/评论动态（气泡样式） */
export function CommentListView({ items, onSelect, isFavorited, onToggleFavorite, isFavoritePending }: CommentListViewProps) {
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
        const activities = item.recent_reviews || []
        const typeColor = TYPE_COLOR[item.content_type] || '#FB71A7'
        const ratingCount = item.rating_count ?? 0
        const activityCount = item.activity_count ?? activities.length

        return (
          <div
            key={item.id}
            className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 overflow-hidden rounded-xl transition-all duration-150 hover:scale-[1.005] hover:shadow-lg sm:grid-cols-[150px_190px_minmax(0,1fr)] sm:gap-4"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}
            onClick={() => onSelect(item.id)}
          >
            {/* 封面：最左侧，占满行高，适配常见 2:3~3:4 封面比例 */}
            <div className="relative col-start-1 row-start-1 w-full self-stretch">
              <CoverImage src={item.cover_url || ''} alt={item.title} />
              {/* 收藏按钮（右上角，与网格视图风格一致） */}
              {onToggleFavorite && (
                <button
                  onClick={e => {
                    e.stopPropagation()
                    onToggleFavorite(item.id)
                  }}
                  disabled={isFavoritePending?.(item.id)}
                  aria-busy={isFavoritePending?.(item.id) || undefined}
                  className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full transition-all duration-150 hover:scale-110"
                  style={{
                    background: isFavorited?.(item.id) ? '#FB71A7' : 'rgba(255, 255, 255, 0.9)',
                    border: 'none',
                    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.15)',
                  }}
                  title={isFavorited?.(item.id) ? '取消收藏' : '收藏'}
                >
                  {isFavoritePending?.(item.id) ? <LoadingIcon size={13} /> : (
                    <Heart
                      size={13}
                      fill={isFavorited?.(item.id) ? 'white' : 'none'}
                      color={isFavorited?.(item.id) ? 'white' : 'var(--text-muted)'}
                    />
                  )}
                </button>
              )}
            </div>

            {/* 中间：番剧信息集合 */}
            <div className="col-start-2 row-start-1 flex min-w-0 flex-col justify-center gap-1.5 py-3">
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
                  <Star size={12} style={{ color: item.my_score ? '#FB71A7' : 'var(--text-muted)' }} fill={item.my_score ? '#FB71A7' : 'none'} />
                  <span className="text-xs font-bold" style={{ color: item.my_score ? '#FB71A7' : 'var(--text-muted)' }}>{avg}</span>
                  {ratingCount > 0 && (
                    <span className="text-[10px] flex items-center gap-0.5" style={{ color: item.my_has_review ? '#FB71A7' : 'var(--text-muted)' }}>
                      <Users size={10} /> {ratingCount}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* 右侧：朋友们的评分/评论动态（左右块状排列） */}
            <div
              className="col-span-2 row-start-2 flex min-w-0 flex-col justify-center gap-1.5 border-t border-l-0 px-3 py-3 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:border-t-0 sm:border-l sm:pl-4 sm:pr-3"
              style={{ borderColor: 'var(--border-line)' }}
            >
              {activities.length === 0 ? (
                <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <MessageCircle size={12} /> 暂无评分或评论
                </p>
              ) : (
                <div className={activities.length <= 2 ? 'flex flex-col gap-1.5' : 'columns-2 gap-1.5'}>
                  {activities.map((r, i) => (
                    <div
                      key={i}
                      className="rounded-xl px-3 py-1.5 break-inside-avoid"
                      style={{
                        background: 'var(--bg-card-warm)',
                        border: '1px solid var(--border-line)',
                        marginBottom: activities.length <= 2 ? 0 : 6,
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <Avatar name={r.nickname || '?'} src={r.avatar_url} crop={r.avatar_crop} size={16} />
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
                            // 动态少时完整显示，瀑布流时最多 3 行
                            display: activities.length <= 2 ? 'block' : '-webkit-box',
                            WebkitLineClamp: activities.length <= 2 ? undefined : 3,
                            WebkitBoxOrient: activities.length <= 2 ? undefined : 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {r.review}
                        </p>
                      )}
                    </div>
                  ))}
                  {/* +N 条动态：作为最后一块跟在后面，不独占一行 */}
                  {activityCount > activities.length && (
                    <button
                      className="inline-flex items-center rounded-xl px-3 py-1.5 text-[11px] font-medium transition-all duration-150 hover:opacity-80 break-inside-avoid"
                      style={{
                        color: '#FB71A7',
                        background: 'rgba(251, 113, 167, 0.08)',
                        border: '1px dashed rgba(251, 113, 167, 0.4)',
                        alignSelf: activities.length <= 2 ? 'flex-start' : undefined,
                      }}
                      onClick={e => {
                        e.stopPropagation()
                        onSelect(item.id)
                      }}
                    >
                      +{activityCount - activities.length} 条动态 ›
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
