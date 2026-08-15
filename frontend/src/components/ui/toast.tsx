import { useToastStore, type ToastType } from '@/stores/toast-store'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'

const iconMap: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
}

const colorMap: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: 'var(--bg-card)', border: '#22c55e', icon: '#22c55e' },
  error: { bg: 'var(--bg-card)', border: '#ef4444', icon: '#ef4444' },
  info: { bg: 'var(--bg-card)', border: 'var(--brand)', icon: 'var(--brand)' },
  warning: { bg: 'var(--bg-card)', border: '#f59e0b', icon: '#f59e0b' },
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore()

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => {
        const Icon = iconMap[toast.type]
        const colors = colorMap[toast.type]

        return (
          <div
            key={toast.id}
            className="flex items-start gap-3 p-4 rounded-lg shadow-lg animate-slide-in-right"
            style={{
              background: colors.bg,
              border: `1px solid ${colors.border}`,
            }}
          >
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
