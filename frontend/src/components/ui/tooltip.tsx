import { useState, type FocusEvent, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

type TooltipSide = 'top' | 'bottom'

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  side?: TooltipSide
  className?: string
}

function handleTooltipBlur(
  event: FocusEvent<HTMLSpanElement>,
  setVisible: (visible: boolean) => void,
): void {
  const nextTarget = event.relatedTarget
  if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
    setVisible(false)
  }
}

export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const positionClassName = side === 'bottom'
    ? 'left-1/2 top-full mt-2 -translate-x-1/2'
    : 'bottom-full left-1/2 mb-2 -translate-x-1/2'

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocusCapture={() => setVisible(true)}
      onBlurCapture={event => handleTooltipBlur(event, setVisible)}
    >
      {children}
      <span
        role="tooltip"
        aria-hidden={!visible}
        className={cn(
          'pointer-events-none absolute z-[70] w-max max-w-[min(18rem,calc(100vw-2rem))] whitespace-normal break-words rounded-md px-2.5 py-1.5 text-center text-[11px] font-medium shadow-lg transition-[opacity,visibility] duration-150',
          positionClassName,
          visible ? 'visible opacity-100' : 'invisible opacity-0',
        )}
        style={{
          background: 'var(--bg-card-warm)',
          border: '1px solid var(--border-line)',
          color: 'var(--text-primary)',
          overflowWrap: 'anywhere',
        }}
      >
        {content}
      </span>
    </span>
  )
}
