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
  const description = content.description?.trim() || '暂无简介'

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative block min-w-0 w-full cursor-pointer rounded-2xl p-3 text-left transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] sm:p-4 lg:flex lg:items-center lg:justify-center lg:gap-5"
      style={{
        background: `linear-gradient(145deg, ${surface}, var(--bg-card) 62%)`,
        border: `1px solid ${accent}`,
        boxShadow: `0 12px 36px color-mix(in srgb, ${accent} 8%, transparent)`,
      }}
      data-testid={`battle-card-${side}`}
      data-content-id={content.content_id}
      aria-label={`查看《${content.title}》详情`}
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl lg:h-64 lg:w-48 lg:shrink-0 lg:aspect-auto" style={{ background: 'var(--bg-card-warm)' }}>
        <CoverImage src={content.cover_url ?? ''} alt={content.title} loading="eager" />
      </div>
      <div className="mt-3 min-w-0 lg:mt-0 lg:w-44 lg:shrink-0">
        <h3 className="line-clamp-3 text-sm font-semibold sm:text-base" style={{ color: 'var(--text-primary)' }} title={content.title}>
          {content.title}
        </h3>
        <p className="mt-2 min-h-[3.75rem] line-clamp-3 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
          {description}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs" style={{ color: accent }}>
            {CONTENT_TYPE_LABELS[content.content_type] ?? '动画作品'}
          </span>
        </div>
      </div>
    </button>
  )
}
