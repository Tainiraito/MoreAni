import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white border border-brand hover:bg-brand-deep hover:shadow-md active:scale-[0.98]',
  secondary: 'bg-ink text-white border border-ink hover:bg-slate active:scale-[0.98]',
  outline: 'bg-white text-ink border border-black/[0.12] hover:bg-paper/60 active:scale-[0.98]',
  ghost: 'bg-transparent text-ink border border-transparent hover:bg-paper/60 active:scale-[0.98]',
  danger: 'bg-accent-coral text-white border border-accent-coral hover:opacity-90 active:scale-[0.98]',
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs font-medium rounded-lg',
  md: 'h-10 px-4 text-sm font-medium rounded-lg',
  lg: 'h-11 px-6 text-base font-medium rounded-lg',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-medium transition-all duration-200 select-none shadow-sm',
        variantStyles[variant],
        sizeStyles[size],
        (disabled || loading) && 'opacity-50 cursor-not-allowed',
        className
      )}
      {...props}
    >
      {loading ? (
        <span className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
      ) : children}
    </button>
  )
)
Button.displayName = 'Button'
