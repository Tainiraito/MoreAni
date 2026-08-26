import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useFavoriteStore } from '@/stores/favorite-store'
import { useRefreshStore } from '@/stores/refresh-store'
import { ApiTimeoutError, api } from '@/lib/api'
import { normalizeAiringWeek } from '@/lib/airing'
import { PageMain } from '@/components/layout/PageContainer'
import { HeroBrand } from '@/components/layout/HeroBrand'
import { AnimeCard } from '@/components/content/AnimeCard'
import { CommentListView } from '@/components/content/CommentListView'
import { OtherContentList } from '@/components/content/OtherContentList'
import { WeeklyAiringPanel } from '@/components/content/WeeklyAiringPanel'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { HeroSection } from '@/components/content/HeroSection'
import { LayoutGrid, List } from 'lucide-react'
import type { AiringCalendarWeek, ContentItem } from '@/types'
import {
  buildContentListParams,
  getRecommendationSize,
  LatestRequestGate,
  normalizeRecommendationItems,
} from '@/lib/content-query'

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300
const RECOMMENDATION_CACHE_PREFIX = 'moreani-recommendations-v1'
const AIRING_WEEK_CACHE_KEY = 'moreani-airing-week-v2'
const AIRING_STALE_TIME_MS = 5 * 60 * 1000
const AIRING_GC_TIME_MS = 30 * 60 * 1000
type HomeTab = 'anime' | 'calendar' | 'other'

interface AiringWeekCacheRecord {
  week: AiringCalendarWeek
  cachedAt: number
}

function recommendationCacheKey(userId: number | null): string {
  return `${RECOMMENDATION_CACHE_PREFIX}:${userId ?? 'guest'}`
}

