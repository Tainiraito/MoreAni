import { useEffect, useState } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useToastStore } from '@/stores/toast-store'
import { api } from '@/lib/api'
import { useLockBodyScroll } from '@/hooks/use-lock-body-scroll'
import { Avatar } from '@/components/ui/Avatar'
import { secureUrl } from '@/components/ui/CoverImage'
import { PasswordInput } from '@/components/ui/password-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { X, Pencil } from 'lucide-react'

interface UserStats {
  rating_count: number
  review_count: number
  favorite_count: number
  avg_score: number | null
}

interface ActivityItem {
  type: 'rating' | 'review' | 'favorite'
  content_id: number
  content_title: string
  content_cover: string
  content_type: string
  score: number | null
  review: string
  updated_at: string
}

export function SettingsDialog() {
  const { settingsOpen, closeSettings, openAuth, openDetail } = useUIStore()
  useLockBodyScroll(settingsOpen)
  const { user, setUser, logout } = useAuthStore()
  const [editingNickname, setEditingNickname] = useState(false)
  const [nickname, setNickname] = useState('')
  const [nicknameError, setNicknameError] = useState('')
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [stats, setStats] = useState<UserStats | null>(null)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [activityTotal, setActivityTotal] = useState(0)
  const [activityPage, setActivityPage] = useState(1)
  const [activityLoading, setActivityLoading] = useState(false)

  // 打开弹窗时加载用户统计 + 动态第一页
  useEffect(() => {
    if (!settingsOpen || !user) return
    api.getUser(user.id)
      .then(res => {
        const s = res as UserStats
        setStats({
          rating_count: s.rating_count ?? 0,
          review_count: s.review_count ?? 0,
          favorite_count: s.favorite_count ?? 0,
          avg_score: s.avg_score ?? null,
        })
      })
      .catch(() => {})
    loadActivity(1, true)
  }, [settingsOpen, user?.id])

  const loadActivity = async (page: number, reset = false) => {
    if (!user || activityLoading) return
    setActivityLoading(true)
    try {
      const res = await api.getUserActivity(user.id, { page: String(page), size: '10' })
      const items = (res.items || []) as ActivityItem[]
      setActivity(prev => (reset ? items : [...prev, ...items]))
      setActivityTotal(res.total || 0)
      setActivityPage(page)
    } catch {
      // ignore
    } finally {
      setActivityLoading(false)
    }
  }

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
      setUser({ ...user!, ...updated, role: updated.role as 'user' | 'admin' | 'super_admin' })
      useToastStore.getState().addToast('success', '昵称已更新')
      cancelEditNickname()
    } catch (err: any) {
      setNicknameError(err.message || '昵称修改失败')
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
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
                @{user?.username} · {user?.role === 'super_admin' ? '超级管理员' : user?.role === 'admin' ? '管理员' : '成员'}
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
            {/* 统计信息 */}
            {stats && (
              <div className="flex items-center gap-4 mt-3">
                {stats.avg_score != null && (
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-bold" style={{ color: '#FB71A7' }}>
                      {(stats.avg_score / 10).toFixed(1)}
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>均分</span>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{stats.rating_count}</span>
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>评分</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{stats.favorite_count}</span>
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>收藏</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{stats.review_count}</span>
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>评论</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 我的动态（评分/收藏/评论，时间降序） */}
        <div className="mb-8">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>我的动态</h3>
          {activity.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>还没有动态</p>
          ) : (
            <div className="max-h-72 overflow-y-auto space-y-2.5 pr-1">
              {activity.map((item, idx) => {
                const badge =
                  item.type === 'rating'
                    ? { text: '评分', color: '#FB71A7' }
                    : item.type === 'review'
                      ? { text: '评论', color: '#C77DFF' }
                      : { text: '收藏', color: '#4DA6FF' }
                const desc =
                  item.type === 'rating'
                    ? `评分 ${((item.score ?? 0) / 10).toFixed(1)}`
                    : item.type === 'review'
                      ? (item.review || (item.score ? `评分 ${((item.score ?? 0) / 10).toFixed(1)}` : '写了评论'))
                      : '收藏了'
                return (
                  <div
                    key={idx}
                    className="flex items-center gap-3 cursor-pointer rounded-lg transition-all duration-150 hover:opacity-80"
                    onClick={() => {
                      // 打开该番剧详情（用户信息弹窗保持打开，详情弹窗层级更高盖在其上）
                      openDetail(item.content_id)
                    }}
                  >
                    <div
                      className="w-10 h-14 rounded-md overflow-hidden shrink-0"
                      style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }}
                    >
                      {item.content_cover ? (
                        <img src={secureUrl(item.content_cover)} alt="" className="w-full h-full object-cover" />
                      ) : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {item.content_title}
                        </span>
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                          style={{ background: `${badge.color}1a`, color: badge.color }}
                        >
                          {badge.text}
                        </span>
                      </div>
                      <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        {desc} · {new Date(item.updated_at).toLocaleDateString('zh-CN')}
                      </div>
                    </div>
                  </div>
                )
              })}
              {activityTotal > activity.length && (
                <button
                  onClick={() => loadActivity(activityPage + 1)}
                  disabled={activityLoading}
                  className="w-full py-1.5 text-xs rounded-lg transition-all duration-150 hover:opacity-80"
                  style={{ color: '#FB71A7', border: '1px dashed rgba(251, 113, 167, 0.4)' }}
                >
                  {activityLoading ? '加载中...' : `加载更多（${activity.length}/${activityTotal}）`}
                </button>
              )}
            </div>
          )}
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
