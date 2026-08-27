import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'

import { NotificationPanel } from '@/components/notification/NotificationPanel'
import { useAuthStore } from '@/stores/auth-store'
import { useNotificationStore } from '@/stores/notification-store'
import { LoadingIcon } from '@/components/ui/loading-icon'

const FOREGROUND_REFRESH_DEDUP_WINDOW = 5_000

export function NotificationCenter() {
  const { user } = useAuthStore()
  const open = useNotificationStore(state => state.open)
  const filter = useNotificationStore(state => state.filter)
  const unreadCount = useNotificationStore(state => state.unreadCount)
  const openPanel = useNotificationStore(state => state.openPanel)
  const closePanel = useNotificationStore(state => state.closePanel)
  const loadUnreadCount = useNotificationStore(state => state.loadUnreadCount)
  const loadNotifications = useNotificationStore(state => state.loadNotifications)
  const [opening, setOpening] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const lastForegroundRefreshAt = useRef(0)

  useEffect(() => {
    if (!open) return
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && containerRef.current && !containerRef.current.contains(event.target)) {
        closePanel()
      }
    }
    document.addEventListener('pointerdown', handleOutsidePointerDown)
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown)
  }, [closePanel, open])

  useEffect(() => {
    const refreshOnForeground = () => {
      const now = Date.now()
      if (now - lastForegroundRefreshAt.current < FOREGROUND_REFRESH_DEDUP_WINDOW) return
      lastForegroundRefreshAt.current = now
      void loadUnreadCount(true)
      if (open) void loadNotifications(filter, true)
    }

    void loadUnreadCount()
    const timer = window.setInterval(() => void loadUnreadCount(), 60_000)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshOnForeground()
    }
    const handleWindowFocus = () => refreshOnForeground()

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleWindowFocus)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [filter, loadNotifications, loadUnreadCount, open, user?.id])

  const handleToggle = async () => {
    if (open) {
      closePanel()
      return
    }
    if (opening) return
    setOpening(true)
    try {
      await openPanel()
    } finally {
      setOpening(false)
    }
  }

  return (
    <>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          aria-label="打开通知"
          aria-expanded={open}
          onClick={() => void handleToggle()}
          disabled={opening}
          aria-busy={opening || undefined}
          className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-[rgba(251,113,167,0.1)] disabled:cursor-not-allowed disabled:opacity-60"
          style={{ color: open ? '#FB71A7' : 'var(--text-secondary)' }}
        >
          {opening ? <LoadingIcon size={17} /> : <Bell size={17} />}
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 min-w-4 rounded-full px-1 text-center text-[9px] font-bold leading-4" style={{ background: '#ef4444', color: 'white', border: '2px solid var(--bg-card)' }}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
        <NotificationPanel />
      </div>
    </>
  )
}
