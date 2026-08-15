import { useState, useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useUIStore } from '@/stores/ui-store'
import { useTheme } from '@/hooks/use-theme'
import { PageContainer } from '@/components/layout/PageContainer'

export function AppHeader() {
  const { user, logout } = useAuthStore()
  const { openAuth, openSettings } = useUIStore()
  const { theme, toggleTheme } = useTheme()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 80)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <header
      className="fixed top-0 right-0 left-0 z-50 flex h-11 items-center sm:h-12 transition-all duration-300"
      style={{
        background: scrolled ? 'var(--bg-card)' : 'transparent',
        borderBottom: scrolled ? '1px solid var(--border-line)' : '1px solid transparent',
        backdropFilter: scrolled ? 'blur(12px)' : 'none',
        opacity: scrolled ? 1 : 0,
        transform: scrolled ? 'translateY(0)' : 'translateY(-100%)',
        pointerEvents: scrolled ? 'auto' : 'none',
      }}
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
            />
            <span
              className="text-xs font-medium uppercase tracking-[0.15em]"
              style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
            >
              又看一集
            </span>
          </a>

          {/* Right side: theme toggle + functional buttons */}
          <div className="flex items-center gap-3">
            {/* 主题切换 */}
            <button
              onClick={toggleTheme}
              className="w-7 h-7 flex items-center justify-center rounded-md transition-all duration-200 hover:opacity-70"
              style={{ color: 'var(--text-muted)' }}
              title={theme === 'light' ? '切换到暗色模式' : '切换到浅色模式'}
            >
              {theme === 'light' ? '🌙' : '☀️'}
            </button>

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
