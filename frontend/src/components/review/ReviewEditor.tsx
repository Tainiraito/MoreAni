import { Mark, markInputRule, mergeAttributes, type Editor } from '@tiptap/core'
import type { Mark as ProseMirrorMark } from '@tiptap/pm/model'
import { TextSelection, type Transaction } from '@tiptap/pm/state'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useEffect, useRef, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { Bold, EyeOff, Italic, Strikethrough, Underline, type LucideIcon } from 'lucide-react'

import { REVIEW_MARKUP_TOKENS, type ReviewMarkupFormat } from '@/lib/review-markup'
import {
  REVIEW_TIPTAP_MARK_NAMES,
  reviewMarkupToTiptapDocument,
  serializeTiptapDocument,
} from '@/lib/review-tiptap'

interface ReviewEditorProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  rows?: number
}

interface MarkupTool {
  label: string
  format: ReviewMarkupFormat
  icon: LucideIcon
}

const MARKUP_TOOLS: readonly MarkupTool[] = [
  { label: '斜体', format: 'italic', icon: Italic },
  { label: '加粗', format: 'bold', icon: Bold },
  { label: '下划线', format: 'underline', icon: Underline },
  { label: '删除线', format: 'strike', icon: Strikethrough },
  { label: '防剧透', format: 'inline-spoiler', icon: EyeOff },
]

const SHORTCUTS: Readonly<Partial<Record<ReviewMarkupFormat, string>>> = {
  bold: 'b',
  italic: 'i',
  underline: 'u',
  strike: 's',
}

const INPUT_RULES: Readonly<Record<ReviewMarkupFormat, RegExp>> = {
  italic: /(?<!\*)\*([^*]+)\*(?!\*)$/,
  bold: /\*\*((?:[^*]|\*(?!\*))+?)\*\*$/,
  underline: /__([^_]+)__(?!_)$/,
  strike: /~~([^~]+)~~(?!~)$/,
  'inline-spoiler': /\|\|([^|]+)\|\|(?!\|)$/,
}

const MIN_EDITOR_HEIGHT_PX = 64
const REVIEW_CARET_MARK_NAME = 'reviewCaretAnchor'
const REVIEW_CARET_CHARACTER = '\u200B'

function createReviewMark(format: ReviewMarkupFormat) {
  const token = REVIEW_MARKUP_TOKENS[format]
  const shortcut = SHORTCUTS[format]

  return Mark.create({
    name: REVIEW_TIPTAP_MARK_NAMES[format],
    inclusive: true,

    addKeyboardShortcuts() {
      return shortcut
        ? {
            [`Mod-${shortcut}`]: () => this.editor.commands.toggleMark(this.name),
          }
        : {}
    },

    addInputRules() {
      return [
        markInputRule({
          find: INPUT_RULES[format],
          type: this.type,
        }),
      ]
    },

    parseHTML() {
      return [{ tag: `span[data-review-format="${format}"]` }]
    },

    renderHTML({ HTMLAttributes }) {
      const attributes = mergeAttributes(HTMLAttributes, {
        'data-review-format': format,
        'data-review-token': token,
        ...(format === 'inline-spoiler'
          ? {
              'data-review-spoiler': 'true',
              'aria-label': '防剧透内容，点击显示或隐藏',
            }
          : {}),
      })

      return ['span', attributes, 0]
    },
  })
}

function createReviewCaretMark() {
  return Mark.create({
    name: REVIEW_CARET_MARK_NAME,
    inclusive: false,
    excludes: '_',

    parseHTML() {
      return [{ tag: 'span[data-review-caret-anchor]' }]
    },

    renderHTML({ HTMLAttributes }) {
      return ['span', mergeAttributes(HTMLAttributes, {
        'data-review-caret-anchor': 'true',
        'aria-hidden': 'true',
      }), 0]
    },
  })
}