function readRecommendationCache(userId: number | null): ContentItem[] {
  try {
    const raw = sessionStorage.getItem(recommendationCacheKey(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? normalizeRecommendationItems(parsed as ContentItem[]) : []
  } catch {
    return []
  }
}

function writeRecommendationCache(userId: number | null, items: ContentItem[]): void {
  if (items.length === 0) return
  try {
    sessionStorage.setItem(recommendationCacheKey(userId), JSON.stringify(items))
  } catch {
    // sessionStorage 不可用时仍保留当前内存中的推荐。
  }
}

function readAiringWeekCache(): AiringWeekCacheRecord | null {
  try {
    const raw = sessionStorage.getItem(AIRING_WEEK_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    if (!record.week || typeof record.week !== 'object' || typeof record.cachedAt !== 'number') return null
    return { week: normalizeAiringWeek(record.week as AiringCalendarWeek), cachedAt: record.cachedAt }
  } catch {
    return null
  }
}

function currentWeekStart(): string {
  const current = new Date()
  const day = current.getDay() || 7
  current.setDate(current.getDate() - day + 1)
  const month = String(current.getMonth() + 1).padStart(2, '0')
  const date = String(current.getDate()).padStart(2, '0')
  return `${current.getFullYear()}-${month}-${date}`
}

export function HomePage() {
  const { user } = useAuthStore()
  const userId = user?.id
  const { openDetail, openAddAnime } = useUIStore()
  const { isFavorited, toggleFavorite } = useFavoriteStore()
  const refreshKey = useRefreshStore(s => s.refreshKey)
  const [activeTab, setActiveTab] = useState<HomeTab>('anime')
  const [items, setItems] = useState<ContentItem[]>([])
  const [hero, setHero] = useState<ContentItem | null>(null)
  const [scrollRecommendations, setScrollRecommendations] = useState<ContentItem[]>(() => readRecommendationCache(user?.id ?? null))
  const scrollRecommendationsRef = useRef<ContentItem[]>(scrollRecommendations)
  const scrollRequestGate = useRef(new LatestRequestGate())
  const heroRequestGate = useRef(new LatestRequestGate())
  const recommendationWakeAt = useRef(0)
  const [recommendationSize, setRecommendationSize] = useState(() => getRecommendationSize(window.innerWidth))
  const recommendationSizeRef = useRef(recommendationSize)
  recommendationSizeRef.current = recommendationSize
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [listRetryKey, setListRetryKey] = useState(0)
  const [progress, setProgress] = useState(0)
  const heroIdRef = useRef<number | null>(null)
  const listRequestGate = useRef(new LatestRequestGate())
  const paginationRequestGate = useRef(new LatestRequestGate())
  const listQueryVersionRef = useRef(0)
  const listLoadingRef = useRef(true)
  const pageRef = useRef(1)
  const hasMoreRef = useRef(true)
  const paginationControllerRef = useRef<AbortController | null>(null)
  const lastListContextRef = useRef<{ activeTab: HomeTab; userId: number } | null>(null)
  const airingQuery = useQuery({
    queryKey: ['airing-week'],
    queryFn: ({ signal }) => api.getAiringWeek({ signal }),
    enabled: userId !== undefined && activeTab === 'calendar',
    staleTime: AIRING_STALE_TIME_MS,
    gcTime: AIRING_GC_TIME_MS,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    initialData: () => readAiringWeekCache()?.week,
    initialDataUpdatedAt: () => {
      const cached = readAiringWeekCache()
      if (!cached) return 0
      return cached.week.week_start === currentWeekStart() ? cached.cachedAt : 0
    },
  })

  // Search and filter state
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const searchCompositionRef = useRef(false)
  const searchDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [myFilter, setMyFilter] = useState<'' | 'rated' | 'unrated' | 'reviewed' | 'unreviewed' | 'favorited' | 'unfavorited'>('')
  const [sortBy, setSortBy] = useState('updated_desc')
  // 放送季度筛选（2026-01 = 2026年1月番）；用户筛选（看该用户评分/评论过的番）
  const [seasonFilter, setSeasonFilter] = useState('')
  const [userFilter, setUserFilter] = useState('')
  const [userOptions, setUserOptions] = useState<{ id: number; nickname: string }[]>([])
  // 季度选项数据驱动：后端按 release_date 聚合出有数据的季度（跨年/新增番自动更新）
  const [seasonOptions, setSeasonOptions] = useState<{ value: string; label: string }[]>([])
  // 视图模式：评论列表（默认）/ 卡片网格；localStorage 记忆用户选择
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() =>
    localStorage.getItem('moreani-view') === 'grid' ? 'grid' : 'list',
  )

  // 加载放送季度分布（有数据的季度才显示，带数量）
  useEffect(() => {
    if (!user) return
    api.getSeasons()
      .then(res => {
        setSeasonOptions((res.items || []).map(s => ({
          value: s.value,
          label: `${s.value.slice(0, 4)}年${parseInt(s.value.slice(5), 10)}月番 (${s.count})`,
        })))
      })
      .catch(() => {})
  }, [user])

  // 加载注册用户列表（排除 super_admin 爱莉希雅），供按用户筛选
  useEffect(() => {
    if (!user) return
    api.listUsers()
      .then(res => setUserOptions((res.items || []).map(u => ({ id: u.id, nickname: u.nickname || u.username }))))
      .catch(() => {})
  }, [user])

  const switchView = (mode: 'grid' | 'list') => {
    setViewMode(mode)
    localStorage.setItem('moreani-view', mode)
  }

  // Infinite scroll pagination state
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const isLoadingMoreRef = useRef(false)
  const AUTO_REFRESH_MS = 11000

  const fetchScrollRecommendations = useCallback(async (size: number, excludePrevious: boolean) => {
    const requestId = scrollRequestGate.current.begin()
    const previousIds = excludePrevious ? scrollRecommendationsRef.current.map(item => item.id) : []
    try {
      const response = await api.getRecommendations({
        type: 'anime',
        size,
        excludeIds: previousIds,
      })
      if (!scrollRequestGate.current.isCurrent(requestId)) return null
      const unique = normalizeRecommendationItems(response.items)
      if (unique.length === 0) return scrollRecommendationsRef.current
      scrollRecommendationsRef.current = unique
      setScrollRecommendations(unique)
      writeRecommendationCache(user?.id ?? null, unique)
      return unique
    } catch {
      // 保留上一轮推荐，避免短暂网络错误导致首屏清空。
      return null
    }
  }, [user?.id])

  const fetchHeroRecommendation = useCallback(async () => {
    const requestId = heroRequestGate.current.begin()
    const currentHeroId = heroIdRef.current
    const excludeIds = currentHeroId === null ? [] : [currentHeroId]
    try {
      const item = await api.getRandom({
        type: 'anime',
        excludeIds: [...new Set(excludeIds)],
      })
      if (!heroRequestGate.current.isCurrent(requestId)) return
      if (!item || item.id === currentHeroId) return
      heroIdRef.current = item.id
      setHero(item)
    } catch {
      // 随机请求失败时保留当前精选，避免精选区闪烁。
    }
  }, [])

  const fetchRecommendationPools = useCallback(async (size: number, excludePrevious: boolean, includeHero: boolean) => {
    const scrollItems = await fetchScrollRecommendations(size, excludePrevious)
    if (includeHero && scrollItems) {
      await fetchHeroRecommendation()
    }
  }, [fetchHeroRecommendation, fetchScrollRecommendations])

  useEffect(() => {
    const cached = readRecommendationCache(user?.id ?? null)
    scrollRecommendationsRef.current = cached
    setScrollRecommendations(cached)
  }, [user?.id])

  useEffect(() => {
    const excludePrevious = scrollRecommendationsRef.current.length > 0
    if (!user) {
      heroIdRef.current = null
      setHero(null)
    }
    void fetchRecommendationPools(recommendationSizeRef.current, excludePrevious, Boolean(user))
  }, [fetchRecommendationPools, refreshKey, user])

  useEffect(() => {
    const refreshOnWake = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - recommendationWakeAt.current < 30_000) return
      recommendationWakeAt.current = now
      void fetchRecommendationPools(
        recommendationSizeRef.current,
        scrollRecommendationsRef.current.length > 0,
        Boolean(user),
      )
    }
    window.addEventListener('focus', refreshOnWake)
    window.addEventListener('pageshow', refreshOnWake)
    document.addEventListener('visibilitychange', refreshOnWake)
    return () => {
      window.removeEventListener('focus', refreshOnWake)
      window.removeEventListener('pageshow', refreshOnWake)
      document.removeEventListener('visibilitychange', refreshOnWake)
    }
  }, [fetchRecommendationPools, user])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const handleResize = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const required = getRecommendationSize(window.innerWidth)
        if (required > scrollRecommendationsRef.current.length) {
          setRecommendationSize(required)
          void fetchScrollRecommendations(required, true)
        }
      }, 200)
    }
    window.addEventListener('resize', handleResize)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', handleResize)
    }
  }, [fetchScrollRecommendations])

  // Hero 每次轮换都从全量公开番剧中重新随机抽取；不维护固定 Hero 池。
  const heroFavorited = hero ? isFavorited(hero.id) : false

  const clearSearchDebounce = useCallback(() => {
    if (searchDebounceTimerRef.current === null) return
    clearTimeout(searchDebounceTimerRef.current)
    searchDebounceTimerRef.current = null
  }, [])

  const commitSearchQuery = useCallback((value: string) => {
    const normalizedQuery = value.trim()
    clearSearchDebounce()
    setSearchQuery(previous => previous === normalizedQuery ? previous : normalizedQuery)
  }, [clearSearchDebounce])

  const scheduleSearchQuery = useCallback((value: string) => {
    clearSearchDebounce()
    searchDebounceTimerRef.current = setTimeout(() => {
      searchDebounceTimerRef.current = null
      if (searchCompositionRef.current) return
      commitSearchQuery(value)
    }, SEARCH_DEBOUNCE_MS)
  }, [clearSearchDebounce, commitSearchQuery])

  // 防抖搜索：组合输入期间只更新输入框，不提交未完成的拼音/候选词。
  useEffect(() => {
    if (searchCompositionRef.current) return
    scheduleSearchQuery(searchInput)
    return clearSearchDebounce
  }, [clearSearchDebounce, scheduleSearchQuery, searchInput])

  const handleSearchCompositionStart = () => {
    searchCompositionRef.current = true
    clearSearchDebounce()
  }

  const handleSearchCompositionEnd = (event: React.CompositionEvent<HTMLInputElement>) => {
    searchCompositionRef.current = false
    scheduleSearchQuery(event.currentTarget.value)
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    if (searchCompositionRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return
    commitSearchQuery(searchInput)
  }

  const contentQuery = useMemo(() => ({
    activeType: activeTab === 'other' ? 'other' as const : 'anime' as const,
    searchQuery,
    myFilter,
    sortBy,
    seasonFilter: activeTab === 'anime' ? seasonFilter : '',
    userFilter,
  }), [activeTab, searchQuery, myFilter, sortBy, seasonFilter, userFilter])

  const listQueryRef = useRef({ activeTab, contentQuery })
  listQueryRef.current = { activeTab, contentQuery }

  // 加载当前 tab 的内容（重置分页）
  useEffect(() => {
    const queryVersion = listQueryVersionRef.current + 1
    listQueryVersionRef.current = queryVersion
    paginationRequestGate.current.begin()
    paginationControllerRef.current?.abort()
    paginationControllerRef.current = null
    isLoadingMoreRef.current = false
    setLoadingMore(false)

    if (userId === undefined || activeTab === 'calendar') {
      listLoadingRef.current = false
      setLoading(false)
      return
    }

    const contextChanged = lastListContextRef.current !== null
      && (lastListContextRef.current.activeTab !== activeTab || lastListContextRef.current.userId !== userId)
    if (contextChanged) setItems([])
    lastListContextRef.current = { activeTab, userId }

    listLoadingRef.current = true
    setLoading(true)
    setListError(null)
    pageRef.current = 1
    setHasMore(true)
    hasMoreRef.current = true
    setTotalCount(0)

    const requestId = listRequestGate.current.begin()
    const controller = new AbortController()
    const params = buildContentListParams(contentQuery, 1, PAGE_SIZE)

    api.listContent(params, { signal: controller.signal })
      .then(res => {
        if (!listRequestGate.current.isCurrent(requestId) || queryVersion !== listQueryVersionRef.current) return
        const list = res.items || []
        setItems(list)
        setTotalCount(res.total || 0)
        setHasMore(list.length < (res.total || 0))
        hasMoreRef.current = list.length < (res.total || 0)
      })
      .catch(error => {
        if (
          controller.signal.aborted
          || !listRequestGate.current.isCurrent(requestId)
          || queryVersion !== listQueryVersionRef.current
        ) return
        setListError(error instanceof ApiTimeoutError ? '列表加载超时，请重试' : '列表加载失败，请重试')
        setHasMore(false)
        hasMoreRef.current = false
      })
      .finally(() => {
        if (listRequestGate.current.isCurrent(requestId) && queryVersion === listQueryVersionRef.current) {
          listLoadingRef.current = false
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [activeTab, contentQuery, userId, refreshKey, listRetryKey])

  // 加载更多（下一页）
  const loadMore = useCallback(async () => {
    const currentQuery = listQueryRef.current
    if (
      currentQuery.activeTab === 'calendar'
      || isLoadingMoreRef.current
      || !hasMoreRef.current
      || listLoadingRef.current
    ) return
    isLoadingMoreRef.current = true
    setLoadingMore(true)

    const queryVersion = listQueryVersionRef.current
    const nextPage = pageRef.current + 1
    const requestId = paginationRequestGate.current.begin()
    const controller = new AbortController()
    paginationControllerRef.current = controller
    const params = buildContentListParams(currentQuery.contentQuery, nextPage, PAGE_SIZE)

    try {
      const res = await api.listContent(params, { signal: controller.signal })
      if (
        controller.signal.aborted
        || !paginationRequestGate.current.isCurrent(requestId)
        || queryVersion !== listQueryVersionRef.current
      ) return
      const list = res.items || []
      setTotalCount(res.total)
      // 防御：追加前去重（分页偶发重叠时避免重复 key）
      setItems(prev => {
        const seen = new Set(prev.map(i => i.id))
        const next = [...prev, ...list.filter(i => !seen.has(i.id))]
        setHasMore(next.length < res.total)
        hasMoreRef.current = next.length < res.total
        return next
      })
      pageRef.current = nextPage
    } catch {
      // ignore load-more errors
    } finally {
      if (paginationControllerRef.current === controller) {
        paginationControllerRef.current = null
        setLoadingMore(false)
        isLoadingMoreRef.current = false
      }
    }
  }, [])

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

  const handleRetryList = useCallback(() => {
    setListRetryKey(value => value + 1)
  }, [])

  // 换一个精选（手动或自动触发）
  const handleRefreshHero = useCallback(() => {
    setProgress(0)
    void fetchHeroRecommendation()
  }, [fetchHeroRecommendation])

  // Auto-refresh: CSS transition drives the animation, JS only sets start/end
  useEffect(() => {
    if (!hero) {
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
          void fetchHeroRecommendation()
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
  }, [fetchHeroRecommendation, hero])

  // 未登录只显示首屏
  if (!user) {
    return <HeroBrand items={scrollRecommendations} />
  }

  const animeItems = items.filter(i => i.content_type === 'anime' || i.content_type === 'anime_movie')

  return (
    <PageMain>
      <HeroBrand items={scrollRecommendations} />

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
          {(['anime', 'calendar', 'other'] as const).map(val => {
            const labels: Record<HomeTab, string> = { anime: '番剧', calendar: '新番周历', other: '其他' }
            const isActive = activeTab === val
            return (
              <button
                key={val}
                type="button"
                onClick={() => setActiveTab(val)}
                className="relative min-h-[3.75rem] cursor-pointer whitespace-nowrap pb-3 text-lg font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                style={{
                  color: isActive ? '#FB71A7' : 'var(--text-muted)',
                  borderBottom: isActive ? '2px solid #FB71A7' : '2px solid transparent',
                }}
              >
                {labels[val]}
              </button>
            )
          })}
        </div>

        {/* 搜索、筛选、排序 */}
        {activeTab !== 'calendar' && <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-xs">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
              style={{ color: 'var(--text-muted)' }}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <Input
              placeholder={activeTab === 'other' ? '搜索其他内容、标签...' : '搜索番剧、标签...'}
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onCompositionStart={handleSearchCompositionStart}
              onCompositionEnd={handleSearchCompositionEnd}
              onKeyDown={handleSearchKeyDown}
              clearable
              onClear={() => {
                searchCompositionRef.current = false
                setSearchInput('')
                commitSearchQuery('')
              }}
              className="pl-9 text-sm"
            />
          </div>
          {activeTab === 'anime' && <Select
            value={seasonFilter}
            onChange={setSeasonFilter}
            className="w-[128px]"
            placeholder="放送季度"
            options={[{ value: '', label: '全部季度' }, ...seasonOptions]}
          />}
          <Select
            value={userFilter}
            onChange={setUserFilter}
            className="w-[128px]"
            placeholder="按用户"
            options={[{ value: '', label: '全部用户' }, ...userOptions.map(u => ({ value: String(u.id), label: u.nickname }))]}
          />
          <Select
            value={myFilter}
            onChange={v => setMyFilter(v as '' | 'rated' | 'unrated' | 'reviewed' | 'unreviewed' | 'favorited' | 'unfavorited')}
            className="w-[130px]"
            groups={[
              {
                label: '我的状态',
                options: [
                  { value: '', label: '全部' },
                  { value: 'rated', label: '已评分' },
                  { value: 'unrated', label: '未评分' },
                  { value: 'reviewed', label: '已评论' },
                  { value: 'unreviewed', label: '未评论' },
                  { value: 'favorited', label: '已收藏' },
                  { value: 'unfavorited', label: '未收藏' },
                ],
              },
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
              { value: 'oldest', label: '最早添加' },
              { value: 'title', label: '标题排序' },
            ]}
          />
          {/* 仅管理员显示新增按钮（普通用户无权限，避免操作后报错）；super_admin 同样有权限 */}
          {activeTab === 'anime' && (user?.role === 'admin' || user?.role === 'super_admin') && (
            <button
              onClick={() => openAddAnime()}
              className="flex h-9 items-center gap-1 px-4 text-xs font-medium rounded-lg transition-all duration-200"
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
          )}
          {/* 视图切换（组合式：评论列表 / 卡片网格） */}
          {activeTab === 'anime' && <div
            className="flex items-center ml-1 rounded-lg overflow-hidden"
            style={{ border: '1px solid var(--border-line)' }}
          >
            <button
              onClick={() => switchView('list')}
              title="评论列表视图"
              className="w-9 h-9 flex items-center justify-center transition-all duration-150"
              style={{
                background: viewMode === 'list' ? 'var(--bg-card)' : 'transparent',
                color: viewMode === 'list' ? '#FB71A7' : 'var(--text-muted)',
                boxShadow: viewMode === 'list' ? '0 1px 3px rgba(0, 0, 0, 0.08)' : 'none',
              }}
            >
              <List size={14} />
            </button>
            <button
              onClick={() => switchView('grid')}
              title="卡片网格视图"
              className="w-9 h-9 flex items-center justify-center transition-all duration-150"
              style={{
                background: viewMode === 'grid' ? 'var(--bg-card)' : 'transparent',
                color: viewMode === 'grid' ? '#FB71A7' : 'var(--text-muted)',
                borderLeft: '1px solid var(--border-line)',
                boxShadow: viewMode === 'grid' ? '0 1px 3px rgba(0, 0, 0, 0.08)' : 'none',
              }}
            >
              <LayoutGrid size={14} />
            </button>
          </div>}
        </div>}

        {activeTab === 'calendar' ? (
          <WeeklyAiringPanel
            week={airingQuery.data ?? null}
            loading={airingQuery.isPending}
            error={airingQuery.error instanceof Error ? airingQuery.error.message : null}
            onOpenContent={openDetail}
            onAddAnime={item => openAddAnime({
              bangumiId: item.subject_id,
              title: item.title,
              titleAlt: item.title_alt,
            })}
            isFavorited={isFavorited}
            onToggleFavorite={toggleFavorite}
          />
        ) : loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-32" role="status" aria-label="列表加载中">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>加载中...</p>
          </div>
        ) : listError && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-32" role="alert">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{listError}</p>
            <button
              type="button"
              onClick={handleRetryList}
              className="rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', color: '#FB71A7' }}
            >
              重试
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center py-32">
            <p className="text-lg" style={{ color: 'var(--text-muted)' }}>
              暂无内容
            </p>
          </div>
        ) : (
          <>
            {loading && (
              <div className="mb-4 flex items-center justify-center py-2" role="status" aria-label="列表刷新中">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>正在更新列表...</p>
              </div>
            )}
            {listError && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-lg px-3 py-2" role="alert" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{listError}</p>
                <button type="button" onClick={handleRetryList} className="shrink-0 text-xs font-medium hover:opacity-80" style={{ color: '#FB71A7' }}>重试</button>
              </div>
            )}
            {activeTab === 'other' ? (
              <section className="mt-8">
                <OtherContentList items={items} onSelect={openDetail} isFavorited={isFavorited} onToggleFavorite={toggleFavorite} />
                {loadingMore && <div className="flex items-center justify-center py-8" role="status" aria-label="加载更多"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>加载中...</p></div>}
                {!hasMore && items.length > 0 && <div className="flex items-center justify-center py-8"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>已显示全部 {totalCount} 条内容</p></div>}
              </section>
            ) : (
            animeItems.length > 0 && (
              <section className="mt-8">
                {viewMode === 'list' ? (
                  <CommentListView
                    items={animeItems}
                    onSelect={openDetail}
                    isFavorited={isFavorited}
                    onToggleFavorite={toggleFavorite}
                  />
                ) : (
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
                )}
                {/* 无限滚动加载状态 */}
                {loadingMore && (
                  <div className="flex items-center justify-center py-8" role="status" aria-label="加载更多">
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
            )
            )}
          </>
        )}
      </div>
    </PageMain>
  )
}
