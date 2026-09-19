import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react'

import { BattlePair } from '@/components/red-blue/BattlePair'
import { RankingList } from '@/components/red-blue/RankingList'
import { StickyMiniBattle } from '@/components/red-blue/StickyMiniBattle'
import { PageMain } from '@/components/layout/PageContainer'
import { ApiError, api } from '@/lib/api'
import { buildRedBlueRankingChanges, patchRedBlueComparisonState, patchRedBlueSuggestionAction, RED_BLUE_STATE_QUERY_KEY } from '@/lib/red-blue'
import { useUIStore } from '@/stores/ui-store'
import { useToastStore } from '@/stores/toast-store'
import type {
  CreateRedBlueComparisonRequest,
  RedBlueOutcome,
  RedBlueRankingChange,
  RedBlueScoreSuggestion,
  RedBlueState,
  RedBlueSuggestionAction,
} from '@/types/red-blue'

interface RetryComparison extends CreateRedBlueComparisonRequest {
  leftTitle: string
  rightTitle: string
}

interface UndoComparison {
  id: number
  message: string
}

function createClientEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `red-blue-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatScore(score: number): string {
  return (score / 10).toFixed(1)
}

function outcomeMessage(outcome: RedBlueOutcome, leftTitle: string, rightTitle: string): string {
  if (outcome === 'LEFT_WIN') return `已记录：更喜欢《${leftTitle}》`
  if (outcome === 'RIGHT_WIN') return `已记录：更喜欢《${rightTitle}》`
  if (outcome === 'TIE') return '已记录：两部作品差不多'
  return '已跳过这组作品'
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
  const [lastRankingDelta, setLastRankingDelta] = useState<Record<number, RedBlueRankingChange>>({})
  const [actionPendingId, setActionPendingId] = useState<number | null>(null)
  const [undoComparison, setUndoComparison] = useState<UndoComparison | null>(null)
  const [focusContentId, setFocusContentId] = useState<number | null>(null)
  const [battleVisible, setBattleVisible] = useState(true)
  const battleSectionRef = useRef<HTMLElement | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toggleFocus = useCallback((contentId: number) => {
    setFocusContentId(current => current === contentId ? null : contentId)
  }, [])

  const stateQuery = useQuery({
    queryKey: RED_BLUE_STATE_QUERY_KEY,
    queryFn: () => api.getRedBlueState(),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
  })

  const comparisonMutation = useMutation({
    mutationFn: (payload: CreateRedBlueComparisonRequest) => api.createRedBlueComparison(payload),
  })
  const actionMutation = useMutation({
    mutationFn: ({ suggestion, action, clientEventId }: { suggestion: RedBlueScoreSuggestion; action: RedBlueSuggestionAction; clientEventId: string }) =>
      api.handleRedBlueSuggestionAction(suggestion.id, {
        action,
        suggestion_key: suggestion.suggestion_key,
        client_event_id: clientEventId,
      }),
  })
  const revokeMutation = useMutation({
    mutationFn: (comparisonId: number) => api.revokeRedBlueComparison(comparisonId),
  })

  useEffect(() => () => {
    if (undoTimerRef.current !== null) clearTimeout(undoTimerRef.current)
  }, [])

  useEffect(() => {
    const section = battleSectionRef.current
    if (section === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      entries => setBattleVisible(entries[0]?.isIntersecting ?? true),
      { threshold: 0.01, rootMargin: '-48px 0px 0px' },
    )
    observer.observe(section)
    return () => observer.disconnect()
  }, [stateQuery.data?.current_pair?.left.content_id, stateQuery.data?.current_pair?.right.content_id])

  const reloadState = useCallback(async () => {
    await queryClient.fetchQuery({
      queryKey: RED_BLUE_STATE_QUERY_KEY,
      queryFn: () => api.getRedBlueState(),
    })
  }, [queryClient])

  const submitComparison = useCallback((outcome: RedBlueOutcome) => {
    const current = queryClient.getQueryData<RedBlueState>(RED_BLUE_STATE_QUERY_KEY)
    const pair = current?.current_pair
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
        const previous = queryClient.getQueryData<RedBlueState>(RED_BLUE_STATE_QUERY_KEY)
        const responseIsStale = previous !== undefined && response.state_version < previous.state_version
        if (previous === undefined) {
          void reloadState()
        } else {
          const patched = patchRedBlueComparisonState(previous, response)
          if (patched === null) {
            void reloadState()
          } else {
            queryClient.setQueryData(RED_BLUE_STATE_QUERY_KEY, patched)
          }
        }
        if (!responseIsStale && response.comparison.outcome !== 'SKIP') {
          setLastRankingDelta(buildRedBlueRankingChanges(response.ranking_delta))
        }
        setRetryComparison(null)
        setSelectedOutcome(null)
        if (response.comparison.outcome !== 'SKIP') {
          if (undoTimerRef.current !== null) clearTimeout(undoTimerRef.current)
          setUndoComparison({
            id: response.comparison.id,
            message: outcomeMessage(response.comparison.outcome, pair.left.title, pair.right.title),
          })
          undoTimerRef.current = window.setTimeout(() => setUndoComparison(null), 7000)
        } else {
          setUndoComparison(null)
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
  }, [addToast, comparisonMutation, focusContentId, queryClient, reloadState, retryComparison])

  const handleSuggestionAction = useCallback((suggestion: RedBlueScoreSuggestion, action: RedBlueSuggestionAction) => {
    if (actionPendingId !== null) return
    const clientEventId = createClientEventId()
    setActionPendingId(suggestion.id)
    actionMutation.mutate({ suggestion, action, clientEventId }, {
      onSuccess: response => {
        const current = queryClient.getQueryData<RedBlueState>(RED_BLUE_STATE_QUERY_KEY)
        if (current !== undefined) queryClient.setQueryData(RED_BLUE_STATE_QUERY_KEY, patchRedBlueSuggestionAction(current, response))
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
  }, [actionMutation, actionPendingId, addToast, queryClient, reloadState])

  const revokeComparison = useCallback(() => {
    if (undoComparison === null || revokeMutation.isPending) return
    const comparisonId = undoComparison.id
    setUndoComparison(null)
    setLastRankingDelta({})
    revokeMutation.mutate(comparisonId, {
      onSuccess: () => {
        addToast('success', '这次 PK 已撤销')
        void reloadState()
      },
      onError: error => addToast('error', errorMessage(error)),
    })
  }, [addToast, reloadState, revokeMutation, undoComparison])

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
            onClick={() => void stateQuery.refetch()}
            className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold"
            style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
          >
            <RefreshCw size={15} /> 重试
          </button>
        </section>
      </PageMain>
    )
  }

  const state = stateQuery.data
  const pairMessage = pairStatusText(state)
  const canShowPair = state.current_pair !== null && state.pair_status !== 'INSUFFICIENT_CANDIDATES'
  const focusedContent = focusContentId === null
    ? null
    : state.ranking.find(item => item.content.content_id === focusContentId)?.content ?? null
  const statusText = modelStatusText(state)

  return (
    <PageMain className="pt-16 pb-12 sm:pt-20 sm:pb-16" data-testid="red-blue-page">
      <div className="space-y-5 sm:space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2" style={{ color: 'var(--brand)' }}>
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'rgba(251,113,167,0.12)' }}>
                <Sparkles size={17} />
              </span>
              <span className="text-xs font-semibold uppercase tracking-[0.18em]">MoreAni / Personal order</span>
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl" style={{ color: 'var(--text-primary)' }}>红蓝合战</h1>
            <p className="mt-2 text-sm sm:text-base" style={{ color: 'var(--text-secondary)' }}>用相对选择，整理真正属于你的番剧排名。</p>
          </div>
          {statusText && (
            <p className="self-start text-xs sm:self-auto sm:pb-1 sm:text-right" style={{ color: 'var(--text-muted)' }} aria-live="polite">
              {statusText}
            </p>
          )}
        </header>

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

        {state.candidate_count === 0 || (state.candidate_count === 1 && state.current_pair === null) ? (
          <EmptyBattleState candidateCount={state.candidate_count} />
        ) : canShowPair ? (
          <section ref={battleSectionRef} aria-labelledby="red-blue-battle-title" data-testid="red-blue-main-battle">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>Choose by feeling</p>
                <h2 id="red-blue-battle-title" className="mt-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>这一组，你更喜欢哪一部？</h2>
              </div>
              {comparisonMutation.isPending && <LoaderCircle size={17} className="animate-spin" style={{ color: 'var(--brand)' }} aria-label="正在记录选择" />}
            </div>
            <BattlePair
              pair={state.current_pair}
              disabled={comparisonMutation.isPending}
              selectedOutcome={selectedOutcome}
              onChoose={submitComparison}
              onOpenContent={openDetail}
            />
          </section>
        ) : null}

        {!battleVisible && canShowPair && state.current_pair && (
          <StickyMiniBattle
            pair={state.current_pair}
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

        {undoComparison && (
          <div className="flex flex-col gap-2 rounded-xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between" style={{ background: 'rgba(71,184,138,0.08)', border: '1px solid rgba(71,184,138,0.25)' }} data-testid="comparison-undo">
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{undoComparison.message}</span>
            <button type="button" onClick={revokeComparison} disabled={revokeMutation.isPending} className="inline-flex items-center justify-center gap-1 text-xs font-semibold disabled:opacity-50" style={{ color: '#47b88a' }}>
              {revokeMutation.isPending && <LoaderCircle size={13} className="animate-spin" />} 撤销
            </button>
          </div>
        )}

        {state.ranking.length > 0 && (
            <RankingList
              ranking={state.ranking}
              rankChanges={lastRankingDelta}
              actionPendingId={actionPendingId}
              onOpenContent={openDetail}
              onSuggestionAction={handleSuggestionAction}
              candidateCount={state.candidate_count}
              focusedContentId={focusContentId}
              onFocusContent={toggleFocus}
          />
        )}
        {state.ranking.length === 0 && state.candidate_count > 0 && <EmptyBattleState candidateCount={state.candidate_count} />}
      </div>
    </PageMain>
  )
}
