import { useAuthStore } from '@/stores/auth-store'
import { useUIStore } from '@/stores/ui-store'
import { PageContainer } from '@/components/layout/PageContainer'

export function AppHeader() {
  const { user, logout } = useAuthStore()
  const { openAuth, openSettings } = useUIStore()

  return (
    <header
      className="fixed top-0 right-0 left-0 z-50 flex h-11 items-center sm:h-12"
      style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-line)' }}
    >
      <PageContainer>
        <div className="flex items-center justify-between">
          {/* Logo — icon + 文字 */}
          <a
            href="/"
            className="flex items-center gap-2 transition-opacity duration-300 hover:opacity-80"
          >
            <img
              src="/favicon-32.png"
              alt="MoreAni"
              className="w-6 h-6 rounded-sm"
              style={{ boxShadow: '0 0 8px rgba(255, 140, 212, 0.3)' }}
            />
            <span
              className="text-xs font-medium uppercase tracking-[0.15em]"
              style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
            >
              又看一集
            </span>
          </a>

          {/* Right side: functional buttons */}
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <span
                  className="hidden text-xs sm:inline"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {user.username}
                </span>
                <button
                  onClick={openSettings}
                  className="text-xs transition-opacity hover:opacity-70"
                  style={{ color: 'var(--text-muted)' }}
                >
                  设置
                </button>
                <button
                  onClick={logout}
                  className="text-xs transition-opacity hover:opacity-70"
                  style={{ color: 'var(--text-muted)' }}
                >
                  退出
                </button>
              </>
            ) : (
              <button
                onClick={openAuth}
                className="text-xs font-medium transition-opacity hover:opacity-70"
                style={{ color: 'var(--accent-pink)' }}
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
