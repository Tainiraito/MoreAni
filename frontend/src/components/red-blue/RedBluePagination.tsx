import { ChevronLeft, ChevronRight } from 'lucide-react'

interface RedBluePaginationProps {
  page: number
  size: number
  total: number
  itemLabel: string
  ariaLabel: string
  onPageChange: (page: number) => void
}

/** 红蓝合战两个列表共用的分页控件。 */
export function RedBluePagination({ page, size, total, itemLabel, ariaLabel, onPageChange }: RedBluePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / size))
  if (totalPages <= 1 && total === 0) return null

  return (
    <nav className="flex flex-col gap-2 px-1 py-4 text-xs sm:flex-row sm:items-center sm:justify-between" aria-label={ariaLabel}>
      <p style={{ color: 'var(--text-muted)' }}>
        第 {Math.min(page, totalPages)} / {totalPages} 页 · 共 {total} {itemLabel}
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-line)' }}
          >
            <ChevronLeft size={14} aria-hidden="true" /> 上一页
          </button>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-line)' }}
          >
            下一页 <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </nav>
  )
}
