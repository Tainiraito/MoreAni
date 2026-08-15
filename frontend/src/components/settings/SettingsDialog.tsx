import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'

export function SettingsDialog() {
  const { settingsOpen, closeSettings } = useUIStore()
  const { user } = useAuthStore()

  if (!settingsOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
         onClick={closeSettings}>
      <div
        className="rounded-2xl w-[480px] max-w-[90vw] p-8"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-line)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.5), 0 0 20px rgba(255, 140, 212, 0.1)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>设置</h2>
          <button
            onClick={closeSettings}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-200 hover:opacity-80"
            style={{ color: 'var(--text-muted)', background: 'var(--bg-card-warm)' }}
          >
            ✕
          </button>
        </div>

        {/* 用户信息 */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>头像</h3>
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, var(--brand-light), var(--brand))',
                border: '2px solid var(--brand)',
                boxShadow: '0 0 15px rgba(255, 140, 212, 0.3)',
              }}
            >
              <span className="text-white text-xl font-semibold">
                {user?.username?.charAt(0).toUpperCase() || '?'}
              </span>
            </div>
            <div>
              <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{user?.username}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {user?.role === 'admin' ? '管理员' : '成员'}
              </p>
            </div>
          </div>
        </div>

        {/* 修改密码 */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>修改密码</h3>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>密码修改功能开发中...</p>
        </div>

        {/* 关于 */}
        <div
          className="pt-4"
          style={{ borderTop: '1px solid var(--border-line)' }}
        >
          <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
            MoreAni v2.0 — 又看一集
          </p>
        </div>
      </div>
    </div>
  )
}
