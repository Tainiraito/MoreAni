import { useState, useEffect, useRef } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useUIStore } from '@/stores/ui-store'
import { useToastStore } from '@/stores/toast-store'
import { useTheme } from '@/hooks/use-theme'
import { api } from '@/lib/api'
import { PageContainer } from '@/components/layout/PageContainer'
import { Avatar } from '@/components/ui/Avatar'
import { User, Sun, Moon, Settings, LogOut, Shield } from 'lucide-react'

export function AppHeader() {
  const { user, logout } = useAuthStore()
  const { openAuth, openSettings, openAdmin } = useUIStore()
  const { theme, toggleTheme } = useTheme()
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 80)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  const menuItemStyle = "w-full px-4 py-2.5 text-sm text-left transition-colors flex items-center gap-2.5"

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
          <a
            href="/"
            className="flex items-center gap-2 transition-opacity duration-300 hover:opacity-80"
          >
            <img 
              src={theme === 'dark' ? '/favicon-white-32.png' : '/favicon-32.png'} 
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

          {/* 右侧：头像菜单 */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-8 h-8 rounded-full overflow-hidden transition-all duration-200 hover:opacity-80"
              style={{ border: '2px solid var(--border-line)' }}
            >
              {user ? (
                <Avatar name={user.nickname} src={user.avatar_url} size={28}
                  style={{ border: '2px solid var(--border-line)' }} />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center"
                  style={{ background: 'var(--bg-card-warm)', color: 'var(--text-muted)' }}
                >
                  <User size={16} />
                </div>
              )}
            </button>

            {/* 下拉菜单 — 相对头像居中 */}
            {menuOpen && (
              <div
                className="absolute top-full mt-2 w-48 rounded-xl overflow-hidden"
                style={{
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-line)',
                  boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
                  animation: 'scale-in-center 150ms ease-out',
                  transformOrigin: 'top center',
                }}
              >
                {user && (
                  <div
                    className="px-4 py-3"
                    style={{ borderBottom: '1px solid var(--border-line)' }}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar name={user.nickname} src={user.avatar_url} size={40} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {user.nickname}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {user.role === 'super_admin' ? '超级管理员' : user.role === 'admin' ? '管理员' : '成员'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => { toggleTheme(); setMenuOpen(false) }}
                  className={menuItemStyle}
                  style={{ color: 'var(--text-primary)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(251, 113, 167, 0.08)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
                  {theme === 'light' ? '深色模式' : '浅色模式'}
                </button>

                {user && (
                  <button
                    onClick={() => { openSettings(); setMenuOpen(false) }}
                    className={menuItemStyle}
                    style={{ color: 'var(--text-primary)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(251, 113, 167, 0.08)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <Settings size={16} />
                    用户信息
                  </button>
                )}

                {user?.role === 'super_admin' && (
                  <button
                    onClick={() => { openAdmin(); setMenuOpen(false) }}
                    className={menuItemStyle}
                    style={{ color: 'var(--brand)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(251, 113, 167, 0.08)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <Shield size={16} />
                    后台管理
                  </button>
                )}

                <div style={{ borderTop: '1px solid var(--border-line)' }} />

                {user ? (
                  <button
                    onClick={async () => {
                      setMenuOpen(false)
                      try { await api.logout() } catch { /* ignore */ }
                      logout()
                      useToastStore.getState().addToast('success', '已退出登录')
                    }}
                    className={menuItemStyle}
                    style={{ color: 'var(--accent-coral)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(251, 113, 167, 0.08)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <LogOut size={16} />
                    退出登录
                  </button>
                ) : (
                  <button
                    onClick={() => { openAuth(); setMenuOpen(false) }}
                    className={menuItemStyle}
                    style={{ color: 'var(--brand)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(251, 113, 167, 0.08)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <User size={16} />
                    登录 / 注册
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </PageContainer>
    </header>
  )
}
