import type { AnalyticsScopeType } from '@/types'

export const ANALYTICS_QUERY_STALE_TIME_MS = 15_000
export const ANALYTICS_QUERY_GC_TIME_MS = 5 * 60_000

interface AnalyticsQueryScope {
  scope: AnalyticsScopeType
  userId?: number
  tags?: readonly string[]
}

interface AnalyticsRecommendationsQuery extends AnalyticsQueryScope {
  limit: number
}

interface AnalyticsOverviewQuery extends AnalyticsQueryScope {
  minScore: number
  maxScore: number
}

export function analyticsOverviewQueryKey(params: AnalyticsOverviewQuery) {
  return [
    'analytics-overview',
    params.scope,
    params.userId ?? null,
    params.minScore,
    params.maxScore,
    ...(params.tags ?? []),
  ] as const
}

export function analyticsRecommendationsQueryKey(params: AnalyticsRecommendationsQuery) {
  return [
    'analytics-recommendations',
    params.scope,
    params.userId ?? null,
    params.limit,
    ...(params.tags ?? []),
  ] as const
}

export const ANALYTICS_QUERY_BEHAVIOR = {
  staleTime: ANALYTICS_QUERY_STALE_TIME_MS,
  gcTime: ANALYTICS_QUERY_GC_TIME_MS,
  retry: false,
  refetchOnWindowFocus: false,
} as const
