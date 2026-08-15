import { cn } from '@/lib/utils'

type BadgeVariant = 'default' | 'brand' | 'outline' | 'ghost'

interface BadgeProps {
  variant?: BadgeVariant
  className?: string
  children: React.ReactNode
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-paper text-ink border border-black/[0.06]',
  brand: 'bg-brand/10 text-brand border border-brand/20',
  outline: 'bg-transparent text-muted border border-black/[0.08]',
  ghost: 'bg-transparent text-muted border border-transparent',
}

export function Badge({ variant = 'default', className, children }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md',
      variantStyles[variant],
      className
    )}>
      {children}
    </span>
  )
}

// Content type badge with color
const typeColors: Record<string, string> = {
  anime: 'bg-accent-purple/10 text-accent-purple',
  movie: 'bg-type-movie/10 text-type-movie',
  game: 'bg-type-game/10 text-type-game',
  software: 'bg-type-software/10 text-type-software',
  website: 'bg-type-website/10 text-type-website',
  book: 'bg-type-book/10 text-type-book',
}

const typeLabels: Record<string, string> = {
  anime: '番剧',
  movie: '电影',
  game: '游戏',
  software: '软件',
  website: '网站',
  book: '书籍',
}

export function TypeBadge({ type }: { type: string }) {
  return (
    <span className={cn('inline-block px-2 py-0.5 text-[11px] font-medium rounded-md', typeColors[type] || 'bg-paper text-slate')}>
      {typeLabels[type] || type}
    </span>
  )
}
