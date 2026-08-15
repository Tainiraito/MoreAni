import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import type { ContentType } from '@/types'

const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-md font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-surface text-primary border border-border',
        brand: 'bg-brand/10 text-brand border border-brand/20',
        outline: 'bg-transparent text-muted border border-border',
        ghost: 'bg-transparent text-muted border border-transparent',
      },
      size: {
        sm: 'px-1.5 py-0.5 text-[10px]',
        md: 'px-2 py-0.5 text-[11px]',
        lg: 'px-2.5 py-1 text-xs',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
)

interface BadgeProps extends VariantProps<typeof badgeVariants> {
  className?: string
  children: React.ReactNode
}

export function Badge({ variant, size, className, children }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)}>
      {children}
    </span>
  )
}

const typeColors: Record<string, string> = {
  anime: 'bg-type-anime/10 text-type-anime border border-type-anime/20',
  movie: 'bg-type-movie/10 text-type-movie border border-type-movie/20',
  game: 'bg-type-game/10 text-type-game border border-type-game/20',
  software: 'bg-type-software/10 text-type-software border border-type-software/20',
  website: 'bg-type-website/10 text-type-website border border-type-website/20',
  book: 'bg-type-book/10 text-type-book border border-type-book/20',
}

interface TypeBadgeProps {
  type: ContentType | string
  className?: string
}

export function TypeBadge({ type, className }: TypeBadgeProps) {
  const labels: Record<string, string> = {
    anime: '番剧',
    movie: '电影',
    game: '游戏',
    software: '软件',
    website: '网站',
    book: '书籍',
  }

  return (
    <span className={cn('inline-block px-2 py-0.5 text-[11px] font-medium rounded-md', typeColors[type] || 'bg-surface text-slate', className)}>
      {labels[type] || type}
    </span>
  )
}
