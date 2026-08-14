import { useAuthStore } from '@/stores/auth-store'
import { useUIStore } from '@/stores/ui-store'

export function AppHeader() {
  const { user, isGuest, logout } = useAuthStore()
  const { openAuth, openSettings } = useUIStore()

  return (
    <header className="sticky top-0 z-40 border-b-2 border-brand-dark bg-white">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        {/* Logo */}
        <h1 className="font-display text-xl font-bold tracking-tight text-brand-dark">
          又看一集
        </h1>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="text-sm text-gray-600">{user.username}</span>
              <button
                onClick={openSettings}
                className="rounded-none border-2 border-brand-dark px-3 py-1 text-sm font-medium hover:bg-brand-dark hover:text-white transition-colors"
              >
                设置
              </button>
              <button
                onClick={logout}
                className="text-sm text-gray-500 hover:text-brand-pink"
              >
                退出
              </button>
            </>
          ) : isGuest ? (
            <span className="text-sm text-gray-500">游客模式</span>
          ) : (
            <button
              onClick={openAuth}
              className="rounded-none bg-brand-dark px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-pink transition-colors"
            >
              登录
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