const REVIEW_EXTENSIONS = [
  StarterKit.configure({
    bold: false,
    italic: false,
    strike: false,
  }),
  createReviewMark('italic'),
  createReviewMark('bold'),
  createReviewMark('underline'),
  createReviewMark('strike'),
  createReviewMark('inline-spoiler'),
  createReviewCaretMark(),
]

function getFormatElements(editor: Editor): HTMLElement[] {
  if (editor.isDestroyed) return []
  return Array.from(editor.view.dom.querySelectorAll<HTMLElement>('[data-review-format]'))
}

function selectionIntersectsElement(selection: Selection, element: HTMLElement): boolean {
  if (element.contains(selection.anchorNode) || element.contains(selection.focusNode)) return true
  if (selection.rangeCount === 0) return false

  const range = selection.getRangeAt(0)
  if (element.contains(range.commonAncestorContainer)) return true

  try {
    return range.intersectsNode(element)
  } catch {
    return false
  }
}

function getFormatAncestors(node: Node | null, editorRoot: HTMLElement): HTMLElement[] {
  const elements: HTMLElement[] = []
  let current = node instanceof HTMLElement ? node : node?.parentElement ?? null

  while (current && current !== editorRoot) {
    if (current.dataset.reviewFormat) elements.push(current)
    current = current.parentElement
  }

  return elements
}

interface CaretBoundaryElements {
  start: HTMLElement[]
  end: HTMLElement[]
}

function getCaretBoundaryElements(editor: Editor): CaretBoundaryElements {
  const boundary: CaretBoundaryElements = { start: [], end: [] }
  const selection = window.getSelection()
  if (!selection || !selection.isCollapsed || selection.rangeCount !== 1) return boundary

  const range = selection.getRangeAt(0)
  if (!editor.view.dom.contains(range.commonAncestorContainer) || !selection.anchorNode) return boundary

  const anchorNode = selection.anchorNode
  if (anchorNode.nodeType === Node.TEXT_NODE) {
    const textLength = anchorNode.textContent?.length ?? 0
    if (selection.anchorOffset === 0) boundary.start = getFormatAncestors(anchorNode, editor.view.dom)
    if (selection.anchorOffset === textLength) boundary.end = getFormatAncestors(anchorNode, editor.view.dom)
    return boundary
  }

  const before = anchorNode.childNodes[selection.anchorOffset - 1] ?? null
  const after = anchorNode.childNodes[selection.anchorOffset] ?? null
  if (after) boundary.start = getFormatAncestors(after, editor.view.dom)
  if (before) boundary.end = getFormatAncestors(before, editor.view.dom)
  return boundary
}

function setActiveFormatAttributes(editor: Editor): void {
  if (editor.isDestroyed) return
  const selection = window.getSelection()
  const insideEditor = selection?.rangeCount === 1
    && editor.view.dom.contains(selection.getRangeAt(0).commonAncestorContainer)
  const caretBoundary = getCaretBoundaryElements(editor)

  getFormatElements(editor).forEach(element => {
    element.removeAttribute('data-review-caret-boundary')
    if (insideEditor && selection && selectionIntersectsElement(selection, element)) {
      element.setAttribute('data-review-active', 'true')
    } else {
      element.removeAttribute('data-review-active')
    }

    if (caretBoundary.start.includes(element)) element.setAttribute('data-review-caret-boundary', 'start')
    if (caretBoundary.end.includes(element)) element.setAttribute('data-review-caret-boundary', 'end')
  })
}

function getDomSelectionRange(editor: Editor): { from: number; to: number } | null {
  if (editor.isDestroyed) return null
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!editor.view.dom.contains(range.commonAncestorContainer)) return null

  try {
    const anchor = editor.view.posAtDOM(selection.anchorNode!, selection.anchorOffset)
    const focus = editor.view.posAtDOM(selection.focusNode!, selection.focusOffset)
    return {
      from: Math.min(anchor, focus),
      to: Math.max(anchor, focus),
    }
  } catch {
    return null
  }
}

