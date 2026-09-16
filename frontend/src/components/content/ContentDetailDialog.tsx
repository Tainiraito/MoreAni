import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useToastStore } from '@/stores/toast-store'
import { useRefreshStore } from '@/stores/refresh-store'
import { useLockBodyScroll } from '@/hooks/use-lock-body-scroll'
import { useMaskClose } from '@/hooks/use-mask-close'
import { api } from '@/lib/api'
import { contentDetailQueryKey } from '@/lib/content-detail-query'
import { X, Star, Users, Play, BookOpen, Monitor, Gamepad2, Film, Globe, Building, Calendar, MessageCircle, ExternalLink, Heart, Trash2, Pencil, Search } from 'lucide-react'
import { secureUrl } from '@/lib/image-url'
import { Avatar } from '@/components/ui/Avatar'
import { CollapsibleText } from '@/components/ui/CollapsibleText'
import { StarRating } from '@/components/rating/StarRating'
import { AnimeResourceDialog } from '@/components/content/AnimeResourceDialog'
import { LoadingIcon } from '@/components/ui/loading-icon'
import { ReviewEditor } from '@/components/review/ReviewEditor'
import { ReviewText } from '@/components/review/ReviewText'
import type { AvatarCrop, ContentItem } from '@/types'

const TYPE_CONFIG: Record<string, { label: string; icon: typeof Star; color: string }> = {
  anime: { label: '番剧', icon: Play, color: 'var(--type-anime)' },
  anime_movie: { label: '动画电影', icon: Film, color: '#FB71A7' },
  movie: { label: '电影', icon: Film, color: 'var(--type-movie)' },
  game: { label: '游戏', icon: Gamepad2, color: 'var(--type-game)' },
  software: { label: '软件', icon: Monitor, color: 'var(--type-software)' },
  website: { label: '网站', icon: Globe, color: 'var(--type-website)' },
  book: { label: '书籍', icon: BookOpen, color: 'var(--type-book)' },
}

interface Review {
  id: number
  content_id: number
  user_id: number
  username: string
  nickname: string
  avatar_id: number
  avatar_url?: string | null
  avatar_crop?: AvatarCrop | null
  score: number
  recommend: number
  review: string
  created_at: string
}

interface ContentDetailData {
  content: ContentItem
  reviews: Review[]
}

const CONTENT_DETAIL_STALE_TIME_MS = 60_000
const CONTENT_DETAIL_GC_TIME_MS = 5 * 60_000

type ReviewDiscardAction = 'close-detail' | 'cancel-edit'

interface ContentDetailDialogProps {
  isFavorited?: boolean
  isFavoritePending?: boolean
  onToggleFavorite?: (id: number) => void
}

