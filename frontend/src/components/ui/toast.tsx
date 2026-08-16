import { useToastStore, type ToastType } from '@/stores/toast-store'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'

const iconMap: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
}

const colorMap: Record<ToastType, { border: string; icon: string; glow: string }> = {
  success: { border: '#22c55e', icon: '#22c55e', glow: 'rgba(34,197,94,0.16)' },
  error: { border: '#ef4444', icon: '#ef4444', glow: 'rgba(239,68,68,0.16)' },
  info: { border: 'var(--brand)', icon: 'var(--brand)', glow: 'rgba(251,113,167,0.18)' },
  warning: { border: '#f59e0b', icon: '#f59e0b', glow: 'rgba(245,158,11,0.16)' },
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore()

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col items-end gap-2 max-w-[320px] pointer-events-none">
      {toasts.map((toast) => {
        const Icon = iconMap[toast.type]
        const colors = colorMap[toast.type]

        return (
          <div
            key={toast.id}
            className="pointer-events-auto relative flex items-start gap-3 pl-5 pr-3 py-3.5 rounded-xl backdrop-blur-md animate-slide-in-right overflow-hidden"
            style={{
              background: 'color-mix(in srgb, var(--bg-card) 88%, transparent)',
              border: '1px solid var(--border-line)',
              boxShadow: `0 8px 32px rgba(0,0,0,0.12), 0 2px 8px ${colors.glow}`,
            }}
          >
            {/* 左侧类型色条 */}
            <span
              className="absolute left-0 top-0 bottom-0 w-1"
              style={{ background: colors.border }}
            />
            <Icon size={18} style={{ color: colors.icon, flexShrink: 0, marginTop: 1 }} />
            <p className="flex-1 text-sm" style={{ color: 'var(--text-primary)' }}>
              {toast.message}
            </p>
            <button
              onClick={() => removeToast(toast.id)}
              className="flex-shrink-0 hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-muted)' }}
            >
              <X size={16} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