function syncProseMirrorSelection(editor: Editor): void {
  if (editor.isDestroyed) return
  const nextSelection = getDomSelectionRange(editor)
  if (!nextSelection) return

  const currentSelection = editor.state.selection
  if (currentSelection.from === nextSelection.from && currentSelection.to === nextSelection.to) return

  editor.commands.setTextSelection(nextSelection)
}

function getReviewBoundaryMarks(
  editor: Editor,
  position: number,
  direction: 'left' | 'right',
): ProseMirrorMark[] {
  const resolvedPosition = editor.state.doc.resolve(position)
  const enteringMarks = direction === 'left'
    ? resolvedPosition.nodeAfter?.marks ?? []
    : resolvedPosition.nodeBefore?.marks ?? []
  const leavingMarks = direction === 'left'
    ? resolvedPosition.nodeBefore?.marks ?? []
    : resolvedPosition.nodeAfter?.marks ?? []

  return enteringMarks.filter(mark => (
    Object.values(REVIEW_TIPTAP_MARK_NAMES).includes(mark.type.name)
    && !leavingMarks.some(other => other.type === mark.type)
  ))
}

function placeCaretOutsideReviewFormat(
  editor: Editor,
  position: number,
  direction: 'left' | 'right',
  boundaryMarks: ProseMirrorMark[],
): boolean {
  const caretMarkType = editor.state.schema.marks[REVIEW_CARET_MARK_NAME]
  if (!caretMarkType) return false

  let transaction = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position))
  boundaryMarks.forEach(mark => {
    transaction = transaction.removeStoredMark(mark)
  })
  transaction = transaction.setStoredMarks([])
  transaction = transaction.insert(
    position,
    editor.state.schema.text(REVIEW_CARET_CHARACTER, [caretMarkType.create()]),
  )
  const selectionPosition = direction === 'left' ? position : position + 1
  transaction = transaction.setSelection(TextSelection.create(transaction.doc, selectionPosition))
  editor.view.dispatch(transaction)
  return true
}

function moveToReviewBoundary(editor: Editor, direction: 'left' | 'right'): boolean {
  const { selection, doc } = editor.state
  if (!(selection instanceof TextSelection) || !selection.empty) return false

  const nextPosition = direction === 'right' ? selection.from + 1 : selection.from - 1
  if (nextPosition < 1 || nextPosition > doc.content.size) return false

  const boundaryMarks = getReviewBoundaryMarks(editor, nextPosition, direction)
  if (boundaryMarks.length === 0) return false

  return placeCaretOutsideReviewFormat(editor, nextPosition, direction, boundaryMarks)
}

function exitReviewMarksAtBoundary(editor: Editor, direction: 'left' | 'right'): boolean {
  const { selection } = editor.state
  if (!(selection instanceof TextSelection)) return false

  const position = selection.empty
    ? selection.from
    : direction === 'right' ? selection.to : selection.from
  const boundaryMarks = getReviewBoundaryMarks(editor, position, direction)
  if (boundaryMarks.length === 0) return false

  return placeCaretOutsideReviewFormat(editor, position, direction, boundaryMarks)
}

function getReviewCaretAnchorRange(
  doc: Editor['state']['doc'],
  position: number,
): { from: number; to: number } | null {
  const resolvedPosition = doc.resolve(position)
  const parentStart = resolvedPosition.start(resolvedPosition.depth)
  let anchorRange: { from: number; to: number } | null = null

  resolvedPosition.parent.forEach((node, offset) => {
    const from = parentStart + offset
    const to = from + node.nodeSize
    const caretMark = node.marks.find(mark => mark.type.name === REVIEW_CARET_MARK_NAME)
    if (
      anchorRange === null
      && position >= from
      && position <= to
      && node.isText
      && node.text !== undefined
      && node.text === REVIEW_CARET_CHARACTER.repeat(node.text.length)
      && caretMark !== undefined
    ) {
      anchorRange = { from, to }
    }
  })

  return anchorRange
}

