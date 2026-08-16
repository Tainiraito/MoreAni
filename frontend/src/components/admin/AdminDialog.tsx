import { useEffect, useState } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useToastStore } from '@/stores/toast-store'
import { useLockBodyScroll } from '@/hooks/use-lock-body-scroll'
import { api } from '@/lib/api'
import { Avatar } from '@/components/ui/Avatar'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { X, Search, Plus, Pencil, Trash2, Shield } from 'lucide-react'
import type { User } from '@/types'

const ROLE_LABEL: Record<string, string> = { user: '成员', admin: '管理员', super_admin: '超级管理员' }
const ROLE_COLOR: Record<string, string> = { user: '#4DA6FF', admin: '#FB71A7', super_admin: '#C77DFF' }

interface AdminUserForm {
  username: string
  nickname: string
  password: string
  role: string
}

export function AdminDialog() {
  const { adminOpen, closeAdmin } = useUIStore()
  useLockBodyScroll(adminOpen)
  const [users, setUsers] = useState<User[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null)
  const [form, setForm] = useState<AdminUserForm>({ username: '', nickname: '', password: '', role: 'user' })
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const PAGE_SIZE = 15

  const loadUsers = async (p = 1, search = q) => {
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
    }
  }

  useEffect(() => {
    if (adminOpen) {
      setUsers([])
      setPage(1)
      setQ('')
      loadUsers(1, '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminOpen])

  if (!adminOpen) return null

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
    try {
      await api.adminDeleteUser(u.id)
      useToastStore.getState().addToast('success', `已删除 ${u.nickname}`)
      setConfirmDelete(null)
      loadUsers(1, q)
    } catch (err: any) {
      setConfirmDelete(null)
      useToastStore.getState().addToast('error', err.message || '删除失败')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }} onClick={closeAdmin}>
      <div
        className="rounded-2xl w-[720px] max-w-[95vw] max-h-[85vh] flex flex-col"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', boxShadow: 'var(--shadow-popup)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4" style={{ borderBottom: '1px solid var(--border-line)' }}>
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Shield size={16} style={{ color: '#FB71A7' }} /> 后台管理 · 用户
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>共 {total} 个用户（超级管理员专属）</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={openAdd} size="sm" style={{ background: '#FB71A7', color: 'white' }}>
              <Plus size={13} /> 新增用户
            </Button>
            <button onClick={closeAdmin} className="w-7 h-7 flex items-center justify-center rounded-lg hover:opacity-80" style={{ color: 'var(--text-muted)', background: 'var(--bg-card-warm)' }}>
              <X size={14} />
            </button>
          </div>
        </div>

        {/* 搜索 */}
        <div className="px-6 pt-3">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <Input
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') loadUsers(1, q) }}
              placeholder="搜索账号 / 昵称…"
              className="pl-9 h-9 text-sm"
            />
          </div>
        </div>

        {/* 用户列表 */}
        <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1.5">
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
                <Avatar name={u.nickname} size={32} />
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
                    className="w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-150 hover:opacity-80"
                    style={{ color: 'var(--text-muted)', background: 'var(--bg-card)' }}
                    title="编辑"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(u)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-150 hover:opacity-80"
                    style={{ color: 'var(--accent-coral)', background: 'var(--bg-card)' }}
                    title="删除"
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
              className="w-full py-2 text-xs rounded-lg transition-all duration-150 hover:opacity-80"
              style={{ color: '#FB71A7', border: '1px dashed rgba(251, 113, 167, 0.4)' }}
            >
              {loading ? '加载中...' : `加载更多（${users.length}/${total}）`}
            </button>
          )}
        </div>

        {/* 新增/编辑表单弹窗 */}
        {formOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setFormOpen(false)}>
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
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setConfirmDelete(null)}>
            <div className="rounded-2xl w-[360px] max-w-[90vw] p-6 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)', boxShadow: 'var(--shadow-popup)' }} onClick={e => e.stopPropagation()}>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                确定删除用户「{confirmDelete.nickname}」吗？
              </p>
              <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
                将同时删除其全部评分、评论和收藏，且不可恢复
              </p>
              <div className="flex gap-2 mt-4">
                <Button onClick={() => handleDelete(confirmDelete)} className="flex-1" style={{ background: 'var(--accent-coral)', color: 'white' }}>删除</Button>
                <Button variant="secondary" onClick={() => setConfirmDelete(null)} className="flex-1">取消</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
