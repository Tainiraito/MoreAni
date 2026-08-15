import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HomePage } from '@/pages/HomePage'
import { ProfilePage } from '@/pages/ProfilePage'
import { AppHeader } from '@/components/layout/AppHeader'
import { ContentDetailDialog } from '@/components/content/ContentDetailDialog'
import { AuthDialog } from '@/components/auth/AuthDialog'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { ToastContainer } from '@/components/ui/toast'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'

const queryClient = new QueryClient()

function AuthValidator({ children }: { children: React.ReactNode }) {
  const { user, setUser, logout } = useAuthStore()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    // 如果 localStorage 中有用户信息，验证 cookie 是否有效
    if (user) {
      api.getMe()
        .then(userData => {
          // cookie 有效，更新用户信息
          setUser({
            id: userData.id,
            username: userData.username,
            avatar_id: userData.avatar_id,
            role: userData.role as 'user' | 'admin',
            created_at: new Date().toISOString(),
          })
        })
        .catch(() => {
          // cookie 无效，清除登录状态
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
          <ContentDetailDialog />
          <AuthDialog />
          <SettingsDialog />
          <ToastContainer />
        </AuthValidator>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
