export type ReviewMarkupFormat = 'italic' | 'bold' | 'underline' | 'strike' | 'inline-spoiler'

export type ReviewMarkupNode =
  | { kind: 'text'; value: string }
  | { kind: 'format'; format: ReviewMarkupFormat; children: ReviewMarkupNode[] }

export interface ReviewEditorSelection {
  start: number
  end: number
  preserveFormatCaret?: boolean
}

export const REVIEW_MARKUP_TOKENS: Readonly<Record<ReviewMarkupFormat, string>> = {
  italic: '*',
  bold: '**',
  underline: '__',
  strike: '~~',
  'inline-spoiler': '||',
}

interface ParseResult {
  nodes: ReviewMarkupNode[]
  index: number
  closed: boolean
}

interface MarkupToken {
  token: string
  format: ReviewMarkupFormat
}

const MARKUP_TOKENS: readonly MarkupToken[] = [
  { token: REVIEW_MARKUP_TOKENS.bold, format: 'bold' },
  { token: REVIEW_MARKUP_TOKENS.underline, format: 'underline' },
  { token: REVIEW_MARKUP_TOKENS.strike, format: 'strike' },
  { token: REVIEW_MARKUP_TOKENS['inline-spoiler'], format: 'inline-spoiler' },
  { token: REVIEW_MARKUP_TOKENS.italic, format: 'italic' },
]

const ESCAPABLE_MARKUP_CHARACTERS = new Set(['*', '_', '~', '|', '\\'])
const REVIEW_MARKUP_FORMATS = new Set<ReviewMarkupFormat>([
  'italic',
  'bold',
  'underline',
  'strike',
  'inline-spoiler',
])

function appendText(nodes: ReviewMarkupNode[], value: string): void {
  if (!value) return
  const previous = nodes[nodes.length - 1]
  if (previous?.kind === 'text') {
    previous.value += value
    return
  }
  nodes.push({ kind: 'text', value })
}

function findOpeningToken(source: string, index: number): MarkupToken | null {
  return MARKUP_TOKENS.find(({ token }) => source.startsWith(token, index)) ?? null
}

function matchesClosingToken(source: string, index: number, closingToken: string): boolean {
  if (!source.startsWith(closingToken, index)) return false

  // 单星号是斜体的结束符，但不能抢先截断嵌套的双星号加粗标记。
  return !MARKUP_TOKENS.some(({ token }) => (
    token.length > closingToken.length
      && token.startsWith(closingToken)
      && source.startsWith(token, index)
  ))
}

function parseSequence(source: string, start: number, closingToken: string | null): ParseResult {
  const nodes: ReviewMarkupNode[] = []
  let index = start

  while (index < source.length) {
    if (closingToken && matchesClosingToken(source, index, closingToken)) {
      return { nodes, index: index + closingToken.length, closed: true }
    }

    const currentCharacter = source[index]
    if (currentCharacter === '\\' && index + 1 < source.length) {
      const escapedCharacter = source[index + 1]
      if (ESCAPABLE_MARKUP_CHARACTERS.has(escapedCharacter)) {
        appendText(nodes, escapedCharacter)
        index += 2
        continue
      }
    }

    const openingToken = findOpeningToken(source, index)
    if (openingToken) {
      const nested = parseSequence(source, index + openingToken.token.length, openingToken.token)
      if (nested.closed) {
        nodes.push({
          kind: 'format',
          format: openingToken.format,
          children: nested.nodes,
        })
        index = nested.index
        continue
      }
      // 未闭合标记不吞掉后续正文，原样保留标记本身。
      appendText(nodes, openingToken.token)
      index += openingToken.token.length
      continue
    }

    appendText(nodes, currentCharacter)
    index += 1
  }

  return { nodes, index, closed: closingToken === null }
}

/** 将受限的评论 Markdown 语法解析为安全的渲染节点。 */
export function parseReviewMarkup(source: string): ReviewMarkupNode[] {
  return parseSequence(source, 0, null).nodes
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
}

function stripEditorCaretCharacters(value: string): string {
  return value.replaceAll('\u200B', '')
}


function renderEditableNodes(
  nodes: ReviewMarkupNode[],
  path: string,
  revealedSpoilerIds: ReadonlySet<string>,
): string {
  return nodes.map((node, index) => {
    const nodeId = `${path}.${index}`
    if (node.kind === 'text') return escapeHtml(node.value)

    const token = REVIEW_MARKUP_TOKENS[node.format]
    const spoilerAttributes = node.format === 'inline-spoiler'
      ? ` data-review-spoiler="true" role="button" tabindex="0" aria-label="防剧透内容，点击显示或隐藏"${revealedSpoilerIds.has(nodeId) ? ' data-review-revealed="true"' : ''}`
      : ''

    const renderedChildren = renderEditableNodes(node.children, nodeId, revealedSpoilerIds)

    // token 作为可见文本渲染（带 data-review-token 标记），内容正常显示
    return `<span class="review-format-block" data-review-format="${node.format}" data-review-node-id="${nodeId}"${spoilerAttributes}><span class="review-token" data-review-token="${token}">${escapeHtml(token)}</span>${renderedChildren}<span class="review-token" data-review-token="${token}">${escapeHtml(token)}</span></span>`
  }).join('')
}

