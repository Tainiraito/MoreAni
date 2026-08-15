import { useState } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function AuthDialog() {
  const { authOpen, closeAuth } = useUIStore()
  const { setUser, setToken } = useAuthStore()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!authOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        const res = await api.login({ username, password })
        setUser(res.user as any)
        if (res.token) setToken(res.token)
      } else {
        const res = await api.register({ code, username, password })
        setUser(res.user as any)
        if (res.token) setToken(res.token)
      }
      closeAuth()
      resetForm()
    } catch (err: any) {
      setError(err.message || '操作失败')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setUsername('')
    setPassword('')
    setCode('')
    setError('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
         onClick={closeAuth}>
      <div
        className="rounded-2xl w-[420px] max-w-[90vw] p-8"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-line)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.15)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Tabs */}
        <div className="flex rounded-xl overflow-hidden mb-7" style={{ border: '1px solid var(--border-line)' }}>
          <button
            className={`flex-1 py-2.5 text-sm font-medium transition-all duration-200 ${
              mode === 'login' ? 'text-white' : 'hover:opacity-80'
            }`}
            style={mode === 'login' ? { background: 'var(--btn-primary-bg)' } : { color: 'var(--text-muted)', background: 'var(--bg-card-warm)' }}
            onClick={() => { setMode('login'); resetForm() }}
          >
            登录
          </button>
          <button
            className={`flex-1 py-2.5 text-sm font-medium transition-all duration-200 ${
              mode === 'register' ? 'text-white' : 'hover:opacity-80'
            }`}
            style={mode === 'register' ? { background: 'var(--btn-primary-bg)' } : { color: 'var(--text-muted)', background: 'var(--bg-card-warm)', borderLeft: '1px solid var(--border-line)' }}
            onClick={() => { setMode('register'); resetForm() }}
          >
            注册
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>邀请码</Label>
              <Input value={code} onChange={e => setCode(e.target.value)} placeholder="请输入邀请码" required />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>用户名</Label>
            <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="请输入用户名" required />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>密码</Label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入密码" required />
          </div>
          {error && <p className="text-sm text-accent-coral">{error}</p>}
          <Button type="submit" loading={loading} className="w-full">
            {mode === 'login' ? '登录' : '注册'}
          </Button>
        </form>
      </div>
    </div>
  )
}
