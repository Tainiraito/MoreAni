import { cn } from '@/lib/utils'

interface ScoreBadgeProps {
  score: number | null | undefined
  size?: 'sm' | 'md' | 'lg'
}

const SIZE_CLASS: Record<string, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-lg',
}

/** 分数徽章（v2 主题：品牌粉 + 主题变量，不依赖 v1 遗留样式类） */
export function ScoreBadge({ score, size = 'md' }: ScoreBadgeProps) {
  const display = score && score > 0 ? (score / 10).toFixed(1) : null

  if (!display) {
    return (
      <span
        className={cn('inline-flex items-center font-medium', SIZE_CLASS[size])}
        style={{ color: 'var(--text-muted)' }}
      >
        未评分
      </span>
    )
  }

  return (
    <span
      className={cn('inline-flex items-center gap-0.5 font-semibold', SIZE_CLASS[size])}
      style={{ color: 'var(--brand)' }}
    >
      <span className="text-[0.7em]">★</span>
      {display}
      <span className="text-[0.6em]" style={{ color: 'var(--text-muted)' }}>/10</span>
    </span>
  )
}
