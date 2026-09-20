import type { RedBlueStability } from '@/types/red-blue'

const LABELS: Record<string, string> = {
  UNCALIBRATED: '未校准',
  CALIBRATING: '校准中',
  RELATIVELY_STABLE: '较稳定',
  STABLE: '稳定',
}

const COLORS: Record<string, string> = {
  UNCALIBRATED: 'var(--text-muted)',
  CALIBRATING: 'var(--accent-purple)',
  RELATIVELY_STABLE: 'var(--battle-blue-text)',
  STABLE: '#47b88a',
}

interface StabilityBadgeProps {
  stability: RedBlueStability | string
}

export function StabilityBadge({ stability }: StabilityBadgeProps) {
  const color = COLORS[stability] ?? 'var(--text-muted)'
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium whitespace-nowrap"
      style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
      {LABELS[stability] ?? '状态待确认'}
    </span>
  )
}
