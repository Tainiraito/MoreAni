import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bell, BellOff, ChevronDown, Copy, ExternalLink, RefreshCw, Search, X } from 'lucide-react'

import { api } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useAuthStore } from '@/stores/auth-store'
import { useToastStore } from '@/stores/toast-store'
import { useUIStore } from '@/stores/ui-store'
import { LoadingIcon } from '@/components/ui/loading-icon'
import type { AnimeResource, ContentItem, ResourceSubscription } from '@/types'

type ResourceSource = 'mikan' | 'animegarden'

interface AnimeResourceDialogProps {
  open: boolean
  content: ContentItem
  onClose: () => void
  focusSource?: ResourceSource
  focusFansubName?: string
  focusFansubId?: string
  focusResourceKey?: string
}

interface ResourceGroup {
  key: string
  id?: string
  name: string
  resources: AnimeResource[]
}

interface QuickFilterDefinition {
  key: ResourceQuickFilter
  label: string
}

type ResourceQuickFilter =
  | 'simplified'
  | 'traditional'
  | 'japanese'
  | 'softsub'
  | 'hardsub'
  | 'resolution720'
  | 'resolution1080'
  | 'resolution1440'
  | 'resolution2160'

interface ResourceSourceState {
  resources: AnimeResource[]
  page: number
  complete: boolean
  available: boolean
  matched: boolean
  matchMethod: 'bangumi' | 'none'
  message: string | null
  loading: boolean
  loadingMore: boolean
  error: string
  loaded: boolean
}

const SOURCE_TABS: Array<{ key: ResourceSource; label: string }> = [
  { key: 'mikan', label: 'Mikan' },
  { key: 'animegarden', label: 'AnimeGarden' },
]

const SOURCE_LABEL: Record<ResourceSource, string> = {
  mikan: 'Mikan',
  animegarden: 'Anime Garden',
}

const RESOURCE_PAGE_SIZE = 50
const RESOURCE_LIST_BACKGROUND = 'var(--resource-list-bg)'

const QUICK_FILTERS: QuickFilterDefinition[] = [
  { key: 'simplified', label: '简' },
  { key: 'traditional', label: '繁' },
  { key: 'japanese', label: '日' },
  { key: 'softsub', label: '内封' },
  { key: 'hardsub', label: '内嵌' },
  { key: 'resolution720', label: '720p' },
  { key: 'resolution1080', label: '1080p' },
  { key: 'resolution1440', label: '1440p' },
  { key: 'resolution2160', label: '2160p' },
]

const LANGUAGE_FILTER_KEYS: ResourceQuickFilter[] = ['simplified', 'traditional', 'japanese']
const SUBTITLE_FILTER_KEYS: ResourceQuickFilter[] = ['softsub', 'hardsub']
const RESOLUTION_FILTER_KEYS: ResourceQuickFilter[] = ['resolution720', 'resolution1080', 'resolution1440', 'resolution2160']

const EXCLUSIVE_FILTER_GROUPS: ResourceQuickFilter[][] = [SUBTITLE_FILTER_KEYS, RESOLUTION_FILTER_KEYS]

const QUICK_FILTER_MARKERS: Record<ResourceQuickFilter, string[]> = {
  simplified: ['简', '简中', '简体', '简繁', '繁简', 'chs', 'sc', 'gb'],
  traditional: ['繁', '繁中', '繁体', '繁體', '简繁', '繁简', 'cht', 'tc', 'big5'],
  japanese: ['日', '日语', '日文', '日本語', '日英', '日中', 'jp', 'jpn'],
  softsub: ['内封', '软字幕', 'softsub', 'soft sub'],
  hardsub: ['内嵌', '硬字幕', 'hardsub', 'hard sub'],
  resolution720: ['720p', '1280x720', '1280×720'],
  resolution1080: ['1080p', '1920x1080', '1920×1080'],
  resolution1440: ['1440p', '2560x1440', '2560×1440'],
  resolution2160: ['2160p', '3840x2160', '3840×2160', '4k', 'uhd'],
}

function matchesQuickFilters(title: string, filters: ResourceQuickFilter[]): boolean {
  if (filters.length === 0) return true
  const normalized = title.normalize('NFKC').trim().toLocaleLowerCase()
  const tokens = normalized.split(/[\s[\]【】()（）{}<>._\-+,|/]+/).filter(Boolean)
  return filters.every(filter => QUICK_FILTER_MARKERS[filter].some(marker => {
    const normalizedMarker = marker.normalize('NFKC').toLocaleLowerCase()
    return normalizedMarker.length === 1
      ? tokens.includes(normalizedMarker)
      : normalized.includes(normalizedMarker)
  }))
}

