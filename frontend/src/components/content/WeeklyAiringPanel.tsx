import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ExternalLink, Heart, LayoutGrid, List, Plus } from 'lucide-react'
import { CoverImage } from '@/components/ui/CoverImage'
import { Skeleton } from '@/components/ui/skeleton'
import { LoadingIcon } from '@/components/ui/loading-icon'
import type { AiringCalendarDay, AiringCalendarWeek } from '@/types'

type AiringCalendarEntry = AiringCalendarDay['items'][number]

interface WeeklyAiringPanelProps {
  week: AiringCalendarWeek | null
  loading: boolean
  error: string | null
  onOpenContent: (id: number) => void
  onAddAnime: (item: AiringCalendarEntry) => void
  isFavorited: (id: number) => boolean
  onToggleFavorite: (id: number) => void
  isFavoritePending?: (id: number) => boolean
}

function todayWeekday(): number {
  const day = new Date().getDay()
  return day === 0 ? 7 : day
}

const WEEKDAY_SHORT_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function shortWeekdayLabel(day: AiringCalendarDay): string {
  return WEEKDAY_SHORT_LABELS[day.weekday - 1] ?? day.label.replace('星期', '周')
}

type CalendarView = 'grid' | 'list'

function formatSyncTime(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function DayButton({ day, selected, onClick }: { day: AiringCalendarDay; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-pressed={selected}
      onClick={onClick}
      className="min-w-0 flex-1 cursor-pointer px-1 py-2 text-center transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      style={{
        background: selected ? '#FB71A7' : 'var(--bg-card-warm)',
        color: selected ? 'white' : 'var(--text-secondary)',
        borderRight: '1px solid var(--border-line)',
      }}
    >
      <span className="block text-xs font-medium">{shortWeekdayLabel(day)}</span>
      <span className="mt-0.5 block text-[10px] opacity-75">{day.date.slice(5).replace('-', '/')}</span>
      {day.is_today && <span className="mt-1 block text-[9px] font-semibold">今天</span>}
    </button>
  )
}

