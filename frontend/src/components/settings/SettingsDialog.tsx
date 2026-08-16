import { useState } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useToastStore } from '@/stores/toast-store'
import { api } from '@/lib/api'
import { Avatar } from '@/components/ui/Avatar'
import { PasswordInput } from '@/components/ui/password-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { X, Pencil } from 'lucide-react'

export function SettingsDialog() {
  const { settingsOpen, closeSettings, openAuth } = useUIStore()
  const { user, setUser, logout } = useAuthStore()
  const [editingNickname, setEditingNickname] = useState(false)
  const [nickname, setNickname] = useState('')
  const [nicknameError, setNicknameError] = useState('')
  const [passwordOpen, setPasswordOpen] = useState(false)

  if (!settingsOpen) return null

  const resetForm = () => {
    setEditingNickname(false)
    setNickname('')
    setNicknameError('')
  }

  const handleClose = () => {
    resetForm()
    closeSettings()
  }

  const startEditNickname = () => {
    setNickname(user?.nickname || '')
    setNicknameError('')
    setEditingNickname(true)
  }

  const cancelEditNickname = () => {
    setNickname('')
    setNicknameError('')
    setEditingNickname(false)
  }

  const handleUpdateNickname = async (e: React.FormEvent) => {
    e.preventDefault()
    setNicknameError('')
    const value = nickname.trim()
    if (!value) {
      setNicknameError('昵称不能为空')
      return
    }
    if (value === user?.nickname) {
      setNicknameError('昵称没有变化')
      return
    }
    try {
      const updated = await api.updateNickname(value)
      setUser({ ...user!, ...updated })
      useToastStore.getState().addToast('success', '昵称已更新')
      cancelEditNickname()
    } catch (err: any) {
      setNicknameError(err.message || '昵称修改失败')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
      onClick={handleClose}
    >
      <div
        className="rounded-2xl w-[440px] max-w-[90vw] p-8"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-line)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.15)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>用户信息</h2>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-200 hover:opacity-80"
            style={{ color: 'var(--text-muted)', background: 'var(--bg-card-warm)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* 用户信息 */}
        <div className="flex items-start gap-4 mb-8">
          <Avatar name={user?.nickname || '?'} size={64}
            style={{ border: '2px solid var(--brand)' }} />
          <div className="flex-1 min-w-0">
            {editingNickname ? (
              <form onSubmit={handleUpdateNickname} className="flex items-center gap-2">
                <Input
                  value={nickname}
                  onChange={e => setNickname(e.target.value)}
                  className="h-8 flex-1 text-sm"
                  autoFocus
                />
                <Button type="submit" className="h-8 px-3 text-xs">保存</Button>
                <button
                  type="button"
                  onClick={cancelEditNickname}
                  className="text-xs"
                  style={{ color: 'var(--text-muted)' }}
                >
                  取消
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-1.5">
                <p className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>
                  {user?.nickname}
                </p>
                <button
                  onClick={startEditNickname}
                  title="修改昵称"
                  className="p-1 rounded-md transition-all duration-150 hover:opacity-70"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Pencil size={13} />
                </button>
              </div>
            )}
            <div className="flex items-center gap-2 mt-1">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                @{user?.username} · {user?.role === 'admin' ? '管理员' : '成员'}
              </p>
              <button
                onClick={() => setPasswordOpen(true)}
                className="text-xs px-2 py-0.5 rounded-md transition-all duration-150 hover:opacity-80"
                style={{ color: '#FB71A7', border: '1px solid rgba(251, 113, 167, 0.35)' }}
              >
                修改密码
              </button>
            </div>
            {nicknameError && (
              <p className="text-xs mt-1" style={{ color: 'var(--accent-coral)' }}>{nicknameError}</p>
            )}
          </div>
        </div>

        {/* 关于 */}
        <div className="pt-4" style={{ borderTop: '1px solid var(--border-line)' }}>
          <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
            MoreAni v2.0 — 又看一集
          </p>
        </div>
      </div>

      {/* 修改密码弹窗 */}
      <PasswordChangeModal
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onSuccess={() => {
          logout()
          closeSettings()
          openAuth()
        }}
      />
    </div>
  )
}

/** 修改密码弹窗（独立于用户信息弹窗） */
function PasswordChangeModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!open) return null

  const handleSubmit = async (e: React.FormEvent) => {
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
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      onClose()
      onSuccess()
    } catch (err: any) {
      setError(err.message || '密码修改失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.4)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl w-[400px] max-w-[90vw] p-6"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-line)',
          boxShadow: 'var(--shadow-popup)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>修改密码</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-200 hover:opacity-80"
            style={{ color: 'var(--text-muted)', background: 'var(--bg-card-warm)' }}
          >
            <X size={14} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
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
          <div className="flex gap-2 pt-1">
            <Button type="submit" loading={loading} className="flex-1">确认修改</Button>
            <Button type="button" onClick={onClose} className="px-4"
              style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-line)' }}>
              取消
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