interface QuickFilterButtonProps {
  filter: QuickFilterDefinition
  selected: boolean
  onClick: () => void
  joined?: boolean
  radio?: boolean
}

function QuickFilterButton({ filter, selected, onClick, joined = false, radio = false }: QuickFilterButtonProps) {
  return (
    <button
      type="button"
      role={radio ? 'radio' : undefined}
      aria-checked={radio ? selected : undefined}
      aria-pressed={radio ? undefined : selected}
      onClick={onClick}
      className={`cursor-pointer border text-[11px] transition-colors ${joined
        ? 'border-l border-[var(--border-line)] px-2.5 py-1 first:border-l-0'
        : 'rounded border px-2.5 py-1'
        } ${selected
        ? 'border-[#FB71A7] bg-[#FB71A7] text-white hover:border-[#e85d93] hover:bg-[#e85d93]'
        : 'bg-[var(--bg-card-warm)] text-[var(--text-secondary)] hover:border-[rgba(251,113,167,0.45)] hover:bg-[rgba(251,113,167,0.08)] hover:text-[var(--text-primary)]'
        }`}
    >
      {filter.label}
    </button>
  )
}

const PROVIDER_LABEL: Record<string, string> = {
  dmhy: '动漫花园',
  moe: '萌番组',
  mikan: 'Mikan',
  ani: 'ANi',
}

function initialSourceState(): ResourceSourceState {
  return {
    resources: [],
    page: 1,
    complete: true,
    available: true,
    matched: true,
    matchMethod: 'bangumi',
    message: null,
    loading: false,
    loadingMore: false,
    error: '',
    loaded: false,
  }
}

function initialSourceStates(): Record<ResourceSource, ResourceSourceState> {
  return { mikan: initialSourceState(), animegarden: initialSourceState() }
}

function fansubName(resource: AnimeResource): string {
  return resource.fansub?.name || resource.publisher?.name || '未标注字幕组'
}

function fansubKey(name: string): string {
  return name.normalize('NFKC').trim().toLocaleLowerCase()
}

function groupKey(source: ResourceSource, resource: AnimeResource): string {
  if (source === 'mikan' && resource.fansub?.id !== undefined && resource.fansub?.id !== null) {
    return `group:${String(resource.fansub.id)}`
  }
  return fansubKey(fansubName(resource))
}

function resourceKey(resource: AnimeResource): string {
  return resource.source === 'mikan'
    ? `mikan:${resource.provider_id}`
    : `${resource.provider}:${resource.provider_id}`
}

function formatSize(bytes: number): string {
  if (!bytes || bytes < 1024) return bytes ? `${bytes} B` : '大小未知'
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = -1
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { dateStyle: 'medium' })
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('复制失败')
}

