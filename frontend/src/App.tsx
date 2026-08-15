import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HomePage } from '@/pages/HomePage'
import { ProfilePage } from '@/pages/ProfilePage'
import { AppHeader } from '@/components/layout/AppHeader'
import { ContentDetailDialog } from '@/components/content/ContentDetailDialog'
import { ContentFormDialog } from '@/components/content/ContentFormDialog'
import { AuthDialog } from '@/components/auth/AuthDialog'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { ToastContainer } from '@/components/ui/toast'
import { useAuthStore } from '@/stores/auth-store'
import { useFavoriteStore } from '@/stores/favorite-store'
import { useUIStore } from '@/stores/ui-store'
import { api } from '@/lib/api'

import { useRefreshStore } from '@/stores/refresh-store'

const queryClient = new QueryClient()

function AuthValidator({ children }: { children: React.ReactNode }) {
  const { user, setUser, logout } = useAuthStore()
  const { loadFavorites } = useFavoriteStore()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (user) {
      api.getMe()
        .then(userData => {
          setUser({
            id: userData.id,
            username: userData.username,
            avatar_id: userData.avatar_id,
            role: userData.role as 'user' | 'admin',
            created_at: new Date().toISOString(),
          })
          loadFavorites()
        })
        .catch(() => {
          logout()
        })
        .finally(() => setChecking(false))
    } else {
      setChecking(false)
    }
  }, [])

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
  const { detailContentId, addAnimeOpen, editContentId, closeAddAnime, closeEditContent } = useUIStore()
  const { isFavorited, toggleFavorite, loadFavorites } = useFavoriteStore()

  const handleRefresh = () => {
    loadFavorites()
    useRefreshStore.getState().triggerRefresh()
  }

  return (
    <>
      <ContentDetailDialog
        isFavorited={detailContentId ? isFavorited(detailContentId) : false}
        onToggleFavorite={toggleFavorite}
      />
      <ContentFormDialog open={addAnimeOpen} onClose={closeAddAnime} onSaved={handleRefresh} />
      <ContentFormDialog contentId={editContentId} open={!!editContentId} onClose={closeEditContent} onSaved={handleRefresh} />
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
              <Route path="/profile/:id" element={<ProfilePage />} />
            </Routes>
          </div>

          {/* Global Dialogs */}
          <GlobalDialogs />
          <AuthDialog />
          <SettingsDialog />
          <ToastContainer />
        </AuthValidator>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
