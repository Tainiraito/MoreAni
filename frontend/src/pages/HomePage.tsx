import { useState, useEffect } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { api } from '@/lib/api'
import { PageMain } from '@/components/layout/PageContainer'
import { CategoryTabs } from '@/components/content/CategoryTabs'
import { ContentCard } from '@/components/content/ContentCard'
import { ContentListItem } from '@/components/content/ContentListItem'
import { HeroSection } from '@/components/content/HeroSection'
import type { ContentItem, ContentType } from '@/types'

export function HomePage() {
  const [activeType, setActiveType] = useState<ContentType | 'all'>('all')
  const [items, setItems] = useState<ContentItem[]>([])
  const [hero, setHero] = useState<ContentItem | null>(null)
  const [loading, setLoading] = useState(true)
  const { openDetail, openAuth } = useUIStore()

  useEffect(() => {
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
  }, [activeType])

  // Separate anime (cover cards) from other types (list)
  const animeItems = items.filter(i => i.content_type === 'anime')
  const otherItems = items.filter(i => i.content_type !== 'anime')

  return (
    <PageMain className="py-20 sm:py-24">
      {/* Hero — only for anime */}
      {hero && hero.content_type === 'anime' && (
        <HeroSection content={hero} onSelect={openDetail} />
      )}

      {/* Category Tabs */}
      <CategoryTabs active={activeType} onChange={setActiveType} />

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <p className="text-sm" style={{ color: 'var(--text-muted, #8a8590)' }}>加载中...</p>
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center justify-center py-32">
          <p className="text-lg" style={{ color: 'var(--text-muted, #8a8590)' }}>
            暂无内容
          </p>
        </div>
      ) : (
        <>
          {/* Anime section — cover card grid */}
          {animeItems.length > 0 && (
            <section className="mt-8">
              {(activeType === 'all') && (
                <h2
                  className="mb-4 text-xl font-semibold"
                  style={{ color: 'var(--text-primary, #0c0a12)' }}
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

          {/* Other types — Gleamory-style list */}
          {otherItems.length > 0 && (
            <section className="mt-10">
              {(activeType === 'all') && animeItems.length > 0 && (
                <h2
                  className="mb-4 text-xl font-semibold"
                  style={{ color: 'var(--text-primary, #0c0a12)' }}
                >
                  其他内容
                </h2>
              )}
              <ol
                className="border-y"
                style={{ borderColor: 'rgba(44,42,48,0.1)' }}
              >
                {otherItems.map(item => (
                  <ContentListItem key={item.id} content={item} onSelect={openDetail} />
                ))}
              </ol>
            </section>
          )}
        </>
      )}

      {/* Login prompt */}
      <div
        className="mt-12 text-center py-8"
        style={{ borderTop: '0.5px solid rgba(44,42,48,0.07)' }}
      >
        <p className="mb-3 text-sm" style={{ color: 'var(--text-muted, #8a8590)' }}>
          登录后可以评分、评论和管理观看状态
        </p>
        <button
          onClick={openAuth}
          className="px-5 py-2 text-sm font-medium rounded-lg transition-all duration-200"
          style={{
            background: 'var(--accent-amber, #c4956a)',
            color: '#fffaf2',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          立即登录
        </button>
      </div>
    </PageMain>
  )
}
