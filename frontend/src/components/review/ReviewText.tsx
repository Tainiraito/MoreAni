import { Fragment, memo, type HTMLAttributes, type ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { parseReviewMarkup, type ReviewMarkupFormat, type ReviewMarkupNode } from '@/lib/review-markup'

interface ReviewTextProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  text: string
  interactiveInlineSpoilers?: boolean
  showMarkupPlaceholders?: boolean
}

const FORMAT_CLASS_NAMES: Record<ReviewMarkupFormat, string> = {
  italic: 'italic',
  bold: 'font-semibold',
  underline: 'underline',
  strike: 'line-through',
  'inline-spoiler': 'rounded-sm bg-black px-0.5 text-black transition-colors hover:text-white focus:text-white focus:outline-none focus:ring-1 focus:ring-white/60',
}

const MARKUP_TOKENS: Record<ReviewMarkupFormat, string> = {
  italic: '*',
  bold: '**',
  underline: '__',
  strike: '~~',
  'inline-spoiler': '||',
}

function renderNodes(
  nodes: ReviewMarkupNode[],
  keyPrefix: string,
  interactiveInlineSpoilers: boolean,
  showMarkupPlaceholders: boolean,
): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`
    if (node.kind === 'text') {
      return <Fragment key={key}>{node.value}</Fragment>
    }

    const isInlineSpoiler = node.format === 'inline-spoiler'
    const marker = MARKUP_TOKENS[node.format]
    return (
      <Fragment key={key}>
        {showMarkupPlaceholders && (
          <span aria-hidden="true" className="select-none" style={{ visibility: 'hidden' }}>{marker}</span>
        )}
        <span
          className={FORMAT_CLASS_NAMES[node.format]}
          tabIndex={isInlineSpoiler && interactiveInlineSpoilers ? 0 : undefined}
          aria-label={isInlineSpoiler ? '防剧透内容' : undefined}
        >
          {renderNodes(node.children, key, interactiveInlineSpoilers, showMarkupPlaceholders)}
        </span>
        {showMarkupPlaceholders && (
          <span aria-hidden="true" className="select-none" style={{ visibility: 'hidden' }}>{marker}</span>
        )}
      </Fragment>
    )
  })
}

export const ReviewText = memo(function ReviewText({
  text,
  className,
  interactiveInlineSpoilers = true,
  showMarkupPlaceholders = false,
  ...props
}: ReviewTextProps) {
  const nodes = parseReviewMarkup(text)
  return (
    <span className={cn('whitespace-pre-wrap break-words', className)} {...props}>
      {renderNodes(nodes, 'review', interactiveInlineSpoilers, showMarkupPlaceholders)}
    </span>
  )
})
