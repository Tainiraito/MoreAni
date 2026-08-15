import { useState } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function AuthDialog() {
  const { authOpen, closeAuth } = useUIStore()
  const { setUser } = useAuthStore()
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
      } else {
        const res = await api.register({ code, username, password })
        setUser(res.user as any)
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
          boxShadow: '0 8px 40px rgba(0,0,0,0.5), 0 0 20px rgba(255, 140, 212, 0.1)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Tabs */}
        <div className="flex rounded-xl overflow-hidden mb-7" style={{ border: '1px solid var(--border-line)' }}>
          <button
            className={`flex-1 py-2.5 text-sm font-medium transition-all duration-200 ${
              mode === 'login'
                ? 'bg-brand text-white'
                : 'hover:opacity-80'
            }`}
            style={mode !== 'login' ? { color: 'var(--text-muted)', background: 'var(--bg-card-warm)' } : {}}
            onClick={() => { setMode('login'); resetForm() }}
          >
            登录
          </button>
          <button
            className={`flex-1 py-2.5 text-sm font-medium transition-all duration-200 ${
              mode === 'register'
                ? 'bg-brand text-white'
                : 'hover:opacity-80'
            }`}
            style={mode !== 'register' ? { color: 'var(--text-muted)', background: 'var(--bg-card-warm)', borderLeft: '1px solid var(--border-line)' } : { borderLeft: '1px solid var(--border-line)' }}
            onClick={() => { setMode('register'); resetForm() }}
          >
            注册
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <Input
              label="邀请码"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="请输入邀请码"
              required
            />
          )}
          <Input
            label="用户名"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="请输入用户名"
            required
          />
          <Input
            label="密码"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="请输入密码"
            required
          />

          {error && (
            <p className="text-sm text-accent-coral">{error}</p>
          )}

          <Button type="submit" loading={loading} className="w-full">
            {mode === 'login' ? '登录' : '注册'}
          </Button>
        </form>
      </div>
    </div>
  )
}
