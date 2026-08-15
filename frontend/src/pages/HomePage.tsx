import { useState, useEffect } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { PageMain } from '@/components/layout/PageContainer'
import { HeroBrand } from '@/components/layout/HeroBrand'
import { CategoryTabs } from '@/components/content/CategoryTabs'
import { ContentCard } from '@/components/content/ContentCard'
import { ContentListItem } from '@/components/content/ContentListItem'
import { HeroSection } from '@/components/content/HeroSection'
import type { ContentItem, ContentType } from '@/types'

export function HomePage() {
  const { user } = useAuthStore()
  const [activeType, setActiveType] = useState<ContentType | 'all'>('all')
  const [items, setItems] = useState<ContentItem[]>([])
  const [hero, setHero] = useState<ContentItem | null>(null)
  const [loading, setLoading] = useState(true)
  const { openDetail } = useUIStore()

  useEffect(() => {
    if (!user) return // 未登录不加载内容

    setLoading(true)
    const params: Record<string, string> = {}
    if (activeType !== 'all') params.type = activeType

    api.listContent(params)
      .then(res => {
        const list = (res.items || []) as ContentItem[]
        setItems(list)
        const heroCandidate = list.find(i => i.content_type === 'anime' && i.cover_url)
          || list.find(i => i.cover_url && (i.avg_score || 0) > 0)
          || list[0]
        setHero(heroCandidate || null)
      })
      .catch(() => { setItems([]); setHero(null) })
      .finally(() => setLoading(false))
  }, [activeType, user])

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
        {/* Hero — 只有番剧才显示 */}
        {hero && hero.content_type === 'anime' && (
          <HeroSection content={hero} onSelect={openDetail} />
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
