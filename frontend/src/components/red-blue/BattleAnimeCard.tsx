import { Info } from 'lucide-react'

import { CoverImage } from '@/components/ui/CoverImage'
import type { RedBlueContentSummary } from '@/types/red-blue'

interface BattleAnimeCardProps {
  content: RedBlueContentSummary
  side: 'red' | 'blue'
  onOpen: () => void
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
  anime: '番剧',
  anime_movie: '动画电影',
}

export function BattleAnimeCard({ content, side, onOpen }: BattleAnimeCardProps) {
  const accent = side === 'red' ? 'var(--battle-red)' : 'var(--battle-blue)'
  const surface = side === 'red' ? 'var(--battle-red-soft)' : 'var(--battle-blue-soft)'

  return (
    <article
      className="min-w-0 rounded-2xl p-3 transition-transform duration-200 hover:-translate-y-0.5 sm:p-4 lg:flex lg:items-center lg:justify-center lg:gap-5"
      style={{
        background: `linear-gradient(145deg, ${surface}, var(--bg-card) 62%)`,
        border: `1px solid ${accent}`,
        boxShadow: `0 12px 36px color-mix(in srgb, ${accent} 8%, transparent)`,
      }}
      data-testid={`battle-card-${side}`}
      data-content-id={content.content_id}
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl lg:h-64 lg:w-48 lg:shrink-0 lg:aspect-auto" style={{ background: 'var(--bg-card-warm)' }}>
        <CoverImage src={content.cover_url ?? ''} alt={content.title} loading="eager" />
        <span
          className="absolute left-2 top-2 rounded-full px-2 py-1 text-[11px] font-semibold tracking-[0.12em]"
          style={{ background: 'color-mix(in srgb, var(--bg-card) 84%, transparent)', color: accent }}
        >
          {side === 'red' ? '红方' : '蓝方'}
        </span>
      </div>
      <div className="mt-3 min-w-0 lg:mt-0 lg:w-44 lg:shrink-0">
        <h3 className="line-clamp-3 text-sm font-semibold sm:text-base" style={{ color: 'var(--text-primary)' }} title={content.title}>
          {content.title}
        </h3>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-xs" style={{ color: accent }}>
            {CONTENT_TYPE_LABELS[content.content_type] ?? '动画作品'}
          </span>
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-[rgba(251,113,167,0.08)]"
            style={{ color: 'var(--text-muted)' }}
            aria-label={`查看《${content.title}》详情`}
          >
            <Info size={13} />
            详情
          </button>
        </div>
      </div>
    </article>
  )
}