export function ContentDetailDialog({ isFavorited = false, isFavoritePending = false, onToggleFavorite }: ContentDetailDialogProps) {
  const { detailOpen, detailContentId, closeDetail, openEditContent, resourceFocus, clearResourceFocus } = useUIStore()
  const location = useLocation()
  const navigate = useNavigate()
  useLockBodyScroll(detailOpen)
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const addToast = useToastStore(state => state.addToast)
  const userId = user?.id ?? null
  const [score, setScore] = useState(0)
  const [reviewText, setReviewText] = useState('')
  const [savedReviewText, setSavedReviewText] = useState('')
  const [myRatingId, setMyRatingId] = useState<number | null>(null)
  const [bangumiScore, setBangumiScore] = useState<number | null>(null)
  const [bangumiLoading, setBangumiLoading] = useState(false)
  const [savingRating, setSavingRating] = useState(false)
  const [deletingRating, setDeletingRating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [reviewDiscardAction, setReviewDiscardAction] = useState<ReviewDiscardAction | null>(null)
  const [resourceOpen, setResourceOpen] = useState(false)
  const [readyDetailKey, setReadyDetailKey] = useState<string | null>(null)
  const previousDetailKey = useRef<string | null>(null)
  const previousLocationRef = useRef(`${location.pathname}${location.search}${location.hash}`)

  const currentDetailKey = detailOpen && detailContentId !== null
    ? `${detailContentId}:${userId ?? 'guest'}`
    : null

  useEffect(() => {
    setReadyDetailKey(null)
    if (!currentDetailKey) return

    const timer = window.setTimeout(() => setReadyDetailKey(currentDetailKey), 0)
    return () => window.clearTimeout(timer)
  }, [currentDetailKey])

  const reviewEditorVisible = !myRatingId || editing
  const reviewDirty = reviewEditorVisible && reviewText !== savedReviewText

  const discardReviewChanges = useCallback(() => {
    setReviewText(savedReviewText)
    setEditing(false)
  }, [savedReviewText])

  const closeDetailWithoutPrompt = useCallback(() => {
    discardReviewChanges()
    setReviewDiscardAction(null)
    closeDetail()
  }, [closeDetail, discardReviewChanges])

  const requestCloseDetail = useCallback(() => {
    if (reviewDirty) {
      setReviewDiscardAction('close-detail')
      return
    }
    closeDetailWithoutPrompt()
  }, [closeDetailWithoutPrompt, reviewDirty])

  const requestCancelEdit = useCallback(() => {
    if (reviewDirty) {
      setReviewDiscardAction('cancel-edit')
      return
    }
    discardReviewChanges()
  }, [discardReviewChanges, reviewDirty])

  const maskProps = useMaskClose(requestCloseDetail)

  const detailQuery = useQuery<ContentDetailData>({
    queryKey: contentDetailQueryKey(detailContentId, userId),
    enabled: currentDetailKey !== null && readyDetailKey === currentDetailKey,
    queryFn: async ({ signal }) => {
      const contentId = detailContentId
      if (contentId === null) throw new Error('缺少内容 ID')
      const [nextContent, ratingsRes] = await Promise.all([
        api.getContent(contentId, { signal }),
        api.getContentRatings(contentId, { size: '50' }, { signal }),
      ])
      return {
        content: nextContent,
        reviews: (ratingsRes.items || []) as Review[],
      }
    },
    staleTime: CONTENT_DETAIL_STALE_TIME_MS,
    gcTime: CONTENT_DETAIL_GC_TIME_MS,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const content = detailQuery.data?.content ?? null
  const allReviews = detailQuery.data?.reviews ?? []
  const loading = detailQuery.isPending || (detailQuery.isFetching && !detailQuery.data)

  useEffect(() => {
    if (!detailQuery.data) return
    const mine = userId
      ? detailQuery.data.reviews.find(review => review.user_id === userId)
      : undefined
    const nextReviewText = mine?.review || ''
    setScore(mine ? mine.score / 10 : 0)
    setReviewText(nextReviewText)
    setSavedReviewText(nextReviewText)
    setMyRatingId(mine?.id ?? null)
  }, [detailQuery.data, userId])

  useEffect(() => {
    if (detailQuery.isError) addToast('error', '加载失败')
  }, [addToast, detailQuery.error, detailQuery.isError])

  useEffect(() => {
    const nextDetailKey = detailOpen && detailContentId !== null ? String(detailContentId) : null
    if (previousDetailKey.current !== nextDetailKey) {
      previousDetailKey.current = nextDetailKey
      setResourceOpen(false)
      setBangumiScore(null)
      setEditing(false)
    }
  }, [detailContentId, detailOpen])

  useEffect(() => {
    if (detailOpen && content && resourceFocus?.contentId === content.id) {
      setResourceOpen(true)
    }
  }, [content, detailOpen, resourceFocus?.contentId])

  useEffect(() => {
    const currentLocation = `${location.pathname}${location.search}${location.hash}`
    if (!detailOpen || !reviewDirty) {
      previousLocationRef.current = currentLocation
      return
    }
    if (previousLocationRef.current === currentLocation) return

    const previousLocation = previousLocationRef.current
    if (window.confirm('评论内容尚未保存，确定离开当前页面吗？')) {
      previousLocationRef.current = currentLocation
      closeDetailWithoutPrompt()
      return
    }

    navigate(previousLocation, { replace: true })
  }, [closeDetailWithoutPrompt, detailOpen, location.hash, location.pathname, location.search, navigate, reviewDirty])

  useEffect(() => {
    if (!reviewDirty) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [reviewDirty])

  // Lock body scroll when dialog is open
  useEffect(() => {
    if (detailOpen) {
      const scrollY = window.scrollY
      document.documentElement.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
      return () => {
        document.documentElement.style.overflow = ''
        document.body.style.overflow = ''
        requestAnimationFrame(() => window.scrollTo(0, scrollY))
      }
    }
  }, [detailOpen])

  if (!detailOpen) return null

  // Save button — actually submit to API
  const handleSave = async () => {
    if (!content || !user) return
    // 允许「只打分不评论」和「只评论不打分」；两者都空才阻止
    if (score <= 0 && !reviewText.trim()) return
    if (savingRating || deletingRating) return
    setSavingRating(true)
    try {
      await api.upsertRating({
        content_id: content.id,
        score: score * 10,
        review: reviewText,
      })
      setSavedReviewText(reviewText)
      setEditing(false)
      await queryClient.invalidateQueries({ queryKey: contentDetailQueryKey(content.id, userId) })
      // 触发列表刷新；详情数据由上面的查询失效机制更新
      useRefreshStore.getState().triggerRefresh()
      addToast('success', '评分已保存')
    } catch {
      // 全局 request() 已处理 toast
    } finally {
      setSavingRating(false)
    }
  }

  const handleDeleteRating = async () => {
    if (!myRatingId || deletingRating || savingRating) return
    setDeletingRating(true)
    try {
      await api.deleteRating(myRatingId)
      setScore(0)
      setReviewText('')
      setSavedReviewText('')
      setMyRatingId(null)
      if (content) await queryClient.invalidateQueries({ queryKey: contentDetailQueryKey(content.id, userId) })
      // 通知列表刷新（删除评分后 my_score 变化）
      useRefreshStore.getState().triggerRefresh()
      addToast('success', '评分已删除')
    } catch {
      // 全局 request() 已处理 toast
    } finally {
      setDeletingRating(false)
    }
  }

  const handleToggleFavorite = () => {
    if (!content || !onToggleFavorite) return
    onToggleFavorite(content.id)
  }

  const handleFetchBangumiScore = async () => {
    if (!content || bangumiLoading) return
    setBangumiLoading(true)
    try {
      let bgmId = content.source_id ? parseInt(content.source_id) : null
      // If no source_id, search Bangumi by title
      if (!bgmId) {
        const searchRes = await api.searchBangumi(content.title)
        const items = (searchRes.items || []) as { bgm_id: number }[]
        if (items.length > 0) bgmId = items[0].bgm_id
      }
      if (!bgmId) {
        addToast('error', '未在 Bangumi 找到匹配条目')
        return
      }
      const res = await api.getBangumiScore(bgmId)
      setBangumiScore(res.score)
    } catch {
      // 全局 request() 已处理 toast
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
  // Prefer content.tags (Tag table) over metadata.tags (old Bangumi import)
  const tags = (content?.tags && content.tags.length > 0)
    ? content.tags.map((t: { name: string }) => t.name)
    : (metadata.tags || [])
  const director = metadata.director
  const studio = metadata.studio
  const airDate = metadata.air_date || content?.release_date
  const collapsibleResetKey = content ? `${content.id}:${content.updated_at}` : 'empty'
  const otherReviews = allReviews.filter(review => !user || review.user_id !== user.id)

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ animation: 'fade-in 200ms ease-out' }}
      >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" {...maskProps} />

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
        {/* 顶部按钮区 */}
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          {user && (
            <button
              onClick={handleToggleFavorite}
              disabled={isFavoritePending}
              aria-busy={isFavoritePending || undefined}
              className="w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200"
              style={{
                background: isFavorited ? '#FB71A7' : 'var(--bg-card)',
                border: isFavorited ? 'none' : '1px solid var(--border-line)',
                color: isFavorited ? 'white' : 'var(--text-muted)',
              }}
              onMouseEnter={e => {
                if (!isFavorited) {
                  e.currentTarget.style.borderColor = '#FB71A7'
                  e.currentTarget.style.color = '#FB71A7'
                }
              }}
              onMouseLeave={e => {
                if (!isFavorited) {
                  e.currentTarget.style.borderColor = 'var(--border-line)'
                  e.currentTarget.style.color = 'var(--text-muted)'
                }
              }}
            >
              {isFavoritePending ? <LoadingIcon size={14} /> : <Heart size={14} fill={isFavorited ? 'white' : 'none'} />}
            </button>
          )}
          {user && content && (
            <button
              onClick={() => openEditContent(content.id)}
              disabled={content.created_by !== user.id && user.role !== 'admin' && user.role !== 'super_admin'}
              className="w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-line)',
                color: 'var(--text-muted)',
              }}
              onMouseEnter={e => {
                if (!e.currentTarget.disabled) {
                  e.currentTarget.style.borderColor = '#FB71A7'
                  e.currentTarget.style.color = '#FB71A7'
                }
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border-line)'
                e.currentTarget.style.color = 'var(--text-muted)'
              }}
              title={content.created_by !== user.id && user.role !== 'admin' && user.role !== 'super_admin' ? '无权编辑' : '编辑'}
            >
              <Pencil size={14} />
            </button>
          )}
          <button
            onClick={requestCloseDetail}
            aria-label="关闭详情"
            className="w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-line)',
              color: 'var(--text-muted)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = '#FB71A7'
              e.currentTarget.style.color = '#FB71A7'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border-line)'
              e.currentTarget.style.color = 'var(--text-muted)'
            }}
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div
              className="animate-spin w-8 h-8 border-2 rounded-full"
              style={{ borderColor: 'var(--border-line)', borderTopColor: '#FB71A7' }}
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
                    <Star size={18} style={{ color: content.my_score ? '#FB71A7' : 'var(--text-muted)' }} fill={content.my_score ? '#FB71A7' : 'none'} />
                    <span className="text-lg font-bold" style={{ color: content.my_score ? '#FB71A7' : 'var(--text-muted)' }}>
                      {avgScore}
                    </span>
                  </div>
                )}

                {(content.rating_count ?? 0) > 0 && (
                  <div className="flex items-center gap-1" style={{ color: content.my_has_review ? '#FB71A7' : 'var(--text-muted)' }}>
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
                {user && (content.content_type === 'anime' || content.content_type === 'anime_movie') && (
                  <button
                    type="button"
                    onClick={() => setResourceOpen(true)}
                    className="flex cursor-pointer items-center gap-1 text-xs transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#FB71A7]/50"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <Search size={12} />
                    寻找资源
                  </button>
                )}
              </div>

              {tags.length > 0 && (
                <CollapsibleText
                  label="标签"
                  lineHeight={24}
                  resetKey={collapsibleResetKey}
                  className="text-xs mb-4"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {tags.map((tag: string, index: number) => (
                    <span key={index}>#{tag}{' '}</span>
                  ))}
                </CollapsibleText>
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
                <CollapsibleText
                  label="简介"
                  lineHeight={28}
                  resetKey={collapsibleResetKey}
                  className="text-sm mb-6"
                  contentClassName="whitespace-pre-line"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {content.description}
                </CollapsibleText>
              )}

              {/* ===== 我的评论（查看态 / 编辑态） ===== */}
              {user && (
                myRatingId && !editing ? (
                  /* 查看态 — 评论卡片，样式与站内评论统一 */
                  <div
                    className="p-3 rounded-lg mb-6 cursor-pointer transition-all duration-200 hover:opacity-80"
                    style={{
                      background: 'var(--bg-card-warm)',
                      border: '1px solid rgba(251,113,167,0.3)',
                    }}
                    onClick={() => setEditing(true)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Avatar name={user.nickname} src={user.avatar_url} crop={user.avatar_crop} size={24} />
                        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                          {user.nickname}
                          <span className="ml-1.5 font-normal" style={{ color: '#FB71A7' }}>
                            点击编辑
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {score > 0 ? (
                          <>
                            <Star size={12} style={{ color: '#FB71A7' }} fill="#FB71A7" />
                            <span className="text-xs" style={{ color: '#FB71A7' }}>
                              {score.toFixed(1)}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            未打分
                          </span>
                        )}
                      </div>
                    </div>
                    {reviewText && <ReviewText text={reviewText} className="block text-xs" style={{ color: 'var(--text-secondary)' }} />}
                  </div>
                ) : (
                  /* 编辑态 — 星星 + 评论 + 保存 */
                  <div
                    className="p-4 rounded-xl mb-6"
                    style={{
                      background: 'var(--bg-card-warm)',
                      border: '1px solid var(--border-line)',
                    }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {myRatingId ? '修改评分' : '我的评分'}
                      </h3>
                      <div className="flex items-center gap-2">
                        {content && (
                          <button
                            onClick={handleFetchBangumiScore}
                            disabled={bangumiLoading}
                            aria-busy={bangumiLoading || undefined}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md transition-all duration-200 hover:opacity-80 disabled:opacity-50"
                            style={{
                              background: 'var(--bg-card)',
                              border: '1px solid var(--border-line)',
                              color: 'var(--text-muted)',
                            }}
                          >
                            {bangumiLoading ? (
                              <LoadingIcon size={12} />
                            ) : (
                              <ExternalLink size={10} />
                            )}
                            {bangumiScore !== null ? `BGM ${bangumiScore}` : 'Bangumi 参考'}
                          </button>
                        )}
                        {myRatingId && (
                          <>
                            <button
                              onClick={handleDeleteRating}
                              disabled={deletingRating || savingRating}
                              aria-busy={deletingRating || undefined}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md transition-all duration-200 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                              style={{ background: 'var(--bg-card)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}
                            >
                              {deletingRating ? <LoadingIcon size={12} /> : <Trash2 size={10} />}
                              删除
                            </button>
                            <button
                              onClick={requestCancelEdit}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md transition-all duration-200 hover:opacity-80"
                              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', color: 'var(--text-muted)' }}
                            >
                              取消
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* 星星 — 只改本地状态 */}
                    <div className="mb-3">
                      <StarRating
                        value={score}
                        onChange={setScore}
                        ariaLabel="我的评分"
                      />
                    </div>

                    {/* 评论输入 */}
                    <ReviewEditor
                      value={reviewText}
                      onChange={setReviewText}
                      rows={2}
                    />

                    {/* 保存（score=0 也可保存：只写评论不打分） */}
                    <button
                      onClick={handleSave}
                      disabled={savingRating || deletingRating || (score <= 0 && !reviewText.trim())}
                      aria-busy={savingRating || undefined}
                      className="mt-2 inline-flex w-full items-center justify-center gap-2 py-2 text-sm font-semibold rounded-lg transition-all duration-200 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ background: '#FB71A7', color: 'white', border: 'none' }}
                    >
                      {savingRating && <LoadingIcon size={15} />}
                      保存
                    </button>
                  </div>
                )
              )}

              {/* ===== 站内评论（仅他人） ===== */}
              {otherReviews.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <MessageCircle size={16} />
                    站内评论
                  </h3>
                  <div className="space-y-3">
                    {otherReviews.map((review) => (
                      <div
                        key={review.id}
                        className="p-3 rounded-lg"
                        style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Avatar name={review.nickname || review.username} src={review.avatar_url} crop={review.avatar_crop} size={24} />
                            <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                              {review.nickname || review.username}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            {review.score > 0 && (
                              <>
                                <Star size={12} style={{ color: '#FB71A7' }} fill="#FB71A7" />
                                <span className="text-xs" style={{ color: '#FB71A7' }}>
                                  {(review.score / 10).toFixed(1)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        {review.review && (
                          <ReviewText
                            text={review.review}
                            className="text-xs"
                            style={{ color: 'var(--text-secondary)' }}
                          />
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
      {content && resourceOpen && (
        <AnimeResourceDialog
          open
          content={content}
          focusSource={resourceFocus?.source}
          focusFansubName={resourceFocus?.fansubName}
          focusFansubId={resourceFocus?.fansubId}
          focusResourceKey={resourceFocus?.resourceKey}
          onClose={() => {
            setResourceOpen(false)
            clearResourceFocus()
          }}
        />
      )}
      </div>

      {reviewDiscardAction && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="review-discard-title">
          <div
            className="w-full max-w-sm rounded-xl p-5"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', boxShadow: 'var(--shadow-popup)' }}
            onClick={event => event.stopPropagation()}
          >
            <h3 id="review-discard-title" className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              评论内容未保存
            </h3>
            <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
              {reviewDiscardAction === 'close-detail' ? '关闭弹窗将丢失本次评论编辑，确定放弃吗？' : '取消编辑将丢失本次评论编辑，确定放弃吗？'}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReviewDiscardAction(null)}
                className="h-9 rounded-lg px-4 text-sm transition-opacity hover:opacity-80"
                style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)', color: 'var(--text-muted)' }}
              >
                继续编辑
              </button>
              <button
                type="button"
                onClick={() => {
                  const action = reviewDiscardAction
                  setReviewDiscardAction(null)
                  discardReviewChanges()
                  if (action === 'close-detail') closeDetail()
                }}
                className="h-9 rounded-lg px-4 text-sm font-medium transition-opacity hover:opacity-80"
                style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
              >
                放弃修改
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
