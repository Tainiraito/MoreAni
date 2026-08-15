import { useState, useEffect, useCallback } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { PageMain } from '@/components/layout/PageContainer'
import { HeroBrand } from '@/components/layout/HeroBrand'
import { CategoryTabs } from '@/components/content/CategoryTabs'
import { AnimeCard } from '@/components/content/AnimeCard'
import { ContentListItem } from '@/components/content/ContentListItem'
import { HeroSection, type ContentStatus } from '@/components/content/HeroSection'
import { RefreshCw } from 'lucide-react'
import type { ContentItem, ContentType } from '@/types'

interface ContentStatusItem {
  content_id: number
  status: string
}

export function HomePage() {
  const { user } = useAuthStore()
  const { openDetail } = useUIStore()
  const [activeType, setActiveType] = useState<ContentType | 'all'>('all')
  const [items, setItems] = useState<ContentItem[]>([])
  const [hero, setHero] = useState<ContentItem | null>(null)
  const [heroStatus, setHeroStatus] = useState<ContentStatus>('none')
  const [allAnime, setAllAnime] = useState<ContentItem[]>([])
  const [statusMap, setStatusMap] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)

  // 加载所有番剧和状态
  useEffect(() => {
    if (!user) return

    Promise.all([
      api.listContent({ type: 'anime' }),
      api.getMyStatuses(),
    ])
      .then(([contentRes, statusRes]) => {
        const animeList = (contentRes.items || []) as ContentItem[]
        const statuses = (statusRes.items || []) as ContentStatusItem[]
        
        // 构建状态映射
        const sMap: Record<number, string> = {}
        statuses.forEach(s => { sMap[s.content_id] = s.status })
        setStatusMap(sMap)
        
        // 只保留有封面的番剧
        const withCover = animeList.filter(i => i.cover_url)
        setAllAnime(withCover)
        
        // 随机选取一个
        if (withCover.length > 0) {
          const randomIndex = Math.floor(Math.random() * withCover.length)
          const selected = withCover[randomIndex]
          setHero(selected)
          setHeroStatus((sMap[selected.id] as ContentStatus) || 'none')
        }
      })
      .catch(() => {})
  }, [user])

  // 加载当前 tab 的内容
  useEffect(() => {
    if (!user) return

    setLoading(true)
    const params: Record<string, string> = {}
    if (activeType !== 'all') params.type = activeType

    api.listContent(params)
      .then(res => {
        const list = (res.items || []) as ContentItem[]
        setItems(list)
      })
      .catch(() => { setItems([]) })
      .finally(() => setLoading(false))
  }, [activeType, user])

  // 换一个精选
  const handleRefreshHero = useCallback(() => {
    if (allAnime.length === 0) {
      setHero(null)
      return
    }
    
    const remaining = allAnime.filter(a => a.id !== hero?.id)
    if (remaining.length === 0) {
      const randomIndex = Math.floor(Math.random() * allAnime.length)
      const selected = allAnime[randomIndex]
      setHero(selected)
      setHeroStatus((statusMap[selected.id] as ContentStatus) || 'none')
    } else {
      const randomIndex = Math.floor(Math.random() * remaining.length)
      const selected = remaining[randomIndex]
      setHero(selected)
      setHeroStatus((statusMap[selected.id] as ContentStatus) || 'none')
    }
  }, [allAnime, hero, statusMap])

  // 更新状态
  const handleStatusChange = useCallback(async (newStatus: ContentStatus) => {
    if (!hero) return
    
    try {
      if (newStatus === 'none') {
        await api.clearStatus(hero.id)
      } else {
        await api.setStatus({ content_id: hero.id, status: newStatus })
      }
      
      // 更新状态映射
      setStatusMap(prev => ({
        ...prev,
        [hero.id]: newStatus === 'none' ? '' : newStatus,
      }))
      setHeroStatus(newStatus)
      
      // 如果标记为已看或弃坑，自动换下一个
      if (newStatus === 'done' || newStatus === 'dropped') {
        handleRefreshHero()
      }
    } catch {
      // ignore
    }
  }, [hero, handleRefreshHero])

  // 未登录只显示首屏
  if (!user) {
    return <HeroBrand />
  }

  // Separate anime (cover cards) from other types (list)
  const animeItems = items.filter(i => i.content_type === 'anime')
  const otherItems = items.filter(i => i.content_type !== 'anime')

  return (
    <PageMain>
      {/* Hero 品牌区域 */}
      <HeroBrand />

      {/* 内容区域 */}
      <div className="pb-20 sm:pb-24">
        {/* 精选推荐 — 随机选取，显示状态按钮 */}
        {hero && (
          <div className="relative">
            <HeroSection
              content={hero}
              status={heroStatus}
              onSelect={openDetail}
              onStatusChange={handleStatusChange}
            />
            <button
              onClick={handleRefreshHero}
              className="absolute top-4 right-4 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 hover:opacity-80"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-line)',
                color: 'var(--text-muted)',
              }}
            >
              <RefreshCw size={12} />
              换一个
            </button>
          </div>
        )}

        {/* 分类标签 */}
        <CategoryTabs active={activeType} onChange={setActiveType} />

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
            {/* 番剧区域 */}
            {animeItems.length > 0 && (
              <section className="mt-8">
                {(activeType === 'all') && (
                  <h2
                    className="mb-4 text-xl font-semibold"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    番剧
                  </h2>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
                  {animeItems.map(item => (
                    <AnimeCard
                      key={item.id}
                      content={item}
                      mode="grid"
                      onSelect={openDetail}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* 其他类型 */}
            {otherItems.length > 0 && (
              <section className="mt-10">
                {(activeType === 'all') && animeItems.length > 0 && (
                  <h2
                    className="mb-4 text-xl font-semibold"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    其他内容
                  </h2>
                )}
                <ol style={{ borderTop: '1px solid var(--border-line)' }}>
                  {otherItems.map(item => (
                    <ContentListItem key={item.id} content={item} onSelect={openDetail} />
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </div>
    </PageMain>
  )
}
