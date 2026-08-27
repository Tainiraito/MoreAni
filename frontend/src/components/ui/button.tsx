import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button-variants'
import { LoadingIcon } from '@/components/ui/loading-icon'

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
}

export function Button({
  variant,
  size,
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const dynamicStyles: Record<string, React.CSSProperties> = {
    primary: {
      background: 'var(--btn-primary-bg)',
      color: 'var(--btn-primary-text)',
    },
    secondary: {
      background: 'var(--btn-secondary-bg)',
      color: 'var(--btn-secondary-text)',
      borderColor: 'var(--btn-secondary-border)',
    },
    outline: {
      background: 'transparent',
      color: 'var(--text-primary)',
      borderColor: 'var(--border-line)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-primary)',
    },
    danger: {},
  }

  return (
    <button
      className={cn(
        buttonVariants({ variant, size }),
        (disabled || loading) && 'opacity-50 cursor-not-allowed',
        className
      )}
      style={dynamicStyles[variant || 'primary']}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <LoadingIcon size={16} className="mr-2" /> : null}
      {children}
    </button>
  )
}