function hasReviewFormatMarks(marks: readonly ProseMirrorMark[] | undefined): boolean {
  return marks?.some(mark => Object.values(REVIEW_TIPTAP_MARK_NAMES).includes(mark.type.name)) ?? false
}

function moveAcrossReviewCaretAnchor(editor: Editor, direction: 'left' | 'right'): boolean {
  const { selection, doc } = editor.state
  if (!(selection instanceof TextSelection) || !selection.empty) return false

  const anchorRange = getReviewCaretAnchorRange(doc, selection.from)
  if (!anchorRange) return false

  const isRightOfFormat = hasReviewFormatMarks(doc.resolve(anchorRange.from).nodeBefore?.marks)
  const isLeftOfFormat = hasReviewFormatMarks(doc.resolve(anchorRange.to).nodeAfter?.marks)
  const movesIntoFormat = direction === 'left' ? isRightOfFormat : isLeftOfFormat
  let transaction = editor.state.tr.delete(anchorRange.from, anchorRange.to)
  const nextPosition = movesIntoFormat
    ? direction === 'left' ? anchorRange.from - 1 : anchorRange.from + 1
    : direction === 'right' ? anchorRange.from + 1 : anchorRange.from - 1
  const boundedPosition = nextPosition >= 1 && nextPosition <= transaction.doc.content.size
    ? nextPosition
    : anchorRange.from

  transaction = transaction.setStoredMarks(movesIntoFormat ? null : [])
  transaction = transaction.setSelection(TextSelection.create(transaction.doc, boundedPosition))
  editor.view.dispatch(transaction)
  return true
}

function removeReviewCaretAnchorAtSelection(
  transaction: Transaction,
  from: number,
  to: number,
): { from: number; to: number } {
  if (from !== to) return { from, to }

  const range = getReviewCaretAnchorRange(transaction.doc, from)
  if (!range) return { from, to }

  transaction.delete(range.from, range.to)
  return { from: range.from, to: range.from }
}

function toggleSpoilerVisibility(element: HTMLElement): void {
  if (element.hasAttribute('data-review-revealed')) {
    element.removeAttribute('data-review-revealed')
  } else {
    element.setAttribute('data-review-revealed', 'true')
  }
}

function getSelectedReviewFormats(editor: Editor): ReviewMarkupFormat[] {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return []

  return Array.from(new Set(
    getFormatElements(editor)
      .filter(element => selectionIntersectsElement(selection, element))
      .map(element => element.dataset.reviewFormat as ReviewMarkupFormat),
  ))
}

function getBoundaryReviewFormats(editor: Editor, key: 'Backspace' | 'Delete'): ReviewMarkupFormat[] {
  const selection = window.getSelection()
  if (!selection || !selection.isCollapsed) return []

  const anchorNode = selection.anchorNode
  if (!anchorNode || !editor.view.dom.contains(anchorNode)) return []

  let formatElement: HTMLElement | null = null
  if (anchorNode.nodeType === Node.TEXT_NODE) {
    const textLength = anchorNode.textContent?.length ?? 0
    const atBoundary = key === 'Backspace'
      ? selection.anchorOffset === 0
      : selection.anchorOffset === textLength
    if (atBoundary) formatElement = anchorNode.parentElement?.closest<HTMLElement>('[data-review-format]') ?? null
  } else if (anchorNode instanceof HTMLElement) {
    const sibling = anchorNode.childNodes[key === 'Backspace' ? selection.anchorOffset - 1 : selection.anchorOffset]
    formatElement = sibling instanceof HTMLElement
      ? sibling.closest<HTMLElement>('[data-review-format]')
      : null
  }

  const format = formatElement?.dataset.reviewFormat as ReviewMarkupFormat | undefined
  return format ? [format] : []
}

