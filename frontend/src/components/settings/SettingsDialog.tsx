import { useState } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useToastStore } from '@/stores/toast-store'
import { api } from '@/lib/api'
import { Avatar } from '@/components/ui/Avatar'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'

export function SettingsDialog() {
  const { settingsOpen, closeSettings, openAuth } = useUIStore()
  const { user, logout } = useAuthStore()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!settingsOpen) return null

  const resetForm = () => {
    setOldPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError('')
  }

  const handleClose = () => {
    resetForm()
    closeSettings()
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (newPassword.length < 6) {
      setError('新密码至少 6 位')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }

    setLoading(true)
    try {
      await api.changePassword({ old_password: oldPassword, new_password: newPassword })
      useToastStore.getState().addToast('success', '密码修改成功，请重新登录')
      resetForm()
      logout()
      closeSettings()
      openAuth()
    } catch (err: any) {
      setError(err.message || '密码修改失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
         onClick={handleClose}>
      <div
        className="rounded-2xl w-[480px] max-w-[90vw] p-8"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-line)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.15)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>设置</h2>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-200 hover:opacity-80"
            style={{ color: 'var(--text-muted)', background: 'var(--bg-card-warm)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* 用户信息 */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>我的信息</h3>
          <div className="flex items-center gap-4">
            <Avatar name={user?.nickname || '?'} size={64}
              style={{ border: '2px solid var(--brand)' }} />
            <div>
              <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{user?.nickname}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                @{user?.username} · {user?.role === 'admin' ? '管理员' : '成员'}
              </p>
            </div>
          </div>
        </div>

        {/* 修改密码 */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>修改密码</h3>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>原密码</Label>
              <PasswordInput value={oldPassword} onChange={e => setOldPassword(e.target.value)} placeholder="请输入原密码" required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>新密码</Label>
              <PasswordInput value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="至少 6 位" required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>确认新密码</Label>
              <PasswordInput value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="再次输入新密码" required />
            </div>
            {error && <p className="text-sm" style={{ color: 'var(--accent-coral)' }}>{error}</p>}
            <Button type="submit" loading={loading} className="w-full">
              修改密码
            </Button>
          </form>
        </div>

        {/* 关于 */}
        <div className="pt-4" style={{ borderTop: '1px solid var(--border-line)' }}>
          <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
            MoreAni v2.0 — 又看一集
          </p>
        </div>
      </div>
    </div>
  )
}
