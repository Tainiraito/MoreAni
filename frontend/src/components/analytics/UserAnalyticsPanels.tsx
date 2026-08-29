import { useQuery } from '@tanstack/react-query'
import { BarChart3, Cloud, Heart, RotateCcw, Sparkles } from 'lucide-react'

import {
  AnalyticsFavoriteCard,
  AnalyticsRecommendationCard,
} from '@/components/analytics/AnalyticsContentCards'
import { ScoreDistributionChart } from '@/components/analytics/ScoreDistributionChart'
import { TagWordCloud } from '@/components/analytics/TagWordCloud'
import { api } from '@/lib/api'
import {
  ANALYTICS_QUERY_BEHAVIOR,
  analyticsOverviewQueryKey,
  analyticsRecommendationsQueryKey,
} from '@/lib/analytics-query'

const FULL_SCORE_RANGE = { min: 0.5, max: 10 } as const
const PANEL_STYLE = {
  background: 'var(--bg-card-warm)',
  border: '1px solid var(--border-line)',
} as const

interface UserAnalyticsPanelsProps {
  userId: number
  onOpenContent: (id: number) => void
}

interface AnalyticsPanelProps {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  testId: string
}

function AnalyticsPanel({ title, icon, children, testId }: AnalyticsPanelProps) {
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col rounded-xl p-4" style={PANEL_STYLE} data-testid={testId}>
      <h3 className="mb-3 flex shrink-0 items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        <span style={{ color: 'var(--brand)' }}>{icon}</span>
        {title}
      </h3>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </section>
  )
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center" role="status" aria-label={label}>
      <div className="h-6 w-6 animate-spin rounded-full border-2" style={{ borderColor: 'var(--border-line)', borderTopColor: 'var(--brand)' }} />
    </div>
  )
}

function PanelError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-3 text-center">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>分析加载失败</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs transition-opacity hover:opacity-80"
        style={{ color: 'var(--brand)', border: '1px solid var(--border-line)' }}
      >
        <RotateCcw size={13} />重新分析
      </button>
    </div>
  )
}

export function UserAnalyticsPanels({ userId, onOpenContent }: UserAnalyticsPanelsProps) {
  const overviewQuery = useQuery({
    queryKey: analyticsOverviewQueryKey({
      scope: 'user',
      userId,
      minScore: FULL_SCORE_RANGE.min,
      maxScore: FULL_SCORE_RANGE.max,
    }),
    queryFn: ({ signal }) => api.getAnalyticsOverview({
      scope: 'user',
      userId,
      minScore: FULL_SCORE_RANGE.min,
      maxScore: FULL_SCORE_RANGE.max,
    }, { signal }),
    ...ANALYTICS_QUERY_BEHAVIOR,
  })
  const recommendationsQuery = useQuery({
    queryKey: analyticsRecommendationsQueryKey({ scope: 'user', userId, limit: 6 }),
    queryFn: ({ signal }) => api.getAnalyticsRecommendations({
      scope: 'user',
      userId,
      limit: 6,
    }, { signal }),
    ...ANALYTICS_QUERY_BEHAVIOR,
  })

  const overview = overviewQuery.data
  const recommendations = recommendationsQuery.data

  return (
    <div className="grid h-full min-h-0 min-w-0 grid-cols-1 grid-rows-4 gap-3 sm:grid-cols-2 sm:grid-rows-2 sm:gap-4 xl:grid-rows-[minmax(0,1fr)_auto] xl:gap-5" data-testid="settings-analytics-grid">
        <AnalyticsPanel title="评分分布" icon={<BarChart3 size={16} />} testId="settings-panel-score-distribution">
          {overviewQuery.isPending ? <PanelLoading label="评分分布加载中" /> : overviewQuery.isError || !overview ? (
            <PanelError onRetry={() => void overviewQuery.refetch()} />
          ) : (
            <ScoreDistributionChart buckets={overview.score_distribution} range={FULL_SCORE_RANGE} />
          )}
        </AnalyticsPanel>
        <AnalyticsPanel title="标签词云" icon={<Cloud size={16} />} testId="settings-panel-tag-cloud">
          {overviewQuery.isPending ? <PanelLoading label="标签词云加载中" /> : overviewQuery.isError || !overview ? (
            <PanelError onRetry={() => void overviewQuery.refetch()} />
          ) : (
            <TagWordCloud items={overview.weighted_tags} />
          )}
        </AnalyticsPanel>

        <AnalyticsPanel title="当前最喜欢" icon={<Heart size={16} />} testId="settings-panel-current-favorites">
          {overviewQuery.isPending ? <PanelLoading label="当前最喜欢加载中" /> : overviewQuery.isError || !overview ? (
            <PanelError onRetry={() => void overviewQuery.refetch()} />
          ) : overview.favorites.length > 0 ? (
            <div className="grid min-h-0 flex-1 content-start gap-2.5 overflow-y-auto p-2" data-testid="settings-current-favorites-scroll">
              {overview.favorites.slice(0, 3).map(item => (
                <AnalyticsFavoriteCard
                  key={item.id}
                  item={item}
                  scope="user"
                  onOpen={onOpenContent}
                />
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>还没有评分代表作</p>
          )}
        </AnalyticsPanel>
        <AnalyticsPanel title="可能喜欢" icon={<Sparkles size={16} />} testId="settings-panel-recommendations">
          {recommendationsQuery.isPending ? <PanelLoading label="可能喜欢加载中" /> : recommendationsQuery.isError || !recommendations ? (
            <PanelError onRetry={() => void recommendationsQuery.refetch()} />
          ) : recommendations.items.length > 0 ? (
            <div className="grid min-h-0 flex-1 content-start gap-2.5 overflow-y-auto p-2" data-testid="settings-recommendations-scroll">
              {recommendations.items.slice(0, 3).map(item => (
                <AnalyticsRecommendationCard
                  key={item.id}
                  item={item}
                  onOpen={onOpenContent}
                />
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>暂无未评分候选番剧</p>
          )}
        </AnalyticsPanel>
    </div>
  )
}
