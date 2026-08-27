import { useEffect, useRef, useState } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useToastStore } from '@/stores/toast-store'
import { useLockBodyScroll } from '@/hooks/use-lock-body-scroll'
import { useMaskClose } from '@/hooks/use-mask-close'
import { api } from '@/lib/api'
import { Avatar } from '@/components/ui/Avatar'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { DatePicker } from '@/components/ui/date-picker'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { LoadingIcon } from '@/components/ui/loading-icon'
import { formatAnnouncementTime } from '@/components/admin/announcement-utils'
import { formatDate, toLocalDateTimeInput, toUtcISOString } from '@/lib/utils'
import { X, Search, Plus, Pencil, Trash2, Shield, Users, KeyRound, Megaphone } from 'lucide-react'
import type { Announcement, InviteCode, User } from '@/types'

const ROLE_LABEL: Record<string, string> = { user: '成员', admin: '管理员', super_admin: '超级管理员' }
const ROLE_COLOR: Record<string, string> = { user: '#4DA6FF', admin: '#FB71A7', super_admin: '#C77DFF' }

const INVITE_STATUS: Record<string, { label: string; color: string }> = {
  active: { label: '有效', color: '#00B894' },
  used_up: { label: '已用完', color: '#E17055' },
  expired: { label: '已过期', color: '#999' },
}

interface AdminUserForm {
  username: string
  nickname: string
  password: string
  role: string
}

interface InviteForm {
  code: string
  max_uses: string
  expires_at: string
}

export function AdminDialog() {
  const { adminOpen, closeAdmin } = useUIStore()
  const maskProps = useMaskClose(closeAdmin)
  useLockBodyScroll(adminOpen)
  const [tab, setTab] = useState<'users' | 'invites' | 'announcements'>('users')

  // 关键：不打开就不渲染（否则页面加载时弹窗常驻、UserManageTab 自动请求 admin/users）
  if (!adminOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }} {...maskProps}>
      <div
        className="rounded-2xl w-[720px] max-w-[95vw] max-h-[85vh] flex flex-col"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', boxShadow: 'var(--shadow-popup)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4" style={{ borderBottom: '1px solid var(--border-line)' }}>
          <div className="flex items-center gap-4">
            <h2 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Shield size={16} style={{ color: '#FB71A7' }} /> 后台管理
            </h2>
            {/* Tab 切换 */}
            <div className="flex items-center rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-line)' }}>
              <button
                onClick={() => setTab('users')}
                className="h-8 px-3.5 text-xs font-medium flex items-center gap-1.5 transition-all duration-150"
                style={{
                  background: tab === 'users' ? 'var(--bg-card-warm)' : 'transparent',
                  color: tab === 'users' ? 'var(--text-primary)' : 'var(--text-muted)',
                  boxShadow: tab === 'users' ? 'inset 0 -2px 0 #FB71A7' : 'none',
                }}
              >
                <Users size={12} /> 用户管理
              </button>
              <button
                onClick={() => setTab('invites')}
                className="h-8 px-3.5 text-xs font-medium flex items-center gap-1.5 transition-all duration-150"
                style={{
                  background: tab === 'invites' ? 'var(--bg-card-warm)' : 'transparent',
                  color: tab === 'invites' ? 'var(--text-primary)' : 'var(--text-muted)',
                  borderLeft: '1px solid var(--border-line)',
                  boxShadow: tab === 'invites' ? 'inset 0 -2px 0 #FB71A7' : 'none',
                }}
              >
                <KeyRound size={12} /> 邀请码
              </button>
              <button
                onClick={() => setTab('announcements')}
                className="h-8 px-3.5 text-xs font-medium flex items-center gap-1.5 transition-all duration-150"
                style={{
                  background: tab === 'announcements' ? 'var(--bg-card-warm)' : 'transparent',
                  color: tab === 'announcements' ? 'var(--text-primary)' : 'var(--text-muted)',
                  borderLeft: '1px solid var(--border-line)',
                  boxShadow: tab === 'announcements' ? 'inset 0 -2px 0 #FB71A7' : 'none',
                }}
              >
                <Megaphone size={12} /> 公共通知
              </button>
            </div>
          </div>
          <button onClick={closeAdmin} className="w-7 h-7 flex items-center justify-center rounded-lg hover:opacity-80" style={{ color: 'var(--text-muted)', background: 'var(--bg-card-warm)' }}>
            <X size={14} />
          </button>
        </div>

        {tab === 'users' ? (
          <UserManageTab />
        ) : tab === 'invites' ? (
          <InviteManageTab />
        ) : (
          <AnnouncementManageTab />
        )}
      </div>
    </div>
  )
}