/** 将评论标记渲染为编辑器可编辑的安全 HTML。 */
export function renderEditableReviewMarkup(
  source: string,
  revealedSpoilerIds: ReadonlySet<string> = new Set<string>(),
): string {
  return renderEditableNodes(parseReviewMarkup(source), 'review', revealedSpoilerIds)
}

function isReviewMarkupFormat(value: string | undefined): value is ReviewMarkupFormat {
  return value !== undefined && REVIEW_MARKUP_FORMATS.has(value as ReviewMarkupFormat)
}

function getElementFormat(element: HTMLElement): ReviewMarkupFormat | null {
  if (isReviewMarkupFormat(element.dataset.reviewFormat)) return element.dataset.reviewFormat

  switch (element.tagName) {
    case 'B':
    case 'STRONG':
      return 'bold'
    case 'I':
    case 'EM':
      return 'italic'
    case 'U':
      return 'underline'
    case 'S':
    case 'DEL':
      return 'strike'
    default:
      return null
  }
}

function isBlockElement(element: Node): boolean {
  return element instanceof HTMLElement && ['DIV', 'P'].includes(element.tagName)
}

function serializeEditorChildren(parent: Node): string {
  const children = Array.from(parent.childNodes)
  let result = ''

  children.forEach((child, index) => {
    const block = isBlockElement(child)
    if (block && result && !result.endsWith('\n')) result += '\n'

    result += serializeEditorNode(child)

    const nextChild = children[index + 1]
    if (block && nextChild && isBlockElement(nextChild) && !result.endsWith('\n')) result += '\n'
  })

  return result
}

function serializeEditorNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return stripEditorCaretCharacters(node.nodeValue ?? '')
  if (!(node instanceof HTMLElement)) return ''
  if (node.tagName === 'BR') return '\n'

  const content = serializeEditorChildren(node)
  const format = getElementFormat(node)
  if (!format) return content

  const token = REVIEW_MARKUP_TOKENS[format]
  return `${token}${content}${token}`
}

/** 将编辑器 DOM 安全地序列化回现有评论标记字符串。 */
export function serializeReviewEditor(root: HTMLElement): string {
  if (root.childNodes.length === 1 && root.firstChild instanceof HTMLBRElement) return ''
  return serializeEditorChildren(root)
}

function getEditorNodeSourceLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return stripEditorCaretCharacters(node.nodeValue ?? '').length
  if (!(node instanceof HTMLElement)) return node instanceof HTMLBRElement ? 1 : 0
  if (node.tagName === 'BR') return 1

  const contentLength = Array.from(node.childNodes)
    .reduce((length, child) => length + getEditorNodeSourceLength(child), 0)
  const format = getElementFormat(node)
  if (!format) return contentLength

  const tokenLength = REVIEW_MARKUP_TOKENS[format].length
  return tokenLength + contentLength + tokenLength
}

function getSourceOffsetInChildren(parent: Node, targetNode: Node, targetOffset: number, sourceStart: number): number | null {
  let sourceOffset = sourceStart

  if (parent === targetNode) {
    const children = Array.from(parent.childNodes)
    return sourceOffset + children
      .slice(0, Math.max(0, Math.min(targetOffset, children.length)))
      .reduce((length, child) => length + getEditorNodeSourceLength(child), 0)
  }

  for (const child of Array.from(parent.childNodes)) {
    if (child === targetNode) {
      if (child.nodeType === Node.TEXT_NODE) {
        const visibleText = (child.nodeValue ?? '').slice(0, Math.max(0, Math.min(targetOffset, child.nodeValue?.length ?? 0)))
        return sourceOffset + stripEditorCaretCharacters(visibleText).length
      }

      const format = child instanceof HTMLElement ? getElementFormat(child) : null
      const contentStart = format
        ? sourceOffset + REVIEW_MARKUP_TOKENS[format].length
        : sourceOffset
      return contentStart + Array.from(child.childNodes)
        .slice(0, Math.max(0, Math.min(targetOffset, child.childNodes.length)))
        .reduce((length, nestedChild) => length + getEditorNodeSourceLength(nestedChild), 0)
    }

    if (child.contains(targetNode)) {
      const format = child instanceof HTMLElement ? getElementFormat(child) : null
      const contentStart = format
        ? sourceOffset + REVIEW_MARKUP_TOKENS[format].length
        : sourceOffset
      return getSourceOffsetInChildren(child, targetNode, targetOffset, contentStart)
    }

    sourceOffset += getEditorNodeSourceLength(child)
  }

  return null
}

