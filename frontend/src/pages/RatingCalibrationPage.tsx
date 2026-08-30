import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowLeft, ArrowUp, Eye, EyeOff, GripVertical, LoaderCircle, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'

import { PageMain } from '@/components/layout/PageContainer'
import { CoverImage } from '@/components/ui/CoverImage'
import { StarRating } from '@/components/rating/StarRating'
import { useToastStore } from '@/stores/toast-store'
import { useRefreshStore } from '@/stores/refresh-store'
import { api, ApiError } from '@/lib/api'
import { contentDetailQueryKeyPrefix } from '@/lib/content-detail-query'
import { moveCalibrationRow, moveCalibrationRowToSlot, sortCalibrationRows, type RatingCalibrationRow } from '@/lib/rating-calibration'
import type { RatingCalibrationCandidate } from '@/types'

const INITIAL_CANDIDATE_COUNT = 3

type ConfirmAction = 'leave' | 'redraw'

interface CalibrationRowViewProps {
  row: RatingCalibrationRow
  index: number
  rowCount: number
  oldScoreVisible: boolean
  isDragging: boolean
  dragOverSlot: number | null
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, contentId: number) => void
  onMove: (fromIndex: number, toIndex: number) => void
  onToggleOldScore: (contentId: number) => void
  onScoreChange: (contentId: number, score: number) => void
  onRemove: (contentId: number) => void
}

interface PointerDragState {
  contentId: number
  pointerId: number
  startX: number
  startY: number
}

function formatScore(score: number): string {
  return (score / 10).toFixed(1)
}

function formatScoreDelta(oldScore: number, newScore: number): string {
  const delta = (newScore - oldScore) / 10
  return `${delta > 0 ? '↑ 上调' : '↓ 下调'} ${Math.abs(delta).toFixed(1)} 分`
}

function toDraftRows(candidates: RatingCalibrationCandidate[]): RatingCalibrationRow[] {
  return candidates.map(candidate => ({ candidate, newScore: null }))
}

function OldScoreControl({
  candidate,
  visible,
  onToggle,
}: {
  candidate: RatingCalibrationCandidate
  visible: boolean
  onToggle: (contentId: number) => void
}) {
  return (
    <div className="flex items-center" data-drag-ignore="true">
      {visible ? (
        <button
          type="button"
          onClick={() => onToggle(candidate.content_id)}
          title="隐藏旧评分"
          aria-label={`隐藏《${candidate.title}》的旧评分`}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold"
          style={{ color: 'var(--text-secondary)', background: 'var(--bg-card-warm)' }}
        >
          {formatScore(candidate.old_score)} <EyeOff size={12} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onToggle(candidate.content_id)}
          title="显示旧评分"
          aria-label={`显示《${candidate.title}》的旧评分`}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
          style={{ color: 'var(--text-muted)', background: 'var(--bg-card-warm)' }}
        >
          <Eye size={12} /> 显示旧评分
        </button>
      )}
    </div>
  )
}

function MoveButtons({
  index,
  rowCount,
  onMove,
}: {
  index: number
  rowCount: number
  onMove: (fromIndex: number, toIndex: number) => void
}) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        data-drag-ignore="true"
        onClick={() => onMove(index, Math.max(0, index - 1))}
        disabled={index === 0}
        aria-label="向上移动"
        className="leading-none disabled:opacity-20"
        style={{ color: 'var(--text-muted)' }}
      >
        <ArrowUp size={11} />
      </button>
      <button
        type="button"
        data-drag-ignore="true"
        onClick={() => onMove(index, Math.min(rowCount - 1, index + 1))}
        disabled={index === rowCount - 1}
        aria-label="向下移动"
        className="leading-none disabled:opacity-20"
        style={{ color: 'var(--text-muted)' }}
      >
        <ArrowDown size={11} />
      </button>
    </div>
  )
}

