import { useState } from 'react'
import { useUIStore } from '@/stores/ui-store'

export function AuthDialog() {
  const { authOpen, closeAuth } = useUIStore()
  const [mode, setMode] = useState<'login' | 'register'>('login')

  if (!authOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={closeAuth} />

      <div className="relative z-10 w-full max-w-md bg-white border-2 border-brand-dark">
        <div className="flex border-b-2 border-brand-dark">
          <button
            onClick={() => setMode('login')}
            className={`flex-1 py-3 text-sm font-bold transition-colors ${
              mode === 'login'
                ? 'bg-brand-dark text-white'
                : 'bg-white text-brand-dark hover:bg-gray-100'
            }`}
          >
            登录
          </button>
          <button
            onClick={() => setMode('register')}
            className={`flex-1 py-3 text-sm font-bold transition-colors ${
              mode === 'register'
                ? 'bg-brand-dark text-white'
                : 'bg-white text-brand-dark hover:bg-gray-100'
            }`}
          >
            注册
          </button>
        </div>

        <div className="p-6">
          <p className="text-gray-500">TODO: {mode === 'login' ? '登录' : '注册'}表单</p>
        </div>
      </div>
    </div>
  )
}