/* ── 用户管理 ─────────────────────────────────────────────── */

function UserManageTab() {
  const [users, setUsers] = useState<User[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null)
  const formMask = useMaskClose(() => setFormOpen(false))
  const confirmMask = useMaskClose(() => setConfirmDelete(null))
  const [form, setForm] = useState<AdminUserForm>({ username: '', nickname: '', password: '', role: 'user' })
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null)
  const PAGE_SIZE = 15
  const initialLoadRef = useRef(false)
  const loadingUsersRef = useRef(false)

  const loadUsers = async (p = 1, search = q) => {
    if (loadingUsersRef.current) return
    loadingUsersRef.current = true
    setLoading(true)
    try {
      const data = await api.adminListUsers({ page: String(p), size: String(PAGE_SIZE), ...(search ? { q: search } : {}) })
      setUsers(p === 1 ? data.items : prev => [...prev, ...data.items])
      setTotal(data.total)
      setPage(p)
    } catch (err: any) {
      useToastStore.getState().addToast('error', err.message || '加载用户失败')
    } finally {
      setLoading(false)
      loadingUsersRef.current = false
    }
  }

  useEffect(() => {
    if (initialLoadRef.current) return
    initialLoadRef.current = true
    setUsers([])
    setPage(1)
    setQ('')
    loadUsers(1, '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openAdd = () => {
    setEditing(null)
    setForm({ username: '', nickname: '', password: '', role: 'user' })
    setFormError('')
    setFormOpen(true)
  }

  const openEdit = (u: User) => {
    setEditing(u)
    setForm({ username: u.username, nickname: u.nickname, password: '', role: u.role })
    setFormError('')
    setFormOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    setFormError('')
    if (!form.username.trim()) { setFormError('账号不能为空'); return }
    if (!editing && form.password.length < 6) { setFormError('密码至少 6 位'); return }
    if (editing && form.password && form.password.length < 6) { setFormError('新密码至少 6 位'); return }
    setSaving(true)
    try {
      const payload: Record<string, string> = { username: form.username.trim(), nickname: form.nickname.trim() || form.username.trim(), role: form.role }
      if (form.password) payload.password = form.password
      if (editing) {
        await api.adminUpdateUser(editing.id, payload)
        useToastStore.getState().addToast('success', '用户已更新')
      } else {
        await api.adminCreateUser({
          username: payload.username,
          nickname: payload.nickname,
          password: payload.password || '',
          role: payload.role,
        })
        useToastStore.getState().addToast('success', '用户已创建')
      }
      setFormOpen(false)
      loadUsers(1, q)
    } catch (err: any) {
      setFormError(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (u: User) => {
    if (deletingUserId !== null) return
    setDeletingUserId(u.id)
    try {
      await api.adminDeleteUser(u.id)
      useToastStore.getState().addToast('success', `已删除 ${u.nickname}`)
      setConfirmDelete(null)
      loadUsers(1, q)
    } catch (err: any) {
      setConfirmDelete(null)
      useToastStore.getState().addToast('error', err.message || '删除失败')
    } finally {
      setDeletingUserId(null)
    }
  }

  return (
    <>
      <div className="px-6 pt-3 flex items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <Input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') loadUsers(1, q) }}
            clearable
            onClear={() => {
              setQ('')
              void loadUsers(1, '')
            }}
            placeholder="搜索账号 / 昵称…"
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Button onClick={openAdd} size="sm" style={{ background: '#FB71A7', color: 'white' }}>
          <Plus size={13} /> 新增用户
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1.5">
        <p className="text-[11px] pb-1" style={{ color: 'var(--text-muted)' }}>共 {total} 个用户</p>
        {loading && users.length === 0 ? (
          <p className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>加载中...</p>
        ) : users.length === 0 ? (
          <p className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>没有找到用户</p>
        ) : (
          users.map(u => (
            <div
              key={u.id}
              className="flex items-center gap-3 px-3 py-2 rounded-xl"
              style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }}
            >
              <Avatar name={u.nickname} src={u.avatar_url} crop={u.avatar_crop} size={32} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{u.nickname}</p>
                  <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: `${ROLE_COLOR[u.role] || '#999'}1a`, color: ROLE_COLOR[u.role] || '#999' }}>
                    {ROLE_LABEL[u.role] || u.role}
                  </span>
                </div>
                <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>@{u.username} · 加入于 {u.created_at ? u.created_at.slice(0, 10) : '?'}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => openEdit(u)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-150"
                  style={{ color: 'var(--text-muted)', background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}
                  title="编辑"
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#FB71A7'; e.currentTarget.style.color = '#FB71A7' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-line)'; e.currentTarget.style.color = 'var(--text-muted)' }}
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => setConfirmDelete(u)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-150"
                  style={{ color: 'var(--accent-coral)', background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}
                  title="删除"
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-coral)'; e.currentTarget.style.color = 'var(--accent-coral)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-line)'; e.currentTarget.style.color = 'var(--accent-coral)' }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))
        )}
        {users.length < total && (
          <button
            onClick={() => loadUsers(page + 1, q)}
            disabled={loading}
            aria-busy={loading || undefined}
            className="inline-flex w-full items-center justify-center gap-1.5 py-2 text-xs rounded-lg transition-all duration-150 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ color: '#FB71A7', border: '1px dashed rgba(251, 113, 167, 0.4)' }}
          >
            {loading ? <><LoadingIcon size={13} /> 加载中...</> : `加载更多（${users.length}/${total}）`}
          </button>
        )}
      </div>

      {/* 表单弹窗 */}
      {formOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }} {...formMask}>
          <div className="rounded-2xl w-[400px] max-w-[90vw] p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', boxShadow: 'var(--shadow-popup)' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>{editing ? '编辑用户' : '新增用户'}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">账号</Label>
                <Input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="登录账号" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">昵称</Label>
                <Input value={form.nickname} onChange={e => setForm({ ...form, nickname: e.target.value })} placeholder="显示昵称（留空用账号）" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{editing ? '密码（留空不修改）' : '密码'}</Label>
                <Input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder={editing ? '留空则保持原密码' : '至少 6 位'} className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">角色</Label>
                <Select
                  value={form.role}
                  onChange={v => setForm({ ...form, role: v })}
                  options={[
                    { value: 'user', label: '成员' },
                    { value: 'admin', label: '管理员' },
                    { value: 'super_admin', label: '超级管理员' },
                  ]}
                  className="w-full h-9 text-sm"
                />
              </div>
              {formError && <p className="text-xs" style={{ color: 'var(--accent-coral)' }}>{formError}</p>}
              <div className="flex gap-2 pt-1">
                <Button type="submit" loading={saving} className="flex-1" style={{ background: '#FB71A7', color: 'white' }}>
                  {editing ? '保存修改' : '创建用户'}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>取消</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }} {...confirmMask}>
          <div className="rounded-2xl w-[360px] max-w-[90vw] p-6 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', boxShadow: 'var(--shadow-popup)' }} onClick={e => e.stopPropagation()}>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              确定删除用户「{confirmDelete.nickname}」吗？评分、评论和收藏将删除；创建的内容将转交给当前超级管理员。
            </p>
            <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
              将同时删除其全部评分、评论和收藏，且不可恢复
            </p>
            <div className="flex gap-2 mt-4">
              <Button onClick={() => void handleDelete(confirmDelete)} loading={deletingUserId === confirmDelete.id} className="flex-1" style={{ background: 'var(--accent-coral)', color: 'white' }}>删除</Button>
              <Button variant="secondary" onClick={() => setConfirmDelete(null)} className="flex-1">取消</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ── 邀请码管理 ───────────────────────────────────────────── */

function InviteManageTab() {
  const [invites, setInvites] = useState<InviteCode[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<InviteCode | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<InviteCode | null>(null)
  const formMask = useMaskClose(() => setFormOpen(false))
  const confirmMask = useMaskClose(() => setConfirmDelete(null))
  const [form, setForm] = useState<InviteForm>({ code: '', max_uses: '1', expires_at: '' })
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingInviteId, setDeletingInviteId] = useState<number | null>(null)
  const PAGE_SIZE = 20
  const initialLoadRef = useRef(false)
  const loadingInvitesRef = useRef(false)

  const loadInvites = async (p = 1, search = q) => {
    if (loadingInvitesRef.current) return
    loadingInvitesRef.current = true
    setLoading(true)
    try {
      const data = await api.adminListInvites({ page: String(p), size: String(PAGE_SIZE), ...(search ? { q: search } : {}) })
      setInvites(p === 1 ? data.items : prev => [...prev, ...data.items])
      setTotal(data.total)
      setPage(p)
    } catch (err: any) {
      useToastStore.getState().addToast('error', err.message || '加载邀请码失败')
    } finally {
      setLoading(false)
      loadingInvitesRef.current = false
    }
  }

  useEffect(() => {
    if (initialLoadRef.current) return
    initialLoadRef.current = true
    setInvites([])
    setPage(1)
    setQ('')
    loadInvites(1, '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openAdd = () => {
    setEditing(null)
    setForm({ code: '', max_uses: '1', expires_at: '' })
    setFormError('')
    setFormOpen(true)
  }

  const openEdit = (i: InviteCode) => {
    setEditing(i)
    setForm({ code: i.code, max_uses: String(i.max_uses), expires_at: i.expires_at ? i.expires_at.slice(0, 10) : '' })
    setFormError('')
    setFormOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    setFormError('')
    if (!form.code.trim() && !editing) { /* 留空自动生成 */ }
    const payload: Record<string, string> = { code: form.code.trim(), max_uses: form.max_uses || '1' }
    if (form.expires_at) payload.expires_at = form.expires_at
    setSaving(true)
    try {
      if (editing) {
        await api.adminUpdateInvite(editing.id, payload)
        useToastStore.getState().addToast('success', '邀请码已更新')
      } else {
        await api.adminCreateInvite(payload)
        useToastStore.getState().addToast('success', '邀请码已创建')
      }
      setFormOpen(false)
      loadInvites(1, q)
    } catch (err: any) {
      setFormError(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (i: InviteCode) => {
    if (deletingInviteId !== null) return
    setDeletingInviteId(i.id)
    try {
      await api.adminDeleteInvite(i.id)
      useToastStore.getState().addToast('success', `已删除邀请码 ${i.code}`)
      setConfirmDelete(null)
      loadInvites(1, q)
    } catch (err: any) {
      setConfirmDelete(null)
      useToastStore.getState().addToast('error', err.message || '删除失败')
    } finally {
      setDeletingInviteId(null)
    }
  }

  return (
    <>
      <div className="px-6 pt-3 flex items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <Input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') loadInvites(1, q) }}
            clearable
            onClear={() => {
              setQ('')
              void loadInvites(1, '')
            }}
            placeholder="搜索邀请码…"
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Button onClick={openAdd} size="sm" style={{ background: '#FB71A7', color: 'white' }}>
          <Plus size={13} /> 生成邀请码
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1.5">
        <p className="text-[11px] pb-1" style={{ color: 'var(--text-muted)' }}>共 {total} 个邀请码</p>
        {loading && invites.length === 0 ? (
          <p className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>加载中...</p>
        ) : invites.length === 0 ? (
          <p className="text-center py-10 text-sm" style={{ color: 'var(--text-muted)' }}>还没有邀请码</p>
        ) : (
          invites.map(i => {
            const st = INVITE_STATUS[i.status] || INVITE_STATUS.active
            return (
              <div
                key={i.id}
                className="flex items-center gap-3 px-3 py-2 rounded-xl"
                style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }}
              >
                <div className="w-8 h-8 flex items-center justify-center rounded-lg shrink-0" style={{ background: 'rgba(251,113,167,0.1)', color: '#FB71A7' }}>
                  <KeyRound size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{i.code}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: `${st.color}1a`, color: st.color }}>
                      {st.label}
                    </span>
                  </div>
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                    已用 {i.use_count}/{i.max_uses} 次{i.expires_at ? ` · 有效期至 ${i.expires_at.slice(0, 10)}` : ' · 永不过期'}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(i)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-150"
                    style={{ color: 'var(--text-muted)', background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}
                    title="编辑"
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#FB71A7'; e.currentTarget.style.color = '#FB71A7' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-line)'; e.currentTarget.style.color = 'var(--text-muted)' }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(i)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-150"
                    style={{ color: 'var(--accent-coral)', background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}
                    title="删除"
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-coral)'; e.currentTarget.style.color = 'var(--accent-coral)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-line)'; e.currentTarget.style.color = 'var(--accent-coral)' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          })
        )}
        {invites.length < total && (
          <button
            onClick={() => loadInvites(page + 1, q)}
            disabled={loading}
            aria-busy={loading || undefined}
            className="inline-flex w-full items-center justify-center gap-1.5 py-2 text-xs rounded-lg transition-all duration-150 hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ color: '#FB71A7', border: '1px dashed rgba(251, 113, 167, 0.4)' }}
          >
            {loading ? <><LoadingIcon size={13} /> 加载中...</> : `加载更多（${invites.length}/${total}）`}
          </button>
        )}
      </div>

      {/* 表单弹窗 */}
      {formOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }} {...formMask}>
          <div className="rounded-2xl w-[400px] max-w-[90vw] p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', boxShadow: 'var(--shadow-popup)' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>{editing ? '编辑邀请码' : '生成邀请码'}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">邀请码（留空自动生成）</Label>
                <Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="如：welcome2026" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">可用次数</Label>
                <Input type="number" min={1} value={form.max_uses} onChange={e => setForm({ ...form, max_uses: e.target.value })} placeholder="1" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <DatePicker
                  label="有效时间（留空永不过期）"
                  value={form.expires_at}
                  onChange={v => setForm({ ...form, expires_at: v })}
                  placeholder="选择日期"
                />
              </div>
              {formError && <p className="text-xs" style={{ color: 'var(--accent-coral)' }}>{formError}</p>}
              <div className="flex gap-2 pt-1">
                <Button type="submit" loading={saving} className="flex-1" style={{ background: '#FB71A7', color: 'white' }}>
                  {editing ? '保存修改' : '创建邀请码'}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>取消</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }} {...confirmMask}>
          <div className="rounded-2xl w-[360px] max-w-[90vw] p-6 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', boxShadow: 'var(--shadow-popup)' }} onClick={e => e.stopPropagation()}>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              确定删除邀请码「{confirmDelete.code}」吗？
            </p>
            <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
              删除后该邀请码无法再用于注册
            </p>
            <div className="flex gap-2 mt-4">
              <Button onClick={() => void handleDelete(confirmDelete)} loading={deletingInviteId === confirmDelete.id} className="flex-1" style={{ background: 'var(--accent-coral)', color: 'white' }}>删除</Button>
              <Button variant="secondary" onClick={() => setConfirmDelete(null)} className="flex-1">取消</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ── 公共通知管理 ─────────────────────────────────────────── */

interface AnnouncementForm {
  title: string
  body: string
  published_at: string
  expires_at: string
  is_published: boolean
}

function AnnouncementLoadingSkeleton() {
  return (
    <div className="space-y-2" aria-label="公共通知加载中">
      {[0, 1, 2].map(index => (
        <div key={index} className="rounded-xl border p-3" style={{ background: 'var(--bg-card-warm)', borderColor: 'var(--border-line)' }}>
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-12" />
          </div>
          <Skeleton className="mt-3 h-2.5 w-11/12" />
          <Skeleton className="mt-2 h-2.5 w-3/5" />
          <Skeleton className="mt-3 h-2 w-1/3" />
        </div>
      ))}
    </div>
  )
}

function AnnouncementManageTab() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [form, setForm] = useState<AnnouncementForm>({ title: '', body: '', published_at: '', expires_at: '', is_published: true })
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deletingAnnouncementId, setDeletingAnnouncementId] = useState<number | null>(null)
  const initialLoadRef = useRef(false)
  const loadingAnnouncementsRef = useRef(false)

  const loadAnnouncements = async () => {
    if (loadingAnnouncementsRef.current) return
    loadingAnnouncementsRef.current = true
    setLoading(true)
    try {
      const response = await api.adminListAnnouncements({ page: '1', size: '50' })
      setAnnouncements(response.items)
    } catch (err: any) {
      useToastStore.getState().addToast('error', err.message || '加载公共通知失败')
    } finally {
      setLoading(false)
      loadingAnnouncementsRef.current = false
    }
  }

  useEffect(() => {
    if (initialLoadRef.current) return
    initialLoadRef.current = true
    void loadAnnouncements()
  }, [])

  const openAdd = () => {
    setEditing(null)
    setForm({ title: '', body: '', published_at: '', expires_at: '', is_published: true })
    setFormError('')
    setFormOpen(true)
  }

  const openEdit = (announcement: Announcement) => {
    setEditing(announcement)
    setForm({
      title: announcement.title,
      body: announcement.body,
      published_at: toLocalDateTimeInput(announcement.published_at),
      expires_at: announcement.expires_at ? announcement.expires_at.slice(0, 10) : '',
      is_published: announcement.is_published,
    })
    setFormError('')
    setFormOpen(true)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (!form.title.trim() || !form.body.trim()) {
      setFormError('标题和正文不能为空')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const publishedAt = form.published_at ? toUtcISOString(form.published_at) : null
      if (editing) {
        await api.adminUpdateAnnouncement(editing.id, {
          title: form.title.trim(),
          body: form.body,
          is_published: form.is_published,
          published_at: publishedAt,
          expires_at: form.expires_at || null,
        })
        useToastStore.getState().addToast('success', '公共通知已更新')
      } else {
        await api.adminCreateAnnouncement({
          title: form.title.trim(),
          body: form.body,
          is_published: form.is_published,
          ...(publishedAt ? { published_at: publishedAt } : {}),
          ...(form.expires_at ? { expires_at: form.expires_at } : {}),
        })
        useToastStore.getState().addToast('success', '公共通知已创建')
      }
      setFormOpen(false)
      await loadAnnouncements()
    } catch (err: any) {
      setFormError(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (announcement: Announcement) => {
    if (deletingAnnouncementId !== null) return
    setDeletingAnnouncementId(announcement.id)
    try {
      await api.adminDeleteAnnouncement(announcement.id)
      useToastStore.getState().addToast('success', '公共通知已删除')
      await loadAnnouncements()
    } catch (err: any) {
      useToastStore.getState().addToast('error', err.message || '删除失败')
    } finally {
      setDeletingAnnouncementId(null)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between px-6 pt-3">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>公共通知会展示给所有访客，正文仅支持纯文本。</p>
        <Button onClick={openAdd} size="sm" style={{ background: '#FB71A7', color: 'white' }}><Plus size={13} /> 新建通知</Button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-6 py-3">
        {loading ? (
          <AnnouncementLoadingSkeleton />
        ) : announcements.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>还没有公共通知</p>
        ) : announcements.map(announcement => (
          <div key={announcement.id} className="rounded-xl p-3" style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)' }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{announcement.title}</p>
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px]" style={{ color: announcement.is_published ? '#00B894' : 'var(--text-muted)', background: announcement.is_published ? 'rgba(0,184,148,0.1)' : 'var(--bg-card)' }}>
                    {announcement.is_published ? '已发布' : '已撤回'}
                  </span>
                </div>
                <p className="mt-1 min-w-0 whitespace-pre-line break-words text-xs" style={{ color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{announcement.body}</p>
                <p className="mt-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {formatAnnouncementTime(announcement)}{announcement.expires_at ? ` · ${formatDate(announcement.expires_at)} 过期` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => openEdit(announcement)} className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ color: 'var(--text-muted)', background: 'var(--bg-card)', border: '1px solid var(--border-line)' }} title="编辑"><Pencil size={13} /></button>
                <button type="button" onClick={() => void handleDelete(announcement)} disabled={deletingAnnouncementId === announcement.id} aria-busy={deletingAnnouncementId === announcement.id || undefined} className="flex h-7 w-7 items-center justify-center rounded-lg disabled:cursor-not-allowed disabled:opacity-50" style={{ color: 'var(--accent-coral)', background: 'var(--bg-card)', border: '1px solid var(--border-line)' }} title="删除">{deletingAnnouncementId === announcement.id ? <LoadingIcon size={13} /> : <Trash2 size={13} />}</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="w-[500px] max-w-[92vw] rounded-2xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', boxShadow: 'var(--shadow-popup)' }} onClick={event => event.stopPropagation()}>
            <h3 className="mb-4 text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{editing ? '编辑公共通知' : '新建公共通知'}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5"><Label className="text-xs">标题</Label><Input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} className="h-9 text-sm" placeholder="例如：MoreAni v2.1 已上线" /></div>
              <div className="space-y-1.5"><Label className="text-xs">正文</Label><Textarea value={form.body} onChange={event => setForm({ ...form, body: event.target.value })} rows={6} className="resize-none text-sm" placeholder="支持纯文本和换行" /></div>
              <DateTimePicker label="发布时间（可选，使用本地时间）" value={form.published_at} onChange={value => setForm({ ...form, published_at: value })} placeholder="留空立即发布" />
              <div className="space-y-1.5"><DatePicker label="过期时间（可选）" value={form.expires_at} onChange={value => setForm({ ...form, expires_at: value })} placeholder="选择日期" /></div>
              <label className="flex cursor-pointer items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <Checkbox checked={form.is_published} onCheckedChange={checked => setForm({ ...form, is_published: checked })} aria-label="立即发布" />
                <span>立即发布</span>
              </label>
              {formError && <p className="text-xs" style={{ color: 'var(--accent-coral)' }}>{formError}</p>}
              <div className="flex gap-2 pt-1"><Button type="submit" loading={saving} className="flex-1" style={{ background: '#FB71A7', color: 'white' }}>{editing ? '保存修改' : '创建通知'}</Button><Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>取消</Button></div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
