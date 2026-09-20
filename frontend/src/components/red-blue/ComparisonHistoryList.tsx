import { LoaderCircle, RotateCcw, Swords } from 'lucide-react'

import { RedBluePagination } from '@/components/red-blue/RedBluePagination'
import type { RedBlueComparisonHistoryItem } from '@/types/red-blue'

interface ComparisonHistoryListProps {
  history: RedBlueComparisonHistoryItem[]
  loading?: boolean
  error?: boolean
  onRetry?: () => void
  pendingId: number | null
  onRevoke: (item: RedBlueComparisonHistoryItem) => void
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

function resultClass(outcome: RedBlueComparisonHistoryItem['outcome'], side: 'left' | 'right'): string {
  const winner = (side === 'left' && outcome === 'LEFT_WIN') || (side === 'right' && outcome === 'RIGHT_WIN')
  return winner ? 'font-bold' : 'font-normal'
}

function resultStyle(outcome: RedBlueComparisonHistoryItem['outcome'], side: 'left' | 'right'): { color: string } {
  if ((side === 'left' && outcome === 'LEFT_WIN') || (side === 'right' && outcome === 'RIGHT_WIN')) {
    return { color: side === 'left' ? 'var(--battle-red-text)' : 'var(--battle-blue-text)' }
  }
  return { color: 'var(--text-muted)' }
}

/** 展示可持续查看、可逐条撤销的 PK 历史。 */
export function ComparisonHistoryList({ history, loading = false, error = false, onRetry, pendingId, onRevoke, page, pageSize, total, onPageChange }: ComparisonHistoryListProps) {
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
            <p className="mt-3 text-sm">{total === 0 ? '还没有 PK 历史记录。' : '当前页暂无 PK 历史记录。'}</p>
            <p className="mt-1 text-xs">{total === 0 ? '完成一次选择后，记录会一直保留在这里。' : '请切换页码查看其他记录。'}</p>
          </div>
        ) : (
          <ol>
            {history.map(item => (
              <li
                key={item.id}
                className="flex h-10 items-center gap-2 border-b px-4 last:border-b-0 sm:px-5"
                style={{ borderColor: 'var(--border-line)' }}
                data-testid={`comparison-history-item-${item.id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-2 truncate text-sm" data-testid={`comparison-history-result-${item.id}`}>
                    <span className={`min-w-0 truncate ${resultClass(item.outcome, 'left')}`} style={resultStyle(item.outcome, 'left')}>《{item.left_content.title}》</span>
                    <span className="shrink-0 text-xs font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>VS</span>
                    <span className={`min-w-0 truncate ${resultClass(item.outcome, 'right')}`} style={resultStyle(item.outcome, 'right')}>《{item.right_content.title}》</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRevoke(item)}
                  disabled={pendingId !== null}
                  className="inline-flex h-7 min-h-7 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors hover:bg-[rgba(251,113,167,0.08)] disabled:opacity-50"
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
      <RedBluePagination
        page={page}
        size={pageSize}
        total={total}
        itemLabel="条记录"
        ariaLabel="PK 历史分页"
        onPageChange={onPageChange}
      />
    </section>
  )
}