function RemoveButton({ onRemove }: { onRemove: () => void }) {
  return (
    <button
      type="button"
      data-drag-ignore="true"
      onClick={onRemove}
      title="移除本次对比"
      aria-label="移除本次对比"
      className="inline-flex shrink-0 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs transition-opacity hover:opacity-80"
      style={{ color: 'var(--accent-coral)', border: '1px solid rgba(239,68,68,0.25)' }}
    >
      <Trash2 size={13} /> 移除
    </button>
  )
}

function Cover({ candidate }: { candidate: RatingCalibrationCandidate }) {
  return (
    <div
      className="h-16 w-12 shrink-0 overflow-hidden rounded-md xl:h-20 xl:w-14"
      style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }}
    >
      <CoverImage src={candidate.cover_url || ''} alt={candidate.title} loading="eager" />
    </div>
  )
}

function InsertionMarker() {
  return (
    <div className="pointer-events-none flex h-2 items-center px-3 sm:px-4" aria-hidden="true">
      <div className="h-0.5 w-full rounded-full" style={{ background: 'var(--brand)', boxShadow: 'var(--shadow-neon)' }} />
    </div>
  )
}

function RatingCalibrationRowView({
  row,
  index,
  rowCount,
  oldScoreVisible,
  isDragging,
  dragOverSlot,
  onPointerDown,
  onMove,
  onToggleOldScore,
  onScoreChange,
  onRemove,
}: CalibrationRowViewProps) {
  const contentId = row.candidate.content_id
  const showInsertionBefore = dragOverSlot === index && !isDragging
  const showInsertionAfter = dragOverSlot === rowCount && index === rowCount - 1 && !isDragging
  const showScoreChange = oldScoreVisible
    && row.newScore !== null
    && row.newScore > 0
    && row.newScore !== row.candidate.old_score
  const rowStyle = {
    borderBottom: index < rowCount - 1 ? '1px solid var(--border-line)' : undefined,
    opacity: isDragging ? 0.5 : 1,
  }
  const dragProps = {
    'data-calibration-index': index,
    'data-calibration-content-id': contentId,
    'aria-label': `拖动《${row.candidate.title}》排序`,
    'aria-roledescription': '可拖动条目',
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => onPointerDown(event, contentId),
  }

  return (
    <Fragment>
      {showInsertionBefore && <InsertionMarker />}

      <div
        {...dragProps}
        className="grid min-w-0 cursor-grab grid-cols-[auto_3rem_minmax(0,1fr)_auto] items-start gap-3 px-3 py-3 select-none transition-colors active:cursor-grabbing xl:grid-cols-[2.25rem_3rem_minmax(10rem,1fr)_6rem_20rem_5rem] xl:items-center sm:px-4"
        style={rowStyle}
      >
        <div className="flex items-center justify-center gap-0.5 pt-1 xl:pt-0">
          <span title="拖动排序" className="rounded p-1" style={{ color: 'var(--text-muted)' }} aria-hidden="true">
            <GripVertical size={17} />
          </span>
          <MoveButtons index={index} rowCount={rowCount} onMove={onMove} />
        </div>
        <Cover candidate={row.candidate} />
        <p className="order-3 min-w-0 pt-1 text-sm font-medium leading-6 xl:truncate xl:pt-0" style={{ color: 'var(--text-primary)' }} title={row.candidate.title}>
          {row.candidate.title}
        </p>
        <div className="order-4 flex justify-end xl:order-6 xl:justify-start">
          <RemoveButton onRemove={() => onRemove(contentId)} />
        </div>
        <div className="order-5 col-span-4 flex min-w-0 items-center pt-1 xl:order-4 xl:col-span-1 xl:justify-center xl:pt-0">
          <OldScoreControl candidate={row.candidate} visible={oldScoreVisible} onToggle={onToggleOldScore} />
        </div>
        <div className="order-6 col-span-4 flex min-w-0 max-w-full flex-col gap-1 overflow-hidden xl:order-5 xl:col-span-1" data-drag-ignore="true">
          <StarRating
            value={row.newScore === null ? 0 : row.newScore / 10}
            onChange={score => onScoreChange(contentId, score)}
            ariaLabel={`《${row.candidate.title}》的新评分`}
            size={18}
          />
          {showScoreChange && row.newScore !== null && (
            <span
              data-testid={`score-change-${contentId}`}
              className="text-xs font-medium"
              style={{ color: row.newScore > row.candidate.old_score ? 'var(--brand)' : 'var(--accent-coral)' }}
            >
              {formatScoreDelta(row.candidate.old_score, row.newScore)}
            </span>
          )}
        </div>
      </div>

      {showInsertionAfter && <InsertionMarker />}
    </Fragment>
  )
}

