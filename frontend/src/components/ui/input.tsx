import { cn } from '@/lib/utils'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export function Input({ label, error, className, ...props }: InputProps) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {label}
        </label>
      )}
      <input
        className={cn(
          'w-full px-3 py-2 text-sm rounded-lg border transition-all duration-200',
          'focus:outline-none focus:ring-1',
          error
            ? 'border-accent-coral focus:border-accent-coral focus:ring-accent-coral/20'
            : 'focus:border-brand/40 focus:ring-brand/10',
          className
        )}
        style={{
          background: 'var(--bg-card)',
          color: 'var(--text-primary)',
          borderColor: error ? undefined : 'var(--border-line)',
        }}
        {...props}
      />
      {error && (
        <p className="text-xs text-accent-coral">{error}</p>
      )}
    </div>
  )
}
