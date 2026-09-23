import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react'

import { BattlePair } from '@/components/red-blue/BattlePair'
import { BattleKeyboardShortcuts } from '@/components/red-blue/BattleKeyboardShortcuts'
import { ComparisonHistoryList } from '@/components/red-blue/ComparisonHistoryList'
import { RankingList } from '@/components/red-blue/RankingList'
import { StickyMiniBattle } from '@/components/red-blue/StickyMiniBattle'
import { PageMain } from '@/components/layout/PageContainer'
import { FeaturePageHeader } from '@/components/layout/FeaturePageHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiError, api } from '@/lib/api'
import { buildRedBlueRankingChanges, buildRedBlueRecalibrationChanges, patchRedBlueComparisonState, patchRedBlueSuggestionAction, RED_BLUE_COMPARISONS_QUERY_KEY, RED_BLUE_STATE_QUERY_KEY } from '@/lib/red-blue'
import { useUIStore } from '@/stores/ui-store'
import { useToastStore } from '@/stores/toast-store'
import type {
  CreateRedBlueComparisonRequest,
  RedBlueComparisonHistoryPage,
  RedBlueComparisonHistoryItem,
  RedBlueOutcome,
  RedBluePair,
  RedBlueRankingChange,
  RedBlueRecalibrationChange,
  RedBlueScoreSuggestion,
  RedBlueState,
  RedBlueSuggestionAction,
} from '@/types/red-blue'

interface RetryComparison extends CreateRedBlueComparisonRequest {
  leftTitle: string
  rightTitle: string
}

const RED_BLUE_PAGE_SIZE = 100
const RED_BLUE_RECALIBRATION_POLL_MS = 750

function createClientEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `red-blue-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatScore(score: number): string {
  return (score / 10).toFixed(1)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '操作失败，请稍后重试'
}

function modelStatusText(state: RedBlueState): string | null {
  if (state.model_freshness === 'BOOTSTRAP') return '正在收集你的第一批相对偏好'
  if (state.model_freshness === 'STALE_REQUIRES_FULL' || state.full_recalibration_required) return '排名正在重新校准'
  if (state.full_recalibration_running) return '排名会在后台继续校准'
  return null
}

function pairStatusText(state: RedBlueState): string | null {
  if (state.pair_status === 'COOLDOWN') return '这两部刚刚比较过，稍后再来看看吧。'
  if (state.pair_status === 'INSUFFICIENT_CANDIDATES') {
    if (state.candidate_count === 0) return '还没有可以参加红蓝合战的番剧。'
    return '至少需要两部已评分番剧才能继续红蓝合战。'
  }
  return null
}

function isFullRecalibrationPending(state: RedBlueState): boolean {
  return state.full_recalibration_required
    || state.full_recalibration_running
    || state.model_freshness === 'STALE_REQUIRES_FULL'
}

function isAuthoritativeFullState(state: RedBlueState): boolean {
  return state.model_freshness === 'FULL'
    && !state.full_recalibration_required
    && !state.full_recalibration_running
}

function isFullRecalibrationCompletion(previous: RedBlueState, next: RedBlueState): boolean {
  return isFullRecalibrationPending(previous) && isAuthoritativeFullState(next)
}

const KEYBOARD_OUTCOMES: Record<string, RedBlueOutcome> = {
  a: 'LEFT_WIN',
  arrowleft: 'LEFT_WIN',
  d: 'RIGHT_WIN',
  arrowright: 'RIGHT_WIN',
  s: 'TIE',
  arrowdown: 'TIE',
  w: 'SKIP',
  arrowup: 'SKIP',
}

function isShortcutBlocked(event: KeyboardEvent): boolean {
  const target = event.target
  if (target instanceof HTMLElement && (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.isContentEditable
    || target.closest('[contenteditable]') !== null
  )) return true
  return document.querySelector('[aria-modal="true"], [role="dialog"], [data-red-blue-shortcut-block="true"]') !== null
}

function BattlePageSkeleton() {
  return (
    <PageMain className="pt-16 pb-12 sm:pt-20 sm:pb-16">
      <div className="animate-pulse space-y-5">
        <div className="h-8 w-36 rounded-lg" style={{ background: 'var(--skeleton-bg)' }} />
        <div className="h-4 w-80 max-w-full rounded" style={{ background: 'var(--skeleton-bg)' }} />
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 rounded-2xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}>
          <div className="aspect-[2/3] rounded-xl" style={{ background: 'var(--skeleton-bg)' }} />
          <div className="aspect-[2/3] rounded-xl" style={{ background: 'var(--skeleton-bg)' }} />
        </div>
        <div className="h-12 rounded-2xl" style={{ background: 'var(--skeleton-bg)' }} />
        <div className="h-64 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }} />
      </div>
    </PageMain>
  )
}

function EmptyBattleState({ candidateCount }: { candidateCount: number }) {
  const message = candidateCount === 0
    ? '还没有可以参加红蓝合战的番剧。'
    : '至少需要两部已评分番剧才能开始红蓝合战。'
  return (
    <div className="rounded-2xl p-8 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }} data-testid="red-blue-empty">
      <Sparkles size={24} className="mx-auto" style={{ color: 'var(--brand)' }} />
      <p className="mt-3 font-medium" style={{ color: 'var(--text-primary)' }}>{message}</p>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>给看过的番剧打分后，它们就会出现在这里。</p>
    </div>
  )
}

export function RedBlueBattlePage() {
  const queryClient = useQueryClient()
  const openDetail = useUIStore(state => state.openDetail)
  const detailOpen = useUIStore(state => state.detailOpen)
  const authOpen = useUIStore(state => state.authOpen)
  const settingsOpen = useUIStore(state => state.settingsOpen)
  const addAnimeOpen = useUIStore(state => state.addAnimeOpen)
  const editContentId = useUIStore(state => state.editContentId)
  const adminOpen = useUIStore(state => state.adminOpen)
  const addToast = useToastStore(state => state.addToast)
  const [selectedOutcome, setSelectedOutcome] = useState<RedBlueOutcome | null>(null)
  const [retryComparison, setRetryComparison] = useState<RetryComparison | null>(null)
  const [lastComparisonRankingDelta, setLastComparisonRankingDelta] = useState<Record<number, RedBlueRankingChange>>({})
  const [fullRecalibrationDelta, setFullRecalibrationDelta] = useState<Record<number, RedBlueRecalibrationChange>>({})
  const [fullRecalibrationAdjustedCount, setFullRecalibrationAdjustedCount] = useState<number | null>(null)
  const [actionPendingId, setActionPendingId] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<'ranking' | 'history'>('ranking')
  const [rankingPage, setRankingPage] = useState(1)
  const [historyPage, setHistoryPage] = useState(1)
  const [focusContentId, setFocusContentId] = useState<number | null>(null)
  const [battleVisible, setBattleVisible] = useState(true)
  // activePair 是浏览器交互态；后台 Full Ranker 轮询只更新 React Query，不覆盖当前卡片。
  const [activePair, setActivePair] = useState<RedBluePair | null | undefined>(undefined)
  const activePairInitializedRef = useRef(false)
  const lastObservedStateRef = useRef<{ queryKey: readonly unknown[]; state: RedBlueState } | null>(null)
  const battleSectionRef = useRef<HTMLElement | null>(null)
  const toggleFocus = useCallback((contentId: number) => {
    setFocusContentId(current => current === contentId ? null : contentId)
  }, [])

  const stateQueryKey = useMemo(
    () => [...RED_BLUE_STATE_QUERY_KEY, rankingPage, RED_BLUE_PAGE_SIZE] as const,
    [rankingPage],
  )
  const historyQueryKey = useMemo(
    () => [...RED_BLUE_COMPARISONS_QUERY_KEY, historyPage, RED_BLUE_PAGE_SIZE] as const,
    [historyPage],
  )

  const stateQuery = useQuery({
    queryKey: stateQueryKey,
    queryFn: () => api.getRedBlueState({ page: rankingPage, size: RED_BLUE_PAGE_SIZE }),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: query => {
      const state = query.state.data
      return state !== undefined && (state.full_recalibration_required || state.full_recalibration_running)
        ? RED_BLUE_RECALIBRATION_POLL_MS
        : false
    },
    refetchIntervalInBackground: false,
  })
  const historyQuery = useQuery({
    queryKey: historyQueryKey,
    queryFn: () => api.getRedBlueComparisons({ page: historyPage, size: RED_BLUE_PAGE_SIZE }),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (activePairInitializedRef.current || stateQuery.data === undefined) return
    activePairInitializedRef.current = true
    setActivePair(stateQuery.data.current_pair)
  }, [stateQuery.data])

  useEffect(() => {
    const nextState = stateQuery.data
    if (nextState === undefined) return
    const previousState = lastObservedStateRef.current?.queryKey === stateQueryKey
      ? lastObservedStateRef.current.state
      : undefined
    if (previousState !== undefined && isFullRecalibrationCompletion(previousState, nextState)) {
      const delta = buildRedBlueRecalibrationChanges(previousState.ranking, nextState.ranking)
      const adjustedCount = Object.keys(delta).length
      if (adjustedCount > 0) {
        setFullRecalibrationDelta(delta)
        setFullRecalibrationAdjustedCount(adjustedCount)
      }
    }
    lastObservedStateRef.current = { queryKey: stateQueryKey, state: nextState }
  }, [stateQuery.data, stateQueryKey])

  const comparisonMutation = useMutation({
    mutationFn: (payload: CreateRedBlueComparisonRequest) => api.createRedBlueComparison(payload),
  })
  const actionMutation = useMutation({
    mutationFn: ({ suggestion, action, clientEventId, page }: { suggestion: RedBlueScoreSuggestion; action: RedBlueSuggestionAction; clientEventId: string; page: number }) =>
      api.handleRedBlueSuggestionAction(suggestion.id, {
        action,
        suggestion_key: suggestion.suggestion_key,
        client_event_id: clientEventId,
      }, { page, size: RED_BLUE_PAGE_SIZE }),
  })
  const revokeMutation = useMutation({
    mutationFn: (comparisonId: number) => api.revokeRedBlueComparison(comparisonId),
  })

  useEffect(() => {
    const section = battleSectionRef.current
    if (section === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      entries => setBattleVisible(entries[0]?.isIntersecting ?? true),
      { threshold: 0.01, rootMargin: '-48px 0px 0px' },
    )
    observer.observe(section)
    return () => observer.disconnect()
  }, [activePair?.left.content_id, activePair?.right.content_id])

  const clearRecalibrationFeedback = useCallback(() => {
    setFullRecalibrationDelta({})
    setFullRecalibrationAdjustedCount(null)
  }, [])

  const reloadState = useCallback(async () => {
    clearRecalibrationFeedback()
    const refreshedState = await queryClient.fetchQuery({
      queryKey: stateQueryKey,
      queryFn: () => api.getRedBlueState({ page: rankingPage, size: RED_BLUE_PAGE_SIZE }),
    })
    setActivePair(refreshedState.current_pair)
  }, [clearRecalibrationFeedback, queryClient, rankingPage, stateQueryKey])

  const submitComparison = useCallback((outcome: RedBlueOutcome) => {
    const pair = activePair
    if (pair === null || pair === undefined || comparisonMutation.isPending) return

    const canRetry = retryComparison !== null
      && retryComparison.left_content_id === pair.left.content_id
      && retryComparison.right_content_id === pair.right.content_id
      && retryComparison.outcome === outcome
    const payload: CreateRedBlueComparisonRequest = canRetry && retryComparison !== null
      ? {
        left_content_id: retryComparison.left_content_id,
        right_content_id: retryComparison.right_content_id,
        outcome: retryComparison.outcome,
        client_event_id: retryComparison.client_event_id,
        focus_content_id: retryComparison.focus_content_id,
      }
      : {
        left_content_id: pair.left.content_id,
        right_content_id: pair.right.content_id,
        outcome,
        client_event_id: createClientEventId(),
        ...(focusContentId === null ? {} : { focus_content_id: focusContentId }),
      }

    setSelectedOutcome(outcome)
    comparisonMutation.mutate(payload, {
      onSuccess: response => {
        const previous = queryClient.getQueryData<RedBlueState>(stateQueryKey)
        const responseIsStale = previous !== undefined && response.state_version < previous.state_version
        if (previous === undefined) {
          void reloadState()
        } else {
          const patched = patchRedBlueComparisonState(previous, response)
          if (patched === null) {
            void reloadState()
          } else {
            queryClient.setQueryData(stateQueryKey, patched)
          }
        }
        if (!responseIsStale) setActivePair(response.next_pair)
        if (!responseIsStale && response.comparison.outcome !== 'SKIP') {
          setLastComparisonRankingDelta(buildRedBlueRankingChanges(response.ranking_delta))
          clearRecalibrationFeedback()
        }
        setRetryComparison(null)
        setSelectedOutcome(null)
        void queryClient.invalidateQueries({ queryKey: RED_BLUE_COMPARISONS_QUERY_KEY })
        // Fast 响应只携带当前权威 Full snapshot 的 uncertainty 字段；
        // 主动刷新并在 Full worker 运行期间轮询，确保 badge/rank interval
        // 不需要用户手动刷新页面才能跟上新的 snapshot。
        if (response.full_recalibration_required || response.full_recalibration_running) {
          void queryClient.invalidateQueries({ queryKey: stateQueryKey })
        }
      },
      onError: error => {
        setSelectedOutcome(null)
        setRetryComparison({ ...payload, leftTitle: pair.left.title, rightTitle: pair.right.title })
        if (error instanceof ApiError && error.status === 409) {
          setRetryComparison(null)
          addToast('warning', '当前状态已变化，正在重新获取红蓝合战状态')
          void reloadState()
        } else {
          addToast('error', errorMessage(error))
        }
      },
    })
  }, [activePair, addToast, clearRecalibrationFeedback, comparisonMutation, focusContentId, queryClient, reloadState, retryComparison, stateQueryKey])

  const handleSuggestionAction = useCallback((suggestion: RedBlueScoreSuggestion, action: RedBlueSuggestionAction) => {
    if (actionPendingId !== null) return
    const clientEventId = createClientEventId()
    setActionPendingId(suggestion.id)
    actionMutation.mutate({ suggestion, action, clientEventId, page: rankingPage }, {
      onSuccess: response => {
        const current = queryClient.getQueryData<RedBlueState>(stateQueryKey)
        if (current !== undefined) queryClient.setQueryData(stateQueryKey, patchRedBlueSuggestionAction(current, response))
        setActionPendingId(null)
        if (action === 'ACCEPTED') addToast('success', `评分已调整为 ${formatScore(response.updated_score)}`)
        if (action === 'DISMISSED') addToast('info', '已暂时忽略这条评分建议')
        if (action === 'REJECTED') addToast('info', '已保持当前评分')
      },
      onError: error => {
        setActionPendingId(null)
        if (error instanceof ApiError && error.status === 409) {
          addToast('warning', '这条评分建议已发生变化，正在刷新状态')
          void reloadState()
        } else {
          addToast('error', errorMessage(error))
        }
      },
    })
  }, [actionMutation, actionPendingId, addToast, queryClient, rankingPage, reloadState, stateQueryKey])

  const revokeComparison = useCallback((item: RedBlueComparisonHistoryItem) => {
    if (revokeMutation.isPending) return
    setLastComparisonRankingDelta({})
    clearRecalibrationFeedback()
    revokeMutation.mutate(item.id, {
      onSuccess: () => {
        queryClient.setQueryData<RedBlueComparisonHistoryPage>(historyQueryKey, current => current === undefined
          ? current
          : {
            ...current,
            items: current.items.filter(historyItem => historyItem.id !== item.id),
            total: Math.max(0, current.total - 1),
          },
        )
        addToast('success', '这次 PK 已撤销')
        void reloadState()
        void queryClient.invalidateQueries({ queryKey: RED_BLUE_COMPARISONS_QUERY_KEY })
      },
      onError: error => addToast('error', errorMessage(error)),
    })
  }, [addToast, clearRecalibrationFeedback, historyQueryKey, queryClient, reloadState, revokeMutation])

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil((stateQuery.data?.ranking_total ?? stateQuery.data?.candidate_count ?? 0) / RED_BLUE_PAGE_SIZE))
    if (rankingPage > totalPages) setRankingPage(totalPages)
  }, [rankingPage, stateQuery.data?.candidate_count, stateQuery.data?.ranking_total])

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil((historyQuery.data?.total ?? 0) / RED_BLUE_PAGE_SIZE))
    if (historyPage > totalPages) setHistoryPage(totalPages)
  }, [historyPage, historyQuery.data?.total])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const outcome = KEYBOARD_OUTCOMES[event.key.toLowerCase()]
      if (
        outcome === undefined
        || event.repeat
        || comparisonMutation.isPending
        || detailOpen
        || authOpen
        || settingsOpen
        || addAnimeOpen
        || editContentId !== null
        || adminOpen
        || isShortcutBlocked(event)
      ) return
      event.preventDefault()
      submitComparison(outcome)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [addAnimeOpen, adminOpen, authOpen, comparisonMutation.isPending, detailOpen, editContentId, settingsOpen, submitComparison])

  if (stateQuery.isLoading) return <BattlePageSkeleton />

  if (stateQuery.isError || stateQuery.data === undefined) {
    return (
      <PageMain className="pt-20 pb-16 sm:pt-24">
        <section className="rounded-2xl p-8 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }} data-testid="red-blue-error">
          <CircleAlert size={24} className="mx-auto" style={{ color: 'var(--accent-coral)' }} />
          <h1 className="mt-3 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>红蓝合战暂时无法加载</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>{errorMessage(stateQuery.error)}</p>
          <button
            type="button"
            onClick={() => {
              clearRecalibrationFeedback()
              void stateQuery.refetch()
            }}
            className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold"
            style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
          >
            <RefreshCw size={15} /> 重试
          </button>
        </section>
      </PageMain>
    )
  }

  if (activePair === undefined) return <BattlePageSkeleton />

  const state = stateQuery.data
  const comparisonHistoryPage = historyQuery.data ?? {
    items: [],
    total: 0,
    page: historyPage,
    size: RED_BLUE_PAGE_SIZE,
  }
  const comparisonHistory = comparisonHistoryPage.items
  const rankingTotal = state.ranking_total ?? state.candidate_count
  const pairMessage = pairStatusText(state)
  const canShowPair = activePair !== null
  const focusedContent = focusContentId === null
    ? null
    : state.ranking.find(item => item.content.content_id === focusContentId)?.content ?? null
  const statusText = modelStatusText(state)

  return (
    <PageMain className="pt-16 pb-12 sm:pt-20 sm:pb-16" data-testid="red-blue-page">
      <div className="space-y-5 sm:space-y-6">
        <FeaturePageHeader
          eyebrow="Personal ranking"
          title="红蓝合战"
          description="用相对选择，整理真正属于你的番剧排名。"
          actions={statusText ? (
            <p className="self-start text-xs sm:self-auto sm:pb-1 sm:text-right" style={{ color: 'var(--text-muted)' }} aria-live="polite">
              {statusText}
            </p>
          ) : undefined}
        />

        {fullRecalibrationAdjustedCount !== null && (
          <div
            className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm"
            style={{ background: 'rgba(251,113,167,0.08)', border: '1px solid rgba(251,113,167,0.22)', color: 'var(--text-secondary)' }}
            data-source="FULL_RECALIBRATION"
            data-testid="red-blue-recalibration-notice"
            aria-live="polite"
          >
            <RefreshCw size={16} style={{ color: 'var(--brand)' }} />
            <span>
              排名已重新校准
              {fullRecalibrationAdjustedCount > 0 && ` · ${fullRecalibrationAdjustedCount} 个位置有所调整`}
            </span>
          </div>
        )}

        {focusedContent && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs" style={{ background: 'rgba(251,113,167,0.08)', border: '1px solid rgba(251,113,167,0.25)', color: 'var(--text-secondary)' }} data-testid="red-blue-focus-status">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--brand)', boxShadow: '0 0 0 4px rgba(251,113,167,0.12)' }} />
              正在重点校准：<strong className="truncate" style={{ color: 'var(--text-primary)' }}>《{focusedContent.title}》</strong>
            </span>
            <button
              type="button"
              onClick={() => setFocusContentId(null)}
              className="shrink-0 font-semibold transition-opacity hover:opacity-75"
              style={{ color: 'var(--brand)' }}
            >
              结束重点校准
            </button>
          </div>
        )}

        {pairMessage && (
          <div className="flex items-start gap-3 rounded-xl px-4 py-3 text-sm" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', color: 'var(--text-secondary)' }} data-testid="red-blue-pair-status">
            <CircleAlert size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--brand)' }} />
            <span>{pairMessage}</span>
          </div>
        )}

        {activePair === null && (state.candidate_count === 0 || state.candidate_count === 1) ? (
          <EmptyBattleState candidateCount={state.candidate_count} />
        ) : canShowPair ? (
          <section ref={battleSectionRef} aria-labelledby="red-blue-battle-title" data-testid="red-blue-main-battle">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-2 sm:flex-nowrap">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>Choose by feeling</p>
                <h2 id="red-blue-battle-title" className="mt-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>这一组，你更喜欢哪一部？</h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <BattleKeyboardShortcuts />
                {comparisonMutation.isPending && <LoaderCircle size={17} className="animate-spin" style={{ color: 'var(--brand)' }} aria-label="正在记录选择" />}
              </div>
            </div>
            <BattlePair
              pair={activePair}
              disabled={comparisonMutation.isPending}
              selectedOutcome={selectedOutcome}
              onChoose={submitComparison}
              onOpenContent={openDetail}
            />
          </section>
        ) : null}

        {!battleVisible && canShowPair && activePair && (
          <StickyMiniBattle
            pair={activePair}
            disabled={comparisonMutation.isPending}
            selectedOutcome={selectedOutcome}
            onChoose={submitComparison}
            onOpenContent={openDetail}
          />
        )}

        {retryComparison && (
          <div className="flex flex-col gap-3 rounded-xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between" style={{ background: 'var(--bg-card)', border: '1px solid color-mix(in srgb, var(--accent-coral) 30%, var(--border-line))' }} data-testid="comparison-retry">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>这次选择还没有确认保存，可以安全重试同一票。</p>
            <button
              type="button"
              onClick={() => submitComparison(retryComparison.outcome)}
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold"
              style={{ color: 'var(--accent-coral)', border: '1px solid color-mix(in srgb, var(--accent-coral) 35%, var(--border-line))' }}
            >
              <RefreshCw size={13} /> 重试上一票
            </button>
          </div>
        )}

        <Tabs
          value={activeTab}
          onValueChange={value => {
            if (value === 'ranking' || value === 'history') setActiveTab(value)
          }}
          className="gap-0"
          data-testid="red-blue-results-tabs"
        >
          <TabsList
            variant="line"
            aria-label="红蓝合战结果"
            className="w-full justify-start rounded-none border-b p-0"
            style={{ borderColor: 'var(--border-line)' }}
          >
            <TabsTrigger
              value="ranking"
              className="flex-none rounded-t-lg px-3 py-2 text-sm font-semibold text-[var(--text-muted)] after:bg-[var(--brand)] data-[active]:text-[var(--brand)]"
              data-testid="red-blue-ranking-tab"
            >
              我的排名
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="flex-none rounded-t-lg px-3 py-2 text-sm font-semibold text-[var(--text-muted)] after:bg-[var(--brand)] data-[active]:text-[var(--brand)]"
              data-testid="red-blue-history-tab"
            >
              PK 历史
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ranking" className="mt-0">
            {state.candidate_count > 0 && (
              <RankingList
                ranking={state.ranking}
                rankChanges={lastComparisonRankingDelta}
                recalibrationChanges={fullRecalibrationDelta}
                actionPendingId={actionPendingId}
                onOpenContent={openDetail}
                onSuggestionAction={handleSuggestionAction}
                candidateCount={state.candidate_count}
                focusedContentId={focusContentId}
                onFocusContent={toggleFocus}
                page={state.ranking_page ?? rankingPage}
                pageSize={state.ranking_size ?? RED_BLUE_PAGE_SIZE}
                total={rankingTotal}
                onPageChange={setRankingPage}
              />
            )}
          </TabsContent>
          <TabsContent value="history" className="mt-0">
            <ComparisonHistoryList
              history={comparisonHistory}
              loading={historyQuery.isLoading}
              error={historyQuery.isError}
              onRetry={() => void historyQuery.refetch()}
              pendingId={revokeMutation.isPending ? revokeMutation.variables ?? null : null}
              onRevoke={revokeComparison}
              page={comparisonHistoryPage.page}
              pageSize={comparisonHistoryPage.size}
              total={comparisonHistoryPage.total}
              onPageChange={setHistoryPage}
            />
          </TabsContent>
        </Tabs>
      </div>
    </PageMain>
  )
}
