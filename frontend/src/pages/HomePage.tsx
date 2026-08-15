import { useState, useEffect, useCallback, useRef } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useFavoriteStore } from '@/stores/favorite-store'
import { useRefreshStore } from '@/stores/refresh-store'
import { api } from '@/lib/api'
import { PageMain } from '@/components/layout/PageContainer'
import { HeroBrand } from '@/components/layout/HeroBrand'
import { AnimeCard } from '@/components/content/AnimeCard'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { HeroSection } from '@/components/content/HeroSection'
import type { ContentItem, ContentType } from '@/types'

const PAGE_SIZE = 20

export function HomePage() {
  const { user } = useAuthStore()
  const { openDetail, openAddAnime } = useUIStore()
  const { isFavorited, toggleFavorite } = useFavoriteStore()
  const refreshKey = useRefreshStore(s => s.refreshKey)
  const [activeType, setActiveType] = useState<ContentType | 'all'>('anime')
  const [items, setItems] = useState<ContentItem[]>([])
  const [hero, setHero] = useState<ContentItem | null>(null)
  const [allAnime, setAllAnime] = useState<ContentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)

  // Search and filter state
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [ratedFilter, setRatedFilter] = useState<'' | 'rated' | 'unrated'>('')
  const [sortBy, setSortBy] = useState('updated_desc')

  // Infinite scroll pagination state
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const isLoadingMoreRef = useRef(false)
  const AUTO_REFRESH_MS = 11000

  // hero 的收藏状态直接从 store 派生
  const heroFavorited = hero ? isFavorited(hero.id) : false

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  // 加载所有番剧
  useEffect(() => {
    if (!user) return

    api.listContent({ type: 'anime' })
      .then(res => {
        const animeList = (res.items || []) as ContentItem[]
        const withCover = animeList.filter(i => i.cover_url)
        setAllAnime(withCover)
        
        if (withCover.length > 0) {
          const randomIndex = Math.floor(Math.random() * withCover.length)
          setHero(withCover[randomIndex])
        }
      })
      .catch(() => {})
  }, [user])

  // 加载当前 tab 的内容（重置分页）
  useEffect(() => {
    if (!user) return

    setLoading(true)
    setPage(1)
    setHasMore(true)
    setTotalCount(0)

    const params: Record<string, string> = { page: '1', size: String(PAGE_SIZE), type: activeType }
    if (searchQuery) params.q = searchQuery
    if (ratedFilter) params.rated = ratedFilter
    if (sortBy !== 'updated_desc') params.sort = sortBy

    api.listContent(params)
      .then(res => {
        const list = (res.items || []) as ContentItem[]
        setItems(list)
        setTotalCount(res.total || 0)
        setHasMore(list.length >= PAGE_SIZE)
      })
      .catch(() => { setItems([]); setHasMore(false) })
      .finally(() => setLoading(false))
  }, [activeType, user, searchQuery, ratedFilter, refreshKey, sortBy])

  // 加载更多（下一页）
  const loadMore = useCallback(async () => {
    if (isLoadingMoreRef.current || !hasMore || loading) return
    isLoadingMoreRef.current = true
    setLoadingMore(true)

    const nextPage = page + 1
    const params: Record<string, string> = { page: String(nextPage), size: String(PAGE_SIZE), type: activeType }
    if (searchQuery) params.q = searchQuery
    if (ratedFilter) params.rated = ratedFilter
    if (sortBy !== 'updated_desc') params.sort = sortBy

    try {
      const res = await api.listContent(params)
      const list = (res.items || []) as ContentItem[]
      setItems(prev => [...prev, ...list])
      setPage(nextPage)
      setHasMore(list.length >= PAGE_SIZE)
    } catch {
      // ignore load-more errors
    } finally {
      setLoadingMore(false)
      isLoadingMoreRef.current = false
    }
  }, [page, hasMore, loading, activeType, searchQuery, ratedFilter])

  // 滚动监听：接近底部 300px 时触发 loadMore
  useEffect(() => {
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = document.documentElement
      if (scrollHeight - scrollTop - clientHeight < 300) {
        loadMore()
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [loadMore])

  // 换一个精选（手动或自动触发）
  const handleRefreshHero = useCallback(() => {
    if (allAnime.length === 0) {
      setHero(null)
      return
    }

    const remaining = allAnime.filter(a => a.id !== hero?.id)
    if (remaining.length === 0) {
      const randomIndex = Math.floor(Math.random() * allAnime.length)
      setHero(allAnime[randomIndex])
    } else {
      const randomIndex = Math.floor(Math.random() * remaining.length)
      setHero(remaining[randomIndex])
    }
    // Reset progress — timer restarts via useEffect on hero change
    setProgress(0)
  }, [allAnime, hero])

  // Auto-refresh: CSS transition drives the animation, JS only sets start/end
  useEffect(() => {
    if (!hero || allAnime.length <= 1) {
      setProgress(0)
      return
    }

    // Step 1: reset to 0 (transition: none, instant)
    setProgress(0)

    // Step 2: double rAF — guarantee 0% is painted before starting 100% animation
    let timer: ReturnType<typeof setTimeout>
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        setProgress(100)
        timer = setTimeout(() => {
          if (allAnime.length > 1) {
            const remaining = allAnime.filter(a => a.id !== hero?.id)
            const pool = remaining.length > 0 ? remaining : allAnime
            const randomIndex = Math.floor(Math.random() * pool.length)
            setHero(pool[randomIndex])
          }
        }, AUTO_REFRESH_MS)
      })
      // Store raf2 for cleanup
      cleanupRaf2 = raf2
    })

    let cleanupRaf2 = 0

    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(cleanupRaf2)
      clearTimeout(timer)
    }
  }, [hero?.id, allAnime.length])

  // 未登录只显示首屏
  if (!user) {
    return <HeroBrand />
  }

  const animeItems = items.filter(i => i.content_type === 'anime')

  return (
    <PageMain>
      <HeroBrand />

      <div className="pb-20 sm:pb-24">
        {hero && (
          <div className="relative">
            <HeroSection
              content={hero}
              isFavorited={heroFavorited}
              onSelect={openDetail}
              onToggleFavorite={() => toggleFavorite(hero.id)}
              onRefresh={handleRefreshHero}
              progress={progress}
              autoRefreshMs={AUTO_REFRESH_MS}
            />
          </div>
        )}

        {/* Tab 分类 */}
        <div
          className="flex gap-6 overflow-x-auto mb-4 -mx-6 px-6"
          style={{ borderBottom: '1px solid var(--border-line)' }}
        >
          {(['anime', 'movie', 'game', 'software', 'website', 'book'] as const).map(val => {
            const labels: Record<string, string> = { anime: '番剧', movie: '电影', game: '游戏', software: '软件', website: '网站', book: '书籍' }
            const isActive = activeType === val
            const isDisabled = val !== 'anime'
            return (
              <button
                key={val}
                onClick={() => !isDisabled && setActiveType(val)}
                disabled={isDisabled}
                className="relative min-h-[3.25rem] whitespace-nowrap pb-3 text-sm font-medium transition-colors duration-150"
                style={{
                  color: isActive ? '#FB71A7' : isDisabled ? 'var(--text-muted)' : 'var(--text-muted)',
                  borderBottom: isActive ? '2px solid #FB71A7' : '2px solid transparent',
                  opacity: isDisabled ? 0.4 : 1,
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                }}
              >
                {labels[val]}
              </button>
            )
          })}
        </div>

        {/* 搜索、筛选、排序 */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-xs">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
              style={{ color: 'var(--text-muted)' }}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <Input
              placeholder="搜索番剧、标签..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="pl-9 text-sm"
            />
          </div>
          <Select
            value={ratedFilter}
            onChange={v => setRatedFilter(v as '' | 'rated' | 'unrated')}
            className="w-[110px]"
            options={[
              { value: '', label: '全部' },
              { value: 'rated', label: '已评分' },
              { value: 'unrated', label: '未评分' },
            ]}
          />
          <Select
            value={sortBy}
            onChange={setSortBy}
            className="w-[130px]"
            options={[
              { value: 'updated_desc', label: '最近编辑' },
              { value: 'air_date_desc', label: '放送日期↓' },
              { value: 'air_date_asc', label: '放送日期↑' },
              { value: 'rating', label: '评分最高' },
              { value: 'newest', label: '最新添加' },
              { value: 'title', label: '标题排序' },
            ]}
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>加载中...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center py-32">
            <p className="text-lg" style={{ color: 'var(--text-muted)' }}>
              暂无内容
            </p>
          </div>
        ) : (
          <>
            {animeItems.length > 0 && (
              <section className="mt-8">
                <div className="flex items-center justify-between mb-4">
                  <h2
                    className="text-xl font-semibold"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    番剧
                  </h2>
                  <button
                    onClick={openAddAnime}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200"
                    style={{
                      background: '#FB71A7',
                      color: 'white',
                      border: 'none',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '0.85' }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
                  >
                    + 添加番剧
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
                  {animeItems.map(item => (
                    <AnimeCard
                      key={item.id}
                      content={item}
                      mode="grid"
                      isFavorited={isFavorited(item.id)}
                      onSelect={openDetail}
                      onToggleFavorite={toggleFavorite}
                    />
                  ))}
                </div>
                {/* 无限滚动加载状态 */}
                {loadingMore && (
                  <div className="flex items-center justify-center py-8">
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>加载中...</p>
                  </div>
                )}
                {!hasMore && animeItems.length > 0 && (
                  <div className="flex items-center justify-center py-8">
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      已显示全部 {totalCount} 部番剧
                    </p>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </PageMain>
  )
}
