import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, ChartNoAxesCombined, Cloud, Heart, Sparkles, Star, Users } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { ScoreDistributionChart } from '@/components/analytics/ScoreDistributionChart'
import { ScoreRangeSlider } from '@/components/analytics/ScoreRangeSlider'
import { TagWordCloud } from '@/components/analytics/TagWordCloud'
import { PageMain } from '@/components/layout/PageContainer'
import { CoverImage } from '@/components/ui/CoverImage'
import { Select } from '@/components/ui/select'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useUIStore } from '@/stores/ui-store'
import type { ScoreRange } from '@/components/analytics/ScoreRangeSlider'
import type {
  AnalyticsConfidence,
  AnalyticsFavoriteItem,
  AnalyticsRecommendationBasis,
  AnalyticsRecommendationItem,
  AnalyticsScopeType,
  AnalyticsTagStat,
} from '@/types'

type TagCloudMode = 'frequency' | 'weighted'

const DEFAULT_SCORE_RANGE: ScoreRange = { min: 0.5, max: 10 }
const RANGE_DEBOUNCE_MS = 150
const ANALYTICS_CARD_STYLE = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-line)',
  boxShadow: '0 0 18px rgba(251, 113, 167, 0.05)',
} as const

const CONFIDENCE_LABEL: Record<AnalyticsConfidence, string> = {
  low: '低置信度',
  medium: '中等置信度',
  high: '高置信度',
}

const BASIS_LABEL: Record<AnalyticsRecommendationBasis, string> = {
  global: '基于全站画像',
  global_fallback: '个人数据不足，使用全站画像',
  blended: '融合个人与全站画像',
  personal: '基于个人画像',
}

function useDebouncedScoreRange(range: ScoreRange): ScoreRange {
  const [debouncedRange, setDebouncedRange] = useState(range)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedRange(range), RANGE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [range])

  return debouncedRange
}

interface AnalyticsScopeSelection {
  scope: AnalyticsScopeType
  userId?: number
}

function parseScope(searchParams: URLSearchParams): AnalyticsScopeSelection {
  if (searchParams.get('scope') !== 'user') return { scope: 'global' }
  const userId = Number(searchParams.get('user_id'))
  if (!Number.isInteger(userId) || userId <= 0) return { scope: 'global' }
  return { scope: 'user', userId }
}

interface SummaryCardProps {
  label: string
  value: string
  icon: React.ReactNode
}

function SummaryCard({ label, value, icon }: SummaryCardProps) {
  return (
    <div className="rounded-xl p-4 sm:p-5" style={ANALYTICS_CARD_STYLE}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ color: 'var(--brand)' }}>{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

interface FavoriteCardProps {
  item: AnalyticsFavoriteItem
  onOpen: (id: number) => void
}

function FavoriteCard({ item, onOpen }: FavoriteCardProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      className="group flex min-w-0 items-center gap-4 rounded-xl p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }}
    >
      <div className="h-24 w-16 shrink-0 overflow-hidden rounded-lg">
        <CoverImage src={item.cover_url} alt={item.title} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.title}</p>
        {item.title_alt ? <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-muted)' }}>{item.title_alt}</p> : null}
        <p className="mt-3 flex items-center gap-1 text-sm font-semibold" style={{ color: 'var(--brand)' }}>
          <Star size={14} fill="currentColor" />
          {item.score.toFixed(1)}
        </p>
        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {item.rating_count} 条评分{item.average_score !== null ? ` · 原始均分 ${item.average_score.toFixed(1)}` : ''}
        </p>
      </div>
    </button>
  )
}

interface RecommendationCardProps {
  item: AnalyticsRecommendationItem
  onOpen: (id: number) => void
}

