import type { JSONContent } from '@tiptap/core'

import {
  parseReviewMarkup,
  REVIEW_MARKUP_TOKENS,
  type ReviewMarkupFormat,
  type ReviewMarkupNode,
} from '@/lib/review-markup'

export const REVIEW_TIPTAP_MARK_NAMES: Readonly<Record<ReviewMarkupFormat, string>> = {
  italic: 'reviewItalic',
  bold: 'reviewBold',
  underline: 'reviewUnderline',
  strike: 'reviewStrike',
  'inline-spoiler': 'reviewInlineSpoiler',
}

const REVIEW_TIPTAP_MARK_ORDER: readonly ReviewMarkupFormat[] = [
  'bold',
  'italic',
  'underline',
  'strike',
  'inline-spoiler',
]

const REVIEW_TIPTAP_MARK_FORMATS = new Map(
  Object.entries(REVIEW_TIPTAP_MARK_NAMES).map(([format, name]) => [name, format as ReviewMarkupFormat]),
)

interface TextSegment {
  text: string
  marks: ReviewMarkupFormat[]
}

type Line = TextSegment[]

function appendTextToLines(value: string, marks: ReviewMarkupFormat[], lines: Line[]): void {
  const parts = value.split('\n')

  parts.forEach((part, index) => {
    if (part) lines[lines.length - 1].push({ text: part, marks: [...marks] })
    if (index < parts.length - 1) lines.push([])
  })
}

function appendMarkupNodesToLines(nodes: ReviewMarkupNode[], marks: ReviewMarkupFormat[], lines: Line[]): void {
  nodes.forEach(node => {
    if (node.kind === 'text') {
      appendTextToLines(node.value, marks, lines)
      return
    }

    // ProseMirror stores formatting on text, so an empty pair has no text to
    // carry a mark. Preserve the legacy source literally until the user edits it.
    if (node.children.length === 0) {
      const token = REVIEW_MARKUP_TOKENS[node.format]
      appendTextToLines(`${token}${token}`, marks, lines)
      return
    }

    appendMarkupNodesToLines(node.children, [...marks, node.format], lines)
  })
}

function lineToTiptapContent(line: Line): JSONContent[] | undefined {
  if (line.length === 0) return undefined

  return line.map(segment => ({
    type: 'text',
    text: segment.text,
    marks: segment.marks.map(format => ({ type: REVIEW_TIPTAP_MARK_NAMES[format] })),
  }))
}

/** 将现有评论标记转换为 Tiptap 的文档模型。 */
export function reviewMarkupToTiptapDocument(source: string): JSONContent {
  const lines: Line[] = [[]]
  appendMarkupNodesToLines(parseReviewMarkup(source), [], lines)

  return {
    type: 'doc',
    content: lines.map(line => {
      const content = lineToTiptapContent(line)
      return {
        type: 'paragraph',
        ...(content ? { content } : {}),
      }
    }),
  }
}

function getOrderedMarkFormats(node: JSONContent): ReviewMarkupFormat[] {
  const formats = (node.marks ?? [])
    .map(mark => REVIEW_TIPTAP_MARK_FORMATS.get(mark.type))
    .filter((format): format is ReviewMarkupFormat => format !== undefined)

  return formats.toSorted(
    (first, second) => REVIEW_TIPTAP_MARK_ORDER.indexOf(first) - REVIEW_TIPTAP_MARK_ORDER.indexOf(second),
  )
}

function serializeInlineContent(nodes: JSONContent[] | undefined): string {
  if (!nodes || nodes.length === 0) return ''

  let result = ''
  let activeMarks: ReviewMarkupFormat[] = []

  nodes.forEach(node => {
    if (node.type === 'hardBreak') {
      result += '\n'
      activeMarks = []
      return
    }

    if (node.type !== 'text') return

    const nextMarks = getOrderedMarkFormats(node)
    let sharedLength = 0
    while (
      sharedLength < activeMarks.length
      && sharedLength < nextMarks.length
      && activeMarks[sharedLength] === nextMarks[sharedLength]
    ) {
      sharedLength += 1
    }

    for (let index = activeMarks.length - 1; index >= sharedLength; index -= 1) {
      result += REVIEW_MARKUP_TOKENS[activeMarks[index]]
    }
    for (let index = sharedLength; index < nextMarks.length; index += 1) {
      result += REVIEW_MARKUP_TOKENS[nextMarks[index]]
    }

    result += (node.text ?? '').replaceAll('\u200B', '')
    activeMarks = nextMarks
  })

  for (let index = activeMarks.length - 1; index >= 0; index -= 1) {
    result += REVIEW_MARKUP_TOKENS[activeMarks[index]]
  }

  return result
}

/** 将 Tiptap 文档序列化回 MoreAni 现有的评论标记字符串。 */
export function serializeTiptapDocument(document: JSONContent): string {
  const blocks = (document.content ?? []).filter(node => node.type === 'paragraph')
  return blocks.map(block => serializeInlineContent(block.content)).join('\n')
}
