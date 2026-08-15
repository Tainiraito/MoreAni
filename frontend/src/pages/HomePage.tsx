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
  const [heroFavorited, setHeroFavorited] = useState(false)
  const [allAnime, setAllAnime] = useState<ContentItem[]>([])
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)

  // 加载所有番剧和收藏状态
  useEffect(() => {
    if (!user) return

    Promise.all([
      api.listContent({ type: 'anime' }),
      api.getMyStatuses(),
    ])
      .then(([contentRes, statusRes]) => {
        const animeList = (contentRes.items || []) as ContentItem[]
        const statuses = (statusRes.items || []) as { content_id: number; status: string }[]
        
        const favIds = new Set(statuses.filter(s => s.status === 'want').map(s => s.content_id))
        setFavoriteIds(favIds)
        
        const withCover = animeList.filter(i => i.cover_url)
        setAllAnime(withCover)
        
        if (withCover.length > 0) {
          const randomIndex = Math.floor(Math.random() * withCover.length)
          const selected = withCover[randomIndex]
          setHero(selected)
          setHeroFavorited(favIds.has(selected.id))
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
      setHeroFavorited(favoriteIds.has(selected.id))
    } else {
      const randomIndex = Math.floor(Math.random() * remaining.length)
      const selected = remaining[randomIndex]
      setHero(selected)
      setHeroFavorited(favoriteIds.has(selected.id))
    }
  }, [allAnime, hero, favoriteIds])

  // 切换精选的收藏
  const handleToggleHeroFavorite = useCallback(async () => {
    if (!hero) return
    
    try {
      if (heroFavorited) {
        await api.clearStatus(hero.id)
        setFavoriteIds(prev => {
          const next = new Set(prev)
          next.delete(hero.id)
          return next
        })
        setHeroFavorited(false)
      } else {
        await api.setStatus({ content_id: hero.id, status: 'want' })
        setFavoriteIds(prev => new Set(prev).add(hero.id))
        setHeroFavorited(true)
      }
    } catch (err) {
      console.error('Toggle favorite failed:', err)
    }
  }, [hero, heroFavorited])

  // 切换卡片的收藏
  const handleToggleCardFavorite = useCallback(async (id: number) => {
    const isFav = favoriteIds.has(id)
    
    try {
      if (isFav) {
        await api.clearStatus(id)
        setFavoriteIds(prev => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      } else {
        await api.setStatus({ content_id: id, status: 'want' })
        setFavoriteIds(prev => new Set(prev).add(id))
      }
    } catch (err) {
      console.error('Toggle favorite failed:', err)
    }
  }, [favoriteIds])

  // 未登录只显示首屏
  if (!user) {
    return <HeroBrand />
  }

  const animeItems = items.filter(i => i.content_type === 'anime')
  const otherItems = items.filter(i => i.content_type !== 'anime')

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
              onToggleFavorite={handleToggleHeroFavorite}
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
                      isFavorited={favoriteIds.has(item.id)}
                      onSelect={openDetail}
                      onToggleFavorite={handleToggleCardFavorite}
                    />
                  ))}
                </div>
              </section>
            )}

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
