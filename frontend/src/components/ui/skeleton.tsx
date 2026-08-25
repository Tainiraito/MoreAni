import * as React from 'react'

import { cn } from '@/lib/utils'

function Skeleton({ className, style, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md', className)}
      style={{ background: 'var(--skeleton-bg)', ...style }}
      {...props}
    />
  )
}

export { Skeleton }