export function ReviewEditor({
  value,
  onChange,
  disabled = false,
  placeholder = '写点评论吧...（可选）',
  rows = 2,
}: ReviewEditorProps) {
  const sourceRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const forcePlainTextInputRef = useRef(false)
  const editorHeight = Math.max(MIN_EDITOR_HEIGHT_PX, rows * 20 + 24)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const editor = useEditor(
    {
      extensions: REVIEW_EXTENSIONS,
      content: reviewMarkupToTiptapDocument(value),
      editable: !disabled,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          'data-slot': 'review-editor',
          role: 'textbox',
          'aria-label': '评论内容',
          'aria-multiline': 'true',
          spellcheck: 'true',
          class: 'w-full overflow-y-auto whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm outline-none transition-shadow focus:ring-1 focus:ring-[#FB71A7]/50',
        },
        handlePaste(view, event) {
          const text = event.clipboardData?.getData('text/plain')
          if (!text) return false

          const { from, to } = view.state.selection
          const transaction = view.state.tr
          let insertFrom = from
          let insertTo = to
          if (forcePlainTextInputRef.current) {
            const range = removeReviewCaretAnchorAtSelection(transaction, from, to)
            insertFrom = range.from
            insertTo = range.to
            transaction.setStoredMarks([])
            forcePlainTextInputRef.current = false
          }
          transaction.insertText(text, insertFrom, insertTo)
          view.dispatch(transaction)
          view.focus()
          return true
        },
        handleTextInput(view, from, to, text) {
          if (!forcePlainTextInputRef.current) return false

          const transaction = view.state.tr
          const range = removeReviewCaretAnchorAtSelection(transaction, from, to)
          transaction.setStoredMarks([])
          forcePlainTextInputRef.current = false
          transaction.insertText(text, range.from, range.to)
          view.dispatch(transaction)
          return true
        },
      },
      onUpdate: ({ editor: currentEditor }) => {
        const nextValue = serializeTiptapDocument(currentEditor.getJSON())
        if (nextValue === sourceRef.current) return

        sourceRef.current = nextValue
        onChangeRef.current(nextValue)
      },
      onSelectionUpdate: ({ editor: currentEditor }) => {
        setActiveFormatAttributes(currentEditor)
      },
    },
    [],
  )

  useEffect(() => {
    if (!editor) return
    if (value === sourceRef.current) return

    sourceRef.current = value
    editor.commands.setContent(reviewMarkupToTiptapDocument(value), { emitUpdate: false })
  }, [editor, value])

  useEffect(() => {
    if (!editor) return

    editor.setEditable(!disabled)
    const editorElement = editor.view.dom
    editorElement.setAttribute('aria-disabled', disabled ? 'true' : 'false')
    editorElement.style.height = `${editorHeight}px`
    editorElement.style.background = 'var(--bg-card)'
    editorElement.style.border = '1px solid var(--border-line)'
    editorElement.style.color = 'var(--text-primary)'
    editorElement.style.caretColor = 'var(--text-primary)'
    editorElement.style.overflowWrap = 'anywhere'
    editorElement.style.cursor = disabled ? 'not-allowed' : ''
    editorElement.style.opacity = disabled ? '0.5' : ''
    setActiveFormatAttributes(editor)
  }, [disabled, editor, editorHeight])

  useEffect(() => {
    if (!editor) return

    const updateActiveFormats = () => {
      syncProseMirrorSelection(editor)
      setActiveFormatAttributes(editor)
      window.requestAnimationFrame(() => {
        if (!editor.isDestroyed) setActiveFormatAttributes(editor)
      })
    }
    document.addEventListener('selectionchange', updateActiveFormats)
    editor.on('selectionUpdate', updateActiveFormats)
    updateActiveFormats()

    return () => {
      document.removeEventListener('selectionchange', updateActiveFormats)
      editor.off('selectionUpdate', updateActiveFormats)
    }
  }, [editor])

  const handleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!editor) return

    forcePlainTextInputRef.current = false
    const target = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>('[data-review-spoiler="true"]')
      : null
    if (!target || !editor.view.dom.contains(target)) return

    const selection = window.getSelection()
    if (selection && !selection.isCollapsed && selection.toString().length > 0) return

    toggleSpoilerVisibility(target)
  }, [editor])

  const handleKeyDownCapture = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!editor) return

    if (event.key === 'ArrowRight') {
      forcePlainTextInputRef.current = false
      syncProseMirrorSelection(editor)
      if (moveAcrossReviewCaretAnchor(editor, 'right')) {
        event.preventDefault()
        return
      }
      if (exitReviewMarksAtBoundary(editor, 'right')) {
        forcePlainTextInputRef.current = true
        event.preventDefault()
        return
      }
      if (moveToReviewBoundary(editor, 'right')) {
        forcePlainTextInputRef.current = true
        event.preventDefault()
        return
      }
    } else if (event.key === 'ArrowLeft') {
      forcePlainTextInputRef.current = false
      syncProseMirrorSelection(editor)
      if (moveAcrossReviewCaretAnchor(editor, 'left')) {
        event.preventDefault()
        return
      }
      if (exitReviewMarksAtBoundary(editor, 'left')) {
        forcePlainTextInputRef.current = true
        event.preventDefault()
        return
      }
      if (moveToReviewBoundary(editor, 'left')) {
        forcePlainTextInputRef.current = true
        event.preventDefault()
        return
      }
    } else if (event.key === 'Enter') {
      if (exitReviewMarksAtBoundary(editor, 'right')) forcePlainTextInputRef.current = true
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      const selectedFormats = getSelectedReviewFormats(editor)
      if (selectedFormats.length > 0) {
        event.preventDefault()
        syncProseMirrorSelection(editor)
        const chain = editor.chain().focus()
        selectedFormats.forEach(format => chain.unsetMark(REVIEW_TIPTAP_MARK_NAMES[format]))
        chain.run()
        return
      }

      const boundaryFormats = getBoundaryReviewFormats(editor, event.key)
      if (boundaryFormats.length > 0) {
        event.preventDefault()
        const position = editor.state.selection.from
        const chain = editor.chain().focus()
        boundaryFormats.forEach(format => {
          const markName = REVIEW_TIPTAP_MARK_NAMES[format]
          chain.extendMarkRange(markName).unsetMark(markName)
        })
        chain.setTextSelection(position).run()
      }
      return
    }

    if (event.key !== 'Enter' && event.key !== ' ') return

    const target = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>('[data-review-spoiler="true"]')
      : null
    if (!target || !editor.view.dom.contains(target)) return

    event.preventDefault()
    toggleSpoilerVisibility(target)
  }, [editor])

  const handleSelectionChange = useCallback(() => {
    if (!editor) return
    syncProseMirrorSelection(editor)
    setActiveFormatAttributes(editor)
  }, [editor])

  return (
    <>
      <div
        className="relative"
        onClick={handleClick}
        onKeyDownCapture={handleKeyDownCapture}
        onMouseUp={handleSelectionChange}
        onSelect={handleSelectionChange}
      >
        {value.length === 0 && (
          <span
            aria-hidden="true"
            data-slot="review-placeholder"
            className="pointer-events-none absolute left-3 top-2 z-10 text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            {placeholder}
          </span>
        )}
        <EditorContent editor={editor} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1" aria-label="评论格式">
        {MARKUP_TOOLS.map(({ label, format, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onMouseDown={(event: ReactMouseEvent<HTMLButtonElement>) => event.preventDefault()}
            onClick={() => {
              forcePlainTextInputRef.current = false
              editor?.chain().focus().toggleMark(REVIEW_TIPTAP_MARK_NAMES[format]).run()
            }}
            disabled={disabled || !editor}
            aria-label={`插入${label}`}
            title={`插入${label}`}
            className="inline-flex min-h-7 items-center gap-1 rounded-md px-1.5 text-xs transition-colors hover:bg-[var(--bg-card)] disabled:cursor-not-allowed disabled:opacity-50 sm:px-2"
            style={{ color: 'var(--text-muted)' }}
          >
            <Icon size={14} aria-hidden="true" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>
    </>
  )
}
