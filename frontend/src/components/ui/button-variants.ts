import { cva } from 'class-variance-authority'

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
  },
)
