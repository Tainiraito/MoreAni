import { useState } from 'react'
import { CheckCheck, ExternalLink } from 'lucide-react'

import { useAuthStore } from '@/stores/auth-store'
import { useNotificationStore, type NotificationFilter } from '@/stores/notification-store'
import { useUIStore } from '@/stores/ui-store'
import { Skeleton } from '@/components/ui/skeleton'
import type { NotificationItem } from '@/types'

const FILTERS: Array<{ key: NotificationFilter; label: string }> = [
  { key: 'public', label: '公共' },
  { key: 'private', label: '私人' },
]

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
}

function payloadString(item: NotificationItem, key: string): string | undefined {
  const value = item.payload?.[key]
  return typeof value === 'string' ? value : undefined
}

function payloadSource(item: NotificationItem): 'mikan' | 'animegarden' | undefined {
  const source = payloadString(item, 'source')
  return source === 'mikan' || source === 'animegarden' ? source : 'animegarden'
}

function NotificationLoadingSkeleton() {
  return (
    <div className="space-y-2" aria-label="通知加载中">
      {[0, 1, 2].map(index => (
        <div
          key={index}
          className="h-20 rounded-xl border p-3"
          style={{ background: 'var(--bg-card-warm)', borderColor: 'var(--border-line)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-2 w-2 rounded-full" />
          </div>
          <Skeleton className="mt-3 h-2.5 w-11/12" />
          <Skeleton className="mt-2 h-2.5 w-2/5" />
        </div>
      ))}
    </div>
  )
}

export function NotificationPanel() {
  const { user } = useAuthStore()
  const { openDetailResource } = useUIStore()
  const { open, filter, items, loading, setFilter, closePanel, markRead, markAllRead } = useNotificationStore()
  const [expandedId, setExpandedId] = useState<number | null>(null)

  if (!open) return null

  const handleClick = (item: NotificationItem) => {
    void markRead(item)
    if (item.kind === 'resource_update') {
      const rawContentId = item.payload?.content_id
      const contentId = typeof rawContentId === 'number' ? rawContentId : Number(rawContentId)
      if (Number.isFinite(contentId) && contentId > 0) {
        closePanel()
        openDetailResource({
          contentId,
          source: payloadSource(item),
          fansubName: payloadString(item, 'fansub_name'),
          fansubId: payloadString(item, 'fansub_id'),
          resourceKey: payloadString(item, 'resource_key'),
        })
        return
      }
    }
    setExpandedId(current => current === item.id ? null : item.id)
  }

  return (
    <div className="absolute right-0 top-full z-40 mt-2 h-[min(420px,calc(100vh-5rem))] w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-2xl" role="dialog" aria-label="通知中心" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }}>
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border-line)' }}>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>通知中心</h2>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => void markAllRead()} className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] hover:bg-[rgba(251,113,167,0.08)] hover:opacity-80" style={{ color: '#FB71A7' }}>
            <CheckCheck size={12} /> 当前分类已读
          </button>
        </div>
      </div>

      <div className="flex border-b px-3" style={{ borderColor: 'var(--border-line)' }}>
        {FILTERS.map(tab => {
          return (
            <button
              type="button"
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className="flex-1 cursor-pointer border-b-2 py-2 text-xs transition-colors hover:bg-[rgba(251,113,167,0.06)]"
              style={{ borderColor: filter === tab.key ? '#FB71A7' : 'transparent', color: filter === tab.key ? '#FB71A7' : 'var(--text-muted)' }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="h-[calc(100%-6.75rem)] overflow-y-auto p-3">
        {!user && filter === 'private' ? (
          <p className="px-3 py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>登录后可以关注字幕组并接收资源更新通知</p>
        ) : loading ? (
          <NotificationLoadingSkeleton />
        ) : items.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>暂无通知</p>
        ) : (
          <div className="space-y-2">
            {items.map(item => {
              const expanded = expandedId === item.id
              return (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => handleClick(item)}
                  className="block w-full cursor-pointer rounded-xl p-3 text-left transition-colors hover:opacity-90"
                  style={{ background: item.is_read ? 'var(--bg-card-warm)' : 'rgba(251,113,167,0.08)', border: `1px solid ${item.is_read ? 'var(--border-line)' : 'rgba(251,113,167,0.28)'}` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{item.title}</p>
                      <p className="mt-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>{item.body}</p>
                    </div>
                    {!item.is_read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: '#ef4444' }} />}
                  </div>
                  {expanded && (
                    <div className="mt-2 border-t pt-2 text-[11px] whitespace-pre-line" style={{ borderColor: 'var(--border-line)', color: 'var(--text-secondary)' }}>
                      {item.body}
                      {item.kind === 'announcement' && <span className="mt-2 flex items-center gap-1" style={{ color: '#FB71A7' }}><ExternalLink size={11} /> 公共公告</span>}
                    </div>
                  )}
                  <p className="mt-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>{formatDate(item.created_at)}{item.kind === 'resource_update' ? ' · 资源更新' : ''}</p>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
