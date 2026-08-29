import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, ChartNoAxesCombined, Cloud, Heart, RotateCcw, Sparkles, Star, Users } from 'lucide-react'
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
const COVER_CARD_GRID_CLASS = 'grid grid-cols-[88px_minmax(0,1fr)]'

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

function haveSameTagNames(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index])
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

interface AnalyticsResetButtonProps {
  label: string
  onClick: () => void
}

function AnalyticsResetButton({ label, onClick }: AnalyticsResetButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[rgba(251,113,167,0.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      style={{ color: 'var(--text-muted)' }}
    >
      <RotateCcw size={14} />
    </button>
  )
}

interface FavoriteCardProps {
  item: AnalyticsFavoriteItem
  scope: AnalyticsScopeType
  requiredTagNames: readonly string[]
  onOpen: (id: number) => void
}

function FavoriteCard({ item, scope, requiredTagNames, onOpen }: FavoriteCardProps) {
  return (
    <button
      type="button"
      data-testid="analytics-favorite-card"
      onClick={() => onOpen(item.id)}
      className="group min-w-0 overflow-hidden rounded-xl text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }}
    >
      <div className={COVER_CARD_GRID_CLASS}>
        <div className="min-h-[7.25rem] self-stretch overflow-hidden" data-testid="analytics-card-cover">
          <CoverImage src={item.cover_url} alt={item.title} />
        </div>
        <div className="min-w-0 p-3">
          <p className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.title}</p>
          {item.title_alt ? <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-muted)' }}>{item.title_alt}</p> : null}
          <p className="mt-3 flex items-center gap-1 text-sm font-semibold" style={{ color: 'var(--brand)' }}>
            <Star size={14} fill="currentColor" />
            {item.score.toFixed(1)}
          </p>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {scope === 'global'
              ? `${item.rating_count} 条评分 · 实际均分`
              : `全站 ${item.rating_count} 条评分${item.average_score !== null ? ` · 均分 ${item.average_score.toFixed(1)}` : ''}`}
          </p>
          {requiredTagNames.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1" data-testid="favorite-required-tags">
              {requiredTagNames.map(tag => (
                <span
                  key={tag}
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                  style={{ color: 'var(--brand)', background: 'rgba(251, 113, 167, 0.14)' }}
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </button>
  )
}

interface RecommendationCardProps {
  item: AnalyticsRecommendationItem
  requiredTagNames: readonly string[]
  onOpen: (id: number) => void
}

function RecommendationCard({ item, requiredTagNames, onOpen }: RecommendationCardProps) {
  const otherMatchedTags = item.matched_tags.filter(tag => !requiredTagNames.includes(tag))
  const hasVisibleTags = requiredTagNames.length > 0 || otherMatchedTags.length > 0
  return (
    <button
      type="button"
      data-testid="analytics-recommendation-card"
      onClick={() => onOpen(item.id)}
      className="group overflow-hidden rounded-xl text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
      style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }}
    >
      <div className={COVER_CARD_GRID_CLASS}>
        <div className="min-h-[7.25rem] self-stretch overflow-hidden" data-testid="analytics-card-cover">
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
          <p
            className="mt-1 flex items-center gap-1 text-[11px] tabular-nums"
            style={{ color: 'var(--text-muted)' }}
            data-testid="analytics-recommendation-rating"
          >
            <Star size={12} fill={item.average_score !== null ? 'currentColor' : 'none'} />
            {item.average_score !== null
              ? `站内评分 ${item.average_score.toFixed(1)} · ${item.rating_count} 人评分`
              : '暂无站内评分'}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {requiredTagNames.map(tag => (
              <span
                key={tag}
                className="rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                style={{ color: 'var(--brand)', background: 'rgba(251, 113, 167, 0.14)' }}
              >
                {tag}
              </span>
            ))}
            {otherMatchedTags.map(tag => (
              <span
                key={tag}
                className="rounded-md px-1.5 py-0.5 text-[10px]"
                style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)' }}
              >
                {tag}
              </span>
            ))}
            {!hasVisibleTags ? (
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>暂无强匹配标签</span>
            ) : null}
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
  const [cloudMode, setCloudMode] = useState<TagCloudMode>('weighted')
  const [selectedTagNames, setSelectedTagNames] = useState<string[]>([])
  const [activeTagNames, setActiveTagNames] = useState<string[]>([])
  const scoreRangeBeforeColumnSelectionRef = useRef<ScoreRange | null>(null)
  const selectedScoreColumnRef = useRef<number | null>(null)
  const debouncedRange = useDebouncedScoreRange(scoreRange)

  const usersQuery = useQuery({
    queryKey: ['analytics-users'],
    queryFn: () => api.listUsers(),
    staleTime: 60_000,
  })
  const overviewQuery = useQuery({
    queryKey: [
      'analytics-overview',
      selection.scope,
      selection.userId ?? null,
      debouncedRange.min,
      debouncedRange.max,
      activeTagNames,
    ],
    queryFn: ({ signal }) => api.getAnalyticsOverview({
      scope: selection.scope,
      userId: selection.userId,
      minScore: debouncedRange.min,
      maxScore: debouncedRange.max,
      tags: activeTagNames,
    }, { signal }),
    placeholderData: previous => previous,
  })
  const recommendationsQuery = useQuery({
    queryKey: ['analytics-recommendations', selection.scope, selection.userId ?? null, activeTagNames],
    queryFn: ({ signal }) => api.getAnalyticsRecommendations({
      scope: selection.scope,
      userId: selection.userId,
      limit: 6,
      tags: activeTagNames,
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
  const cloudTagItems = useMemo<AnalyticsTagStat[]>(
    () => (cloudMode === 'frequency' ? overview?.frequency_tags ?? [] : overview?.weighted_tags ?? []),
    [cloudMode, overview?.frequency_tags, overview?.weighted_tags],
  )
  const deferredTags = useDeferredValue<AnalyticsTagStat[]>(cloudTagItems)
  const availableTagNameSet = useMemo(
    () => new Set(cloudTagItems.map(item => item.name)),
    [cloudTagItems],
  )

  useEffect(() => {
    const nextActiveTagNames = selectedTagNames.filter(name => availableTagNameSet.has(name))
    setActiveTagNames(currentNames => (
      haveSameTagNames(currentNames, nextActiveTagNames) ? currentNames : nextActiveTagNames
    ))
  }, [availableTagNameSet, selectedTagNames])

  const handleScoreRangeChange = useCallback((nextRange: ScoreRange): void => {
    scoreRangeBeforeColumnSelectionRef.current = null
    selectedScoreColumnRef.current = null
    setScoreRange(nextRange)
  }, [])

  const handleScoreColumnSelect = useCallback((score: number): void => {
    const previousRange = scoreRangeBeforeColumnSelectionRef.current
    if (
      selectedScoreColumnRef.current === score
      && scoreRange.min === score
      && scoreRange.max === score
      && previousRange
    ) {
      scoreRangeBeforeColumnSelectionRef.current = null
      selectedScoreColumnRef.current = null
      setScoreRange(previousRange)
      return
    }
    if (selectedScoreColumnRef.current === null) {
      scoreRangeBeforeColumnSelectionRef.current = { ...scoreRange }
    }
    selectedScoreColumnRef.current = score
    setScoreRange({ min: score, max: score })
  }, [scoreRange])

  const handleToggleTag = useCallback((name: string): void => {
    const alreadySelected = selectedTagNames.includes(name)
    setSelectedTagNames(alreadySelected
      ? selectedTagNames.filter(currentName => currentName !== name)
      : [...selectedTagNames, name])
    setActiveTagNames(alreadySelected
      ? activeTagNames.filter(currentName => currentName !== name)
      : [...activeTagNames, name])
  }, [activeTagNames, selectedTagNames])

  const handleResetScoreRange = useCallback((): void => {
    scoreRangeBeforeColumnSelectionRef.current = null
    selectedScoreColumnRef.current = null
    setScoreRange(DEFAULT_SCORE_RANGE)
  }, [])

  const handleResetTagCloud = useCallback((): void => {
    setCloudMode('weighted')
    setSelectedTagNames([])
    setActiveTagNames([])
  }, [])

  const handleScopeChange = (value: string): void => {
    setSelectedTagNames([])
    setActiveTagNames([])
    scoreRangeBeforeColumnSelectionRef.current = null
    selectedScoreColumnRef.current = null
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

          <div className="grid gap-6 lg:grid-cols-2" data-testid="analytics-primary-grid">
            <section className="flex h-full min-w-0 flex-col rounded-xl p-5 sm:p-6" style={ANALYTICS_CARD_STYLE} data-testid="rating-distribution-panel">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-center gap-1">
                  <h2 className="flex items-center gap-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}><BarChart3 size={18} />评分分布</h2>
                  <AnalyticsResetButton label="重置评分区间" onClick={handleResetScoreRange} />
                </div>
                {overviewQuery.isFetching ? <span className="text-[11px]" style={{ color: 'var(--brand)' }}>更新中</span> : null}
              </div>
              <ScoreDistributionChart
                buckets={overview.score_distribution}
                range={scoreRange}
                onSelectScore={handleScoreColumnSelect}
              />
              <div className="mt-2 rounded-xl p-4" style={{ background: 'var(--bg-card-warm)' }}>
                <ScoreRangeSlider value={scoreRange} onChange={handleScoreRangeChange} />
              </div>
            </section>

            <section className="flex h-full min-w-0 flex-col rounded-xl p-5 sm:p-6" style={ANALYTICS_CARD_STYLE} data-testid="tag-cloud-panel">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-center gap-1">
                  <h2 className="flex items-center gap-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}><Cloud size={18} />标签词云</h2>
                  <AnalyticsResetButton label="重置标签词云" onClick={handleResetTagCloud} />
                </div>
                <div className="inline-flex rounded-lg p-1" style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }}>
                  {(['frequency', 'weighted'] as const).map(mode => {
                    const active = cloudMode === mode
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setCloudMode(mode)}
                        aria-pressed={active}
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
              <TagWordCloud
                items={deferredTags}
                selectedNames={activeTagNames}
                onToggleTag={handleToggleTag}
              />
            </section>
          </div>

          <section className="rounded-xl p-5 sm:p-6" style={ANALYTICS_CARD_STYLE}>
            <div className="mb-4">
              <h2 className="flex items-center gap-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}><Heart size={18} />当前最喜欢</h2>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>代表作会随评分区间变化；全站优先展示高分且评分人数充足的番剧，卡片显示站内实际均分</p>
            </div>
            {overviewQuery.isPlaceholderData ? (
              <p className="rounded-xl p-6 text-center text-sm" style={{ color: 'var(--text-muted)', background: 'var(--bg-card-warm)' }}>筛选代表作中…</p>
            ) : overview.favorites.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-3">
                {overview.favorites.map(item => (
                  <FavoriteCard
                    key={item.id}
                    item={item}
                    scope={overview.scope.type}
                    requiredTagNames={activeTagNames}
                    onOpen={openDetail}
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-xl p-6 text-center text-sm" style={{ color: 'var(--text-muted)', background: 'var(--bg-card-warm)' }}>
                {activeTagNames.length > 0 ? '暂无同时包含全部已选标签的代表作' : '当前评分区间暂无代表作'}
              </p>
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
                  {BASIS_LABEL[recommendations.basis]}
                </span>
              ) : null}
            </div>
            {recommendationsQuery.isPending ? <AnalyticsLoading /> : recommendationsQuery.isError ? (
              <p className="rounded-xl p-6 text-center text-sm" style={{ color: 'var(--text-muted)', background: 'var(--bg-card-warm)' }}>推荐加载失败，请稍后重试</p>
            ) : recommendations && recommendations.items.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {recommendations.items.map(item => (
                  <RecommendationCard
                    key={item.id}
                    item={item}
                    requiredTagNames={activeTagNames}
                    onOpen={openDetail}
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-xl p-6 text-center text-sm" style={{ color: 'var(--text-muted)', background: 'var(--bg-card-warm)' }}>
                {activeTagNames.length > 0 ? '暂无同时包含全部已选标签的推荐番剧' : '暂无未评分候选番剧'}
              </p>
            )}
          </section>
        </div>
      )}
    </PageMain>
  )
}
