import { Clock3, LoaderCircle, RotateCcw, Swords } from 'lucide-react'

import type { RedBlueComparisonHistoryItem } from '@/types/red-blue'

interface ComparisonHistoryListProps {
  history: RedBlueComparisonHistoryItem[]
  loading?: boolean
  error?: boolean
  onRetry?: () => void
  pendingId: number | null
  onRevoke: (item: RedBlueComparisonHistoryItem) => void
}

function comparisonMessage(item: RedBlueComparisonHistoryItem): string {
  if (item.outcome === 'LEFT_WIN') return `已记录：更喜欢《${item.left_content.title}》`
  if (item.outcome === 'RIGHT_WIN') return `已记录：更喜欢《${item.right_content.title}》`
  if (item.outcome === 'TIE') return '已记录：两部作品差不多'
  return '已记录：跳过这组作品'
}

function formatCreatedAt(createdAt: string | null): string {
  if (createdAt === null) return '刚刚'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(createdAt))
}

/** 展示可持续查看、可逐条撤销的 PK 历史。 */
export function ComparisonHistoryList({ history, loading = false, error = false, onRetry, pendingId, onRevoke }: ComparisonHistoryListProps) {
  return (
    <section aria-label="PK 历史" data-testid="red-blue-history">
      <div className="mt-4 overflow-hidden rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}>
        {loading ? (
          <div className="flex min-h-36 items-center justify-center px-5 text-sm" style={{ color: 'var(--text-muted)' }} data-testid="red-blue-history-loading">
            <LoaderCircle size={17} className="mr-2 animate-spin" /> 正在加载 PK 历史…
          </div>
        ) : error ? (
          <div className="flex min-h-36 flex-col items-center justify-center px-5 text-center" style={{ color: 'var(--text-muted)' }} data-testid="red-blue-history-error">
            <p className="text-sm">PK 历史暂时无法加载。</p>
            {onRetry && (
              <button type="button" onClick={onRetry} className="mt-3 text-xs font-semibold" style={{ color: 'var(--brand)' }}>
                重试
              </button>
            )}
          </div>
        ) : history.length === 0 ? (
          <div className="flex min-h-36 flex-col items-center justify-center px-5 text-center" style={{ color: 'var(--text-muted)' }} data-testid="red-blue-history-empty">
            <Swords size={22} style={{ color: 'var(--brand)' }} />
            <p className="mt-3 text-sm">还没有 PK 历史记录。</p>
            <p className="mt-1 text-xs">完成一次选择后，记录会一直保留在这里。</p>
          </div>
        ) : (
          <ol>
            {history.map(item => (
              <li
                key={item.id}
                className="flex flex-col gap-3 border-b px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                style={{ borderColor: 'var(--border-line)' }}
                data-testid={`comparison-history-item-${item.id}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{comparisonMessage(item)}</p>
                  <p className="mt-1 truncate text-xs" style={{ color: 'var(--text-secondary)' }}>
                    《{item.left_content.title}》 <span style={{ color: 'var(--text-muted)' }}>VS</span> 《{item.right_content.title}》
                  </p>
                  <p className="mt-2 inline-flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <Clock3 size={13} /> {formatCreatedAt(item.created_at)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRevoke(item)}
                  disabled={pendingId !== null}
                  className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 self-start rounded-lg px-3 text-xs font-semibold transition-colors hover:bg-[rgba(251,113,167,0.08)] disabled:opacity-50 sm:self-auto"
                  style={{ color: 'var(--accent-coral)', border: '1px solid color-mix(in srgb, var(--accent-coral) 35%, var(--border-line))' }}
                  aria-label={`撤销《${item.left_content.title}》与《${item.right_content.title}》这次 PK`}
                >
                  {pendingId === item.id && <LoaderCircle size={13} className="animate-spin" />}
                  <RotateCcw size={13} /> 撤销
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
