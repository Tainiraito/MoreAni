import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export type PageWidth = 'standard' | 'wide'

const pageWidthClassNames: Record<PageWidth, { outer: string; inner: string }> = {
  standard: {
    outer: 'px-6 sm:px-[5.5%]',
    inner: 'max-w-[90rem]',
  },
  wide: {
    outer: 'px-4 sm:px-6 lg:px-8',
    inner: 'max-w-[100rem]',
  },
}

interface PageContainerProps extends HTMLAttributes<HTMLDivElement> {
  width?: PageWidth
  innerClassName?: string
}

interface PageMainProps extends HTMLAttributes<HTMLElement> {
  width?: PageWidth
  innerClassName?: string
}

export const PageContainer = ({
  width = 'standard',
  className,
  innerClassName,
  children,
  ...props
}: PageContainerProps) => {
  const styles = pageWidthClassNames[width]

  return (
    <div className={cn('w-full', styles.outer, className)} {...props}>
      <div className={cn('mx-auto w-full', styles.inner, innerClassName)}>{children}</div>
    </div>
  )
}

export const PageMain = ({
  width = 'standard',
  className,
  innerClassName,
  children,
  ...props
}: PageMainProps) => {
  const styles = pageWidthClassNames[width]

  return (
    <main className={cn('w-full', styles.outer, className)} {...props}>
      <div className={cn('mx-auto w-full', styles.inner, innerClassName)}>{children}</div>
    </main>
  )
}
