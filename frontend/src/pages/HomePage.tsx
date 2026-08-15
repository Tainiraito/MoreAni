import { useState, useEffect, useCallback } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { PageMain } from '@/components/layout/PageContainer'
import { HeroBrand } from '@/components/layout/HeroBrand'
import { CategoryTabs } from '@/components/content/CategoryTabs'
import { AnimeCard } from '@/components/content/AnimeCard'
import { ContentListItem } from '@/components/content/ContentListItem'
import { HeroSection } from '@/components/content/HeroSection'
import { RefreshCw } from 'lucide-react'
import type { ContentItem, ContentType } from '@/types'

export function HomePage() {
  const { user } = useAuthStore()
  const { openDetail } = useUIStore()
  const [activeType, setActiveType] = useState<ContentType | 'all'>('all')
  const [items, setItems] = useState<ContentItem[]>([])
  const [hero, setHero] = useState<ContentItem | null>(null)
  const [allAnime, setAllAnime] = useState<ContentItem[]>([])
  const [loading, setLoading] = useState(true)

  // 加载所有番剧（用于精选推荐），过滤掉已评分的
  useEffect(() => {
    if (!user) return

    Promise.all([
      api.listContent({ type: 'anime' }),
      api.getMyRatings({ size: '100' }),
    ])
      .then(([contentRes, ratingsRes]) => {
        const animeList = (contentRes.items || []) as ContentItem[]
        const ratings = (ratingsRes.items || []) as { content_id: number }[]
        const ratedIds = new Set(ratings.map(r => r.content_id))
        
        // 过滤掉已评分和没有封面的番剧
        const unwatched = animeList.filter(i => i.cover_url && !ratedIds.has(i.id))
        setAllAnime(unwatched)
        
        // 随机选取一个
        if (unwatched.length > 0) {
          const randomIndex = Math.floor(Math.random() * unwatched.length)
          setHero(unwatched[randomIndex])
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
    
    // 从列表中移除当前 hero，然后随机选
    const remaining = allAnime.filter(a => a.id !== hero?.id)
    if (remaining.length === 0) {
      // 如果只剩一个，重新从完整列表选
      const randomIndex = Math.floor(Math.random() * allAnime.length)
      setHero(allAnime[randomIndex])
    } else {
      const randomIndex = Math.floor(Math.random() * remaining.length)
      setHero(remaining[randomIndex])
    }
  }, [allAnime, hero])

  // 想看
  const handleWantToWatch = useCallback(async () => {
    if (!hero) return
    try {
      await api.setStatus({ content_id: hero.id, status: 'wish' })
      // 从 allAnime 中移除当前 hero
      setAllAnime(prev => prev.filter(a => a.id !== hero.id))
      // 换下一个
      handleRefreshHero()
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
        {/* 精选推荐 — 独立于 tab，随机选取未观看的 */}
        {hero && (
          <div className="relative">
            <HeroSection
              content={hero}
              onSelect={openDetail}
              onWantToWatch={handleWantToWatch}
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

        {/* 没有未观看番剧时提示 */}
        {!hero && allAnime.length === 0 && (
          <div
            className="p-8 rounded-xl text-center mb-8"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-line)',
            }}
          >
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              所有番剧都已评分或标记，太棒了！🎉
            </p>
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
            {/* 番剧区域 — 使用统一的 AnimeCard */}
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

            {/* 其他类型 — 列表 */}
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
