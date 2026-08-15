import { type InputHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, ...props }, ref) => (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-ink mb-1.5">{label}</label>
      )}
      <input
        ref={ref}
        className={cn(
          'flex h-10 w-full rounded-lg border border-black/[0.08] bg-white px-3.5 py-2',
          'text-sm text-ink placeholder:text-muted/50',
          'transition-all duration-200',
          'focus:outline-none focus:border-brand/40 focus:ring-1 focus:ring-brand/10',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          error && 'border-accent-coral focus:border-accent-coral',
          className
        )}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-accent-coral">{error}</p>}
    </div>
  )
)
Input.displayName = 'Input'
