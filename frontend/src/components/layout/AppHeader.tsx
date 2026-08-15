import { useAuthStore } from '@/stores/auth-store'
import { useUIStore } from '@/stores/ui-store'
import { PageContainer } from '@/components/layout/PageContainer'

export function AppHeader() {
  const { user, logout } = useAuthStore()
  const { openAuth, openSettings } = useUIStore()

  return (
    <header
      className="fixed top-0 right-0 left-0 z-50 flex h-11 items-center sm:h-12"
      style={{ background: 'var(--bg-card, #fff)', borderBottom: '0.5px solid rgba(44,42,48,0.07)' }}
    >
      <PageContainer>
        <div className="flex items-center justify-between">
          {/* Logo — Gleamory style: text only, uppercase tracking */}
          <a
            href="/"
            className="text-xs font-medium uppercase tracking-[0.2em] transition-opacity duration-300 hover:opacity-70"
            style={{ color: 'var(--text-muted, #8a8590)', fontFamily: 'var(--font-display, serif)' }}
          >
            又看一集
          </a>

          {/* Right side: functional buttons */}
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <span
                  className="hidden text-xs sm:inline"
                  style={{ color: 'var(--text-muted, #8a8590)' }}
                >
                  {user.username}
                </span>
                <button
                  onClick={openSettings}
                  className="text-xs transition-opacity hover:opacity-70"
                  style={{ color: 'var(--text-muted, #8a8590)' }}
                >
                  设置
                </button>
                <button
                  onClick={logout}
                  className="text-xs transition-opacity hover:opacity-70"
                  style={{ color: 'var(--text-muted, #8a8590)' }}
                >
                  退出
                </button>
              </>
            ) : (
              <button
                onClick={openAuth}
                className="text-xs font-medium transition-opacity hover:opacity-70"
                style={{ color: 'var(--accent-amber, #c4956a)' }}
              >
                登录
              </button>
            )}
          </div>
        </div>
      </PageContainer>
    </header>
  )
}
