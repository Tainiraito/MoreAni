import { useState, useEffect, useCallback } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { PageMain } from '@/components/layout/PageContainer'
import { HeroBrand } from '@/components/layout/HeroBrand'
import { CategoryTabs } from '@/components/content/CategoryTabs'
import { ContentCard } from '@/components/content/ContentCard'
import { ContentListItem } from '@/components/content/ContentListItem'
import { HeroSection } from '@/components/content/HeroSection'
import { RefreshCw } from 'lucide-react'
import type { ContentItem, ContentType } from '@/types'

export function HomePage() {
  const { user } = useAuthStore()
  const [activeType, setActiveType] = useState<ContentType | 'all'>('all')
  const [items, setItems] = useState<ContentItem[]>([])
  const [hero, setHero] = useState<ContentItem | null>(null)
  const [allAnime, setAllAnime] = useState<ContentItem[]>([])
  const [loading, setLoading] = useState(true)
  const { openDetail } = useUIStore()

  // 加载所有番剧（用于精选推荐）
  useEffect(() => {
    if (!user) return

    api.listContent({ type: 'anime' })
      .then(res => {
        const list = (res.items || []) as ContentItem[]
        const withCover = list.filter(i => i.cover_url)
        setAllAnime(withCover)
        // 随机选取一个作为精选
        if (withCover.length > 0) {
          const randomIndex = Math.floor(Math.random() * withCover.length)
          setHero(withCover[randomIndex])
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
    if (allAnime.length <= 1) return
    let newIndex: number
    do {
      newIndex = Math.floor(Math.random() * allAnime.length)
    } while (allAnime[newIndex]?.id === hero?.id && allAnime.length > 1)
    setHero(allAnime[newIndex])
  }, [allAnime, hero])

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
        {/* 精选推荐 — 独立于 tab，随机选取 */}
        {hero && (
          <div className="relative">
            <HeroSection content={hero} onSelect={openDetail} />
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
            {/* 番剧区域 — 卡片网格 */}
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
                    <ContentCard key={item.id} content={item} onSelect={openDetail} />
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
