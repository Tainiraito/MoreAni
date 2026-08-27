import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { HomePage } from '@/pages/HomePage'
import { AppHeader } from '@/components/layout/AppHeader'
import { ContentDetailDialog } from '@/components/content/ContentDetailDialog'
import { AuthDialog } from '@/components/auth/AuthDialog'
import { ToastContainer } from '@/components/ui/toast'
import { AdminDialog } from '@/components/admin/admin-dialog-loader'
import { useAuthStore } from '@/stores/auth-store'
import { useFavoriteStore } from '@/stores/favorite-store'
import { useUIStore } from '@/stores/ui-store'
import { ApiError, api } from '@/lib/api'
import type { ContentFormSavedEvent } from '@/components/content/ContentFormDialog'

import { useRefreshStore } from '@/stores/refresh-store'

const queryClient = new QueryClient()
const ProfilePage = lazy(() => import('@/pages/ProfilePage').then(module => ({ default: module.ProfilePage })))
const ContentFormDialog = lazy(() => import('@/components/content/ContentFormDialog').then(module => ({ default: module.ContentFormDialog })))
const SettingsDialog = lazy(() => import('@/components/settings/SettingsDialog').then(module => ({ default: module.SettingsDialog })))
function AdminDialogLoading() {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }} role="status" aria-label="后台管理加载中">
      <div className="w-[320px] max-w-[90vw] rounded-2xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', boxShadow: 'var(--shadow-popup)' }}>
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2" style={{ borderColor: 'var(--border-line)', borderTopColor: '#FB71A7' }} />
          <span className="text-sm" style={{ color: 'var(--text-primary)' }}>后台管理加载中</span>
        </div>
        <div className="mt-4 space-y-2">
          <div className="h-3 w-2/5 animate-pulse rounded" style={{ background: 'var(--skeleton-bg)' }} />
          <div className="h-3 w-4/5 animate-pulse rounded" style={{ background: 'var(--skeleton-bg)' }} />
        </div>
      </div>
    </div>
  )
}

function AuthValidator({ children }: { children: React.ReactNode }) {
  const { user, setUser, logout } = useAuthStore()
  const { loadFavorites } = useFavoriteStore()
  const [checking, setChecking] = useState(true)
  const [initialUser] = useState(user)
  const validationInFlight = useRef(false)
  const lastValidationAt = useRef(0)

  const validateSession = useCallback(async (force = false) => {
    const currentUser = useAuthStore.getState().user
    if (!currentUser || validationInFlight.current) return
    const now = Date.now()
    if (!force && now - lastValidationAt.current < 30_000) return
    validationInFlight.current = true
    lastValidationAt.current = now
    try {
      const userData = await api.getMe()
      const nextUser = {
        id: userData.id,
        username: userData.username,
        nickname: userData.nickname,
        avatar_id: userData.avatar_id,
        avatar_url: userData.avatar_url ?? null,
        avatar_crop: userData.avatar_crop ?? null,
        role: userData.role as 'user' | 'admin' | 'super_admin',
        created_at: currentUser.created_at,
      }
      const latestUser = useAuthStore.getState().user
      const changed = !latestUser
        || latestUser.id !== nextUser.id
        || latestUser.username !== nextUser.username
        || latestUser.nickname !== nextUser.nickname
        || latestUser.avatar_id !== nextUser.avatar_id
        || latestUser.avatar_url !== nextUser.avatar_url
        || latestUser.avatar_crop !== nextUser.avatar_crop
        || latestUser.role !== nextUser.role
      if (changed) setUser(nextUser)
      await loadFavorites()
    } catch (error) {
      // 只有服务端明确确认会话失效时才退出；网络唤醒或 5xx 保留当前页面与用户态。
      if (error instanceof ApiError && error.status === 401) logout()
    } finally {
      validationInFlight.current = false
    }
  }, [loadFavorites, logout, setUser])

  useEffect(() => {
    if (!initialUser) {
      setChecking(false)
      return
    }
    void validateSession(true).finally(() => setChecking(false))
  }, [initialUser, validateSession])

  useEffect(() => {
    if (!user) return
    const handleWake = () => {
      if (document.visibilityState === 'visible') void validateSession()
    }
    window.addEventListener('focus', handleWake)
    window.addEventListener('pageshow', handleWake)
    document.addEventListener('visibilitychange', handleWake)
    return () => {
      window.removeEventListener('focus', handleWake)
      window.removeEventListener('pageshow', handleWake)
      document.removeEventListener('visibilitychange', handleWake)
    }
  }, [user, validateSession])

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-page)' }}>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>加载中...</p>
      </div>
    )
  }

  return <>{children}</>
}

function GlobalDialogs() {
  const queryClient = useQueryClient()
  const {
    detailContentId,
    addAnimeOpen,
    addAnimePreset,
    editContentId,
    settingsOpen,
    adminOpen,
    closeAddAnime,
    closeEditContent,
    openDetail,
  } = useUIStore()
  const { isFavorited, isFavoritePending, toggleFavorite } = useFavoriteStore()

  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['airing-week'] })
    useRefreshStore.getState().triggerRefresh()
  }

  const handleContentSaved = (event: ContentFormSavedEvent) => {
    if (event.operation === 'created' && addAnimePreset?.openDetailAfterSave) {
      closeAddAnime()
      openDetail(event.contentId)
    }
    // 让表单先卸载，再触发列表刷新；刷新请求不会阻塞保存完成和弹窗关闭。
    queueMicrotask(handleRefresh)
  }

  return (
    <>
      <ContentDetailDialog
        isFavorited={detailContentId ? isFavorited(detailContentId) : false}
        isFavoritePending={detailContentId ? isFavoritePending(detailContentId) : false}
        onToggleFavorite={toggleFavorite}
      />
      <Suspense fallback={null}>
        {addAnimeOpen && (
          <ContentFormDialog
            open
            onClose={closeAddAnime}
            onSaved={handleContentSaved}
            initialBangumiSubjectId={addAnimePreset?.bangumiId}
            initialBangumiTitle={addAnimePreset?.title}
            initialBangumiTitleAlt={addAnimePreset?.titleAlt}
          />
        )}
        {!!editContentId && (
          <ContentFormDialog contentId={editContentId} open onClose={closeEditContent} onSaved={handleContentSaved} />
        )}
        {settingsOpen && <SettingsDialog />}
      </Suspense>
      <Suspense fallback={adminOpen ? <AdminDialogLoading /> : null}>
        {adminOpen && <AdminDialog />}
      </Suspense>
    </>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthValidator>
          <div className="min-h-screen">
            <AppHeader />
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/profile/:id" element={<Suspense fallback={null}><ProfilePage /></Suspense>} />
            </Routes>
          </div>

          {/* Global Dialogs */}
          <GlobalDialogs />
          <AuthDialog />
          <ToastContainer />
        </AuthValidator>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
