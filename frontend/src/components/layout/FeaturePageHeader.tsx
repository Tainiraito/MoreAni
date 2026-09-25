import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface FeaturePageHeaderProps {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
  className?: string
}

export function FeaturePageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: FeaturePageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        <p className="mb-2 text-xs uppercase tracking-[0.18em]" style={{ color: 'var(--brand)' }}>
          {eyebrow}
        </p>
        <h1
          className="text-2xl font-bold sm:text-3xl"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
        >
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 sm:text-base" style={{ color: 'var(--text-secondary)' }}>
          {description}
        </p>
      </div>
      {actions ? <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div> : null}
    </header>
  )
}