function RecommendationCard({ item, onOpen }: RecommendationCardProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      className="group overflow-hidden rounded-xl text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
      style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }}
    >
      <div className="grid grid-cols-[88px_minmax(0,1fr)]">
        <div className="aspect-[3/4] overflow-hidden">
          <CoverImage src={item.cover_url} alt={item.title} />
        </div>
        <div className="min-w-0 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.title}</p>
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
              style={{ color: 'var(--brand)', background: 'rgba(251, 113, 167, 0.12)' }}
            >
              {item.match_percent}%
            </span>
          </div>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>{CONFIDENCE_LABEL[item.confidence]}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {item.matched_tags.length > 0 ? item.matched_tags.map(tag => (
              <span
                key={tag}
                className="rounded-md px-1.5 py-0.5 text-[10px]"
                style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)' }}
              >
                {tag}
              </span>
            )) : (
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>暂无强匹配标签</span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

function AnalyticsLoading() {
  return (
    <div className="flex min-h-[360px] items-center justify-center" role="status" aria-label="统计分析加载中">
      <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: 'var(--border-line)', borderTopColor: 'var(--brand)' }} />
    </div>
  )
}

export function AnalyticsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const currentUser = useAuthStore(state => state.user)
  const openDetail = useUIStore(state => state.openDetail)
  const selection = useMemo(() => parseScope(searchParams), [searchParams])
  const [scoreRange, setScoreRange] = useState<ScoreRange>(DEFAULT_SCORE_RANGE)
  const [cloudMode, setCloudMode] = useState<TagCloudMode>('frequency')
  const debouncedRange = useDebouncedScoreRange(scoreRange)

  const usersQuery = useQuery({
    queryKey: ['analytics-users'],
    queryFn: () => api.listUsers(),
    staleTime: 60_000,
  })
  const overviewQuery = useQuery({
    queryKey: ['analytics-overview', selection.scope, selection.userId ?? null, debouncedRange.min, debouncedRange.max],
    queryFn: ({ signal }) => api.getAnalyticsOverview({
      scope: selection.scope,
      userId: selection.userId,
      minScore: debouncedRange.min,
      maxScore: debouncedRange.max,
    }, { signal }),
    placeholderData: previous => previous,
  })
  const recommendationsQuery = useQuery({
    queryKey: ['analytics-recommendations', selection.scope, selection.userId ?? null],
    queryFn: ({ signal }) => api.getAnalyticsRecommendations({
      scope: selection.scope,
      userId: selection.userId,
      limit: 6,
    }, { signal }),
  })

  const scopeOptions = useMemo(() => {
    const members = usersQuery.data?.items ?? []
    return [
      { value: 'global', label: '全站分析' },
      ...members.map(member => ({
        value: `user:${member.id}`,
        label: member.id === currentUser?.id ? `我 · ${member.nickname}` : member.nickname,
      })),
    ]
  }, [currentUser?.id, usersQuery.data?.items])
  const selectedScopeValue = selection.scope === 'global' ? 'global' : `user:${selection.userId}`
  const overview = overviewQuery.data
  const recommendations = recommendationsQuery.data
  const selectedTags = cloudMode === 'frequency' ? overview?.frequency_tags ?? [] : overview?.weighted_tags ?? []
  const deferredTags = useDeferredValue<AnalyticsTagStat[]>(selectedTags)

  const handleScopeChange = (value: string): void => {
    if (value === 'global') {
      setSearchParams({})
      return
    }
    const userId = Number(value.replace('user:', ''))
    if (Number.isInteger(userId) && userId > 0) {
      setSearchParams({ scope: 'user', user_id: String(userId) })
    }
  }

  return (
    <PageMain className="py-20 sm:py-24">
      <section className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ color: 'var(--brand)', background: 'rgba(251, 113, 167, 0.12)' }}>
              <ChartNoAxesCombined size={22} />
            </span>
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>统计分析</h1>
              <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>从评分和标签中理解全站与成员的看番偏好</p>
            </div>
          </div>
        </div>
        <Select
          value={selectedScopeValue}
          onChange={handleScopeChange}
          options={scopeOptions}
          className="w-full sm:w-52"
          placeholder="选择分析范围"
        />
      </section>

      {overviewQuery.isPending ? <AnalyticsLoading /> : overviewQuery.isError || !overview ? (
        <div className="rounded-xl p-8 text-center text-sm" style={ANALYTICS_CARD_STYLE}>
          <p style={{ color: 'var(--text-muted)' }}>统计数据加载失败，请稍后重试</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard label="评分样本" value={String(overview.rating_count)} icon={<BarChart3 size={17} />} />
            <SummaryCard label="涉及番剧" value={String(overview.title_count)} icon={<Heart size={17} />} />
            <SummaryCard label="参与成员" value={String(overview.user_count)} icon={<Users size={17} />} />
            <SummaryCard label="区间均分" value={overview.average_score?.toFixed(2) ?? '—'} icon={<Star size={17} />} />
          </div>

          <div className="grid items-start gap-6 xl:grid-cols-2">
            <section className="rounded-xl p-5 sm:p-6" style={ANALYTICS_CARD_STYLE}>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>评分分布</h2>
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>柱状图保留完整分布，粉色区域为当前筛选范围</p>
                </div>
                {overviewQuery.isFetching ? <span className="text-[11px]" style={{ color: 'var(--brand)' }}>更新中</span> : null}
              </div>
              <ScoreDistributionChart buckets={overview.score_distribution} range={scoreRange} />
              <div className="mt-2 rounded-xl p-4" style={{ background: 'var(--bg-card-warm)' }}>
                <ScoreRangeSlider value={scoreRange} onChange={setScoreRange} />
              </div>
            </section>

            <section className="rounded-xl p-5 sm:p-6" style={ANALYTICS_CARD_STYLE}>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}><Cloud size={18} />标签词云</h2>
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>字号和颜色共同表示标签权重</p>
                </div>
                <div className="inline-flex rounded-lg p-1" style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }}>
                  {(['frequency', 'weighted'] as const).map(mode => {
                    const active = cloudMode === mode
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setCloudMode(mode)}
                        className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                        style={{
                          color: active ? 'var(--btn-primary-text)' : 'var(--text-muted)',
                          background: active ? 'var(--btn-primary-bg)' : 'transparent',
                        }}
                      >
                        {mode === 'frequency' ? '出现频次' : '评分加权'}
                      </button>
                    )
                  })}
                </div>
              </div>
              <TagWordCloud items={deferredTags} />
            </section>
          </div>

          <section className="rounded-xl p-5 sm:p-6" style={ANALYTICS_CARD_STYLE}>
            <div className="mb-4">
              <h2 className="flex items-center gap-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}><Heart size={18} />当前最喜欢</h2>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>代表作会随评分区间变化，全站范围使用贝叶斯均分减少单样本偏差</p>
            </div>
            {overview.favorites.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-3">
                {overview.favorites.map(item => <FavoriteCard key={item.id} item={item} onOpen={openDetail} />)}
              </div>
            ) : (
              <p className="rounded-xl p-6 text-center text-sm" style={{ color: 'var(--text-muted)', background: 'var(--bg-card-warm)' }}>当前评分区间暂无代表作</p>
            )}
          </section>

          <section className="rounded-xl p-5 sm:p-6" style={ANALYTICS_CARD_STYLE}>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}><Sparkles size={18} />可能喜欢</h2>
                <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>匹配度表示标签画像相似度，不代表喜欢概率</p>
              </div>
              {recommendations ? (
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {BASIS_LABEL[recommendations.basis]} · {CONFIDENCE_LABEL[recommendations.confidence]}
                </span>
              ) : null}
            </div>
            {recommendationsQuery.isPending ? <AnalyticsLoading /> : recommendationsQuery.isError ? (
              <p className="rounded-xl p-6 text-center text-sm" style={{ color: 'var(--text-muted)', background: 'var(--bg-card-warm)' }}>推荐加载失败，请稍后重试</p>
            ) : recommendations && recommendations.items.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {recommendations.items.map(item => <RecommendationCard key={item.id} item={item} onOpen={openDetail} />)}
              </div>
            ) : (
              <p className="rounded-xl p-6 text-center text-sm" style={{ color: 'var(--text-muted)', background: 'var(--bg-card-warm)' }}>暂无未评分候选番剧</p>
            )}
          </section>
        </div>
      )}
    </PageMain>
  )
}
