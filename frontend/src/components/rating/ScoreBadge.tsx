import { cn } from '@/lib/utils'

interface ScoreBadgeProps {
  score: number | null | undefined
  size?: 'sm' | 'md' | 'lg'
}

export function ScoreBadge({ score, size = 'md' }: ScoreBadgeProps) {
  if (!score || score === 0) {
    return (
      <div className={cn(
        'inline-flex items-center justify-center bg-paper text-muted border border-black/[0.06] rounded-lg font-display font-semibold',
        size === 'sm' && 'px-2 py-0.5 text-xs',
        size === 'md' && 'px-2.5 py-1 text-sm',
        size === 'lg' && 'px-3.5 py-1.5 text-lg',
      )}>
        —
      </div>
    )
  }

  const display = (score / 10).toFixed(1)

  return (
    <div className={cn(
      'inline-flex items-center gap-1 bg-ink text-brand rounded-lg font-display font-bold',
      size === 'sm' && 'px-2 py-0.5 text-xs',
      size === 'md' && 'px-2.5 py-1 text-sm',
      size === 'lg' && 'px-3.5 py-1.5 text-lg',
    )}>
      <span>{display}</span>
      {size !== 'sm' && <span className="text-white/50 text-[10px] font-normal">/10</span>}
    </div>
  )
}
