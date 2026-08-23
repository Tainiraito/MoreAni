import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

interface CollapsibleTextProps {
  children: ReactNode
  label: string
  lineHeight: number
  lines?: number
  resetKey?: string | number
  className?: string
  contentClassName?: string
  style?: CSSProperties
}

/**
 * A measured, three-line text block that only shows controls when content
 * actually overflows at the current width.
 */
export function CollapsibleText({
  children,
  label,
  lineHeight,
  lines = 3,
  resetKey,
  className = '',
  contentClassName = '',
  style,
}: CollapsibleTextProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const contentId = `collapsible-text-${useId()}`
  const [expanded, setExpanded] = useState(false)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const collapsedHeight = Math.max(1, lineHeight) * Math.max(1, lines)

  useLayoutEffect(() => {
    setExpanded(false)
  }, [resetKey])

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return

    const measure = () => {
      setIsOverflowing(content.scrollHeight > collapsedHeight + 1)
    }

    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      observer.observe(content)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [children, collapsedHeight])

  const collapsed = isOverflowing && !expanded
  const contentStyle: CSSProperties = {
    lineHeight: `${lineHeight}px`,
    maxHeight: collapsed ? `${collapsedHeight}px` : undefined,
    overflow: 'hidden',
  }

  return (
    <div className={`relative ${className}`} style={style}>
      <div
        ref={contentRef}
        id={contentId}
        data-testid="collapsible-content"
        className={contentClassName}
        style={contentStyle}
      >
        {children}
      </div>

      {collapsed && (
        <div
          data-testid="collapsible-fade"
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
          style={{
            height: `${Math.max(20, lineHeight * 1.35)}px`,
            background: 'linear-gradient(to bottom, transparent 0%, var(--bg-card) 82%)',
          }}
        />
      )}

      {isOverflowing && !expanded && (
        <button
          type="button"
          className="absolute right-0 bottom-0 z-20 text-xs font-medium transition-opacity hover:opacity-80"
          style={{
            color: 'var(--brand)',
            background: 'var(--bg-card)',
            border: 0,
            padding: '2px 0 2px 1.5rem',
          }}
          aria-expanded={false}
          aria-controls={contentId}
          aria-label={`展开${label}`}
          onClick={() => setExpanded(true)}
        >
          展开
        </button>
      )}

      {isOverflowing && expanded && (
        <div className="flex justify-end mt-1">
          <button
            type="button"
            className="text-xs font-medium transition-opacity hover:opacity-80"
            style={{ color: 'var(--brand)', background: 'transparent', border: 0, padding: '2px 0' }}
            aria-expanded={true}
            aria-controls={contentId}
            aria-label={`收起${label}`}
            onClick={() => setExpanded(false)}
          >
            收起
          </button>
        </div>
      )}
    </div>
  )
}