function addClosingTokensAtCollapsedCaret(
  root: HTMLElement,
  range: Range,
  sourceOffset: number,
): number {
  let current: Node | null = range.startContainer
  let offset = range.startOffset

  while (current && current !== root) {
    const isAtNodeEnd = current.nodeType === Node.TEXT_NODE
      ? offset === (current.nodeValue?.length ?? 0)
      : current instanceof HTMLElement && offset === current.childNodes.length
    if (!isAtNodeEnd) break

    const parent: Node | null = current.parentNode
    if (!parent) break
    if (current !== parent.lastChild) break

    if (parent instanceof HTMLElement) {
      const format = getElementFormat(parent)
      if (format) sourceOffset += REVIEW_MARKUP_TOKENS[format].length
    }

    current = parent
    offset = parent.childNodes.length
  }

  return sourceOffset
}

/** 获取编辑器当前选区对应的源字符串偏移。 */
export function getReviewEditorSelection(
  root: HTMLElement,
  preserveFormatCaret = false,
): ReviewEditorSelection | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null

  let start = getSourceOffsetInChildren(root, range.startContainer, range.startOffset, 0)
  let end = getSourceOffsetInChildren(root, range.endContainer, range.endOffset, 0)
  if (start === null || end === null) return null

  if (range.collapsed) {
    if (!preserveFormatCaret) start = addClosingTokensAtCollapsedCaret(root, range, start)
    end = start
  }

  return { start, end, preserveFormatCaret: preserveFormatCaret || undefined }
}

interface EditorDomPosition {
  container: Node
  offset: number
}

function ensureEditableCaretAfterFormat(position: EditorDomPosition): EditorDomPosition {
  if (!(position.container instanceof HTMLElement) || position.offset === 0) return position

  const previousNode = position.container.childNodes[position.offset - 1]
  if (!(previousNode instanceof HTMLElement) || !getElementFormat(previousNode)) return position

  const caretAnchor = document.createElement('span')
  caretAnchor.dataset.reviewCaretAnchor = 'true'
  caretAnchor.setAttribute('aria-hidden', 'true')
  const caretText = document.createTextNode('\u200B')
  caretAnchor.appendChild(caretText)
  position.container.insertBefore(caretAnchor, position.container.childNodes[position.offset] ?? null)
  return { container: caretText, offset: caretText.length }
}

function findEditorDomPosition(
  parent: Node,
  targetOffset: number,
  sourceStart: number,
  preserveFormatCaret = false,
): EditorDomPosition {
  let sourceOffset = sourceStart
  const children = Array.from(parent.childNodes)

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    const childLength = getEditorNodeSourceLength(child)
    if (targetOffset <= sourceOffset) return { container: parent, offset: index }
    const format = child instanceof HTMLElement ? getElementFormat(child) : null
    const shouldEnterFormatAtEnd = preserveFormatCaret
      && format !== null
      && targetOffset === sourceOffset + childLength
    if (targetOffset < sourceOffset + childLength || shouldEnterFormatAtEnd) {
      if (child.nodeType === Node.TEXT_NODE) {
        return {
          container: child,
          offset: Math.max(0, Math.min(targetOffset - sourceOffset, child.nodeValue?.length ?? 0)),
        }
      }
      if (child instanceof HTMLBRElement) return { container: parent, offset: index }

      const contentStart = format
        ? sourceOffset + REVIEW_MARKUP_TOKENS[format].length
        : sourceOffset
      if (format && targetOffset <= contentStart) {
        if (preserveFormatCaret && targetOffset === contentStart) {
          return findEditorDomPosition(child, targetOffset, contentStart, true)
        }
        return { container: parent, offset: index }
      }
      return findEditorDomPosition(child, targetOffset, contentStart, preserveFormatCaret)
    }
    sourceOffset += childLength
  }

  return { container: parent, offset: children.length }
}

/** 将源字符串偏移恢复到重新渲染后的编辑器选区。 */
export function restoreReviewEditorSelection(root: HTMLElement, selectionOffsets: ReviewEditorSelection): void {
  const preserveFormatCaret = selectionOffsets.preserveFormatCaret === true
  let start = findEditorDomPosition(root, selectionOffsets.start, 0, preserveFormatCaret)
  let end = findEditorDomPosition(root, selectionOffsets.end, 0, preserveFormatCaret)
  if (selectionOffsets.start === selectionOffsets.end) {
    if (!preserveFormatCaret) start = ensureEditableCaretAfterFormat(start)
    end = start
  }
  const range = document.createRange()
  range.setStart(start.container, start.offset)
  range.setEnd(end.container, end.offset)

  const selection = window.getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(range)
}