export function AnimeResourceDialog({
  open,
  content,
  onClose,
  focusSource,
  focusFansubName,
  focusFansubId,
  focusResourceKey,
}: AnimeResourceDialogProps) {
  const { user } = useAuthStore()
  const { openAuth } = useUIStore()
  const [activeSource, setActiveSource] = useState<ResourceSource>(focusSource || 'mikan')
  const [sourceStates, setSourceStates] = useState<Record<ResourceSource, ResourceSourceState>>(initialSourceStates)
  const [subscriptions, setSubscriptions] = useState<ResourceSubscription[]>([])
  const [selectedFansubBySource, setSelectedFansubBySource] = useState<Record<ResourceSource, string>>({
    mikan: 'all',
    animegarden: 'all',
  })
  const [resourceQuery, setResourceQuery] = useState('')
  const [quickFilters, setQuickFilters] = useState<ResourceQuickFilter[]>([])
  const [expandedGroups, setExpandedGroups] = useState<Record<ResourceSource, string[]>>({ mikan: [], animegarden: [] })
  const [highlightedKey, setHighlightedKey] = useState<string | null>(focusResourceKey || null)
  const [togglingKey, setTogglingKey] = useState<string | null>(null)
  const requestSequence = useRef<Record<ResourceSource, number>>({ mikan: 0, animegarden: 0 })
  const inFlightRequests = useRef(new Map<string, number>())
  const sourceStatesRef = useRef<Record<ResourceSource, ResourceSourceState>>(initialSourceStates())
  const subscriptionsRequest = useRef<Promise<ResourceSubscription[]> | null>(null)
  const initializedContext = useRef<string | null>(null)
  const userId = user?.id

  const getSubscriptions = useCallback(() => {
    if (!userId) return null
    if (!subscriptionsRequest.current) {
      subscriptionsRequest.current = api.listResourceSubscriptions(content.id).catch(error => {
        subscriptionsRequest.current = null
        throw error
      })
    }
    return subscriptionsRequest.current
  }, [content.id, userId])

  const loadSource = useCallback(async (source: ResourceSource, startPage: number, append: boolean) => {
    const requestKey = `${content.id}:${source}`
    if (inFlightRequests.current.has(requestKey)) return

    const sequence = ++requestSequence.current[source]
    inFlightRequests.current.set(requestKey, sequence)
    const initialState = sourceStatesRef.current[source]
    const mergedResources = new Map<string, AnimeResource>()
    if (append) initialState.resources.forEach(item => mergedResources.set(resourceKey(item), item))
    let page = append ? Math.max(1, startPage) : 1
    let latestPage = append ? initialState.page : 1

    const updateSourceState = (patch: Partial<ResourceSourceState>) => {
      setSourceStates(previous => {
        const next = {
          ...previous,
          [source]: { ...previous[source], ...patch },
        }
        sourceStatesRef.current = next
        return next
      })
    }

    updateSourceState({
      loading: !append,
      loadingMore: append || !initialState.complete,
      error: '',
    })

    try {
      let firstPage = true
      while (true) {
        const subscriptionPromise = firstPage && !append ? getSubscriptions() : null
        const [resourceResult, subscriptionResult] = await Promise.allSettled([
          api.getAnimeResources(content.id, { source, page, size: RESOURCE_PAGE_SIZE }),
          subscriptionPromise || Promise.resolve(null),
        ])
        if (resourceResult.status === 'rejected') throw resourceResult.reason
        if (sequence !== requestSequence.current[source] || !open) return

        const resourceResponse = resourceResult.value
        if (subscriptionResult.status === 'fulfilled' && subscriptionResult.value) {
          setSubscriptions(subscriptionResult.value)
        }

        const previousSize = mergedResources.size
        resourceResponse.resources.forEach(item => mergedResources.set(resourceKey(item), item))
        latestPage = resourceResponse.pagination.page
        updateSourceState({
          resources: [...mergedResources.values()],
          page: latestPage,
          complete: resourceResponse.pagination.complete,
          available: resourceResponse.available,
          matched: resourceResponse.matched,
          matchMethod: resourceResponse.match_method,
          message: resourceResponse.message,
          loading: false,
          loadingMore: !resourceResponse.pagination.complete,
          loaded: true,
          error: '',
        })
        if (resourceResponse.pagination.complete) break
        if (resourceResponse.resources.length === 0 || mergedResources.size === previousSize) {
          throw new Error('资源分页没有返回新的内容，请稍后重试')
        }
        page = latestPage + 1
        firstPage = false
      }

      updateSourceState({ loading: false, loadingMore: false, loaded: true })
    } catch (err: any) {
      if (sequence !== requestSequence.current[source]) return
      updateSourceState({
        resources: [...mergedResources.values()],
        page: latestPage,
        complete: false,
        loading: false,
        loadingMore: false,
        loaded: true,
        error: err.message || '资源加载失败',
      })
    } finally {
      if (inFlightRequests.current.get(requestKey) === sequence) {
        inFlightRequests.current.delete(requestKey)
      }
    }
  }, [content.id, getSubscriptions, open])

  useEffect(() => {
    if (!open) {
      initializedContext.current = null
      return
    }
    const contextKey = [content.id, focusSource || '', focusFansubId || '', focusFansubName || '', focusResourceKey || ''].join(':')
    if (initializedContext.current === contextKey) return
    initializedContext.current = contextKey
    requestSequence.current.mikan += 1
    requestSequence.current.animegarden += 1
    inFlightRequests.current.clear()
    subscriptionsRequest.current = null
    const focusedSource = focusSource || 'mikan'
    setActiveSource(focusedSource)
    const resetStates = initialSourceStates()
    sourceStatesRef.current = resetStates
    setSourceStates(resetStates)
    setSubscriptions([])
    const focusedFansub = focusFansubId
      ? `group:${focusFansubId}`
      : (focusFansubName ? fansubKey(focusFansubName) : 'all')
    setSelectedFansubBySource({
      mikan: focusedSource === 'mikan' ? focusedFansub : 'all',
      animegarden: focusedSource === 'animegarden' ? focusedFansub : 'all',
    })
    setResourceQuery('')
    setQuickFilters([])
    setExpandedGroups({ mikan: [], animegarden: [] })
    setHighlightedKey(focusResourceKey || null)
  }, [open, content.id, focusSource, focusFansubId, focusFansubName, focusResourceKey])

  useEffect(() => {
    if (!open) return
    SOURCE_TABS.forEach(({ key }) => {
      const current = sourceStates[key]
      if (!current.loaded && !current.loading && !current.loadingMore) {
        void loadSource(key, 1, false)
      }
    })
  }, [loadSource, open, sourceStates])

  const state = sourceStates[activeSource]
  const resources = state.resources
  const selectedFansub = selectedFansubBySource[activeSource]

  const groups = useMemo<ResourceGroup[]>(() => {
    const map = new Map<string, ResourceGroup>()
    for (const resource of resources) {
      const name = fansubName(resource)
      const key = groupKey(activeSource, resource)
      const group = map.get(key) || {
        key,
        id: activeSource === 'mikan' && resource.fansub?.id != null ? String(resource.fansub.id) : undefined,
        name,
        resources: [],
      }
      group.resources.push(resource)
      map.set(key, group)
    }
    return [...map.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }, [activeSource, resources])

  const visibleGroups = selectedFansub === 'all'
    ? groups
    : groups.filter(group => group.key === selectedFansub)

  const filteredResources = useMemo(() => {
    const normalizedQuery = resourceQuery.normalize('NFKC').trim().toLocaleLowerCase()
    return resources.filter(resource => {
      const normalizedTitle = resource.title.normalize('NFKC').toLocaleLowerCase()
      return (!normalizedQuery || normalizedTitle.includes(normalizedQuery))
        && matchesQuickFilters(resource.title, quickFilters)
    })
  }, [quickFilters, resourceQuery, resources])

  const filteredGroups = useMemo(() => visibleGroups
    .map(group => ({
      ...group,
      resources: group.resources.filter(resource => filteredResources.some(item => item === resource)),
    }))
    .filter(group => group.resources.length > 0), [filteredResources, visibleGroups])

  const fansubOptions = useMemo(() => [
    { value: 'all', label: `全部 (${resources.length})` },
    ...groups.map(group => ({ value: group.key, label: `${group.name} (${group.resources.length})` })),
  ], [groups, resources.length])

  const hasResourceFilters = resourceQuery.trim().length > 0 || quickFilters.length > 0

  const subscriptionByKey = useMemo(() => {
    const result = new Map<string, ResourceSubscription>()
    for (const subscription of subscriptions) {
      const source = subscription.source || 'animegarden'
      if (source === activeSource) result.set(subscription.fansub_key, subscription)
    }
    return result
  }, [activeSource, subscriptions])

  useEffect(() => {
    if (!highlightedKey || !state.loaded) return
    const focusedGroup = groups.find(group => group.resources.some(resource => resourceKey(resource) === highlightedKey))
    if (focusedGroup && !expandedGroups[activeSource].includes(focusedGroup.key)) {
      setExpandedGroups(previous => ({
        ...previous,
        [activeSource]: [...previous[activeSource], focusedGroup.key],
      }))
      return
    }
    const element = Array.from(document.querySelectorAll<HTMLElement>('[data-resource-key]'))
      .find(item => item.dataset.resourceKey === highlightedKey)
    if (!element) return
    element.scrollIntoView({ block: 'center' })
    element.style.outline = '2px solid #FB71A7'
    const timer = window.setTimeout(() => { element.style.outline = '' }, 2200)
    return () => window.clearTimeout(timer)
  }, [activeSource, expandedGroups, groups, highlightedKey, state.loaded, resources])

  const toggleGroup = (key: string) => {
    setExpandedGroups(previous => {
      const current = previous[activeSource]
      return {
        ...previous,
        [activeSource]: current.includes(key) ? current.filter(item => item !== key) : [...current, key],
      }
    })
  }

  const toggleQuickFilter = (filter: ResourceQuickFilter) => {
    const exclusiveGroup = EXCLUSIVE_FILTER_GROUPS.find(group => group.includes(filter))
    setQuickFilters(previous => {
      if (previous.includes(filter)) {
        return previous.filter(item => item !== filter)
      }
      const withoutGroup = exclusiveGroup
        ? previous.filter(item => !exclusiveGroup.includes(item))
        : previous
      return [...withoutGroup, filter]
    })
  }

  const handleSourceChange = (source: ResourceSource) => {
    if (source === activeSource) return
    setActiveSource(source)
    setHighlightedKey(null)
  }

  const handleToggleSubscription = async (group: ResourceGroup) => {
    if (!user) {
      openAuth()
      return
    }
    if (activeSource === 'mikan' && !group.id) {
      useToastStore.getState().addToast('warning', '该 Mikan 字幕组缺少稳定 ID，暂时无法关注')
      return
    }
    const existing = subscriptionByKey.get(group.key)
    const toggleKey = `${activeSource}:${group.key}`
    setTogglingKey(toggleKey)
    try {
      if (existing) {
        await api.deleteResourceSubscription(existing.id)
        setSubscriptions(previous => previous.filter(item => item.id !== existing.id))
        useToastStore.getState().addToast('success', `已取消关注 ${group.name}`)
      } else {
        const created = await api.createResourceSubscription({
          content_id: content.id,
          source: activeSource,
          fansub_id: group.id || null,
          fansub_name: group.name,
        })
        setSubscriptions(previous => [...previous, created])
        useToastStore.getState().addToast('success', `已关注 ${group.name} 的新资源`)
      }
    } catch (err: any) {
      useToastStore.getState().addToast('error', err.message || '关注操作失败')
    } finally {
      setTogglingKey(null)
    }
  }

  const handleCopy = async (resource: AnimeResource) => {
    if (!resource.magnet) {
      useToastStore.getState().addToast('warning', '该资源没有可用磁力链接')
      return
    }
    try {
      await copyText(resource.magnet)
      useToastStore.getState().addToast('success', '磁力链接已复制')
    } catch {
      useToastStore.getState().addToast('error', '复制失败，请手动打开来源页')
    }
  }

  if (!open) return null

  const dialog = (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${content.title}资源`}
      onMouseDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <button className="absolute inset-0 cursor-pointer bg-black/60 backdrop-blur-sm" aria-label="关闭资源弹窗" onClick={event => { event.stopPropagation(); onClose() }} />
      <div
        className="relative flex h-[min(86vh,calc(100vh-2rem))] max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4" style={{ borderColor: 'var(--border-line)' }}>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{content.title}</h2>
            <p className="mt-1 truncate text-xs" style={{ color: 'var(--text-muted)' }}>
              放送：{content.release_date || '时间未知'} · {content.episodes > 0 ? `${content.episodes} 集` : '集数未知'}
            </p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-[rgba(251,113,167,0.08)]" style={{ color: 'var(--text-muted)', background: 'var(--bg-card-warm)' }} aria-label="关闭资源弹窗">
            <X size={16} />
          </button>
        </div>

        <div className="flex gap-1 border-b px-5" style={{ borderColor: 'var(--border-line)' }}>
          {SOURCE_TABS.map(tab => {
            const tabState = sourceStates[tab.key]
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleSourceChange(tab.key)}
                className="cursor-pointer border-b-2 px-3 py-2.5 text-xs font-medium transition-colors hover:bg-[rgba(251,113,167,0.06)]"
                style={{ borderColor: activeSource === tab.key ? '#FB71A7' : 'transparent', color: activeSource === tab.key ? '#FB71A7' : 'var(--text-muted)' }}
              >
                {tab.label}{tabState.loaded && !tabState.error ? ` · ${tabState.resources.length}` : ''}
              </button>
            )
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {state.loading ? (
            <div className="flex h-52 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: 'var(--border-line)', borderTopColor: '#FB71A7' }} />
            </div>
          ) : !state.available ? (
            <div className="rounded-xl p-6 text-center" style={{ background: 'var(--bg-card-warm)', color: 'var(--text-secondary)' }}>
              <p className="text-sm">当前番剧未关联 Bangumi，无法精确寻找资源。</p>
              <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>请先在编辑番剧中关联 Bangumi 条目。</p>
            </div>
          ) : state.error && resources.length === 0 ? (
            <div className="rounded-xl p-6 text-center" style={{ background: 'var(--bg-card-warm)' }}>
              <p className="text-sm" style={{ color: 'var(--accent-coral)' }}>{state.error}</p>
              <button onClick={() => void loadSource(activeSource, 1, false)} disabled={state.loading} aria-busy={state.loading || undefined} className="mt-3 inline-flex cursor-pointer items-center gap-1 rounded-lg px-3 py-1.5 text-xs hover:bg-[rgba(251,113,167,0.08)] disabled:cursor-not-allowed disabled:opacity-50" style={{ color: '#FB71A7', border: '1px solid rgba(251,113,167,0.4)' }}>
                {state.loading ? <LoadingIcon size={12} /> : <RefreshCw size={12} />} 重试
              </button>
            </div>
          ) : !state.matched ? (
            <div className="rounded-xl p-6 text-center text-sm" style={{ background: 'var(--bg-card-warm)', color: 'var(--text-muted)' }}>
              {state.message || `${SOURCE_LABEL[activeSource]} 未找到与当前 Bangumi 条目精确关联的番组。`}
            </div>
          ) : resources.length === 0 ? (
            <div className="rounded-xl p-6 text-center text-sm" style={{ background: 'var(--bg-card-warm)', color: 'var(--text-muted)' }}>{SOURCE_LABEL[activeSource]} 暂无已收录资源</div>
          ) : (
            <>
              <div className="mb-4 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select
                    value={selectedFansub}
                    onChange={value => setSelectedFansubBySource(previous => ({ ...previous, [activeSource]: value }))}
                    options={fansubOptions}
                    className="w-full sm:w-56"
                  />
                  <div className="relative min-w-0 flex-1">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                    <Input
                      value={resourceQuery}
                      onChange={event => setResourceQuery(event.target.value)}
                      clearable
                      onClear={() => setResourceQuery('')}
                      placeholder="筛选资源名称"
                      aria-label="筛选资源名称"
                      className="pl-9"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>快速筛选</span>
                  {QUICK_FILTERS.filter(filter => LANGUAGE_FILTER_KEYS.includes(filter.key)).map(filter => (
                    <QuickFilterButton
                      key={filter.key}
                      filter={filter}
                      selected={quickFilters.includes(filter.key)}
                      onClick={() => toggleQuickFilter(filter.key)}
                    />
                  ))}
                  <div className="flex overflow-hidden rounded border" role="radiogroup" aria-label="字幕类型" style={{ borderColor: 'var(--border-line)' }}>
                    {QUICK_FILTERS.filter(filter => SUBTITLE_FILTER_KEYS.includes(filter.key)).map(filter => (
                      <QuickFilterButton
                        key={filter.key}
                        filter={filter}
                        selected={quickFilters.includes(filter.key)}
                        onClick={() => toggleQuickFilter(filter.key)}
                        joined
                        radio
                      />
                    ))}
                  </div>
                  <div className="flex overflow-hidden rounded border" role="radiogroup" aria-label="分辨率" style={{ borderColor: 'var(--border-line)' }}>
                    {QUICK_FILTERS.filter(filter => RESOLUTION_FILTER_KEYS.includes(filter.key)).map(filter => (
                      <QuickFilterButton
                        key={filter.key}
                        filter={filter}
                        selected={quickFilters.includes(filter.key)}
                        onClick={() => toggleQuickFilter(filter.key)}
                        joined
                        radio
                      />
                    ))}
                  </div>
                  {hasResourceFilters && (
                    <button
                      type="button"
                      onClick={() => { setResourceQuery(''); setQuickFilters([]) }}
                      className="cursor-pointer rounded-md px-1.5 py-0.5 text-[11px] transition-colors hover:bg-[rgba(251,113,167,0.08)]"
                      style={{ color: '#FB71A7' }}
                    >
                      清除筛选
                    </button>
                  )}
                </div>
              </div>

              {state.error && resources.length > 0 && (
                <div className="mb-4 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs" style={{ color: 'var(--accent-coral)', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
                  <span>部分资源加载失败，当前已显示已加载内容。</span>
                  <button type="button" onClick={() => void loadSource(activeSource, state.page + 1, true)} disabled={state.loadingMore} aria-busy={state.loadingMore || undefined} className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 hover:bg-[rgba(251,113,167,0.08)] disabled:cursor-not-allowed disabled:opacity-50" style={{ color: '#FB71A7', border: '1px solid rgba(251,113,167,0.4)' }}>{state.loadingMore ? <LoadingIcon size={12} /> : null}继续重试</button>
                </div>
              )}

              {filteredGroups.length === 0 ? (
                <div className="rounded-xl p-6 text-center text-sm" style={{ background: 'var(--bg-card-warm)', color: 'var(--text-muted)' }}>
                  当前筛选条件下暂无匹配资源
                </div>
              ) : (
              <div className="overflow-hidden rounded-lg" style={{ background: RESOURCE_LIST_BACKGROUND, border: '1px solid var(--border-line)' }}>
                {filteredGroups.map(group => {
                  const subscription = subscriptionByKey.get(group.key)
                  const toggleKey = `${activeSource}:${group.key}`
                  const expanded = expandedGroups[activeSource].includes(group.key)
                  return (
                    <section key={group.key} className="border-b last:border-b-0" style={{ background: 'var(--bg-card)' }}>
                      <div className="flex items-center justify-between gap-3">
                        <button type="button" onClick={() => toggleGroup(group.key)} aria-expanded={expanded} className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2 text-left">
                          <ChevronDown size={14} className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} style={{ color: 'var(--text-muted)' }} />
                          <span className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{group.name}</span>
                          <span className="shrink-0 text-[11px]" style={{ color: 'var(--text-muted)' }}>{group.resources.length} 条</span>
                        </button>
                        <button onClick={() => void handleToggleSubscription(group)} disabled={togglingKey === toggleKey} aria-busy={togglingKey === toggleKey || undefined} className={`mr-3 flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${subscription
                          ? 'border-[rgba(251,113,167,0.45)] text-[#FB71A7] hover:border-[#FB71A7] hover:bg-[rgba(251,113,167,0.08)]'
                          : 'border-[var(--border-line)] text-[var(--text-muted)] hover:border-[rgba(251,113,167,0.45)] hover:bg-[rgba(251,113,167,0.08)] hover:text-[#FB71A7]'
                          }`}>
                          {togglingKey === toggleKey ? <LoadingIcon size={12} /> : subscription ? <BellOff size={12} /> : <Bell size={12} />}
                          {subscription ? '已关注' : '关注该字幕组'}
                        </button>
                      </div>
                      {expanded && <div className="border-t" style={{ borderColor: 'var(--border-line)' }}>
                        {group.resources.map(resource => {
                          const key = resourceKey(resource)
                          return (
                            <article key={key} data-resource-key={key} className="border-b px-3 py-1.5 last:border-b-0" style={{ background: RESOURCE_LIST_BACKGROUND, borderColor: 'var(--border-line)' }}>
                              <p className="min-w-0 break-words text-xs leading-4" style={{ color: 'var(--text-primary)' }}>{resource.title}</p>
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0 text-[10px] leading-4" style={{ color: 'var(--text-muted)' }}>
                                <span>{PROVIDER_LABEL[resource.provider] || resource.provider}</span>
                                <span>{formatSize(resource.size)}</span>
                                <span>{formatDate(resource.created_at)}</span>
                                <button type="button" onClick={() => void handleCopy(resource)} aria-label="复制磁链" title="复制磁链" className="inline-flex cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 text-[10px] leading-4 transition-colors hover:bg-[rgba(251,113,167,0.08)]" style={{ color: '#FB71A7' }}>
                                  <Copy size={10} aria-hidden="true" />
                                  <span>复制磁链</span>
                                </button>
                                {resource.href && (
                                  <a href={resource.href} target="_blank" rel="noopener noreferrer" aria-label="前往来源" title="前往来源" className="inline-flex cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 text-[10px] leading-4 transition-colors hover:bg-[rgba(251,113,167,0.08)]" style={{ color: 'var(--text-secondary)' }}>
                                    <ExternalLink size={10} aria-hidden="true" />
                                    <span>前往来源</span>
                                  </a>
                                )}
                              </div>
                            </article>
                          )
                        })}
                      </div>}
                    </section>
                  )
                })}
              </div>
              )}

              {state.loadingMore && (
                <div className="mt-4 flex items-center justify-center gap-2 py-2 text-xs" aria-live="polite" style={{ color: 'var(--text-muted)' }}>
                  <RefreshCw size={13} className="animate-spin" style={{ color: '#FB71A7' }} />
                  正在加载全部资源…
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}
