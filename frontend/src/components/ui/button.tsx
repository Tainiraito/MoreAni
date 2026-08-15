import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'inline-flex items-center justify-center font-semibold transition-all duration-150 select-none rounded-lg',
  {
    variants: {
      variant: {
        primary: 'text-white',
        secondary: 'border',
        outline: 'border hover:opacity-80',
        ghost: 'hover:opacity-80',
        danger: 'bg-accent-coral text-white hover:opacity-90',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-11 px-6 text-base',
        icon: 'h-10 w-10',
        'icon-sm': 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
)

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
      {...props}
    >
      {loading ? (
        <span className="mr-2 animate-spin">⏳</span>
      ) : null}
      {children}
    </button>
  )
}
