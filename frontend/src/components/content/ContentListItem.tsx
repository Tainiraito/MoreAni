import type { ContentItem } from '@/types'

const TYPE_LABELS: Record<string, string> = {
  anime: '番剧', movie: '电影', game: '游戏', software: '软件', website: '网站', book: '书籍',
}

interface ContentListItemProps {
  content: ContentItem
  onSelect: (id: number) => void
}

export function ContentListItem({ content, onSelect }: ContentListItemProps) {
  const avgScore = content.avg_score && content.avg_score > 0
    ? (content.avg_score / 10).toFixed(1)
    : null

  const meta = [
    content.episodes > 0 ? `${content.episodes}集` : null,
    content.platform || null,
    avgScore ? `★ ${avgScore}` : null,
  ].filter(Boolean)

  return (
    <li
      className="group transition-colors duration-150"
      style={{ borderBottom: '1px solid var(--border-line)' }}
    >
      <button
        type="button"
        onClick={() => onSelect(content.id)}
        className="grid w-full min-h-[4.75rem] grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-1 py-4 text-left sm:grid-cols-[9.5rem_minmax(0,1fr)_9rem] sm:items-center sm:gap-x-5 sm:px-2 sm:py-[1.125rem] hover:opacity-80 transition-opacity"
      >
        {/* Name + tags */}
        <div className="min-w-0">
          <h3
            className="text-lg font-semibold leading-tight sm:text-xl group-hover:text-brand transition-colors"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
          >
            {content.title}
          </h3>
          <p
            className="mt-1 truncate text-xs tracking-[0.04em]"
            style={{ color: 'var(--text-muted)' }}
          >
            {TYPE_LABELS[content.content_type] || content.content_type}
            {content.title_alt ? ` · ${content.title_alt}` : ''}
          </p>
        </div>

        {/* Description */}
        <p
          className="col-span-2 min-w-0 text-[0.78rem] leading-relaxed sm:col-span-1 sm:line-clamp-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          {content.description || '暂无描述'}
        </p>

        {/* Meta */}
        <div className="col-start-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 sm:col-start-auto sm:flex-nowrap sm:justify-end">
          {meta.length > 0 && (
            <span
              className="whitespace-nowrap text-xs leading-[1.125rem] tracking-[0.04em]"
              style={{ color: 'var(--text-muted)' }}
            >
              {meta.join(' · ')}
            </span>
          )}
        </div>
      </button>
    </li>
  )
}