function ConfirmActionDialog({
  action,
  onCancel,
  onConfirm,
}: {
  action: ConfirmAction | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const isLeave = action === 'leave'
  if (action === null) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        data-testid="calibration-confirm-dialog"
        className="w-full max-w-sm rounded-xl p-6"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', boxShadow: 'var(--shadow-popup)' }}
        onClick={event => event.stopPropagation()}
      >
        <h4 className="mb-2 text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
          {isLeave ? '放弃本次修改？' : '重新抽取作品？'}
        </h4>
        <p className="mb-5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {isLeave ? '本次对比还有未保存的修改，确定放弃并返回首页吗？' : '重新抽取会丢弃本次未保存的修改，确定继续吗？'}
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-lg px-4 text-sm transition-opacity hover:opacity-80"
            style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)', color: 'var(--text-muted)' }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-9 rounded-lg px-4 text-sm font-medium transition-opacity hover:opacity-80"
            style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
          >
            {isLeave ? '确定放弃' : '继续抽取'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function RatingCalibrationPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const addToast = useToastStore(state => state.addToast)
  const [rows, setRows] = useState<RatingCalibrationRow[]>([])
  const [oldScoreVisible, setOldScoreVisible] = useState<Record<number, boolean>>({})
  const [removedContentIds, setRemovedContentIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [redrawing, setRedrawing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [poolExhausted, setPoolExhausted] = useState(false)
  const [savedScoreBaselines, setSavedScoreBaselines] = useState<Record<number, number>>({})
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [draggingContentId, setDraggingContentId] = useState<number | null>(null)
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null)
  const draggingContentIdRef = useRef<number | null>(null)
  const dragOverSlotRef = useRef<number | null>(null)
  const pointerDragRef = useRef<PointerDragState | null>(null)
  const pointerDragActiveRef = useRef(false)
  const rowsRef = useRef(rows)

  const visibleRows = rows.length > 0
  const allOldScoresVisible = visibleRows && rows.every(row => oldScoreVisible[row.candidate.content_id])
  const changedRows = useMemo(
    () => rows.filter(row => {
      if (row.newScore === null || row.newScore <= 0) return false
      const baselineScore = savedScoreBaselines[row.candidate.content_id] ?? row.candidate.old_score
      return row.newScore !== baselineScore
    }),
    [rows, savedScoreBaselines],
  )

  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  useEffect(() => {
    if (changedRows.length === 0) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [changedRows.length])

  const clearDragState = useCallback(() => {
    pointerDragRef.current = null
    pointerDragActiveRef.current = false
    draggingContentIdRef.current = null
    dragOverSlotRef.current = null
    setDraggingContentId(null)
    setDragOverSlot(null)
  }, [])

  const getInsertionSlotAtPoint = useCallback((clientX: number, clientY: number): number | null => {
    const target = document.elementFromPoint(clientX, clientY)
    const rowElement = target?.closest<HTMLElement>('[data-calibration-content-id]')
    if (!rowElement) return null
    const targetContentId = Number(rowElement.dataset.calibrationContentId)
    const targetIndex = rowsRef.current.findIndex(row => row.candidate.content_id === targetContentId)
    if (targetIndex < 0) return null
    const bounds = rowElement.getBoundingClientRect()
    return clientY > bounds.top + bounds.height / 2 ? targetIndex + 1 : targetIndex
  }, [])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const pointerDrag = pointerDragRef.current
      if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return
      const distance = Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY)
      if (!pointerDragActiveRef.current && distance < 6) return

      event.preventDefault()
      if (!pointerDragActiveRef.current) {
        pointerDragActiveRef.current = true
        draggingContentIdRef.current = pointerDrag.contentId
        dragOverSlotRef.current = null
        setDraggingContentId(pointerDrag.contentId)
        setDragOverSlot(null)
      }

      const nextSlot = getInsertionSlotAtPoint(event.clientX, event.clientY)
      if (nextSlot === null || nextSlot === dragOverSlotRef.current) return
      dragOverSlotRef.current = nextSlot
      setDragOverSlot(nextSlot)
    }

    const handlePointerUp = (event: PointerEvent) => {
      const pointerDrag = pointerDragRef.current
      if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return
      if (pointerDragActiveRef.current) {
        event.preventDefault()
        const insertionSlot = getInsertionSlotAtPoint(event.clientX, event.clientY)
        if (insertionSlot !== null) {
          setRows(previous => moveCalibrationRowToSlot(previous, pointerDrag.contentId, insertionSlot))
        }
      }
      clearDragState()
    }

    const handlePointerCancel = (event: PointerEvent) => {
      const pointerDrag = pointerDragRef.current
      if (pointerDrag?.pointerId === event.pointerId) clearDragState()
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [clearDragState, getInsertionSlotAtPoint])

  const appendCandidates = (candidates: RatingCalibrationCandidate[], revealRandom = false) => {
    setRows(previous => [...previous, ...toDraftRows(candidates)])
    setOldScoreVisible(previous => {
      const next = { ...previous }
      candidates.forEach(candidate => {
        next[candidate.content_id] = false
      })
      if (revealRandom && candidates.length > 0) {
        const referenceIndex = Math.floor(Math.random() * candidates.length)
        next[candidates[referenceIndex].content_id] = true
      }
      return next
    })
  }

  const loadCandidates = async (count: number, initial = false): Promise<void> => {
    const excluded = [
      ...rows.map(row => row.candidate.content_id),
      ...removedContentIds,
    ]
    try {
      const candidates = await api.getCalibrationCandidates(
        { count, excludeContentIds: excluded },
        { suppressErrorToast: true },
      )
      appendCandidates(candidates)
      setPoolExhausted(false)
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 404) {
        setPoolExhausted(true)
        if (!initial) addToast('info', '没有更多可对比的评分作品')
        return
      }
      if (initial) addToast('error', error instanceof Error ? error.message : '评分作品加载失败')
      else addToast('error', error instanceof Error ? error.message : '追加评分作品失败')
    }
  }

  useEffect(() => {
    let active = true
    const loadInitialCandidates = async () => {
      setLoading(true)
      try {
        const candidates = await api.getCalibrationCandidates(
          { count: INITIAL_CANDIDATE_COUNT },
          { suppressErrorToast: true },
        )
        if (!active) return
        appendCandidates(candidates, true)
        setPoolExhausted(candidates.length < INITIAL_CANDIDATE_COUNT)
      } catch (error: unknown) {
        if (!active) return
        setPoolExhausted(error instanceof ApiError && error.status === 404)
        if (!(error instanceof ApiError && error.status === 404)) {
          addToast('error', error instanceof Error ? error.message : '评分作品加载失败')
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadInitialCandidates()
    return () => {
      active = false
    }
  }, [addToast])

  const handleAdd = async () => {
    if (adding || poolExhausted) return
    setAdding(true)
    try {
      await loadCandidates(1)
    } finally {
      setAdding(false)
    }
  }

  const performRedraw = async () => {
    setRedrawing(true)
    try {
      const excluded = rows.map(row => row.candidate.content_id)
      const candidates = await api.getCalibrationCandidates(
        { count: rows.length, excludeContentIds: excluded },
        { suppressErrorToast: true },
      )
      setRows(toDraftRows(candidates))
      setOldScoreVisible(() => {
        const next: Record<number, boolean> = {}
        candidates.forEach(candidate => {
          next[candidate.content_id] = false
        })
        if (candidates.length > 0) {
          const referenceIndex = Math.floor(Math.random() * candidates.length)
          next[candidates[referenceIndex].content_id] = true
        }
        return next
      })
      setRemovedContentIds(new Set())
      setSavedScoreBaselines({})
      setPoolExhausted(candidates.length < rows.length)
      addToast('success', `已重新抽取 ${candidates.length} 部作品`)
    } catch (error: unknown) {
      if (!(error instanceof ApiError && error.status === 404)) {
        addToast('error', error instanceof Error ? error.message : '重新抽取失败')
      } else {
        addToast('info', '没有足够的其他评分作品可重新抽取')
      }
    } finally {
      setRedrawing(false)
    }
  }

  const handleRedraw = () => {
    if (redrawing || saving || rows.length === 0) return
    if (changedRows.length > 0) {
      setConfirmAction('redraw')
      return
    }
    void performRedraw()
  }

  const handleStarScoreChange = (contentId: number, score: number) => {
    setRows(previous => sortCalibrationRows(
      previous.map(row => row.candidate.content_id === contentId ? { ...row, newScore: score * 10 } : row),
    ))
  }

  const handleMove = (fromIndex: number, toIndex: number) => {
    setRows(previous => moveCalibrationRow(previous, fromIndex, toIndex))
  }

  const handleRemove = (contentId: number) => {
    setRows(previous => previous.filter(row => row.candidate.content_id !== contentId))
    setOldScoreVisible(previous => {
      const next = { ...previous }
      delete next[contentId]
      return next
    })
    setRemovedContentIds(previous => new Set(previous).add(contentId))
    setSavedScoreBaselines(previous => {
      const next = { ...previous }
      delete next[contentId]
      return next
    })
  }

  const handleToggleAllOldScores = () => {
    const nextVisible = !allOldScoresVisible
    setOldScoreVisible(previous => {
      const next = { ...previous }
      rows.forEach(row => {
        next[row.candidate.content_id] = nextVisible
      })
      return next
    })
  }

  const handleToggleOldScore = (contentId: number) => {
    setOldScoreVisible(previous => ({ ...previous, [contentId]: !previous[contentId] }))
  }

  const handleSave = async () => {
    if (saving) return
    if (changedRows.length === 0) {
      addToast('info', '没有需要保存的评分修改')
      return
    }
    setSaving(true)
    const pendingRows = changedRows
    try {
      const response = await api.saveCalibration(pendingRows.map(row => ({
        content_id: row.candidate.content_id,
        expected_score: savedScoreBaselines[row.candidate.content_id] ?? row.candidate.old_score,
        new_score: row.newScore as number,
      })))
      const updatedIds = new Set(response.updated_content_ids)
      setSavedScoreBaselines(previous => {
        const next = { ...previous }
        pendingRows.forEach(row => {
          if (updatedIds.has(row.candidate.content_id) && row.newScore !== null && row.newScore > 0) {
            next[row.candidate.content_id] = row.newScore
          }
        })
        return next
      })
      setOldScoreVisible(previous => {
        const next = { ...previous }
        rowsRef.current.forEach(row => {
          next[row.candidate.content_id] = true
        })
        return next
      })
      useRefreshStore.getState().triggerRefresh()
      response.updated_content_ids.forEach(contentId => {
        void queryClient.invalidateQueries({ queryKey: contentDetailQueryKeyPrefix(contentId) })
      })
      addToast('success', `已保存 ${response.updated_content_ids.length} 部作品的评分`)
    } catch (error: unknown) {
      if (!(error instanceof ApiError && error.status === 409)) {
        addToast('error', error instanceof Error ? error.message : '评分保存失败')
      } else {
        addToast('warning', '部分评分已发生变化，请刷新后重新对比')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleLeave = () => {
    if (changedRows.length > 0) {
      setConfirmAction('leave')
      return
    }
    navigate('/')
  }

  const handleConfirmAction = () => {
    const action = confirmAction
    setConfirmAction(null)
    if (action === 'leave') {
      navigate('/')
      return
    }
    if (action === 'redraw') void performRedraw()
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>, contentId: number) => {
    if (event.button !== 0 || !event.isPrimary) return
    const target = event.target
    if (target instanceof Element && target.closest('[data-drag-ignore="true"]')) {
      return
    }
    event.preventDefault()
    pointerDragRef.current = {
      contentId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    }
  }

  if (loading) {
    return (
      <PageMain className="py-20 sm:py-24">
        <div className="flex items-center justify-center gap-2" style={{ color: 'var(--text-muted)' }}>
          <LoaderCircle className="animate-spin" size={18} />
          <span className="text-sm">正在抽取评分作品...</span>
        </div>
      </PageMain>
    )
  }

  return (
    <PageMain className="py-16 sm:py-20">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--brand)' }}>Random comparison</p>
          <h1 className="text-2xl font-bold sm:text-3xl" style={{ color: 'var(--text-primary)' }}>随机比较</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
            把过去打过分的作品放在一起重新排序，调整后的评分只会在保存时更新。空评分拖到有分数的邻位会继承邻位分数，0 分表示保留旧评分并在保存时跳过。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleToggleAllOldScores}
            disabled={!visibleRows}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', color: 'var(--text-secondary)' }}
          >
            {allOldScoresVisible ? <EyeOff size={14} /> : <Eye size={14} />}
            {allOldScoresVisible ? '隐藏全部旧评分' : '显示全部旧评分'}
          </button>
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={adding || poolExhausted}
            aria-busy={adding || undefined}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
          >
            {adding ? <LoaderCircle className="animate-spin" size={14} /> : <Plus size={14} />}
            {poolExhausted ? '没有更多作品' : '再抽一部'}
          </button>
          <button
            type="button"
            onClick={handleRedraw}
            disabled={redrawing || saving || !visibleRows}
            aria-busy={redrawing || undefined}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', color: 'var(--text-secondary)' }}
          >
            {redrawing ? <LoaderCircle className="animate-spin" size={14} /> : <RefreshCw size={14} />}
            重新抽取
          </button>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
        <span>已抽取 {rows.length} 部 · 可拖动排序，也可以直接修改新评分</span>
        <span>{changedRows.length > 0 ? `待保存 ${changedRows.length} 部` : '暂无待保存修改'}</span>
      </div>

      {!visibleRows ? (
        <section className="rounded-xl p-10 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>还没有可用于随机比较的作品</p>
          <button type="button" onClick={handleLeave} className="mt-4 text-xs" style={{ color: 'var(--brand)' }}>返回首页</button>
        </section>
      ) : (
        <div className="rounded-xl" style={{ border: '1px solid var(--border-line)', background: 'var(--bg-card)' }}>
          {rows.map((row, index) => (
            <RatingCalibrationRowView
              key={row.candidate.content_id}
              row={row}
              index={index}
              rowCount={rows.length}
              oldScoreVisible={oldScoreVisible[row.candidate.content_id] === true}
              isDragging={draggingContentId === row.candidate.content_id}
              dragOverSlot={dragOverSlot}
              onPointerDown={handlePointerDown}
              onMove={handleMove}
              onToggleOldScore={handleToggleOldScore}
              onScoreChange={handleStarScoreChange}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={handleLeave}
          className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-80"
          style={{ background: '#fff', color: '#1f1f1f', border: '1px solid rgba(255,255,255,0.8)' }}
        >
          <ArrowLeft size={16} />
          放弃修改
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || changedRows.length === 0}
          aria-busy={saving || undefined}
          className="inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-45"
          style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
        >
          {saving ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}
          保存评分
        </button>
      </div>

      <ConfirmActionDialog
        action={confirmAction}
        onCancel={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
      />
    </PageMain>
  )
}