function WeeklyAiringSkeleton() {
  return (
    <div data-testid="airing-calendar-skeleton" className="space-y-3">
      <div className="grid grid-cols-7 overflow-hidden rounded-lg">
        {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-[3.75rem] w-full rounded-none" />)}
      </div>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex h-[4.5rem] items-center gap-3 rounded-xl px-3" style={{ background: 'var(--bg-card-warm)' }}>
          <Skeleton className="h-12 w-9 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

function CalendarItemMedia({ item }: { item: AiringCalendarEntry }) {
  return (
    <div className="h-full w-full overflow-hidden" style={{ background: 'var(--bg-card-warm)' }}>
      {item.cover_url ? <CoverImage src={item.cover_url} alt={item.title} /> : <CalendarDays className="m-auto mt-4" size={18} style={{ color: 'var(--text-muted)' }} />}
    </div>
  )
}

function CalendarItemMeta({ item }: { item: AiringCalendarEntry }) {
  return (
    <>
      <h3 className="line-clamp-2 text-sm font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>{item.title}</h3>
      {item.title_alt && <p className="mt-1 line-clamp-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>{item.title_alt}</p>}
    </>
  )
}

function CalendarCornerBadge({
  item,
  isFavorited,
  onToggleFavorite,
  isFavoritePending,
}: {
  item: AiringCalendarEntry
  isFavorited: boolean
  onToggleFavorite: (id: number) => void
  isFavoritePending?: boolean
}) {
  if (!item.matched) {
    return (
      <span
        aria-hidden="true"
        className="flex h-8 w-8 items-center justify-center rounded-full shadow-md"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', color: 'var(--text-secondary)' }}
      >
        <ExternalLink size={14} />
      </span>
    )
  }

  return (
    <button
      type="button"
      aria-label={isFavorited ? `取消收藏 ${item.title}` : `收藏 ${item.title}`}
      aria-pressed={isFavorited}
      title={isFavorited ? '取消收藏' : '收藏'}
      onClick={event => {
        event.stopPropagation()
        onToggleFavorite(item.content_id as number)
      }}
      disabled={isFavoritePending}
      aria-busy={isFavoritePending || undefined}
      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full shadow-md transition-colors hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      style={{ background: 'var(--bg-card)', border: isFavorited ? '2px solid #FB71A7' : '1px solid var(--border-line)', color: isFavorited ? '#FB71A7' : 'var(--text-muted)' }}
    >
      {isFavoritePending ? <LoadingIcon size={14} /> : <Heart size={14} fill={isFavorited ? 'currentColor' : 'none'} />}
    </button>
  )
}

function UnmatchedActionButtons({
  item,
  onAddAnime,
  compact = false,
}: {
  item: AiringCalendarEntry
  onAddAnime: (item: AiringCalendarEntry) => void
  compact?: boolean
}) {
  return (
    <div className={compact ? 'flex shrink-0 items-center gap-2' : 'flex w-full flex-col gap-2'}>
      <a
        href={item.bangumi_url}
        target="_blank"
        rel="noreferrer"
        aria-label={`前往 Bangumi ${item.title}`}
        title="前往 Bangumi"
        onClick={event => event.stopPropagation()}
        className={compact
          ? 'flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50'
          : 'animate-calendar-action-rise flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50'}
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', color: 'var(--text-primary)' }}
      >
        <ExternalLink size={14} style={{ color: '#FB71A7' }} />
        前往 Bangumi
      </a>
      <button
        type="button"
        aria-label={`添加番剧 ${item.title}`}
        title="添加番剧"
        onClick={event => {
          event.stopPropagation()
          onAddAnime(item)
        }}
        className={compact
          ? 'flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50'
          : 'animate-calendar-action-rise animate-calendar-action-rise-delay flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50'}
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', color: 'var(--text-primary)' }}
      >
        <Plus size={14} style={{ color: '#FB71A7' }} />
        添加番剧
      </button>
    </div>
  )
}

function AiringCard({
  item,
  onOpenContent,
  onAddAnime,
  isFavorited,
  onToggleFavorite,
  isFavoritePending,
  actionsOpen,
  onActionsOpenChange,
}: {
  item: AiringCalendarEntry
  onOpenContent: (id: number) => void
  onAddAnime: (item: AiringCalendarEntry) => void
  isFavorited: (id: number) => boolean
  onToggleFavorite: (id: number) => void
  isFavoritePending?: (id: number) => boolean
  actionsOpen: boolean
  onActionsOpenChange: (open: boolean) => void
}) {
  const className = 'group relative block min-w-0 cursor-pointer overflow-hidden rounded-xl text-left transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50'
  const cardContent = (
    <>
      <div className="relative aspect-[3/4] w-full">
        <CalendarItemMedia item={item} />
        {item.matched ? (
          <div className="absolute right-2 top-2">
            <CalendarCornerBadge
              item={item}
              isFavorited={item.matched && item.content_id != null ? isFavorited(item.content_id) : false}
              onToggleFavorite={onToggleFavorite}
              isFavoritePending={item.matched && item.content_id != null ? isFavoritePending?.(item.content_id) : false}
            />
          </div>
        ) : (
          <>
            <div className="absolute right-2 top-2 z-[1]">
              <CalendarCornerBadge item={item} isFavorited={false} onToggleFavorite={onToggleFavorite} />
            </div>
            {actionsOpen && (
              <div
                className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 p-3 animate-fade-in"
                onClick={() => onActionsOpenChange(false)}
              >
                <div className="w-full max-w-[170px]" onClick={event => event.stopPropagation()}>
                  <UnmatchedActionButtons item={item} onAddAnime={onAddAnime} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="min-h-[6.75rem] p-3 text-left"><CalendarItemMeta item={item} /></div>
    </>
  )

  if (item.matched && item.content_id != null) {
    return (
      <article
        role="button"
        tabIndex={0}
        className={className}
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}
        onClick={() => onOpenContent(item.content_id as number)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpenContent(item.content_id as number)
          }
        }}
      >
        {cardContent}
      </article>
    )
  }
  return (
    <article
      aria-label={item.title}
      data-airing-action-card={item.subject_id}
      className={className}
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}
      onClick={() => {
        if (actionsOpen) onActionsOpenChange(false)
      }}
    >
      {cardContent}
      {!actionsOpen && (
        <button
          type="button"
          aria-expanded={actionsOpen}
          aria-label={`打开 ${item.title} 的操作`}
          onClick={() => onActionsOpenChange(true)}
          className="absolute inset-0 z-10 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50"
        />
      )}
    </article>
  )
}

function AiringListRow({ item, onOpenContent, onAddAnime }: { item: AiringCalendarEntry; onOpenContent: (id: number) => void; onAddAnime: (item: AiringCalendarEntry) => void }) {
  const rowContent = (
    <>
      <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md"><CalendarItemMedia item={item} /></div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.title}</h3>
        {item.title_alt && <p className="mt-1 truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>{item.title_alt}</p>}
      </div>
      {item.matched && <span className="inline-flex shrink-0 items-center gap-1 text-xs" style={{ color: '#FB71A7' }}>查看详情</span>}
    </>
  )
  const className = 'flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-black/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50 dark:hover:bg-white/[0.035] sm:px-4'

  return (
    <li className="border-b last:border-b-0" style={{ borderColor: 'var(--border-line)' }}>
      {item.matched && item.content_id != null ? (
        <button type="button" onClick={() => onOpenContent(item.content_id as number)} className={className}>{rowContent}</button>
      ) : (
        <div className={className}>
          {rowContent}
          <UnmatchedActionButtons item={item} onAddAnime={onAddAnime} compact />
        </div>
      )}
    </li>
  )
}

export function WeeklyAiringPanel({ week, loading, error, onOpenContent, onAddAnime, isFavorited, onToggleFavorite, isFavoritePending }: WeeklyAiringPanelProps) {
  const [selectedWeekday, setSelectedWeekday] = useState(todayWeekday)
  const [view, setView] = useState<CalendarView>('grid')
  const [openActionSubjectId, setOpenActionSubjectId] = useState<number | null>(null)

  useEffect(() => {
    const today = week?.days.find(day => day.is_today)?.weekday
    if (today) setSelectedWeekday(today)
  }, [week])

  useEffect(() => {
    setOpenActionSubjectId(null)
  }, [selectedWeekday, week])

  useEffect(() => {
    if (openActionSubjectId === null) return
    const handlePointerDown = (event: PointerEvent) => {
      const openCard = document.querySelector(`[data-airing-action-card="${openActionSubjectId}"]`)
      if (!openCard || !openCard.contains(event.target as Node)) {
        setOpenActionSubjectId(null)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [openActionSubjectId])

  const selectedDay = useMemo(
    () => week?.days.find(day => day.weekday === selectedWeekday) ?? null,
    [selectedWeekday, week],
  )
  const syncTime = formatSyncTime(week?.last_synced_at ?? null)

  if (loading) return <WeeklyAiringSkeleton />

  if (!week) {
    return (
      <div className="flex min-h-60 items-center justify-center rounded-xl px-6 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}>
        <div>
          <CalendarDays className="mx-auto mb-3" size={28} style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{error || '周历暂时没有数据'}</p>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>后台会每天自动同步 Bangumi 周历</p>
        </div>
      </div>
    )
  }

  return (
    <section data-testid="airing-calendar" className="space-y-4">
      <div role="tablist" aria-label="选择更新日期" className="grid w-full grid-cols-7 overflow-hidden rounded-lg" style={{ border: '1px solid var(--border-line)' }}>
        {week.days.map(day => (
          <DayButton key={day.weekday} day={day} selected={day.weekday === selectedWeekday} onClick={() => setSelectedWeekday(day.weekday)} />
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {selectedDay?.items.length ?? 0} 部番剧{syncTime ? ` · 数据更新于 ${syncTime}` : ''}
        </p>
        <div role="group" aria-label="周历视图" className="flex shrink-0 overflow-hidden rounded-lg" style={{ border: '1px solid var(--border-line)' }}>
          <button type="button" aria-label="卡片视图" aria-pressed={view === 'grid'} onClick={() => setView('grid')} className="flex h-8 w-9 cursor-pointer items-center justify-center transition-colors hover:bg-black/[0.025] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 dark:hover:bg-white/[0.035]" style={{ color: view === 'grid' ? '#FB71A7' : 'var(--text-muted)', background: view === 'grid' ? 'var(--bg-card)' : 'transparent' }}><LayoutGrid size={14} /></button>
          <button type="button" aria-label="列表视图" aria-pressed={view === 'list'} onClick={() => setView('list')} className="flex h-8 w-9 cursor-pointer items-center justify-center border-l transition-colors hover:bg-black/[0.025] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 dark:hover:bg-white/[0.035]" style={{ borderColor: 'var(--border-line)', color: view === 'list' ? '#FB71A7' : 'var(--text-muted)', background: view === 'list' ? 'var(--bg-card)' : 'transparent' }}><List size={14} /></button>
        </div>
      </div>

      {week.sync_status === 'failed' && <p className="text-right text-[11px]" style={{ color: '#d97706' }}>同步失败，显示上次数据</p>}

      {error && week.sync_status !== 'failed' && <p className="text-xs" style={{ color: '#d97706' }}>{error}</p>}

      {selectedDay?.items.length === 0 ? (
        <div className="flex min-h-48 items-center justify-center rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>这一天暂无已收录的新番</p>
        </div>
      ) : view === 'grid' ? (
        <div data-testid="airing-calendar-grid" className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {selectedDay?.items.map(item => (
            <AiringCard
              key={`${item.subject_id}-${item.content_id ?? 'bangumi'}`}
              item={item}
              onOpenContent={onOpenContent}
              onAddAnime={onAddAnime}
              isFavorited={isFavorited}
              onToggleFavorite={onToggleFavorite}
              isFavoritePending={isFavoritePending}
              actionsOpen={openActionSubjectId === item.subject_id}
              onActionsOpenChange={open => setOpenActionSubjectId(open ? item.subject_id : null)}
            />
          ))}
        </div>
      ) : (
        <ul data-testid="airing-calendar-list" className="overflow-hidden rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}>
          {selectedDay?.items.map(item => <AiringListRow key={`${item.subject_id}-${item.content_id ?? 'bangumi'}`} item={item} onOpenContent={onOpenContent} onAddAnime={onAddAnime} />)}
        </ul>
      )}
    </section>
  )
}
