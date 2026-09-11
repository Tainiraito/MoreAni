import { useCallback, useLayoutEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type FocusEvent as ReactFocusEvent, type FormEvent as ReactFormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { Bold, Italic, Strikethrough, Underline, EyeOff, type LucideIcon } from 'lucide-react'

import {
  getReviewEditorSelection,
  renderEditableReviewMarkup,
  REVIEW_MARKUP_TOKENS,
  restoreReviewEditorSelection,
  serializeReviewEditor,
  type ReviewEditorSelection,
  type ReviewMarkupFormat,
} from '@/lib/review-markup'

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

interface ReviewHistoryEntry {
  value: string
  selection: ReviewEditorSelection | null
}

interface ReviewHistoryState {
  entries: ReviewHistoryEntry[]
  index: number
}

const MARKUP_TOOLS: readonly MarkupTool[] = [
  { label: '斜体', format: 'italic', icon: Italic },
  { label: '加粗', format: 'bold', icon: Bold },
  { label: '下划线', format: 'underline', icon: Underline },
  { label: '删除线', format: 'strike', icon: Strikethrough },
  { label: '防剧透', format: 'inline-spoiler', icon: EyeOff },
]

const SHORTCUT_FORMATS: Readonly<Record<string, ReviewMarkupFormat>> = {
  b: 'bold',
  i: 'italic',
  u: 'underline',
  s: 'strike',
}

const MIN_EDITOR_HEIGHT_PX = 64
const MAX_HISTORY_ENTRIES = 100

function getEditorSelection(editor: HTMLElement): Range | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  return editor.contains(range.commonAncestorContainer) ? range : null
}

function setSelection(range: Range): void {
  const selection = window.getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(range)
}

function getClosestFormatElement(
  node: Node | null,
  editor: HTMLElement,
  format: ReviewMarkupFormat,
): HTMLElement | null {
  let current = node
  while (current && current !== editor) {
    if (current instanceof HTMLElement && current.dataset.reviewFormat === format) return current
    current = current.parentNode
  }
  return null
}

function rangesHaveSameBoundaries(first: Range, second: Range): boolean {
  return first.compareBoundaryPoints(Range.START_TO_START, second) === 0
    && first.compareBoundaryPoints(Range.END_TO_END, second) === 0
}

function isEntireFormatElementSelected(range: Range, element: HTMLElement): boolean {
  const contentRange = document.createRange()
  contentRange.selectNodeContents(element)
  if (rangesHaveSameBoundaries(range, contentRange)) return true

  const nodeRange = document.createRange()
  nodeRange.selectNode(element)
  if (rangesHaveSameBoundaries(range, nodeRange)) return true

  // 浏览器在鼠标重新框选同一段内容时，边界经常落在内部 Text 节点，
  // 而不是落在 span 的首尾 child 边界。两段可见文本完全相同，才能
  // 认定这是“切换当前格式”，避免第二次点击继续嵌套同一种格式。
  const selectedText = range.toString().replaceAll('\u200B', '')
  const elementText = (element.textContent ?? '').replaceAll('\u200B', '')
  return elementText.length > 0 && selectedText === elementText
}

function getSelectedFormatElement(
  editor: HTMLElement,
  range: Range,
  format: ReviewMarkupFormat,
): HTMLElement | null {
  if (range.collapsed) return null

  const startElement = getClosestFormatElement(range.startContainer, editor, format)
  const endElement = getClosestFormatElement(range.endContainer, editor, format)
  if (!startElement || startElement !== endElement) return null
  return isEntireFormatElementSelected(range, startElement) ? startElement : null
}

function removeFormatElement(element: HTMLElement): void {
  const parent = element.parentNode
  if (!parent) return

  const childNodes = Array.from(element.childNodes)
  const insertionIndex = Array.from(parent.childNodes).indexOf(element)
  childNodes.forEach(child => parent.insertBefore(child, element))
  element.remove()

  const range = document.createRange()
  if (childNodes.length > 0) {
    range.setStartBefore(childNodes[0])
    range.setEndAfter(childNodes[childNodes.length - 1])
  } else {
    const caretOffset = Math.min(insertionIndex, parent.childNodes.length)
    range.setStart(parent, caretOffset)
    range.collapse(true)
  }
  setSelection(range)
}

function isCaretAtFormatBoundary(range: Range, element: HTMLElement, side: 'start' | 'end'): boolean {
  if (!range.collapsed) return false

  const boundaryRange = document.createRange()
  boundaryRange.selectNodeContents(element)
  boundaryRange.collapse(side === 'start')
  if (rangesHaveSameBoundaries(range, boundaryRange)) return true

  // Chromium 在点击格式文本的首尾时，可能把光标放在父节点的
  // child offset 上，而不是放在格式 span 内部的 Text 节点上。
  // 逐级检查同一侧是否还有可见内容，覆盖这两种 Range 表示。
  if (range.startContainer !== element && !element.contains(range.startContainer)) return false

  let current: Node = range.startContainer
  let offset = range.startOffset
  while (current !== element) {
    if (current.nodeType === Node.TEXT_NODE) {
      const text = current.nodeValue ?? ''
      const before = text.slice(0, offset).replaceAll('\u200B', '')
      const after = text.slice(offset).replaceAll('\u200B', '')
      if (side === 'start' ? before.length > 0 : after.length > 0) return false
    } else {
      const children = Array.from(current.childNodes)
      const siblings = side === 'start'
        ? children.slice(0, offset)
        : children.slice(offset)
      if (siblings.some(sibling => (sibling.textContent ?? '').replaceAll('\u200B', '').length > 0)) return false
    }

    const parent = current.parentNode
    if (!parent) return false
    const index = Array.from(parent.childNodes).indexOf(current as ChildNode)
    const siblings = side === 'start'
      ? Array.from(parent.childNodes).slice(0, index)
      : Array.from(parent.childNodes).slice(index + 1)
    if (siblings.some(sibling => (sibling.textContent ?? '').replaceAll('\u200B', '').length > 0)) return false

    current = parent
    offset = side === 'start' ? 0 : parent.childNodes.length
  }

  const elementSiblings = side === 'start'
    ? Array.from(element.childNodes).slice(0, range.startContainer === element ? range.startOffset : 0)
    : Array.from(element.childNodes).slice(range.startContainer === element ? range.startOffset : element.childNodes.length)
  if (elementSiblings.some(sibling => (sibling.textContent ?? '').replaceAll('\u200B', '').length > 0)) return false

  return true
}

function getAdjacentFormatAtCaret(
  editor: HTMLElement,
  range: Range,
  side: 'start' | 'end',
): HTMLElement | null {
  if (!range.collapsed) return null

  const container = range.startContainer
  if (!(container instanceof HTMLElement || container === editor)) return null

  const candidateIndex = side === 'start' ? range.startOffset : range.startOffset - 1
  const candidate = container.childNodes[candidateIndex]
  return candidate instanceof HTMLElement && candidate.dataset.reviewFormat ? candidate : null
}

function getCaretBoundaryFormat(
  editor: HTMLElement,
  range: Range,
  side: 'start' | 'end',
): HTMLElement | null {
  if (range.collapsed === false) return null

  let current: Node | null = range.startContainer
  while (current && current !== editor) {
    if (current instanceof HTMLElement && current.dataset.reviewFormat && isCaretAtFormatBoundary(range, current, side)) {
      return current
    }
    current = current.parentNode
  }
  return getAdjacentFormatAtCaret(editor, range, side)
}

function removeFormatElementAtCaret(element: HTMLElement, side: 'start' | 'end'): void {
  const parent = element.parentNode
  if (!parent) return

  const childNodes = Array.from(element.childNodes)
  const elementIndex = Array.from(parent.childNodes).indexOf(element)
  childNodes.forEach(child => parent.insertBefore(child, element))
  element.remove()

  const range = document.createRange()
  if (childNodes.length === 0) {
    range.setStart(parent, Math.min(elementIndex, parent.childNodes.length))
  } else if (side === 'start') {
    range.setStartBefore(childNodes[0])
  } else {
    range.setStartAfter(childNodes[childNodes.length - 1])
  }
  range.collapse(true)
  setSelection(range)
}

function getAdjacentEmptyFormatElement(editor: HTMLElement, range: Range, key: string): HTMLElement | null {
  if (!range.collapsed) return null

  const parent = range.startContainer
  if (!(parent instanceof HTMLElement || parent === editor)) return null

  const candidateIndex = key === 'Backspace' ? range.startOffset - 1 : range.startOffset
  const candidate = parent.childNodes[candidateIndex]
  if (!(candidate instanceof HTMLElement)) return null
  if (!candidate.dataset.reviewFormat || (candidate.textContent ?? '').replaceAll('\u200B', '')) return null
  return candidate.closest('[data-review-format]') === candidate ? candidate : null
}

function removeEmptyFormatElement(element: HTMLElement, key: string): void {
  const parent = element.parentNode
  if (!parent) return

  const index = Array.from(parent.childNodes).indexOf(element)
  element.remove()
  const range = document.createRange()
  const caretOffset = key === 'Backspace' ? Math.min(index, parent.childNodes.length) : index
  range.setStart(parent, Math.max(0, Math.min(caretOffset, parent.childNodes.length)))
  range.collapse(true)
  setSelection(range)
}

function getCaretAnchor(editor: HTMLElement, range: Range): HTMLElement | null {
  if (!range.collapsed) return null

  let current: Node | null = range.startContainer
  while (current && current !== editor) {
    if (current instanceof HTMLElement && current.dataset.reviewCaretAnchor === 'true') return current
    current = current.parentNode
  }
  return null
}

function findLastTextNode(node: Node): Text | null {
  if (node.nodeType === Node.TEXT_NODE && (node.nodeValue ?? '').replaceAll('\u200B', '')) {
    return node as Text
  }

  const children = Array.from(node.childNodes)
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const textNode = findLastTextNode(children[index])
    if (textNode) return textNode
  }
  return null
}

function deletePreviousCharacterAtCaretAnchor(anchor: HTMLElement): boolean {
  const parent = anchor.parentNode
  if (!parent) return false

  const anchorIndex = Array.from(parent.childNodes).indexOf(anchor)
  const previousNode = parent.childNodes[anchorIndex - 1]
  anchor.remove()

  if (
    previousNode instanceof HTMLElement
    && previousNode.dataset.reviewFormat
    && !(previousNode.textContent ?? '').replaceAll('\u200B', '')
  ) {
    previousNode.remove()
    const emptyRange = document.createRange()
    emptyRange.setStart(parent, Math.min(anchorIndex - 1, parent.childNodes.length))
    emptyRange.collapse(true)
    setSelection(emptyRange)
    return true
  }

  if (!previousNode) {
    const startRange = document.createRange()
    startRange.setStart(parent, Math.min(anchorIndex, parent.childNodes.length))
    startRange.collapse(true)
    setSelection(startRange)
    return false
  }

  const textNode = findLastTextNode(previousNode)
  if (!textNode) {
    const fallbackRange = document.createRange()
    fallbackRange.setStart(parent, Math.min(anchorIndex, parent.childNodes.length))
    fallbackRange.collapse(true)
    setSelection(fallbackRange)
    return false
  }

  const text = textNode.nodeValue ?? ''
  let characterIndex = text.length - 1
  while (characterIndex >= 0 && text[characterIndex] === '\u200B') characterIndex -= 1
  if (characterIndex < 0) return false

  textNode.deleteData(characterIndex, 1)
  const range = document.createRange()
  range.setStart(textNode, characterIndex)
  range.collapse(true)
  setSelection(range)
  return true
}

function placeCaretAtEnd(editor: HTMLElement): void {
  editor.focus()
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  setSelection(range)
}

function placeCaretAfterNode(node: Node): void {
  const range = document.createRange()
  range.setStartAfter(node)
  range.collapse(true)
  setSelection(range)
}

function insertPlainTextAtSelection(editor: HTMLElement, text: string): boolean {
  if (!text) return false

  let range = getEditorSelection(editor)
  if (!range) {
    placeCaretAtEnd(editor)
    range = getEditorSelection(editor)
  }
  if (!range) return false

  range.deleteContents()
  const fragment = document.createDocumentFragment()
  const lines = text.replace(/\r\n?/g, '\n').split('\n')

  lines.forEach((line, index) => {
    if (index > 0) fragment.appendChild(document.createElement('br'))
    if (line) fragment.appendChild(document.createTextNode(line))
  })

  const lastNode = fragment.lastChild
  range.insertNode(fragment)
  if (lastNode) placeCaretAfterNode(lastNode)
  return true
}

function toggleSpoilerAttribute(element: HTMLElement): void {
  if (element.hasAttribute('data-review-revealed')) {
    element.removeAttribute('data-review-revealed')
  } else {
    element.setAttribute('data-review-revealed', 'true')
  }
}

function rangeTouchesElement(range: Range, element: HTMLElement): boolean {
  if (range.collapsed) {
    if (element.contains(range.startContainer)) return true

    const container = range.startContainer
    if (!(container instanceof HTMLElement || container === element.ownerDocument)) return false
    const adjacentIndex = range.startOffset
    return container.childNodes[adjacentIndex] === element
      || container.childNodes[adjacentIndex - 1] === element
  }

  try {
    return range.intersectsNode(element)
  } catch {
    return false
  }
}

export function ReviewEditor({
  value,
  onChange,
  disabled = false,
  placeholder = '写点评论吧...（可选）',
  rows = 2,
}: ReviewEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const isComposingRef = useRef(false)
  const latestValueRef = useRef(value)
  const pendingExternalValueRef = useRef<string | null>(null)
  const lastEmittedValueRef = useRef<string | null>(null)
  const manualNodeIdRef = useRef(0)
  const pointerSelectingRef = useRef(false)
  const keepCaretInsideFormatRef = useRef(false)
  const historyRef = useRef<ReviewHistoryState>({
    entries: [{ value, selection: null }],
    index: 0,
  })
  const revealedSpoilerIdsRef = useRef<ReadonlySet<string>>(new Set<string>())
  const [revealedSpoilerIds, setRevealedSpoilerIds] = useState<ReadonlySet<string>>(new Set<string>())

  latestValueRef.current = value

  const clearActiveFormats = useCallback((): void => {
    editorRef.current?.querySelectorAll<HTMLElement>('[data-review-active="true"]').forEach(element => {
      element.removeAttribute('data-review-active')
    })
  }, [])

  const updateActiveFormats = useCallback((): void => {
    const editor = editorRef.current
    if (!editor) return
    if (pointerSelectingRef.current) return

    const selection = window.getSelection()
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
    if (keepCaretInsideFormatRef.current) {
      let current: Node | null = range?.collapsed ? range.startContainer : null
      let caretInsideFormat = false
      while (current && current !== editor) {
        if (current instanceof HTMLElement && current.dataset.reviewFormat) {
          caretInsideFormat = true
          break
        }
        current = current.parentNode
      }
      if (!caretInsideFormat) keepCaretInsideFormatRef.current = false
    }
    const selectionInsideEditor = range !== null && editor.contains(range.commonAncestorContainer)
    const formatElements = editor.querySelectorAll<HTMLElement>('[data-review-format]')

    formatElements.forEach(element => {
      if (selectionInsideEditor && rangeTouchesElement(range, element)) {
        element.setAttribute('data-review-active', 'true')
      } else {
        element.removeAttribute('data-review-active')
      }
    })
  }, [])

  useLayoutEffect(() => {
    document.addEventListener('selectionchange', updateActiveFormats)
    return () => document.removeEventListener('selectionchange', updateActiveFormats)
  }, [updateActiveFormats])

  const updateSpoilerVisibility = useCallback((ids: ReadonlySet<string>): void => {
    const editor = editorRef.current
    if (!editor) return

    editor.querySelectorAll<HTMLElement>('[data-review-spoiler="true"]').forEach(element => {
      const nodeId = element.dataset.reviewNodeId
      if (nodeId && ids.has(nodeId)) {
        element.setAttribute('data-review-revealed', 'true')
      } else {
        element.removeAttribute('data-review-revealed')
      }
    })
  }, [])

  const hydrateEditor = useCallback((
    nextValue: string,
    resetSpoilers: boolean,
    selectionOffsets: ReviewEditorSelection | null = null,
  ): void => {
    const editor = editorRef.current
    if (!editor) return

    const nextSpoilerIds = resetSpoilers ? new Set<string>() : revealedSpoilerIdsRef.current
    if (resetSpoilers) {
      revealedSpoilerIdsRef.current = nextSpoilerIds
      setRevealedSpoilerIds(nextSpoilerIds)
    }
    editor.innerHTML = renderEditableReviewMarkup(nextValue, nextSpoilerIds)
    if (selectionOffsets) restoreReviewEditorSelection(editor, selectionOffsets)
    updateActiveFormats()
    lastEmittedValueRef.current = nextValue
    pendingExternalValueRef.current = null
  }, [updateActiveFormats])

  const resetHistory = useCallback((nextValue: string): void => {
    historyRef.current = {
      entries: [{ value: nextValue, selection: null }],
      index: 0,
    }
  }, [])

  const recordHistory = useCallback((nextValue: string, selection: ReviewEditorSelection | null): void => {
    const history = historyRef.current
    const currentEntry = history.entries[history.index]
    if (currentEntry?.value === nextValue) {
      if (selection) currentEntry.selection = selection
      return
    }

    const entries = history.entries.slice(0, history.index + 1)
    entries.push({ value: nextValue, selection })
    const trimmedEntries = entries.length > MAX_HISTORY_ENTRIES
      ? entries.slice(entries.length - MAX_HISTORY_ENTRIES)
      : entries
    historyRef.current = {
      entries: trimmedEntries,
      index: trimmedEntries.length - 1,
    }
  }, [])

  const emitCurrentValue = useCallback((rehydrate: boolean, preserveFormatCaret = false): void => {
    const editor = editorRef.current
    if (!editor) return

    const nextValue = serializeReviewEditor(editor)
    const shouldEmit = nextValue !== lastEmittedValueRef.current
    const selectionOffsets = getReviewEditorSelection(editor, preserveFormatCaret)
    const expectedMarkup = renderEditableReviewMarkup(nextValue, revealedSpoilerIdsRef.current)
    if (rehydrate && editor.innerHTML !== expectedMarkup) {
      hydrateEditor(nextValue, false, selectionOffsets)
    }
    if (!shouldEmit) return
    recordHistory(nextValue, selectionOffsets)
    lastEmittedValueRef.current = nextValue
    latestValueRef.current = nextValue
    onChange(nextValue)
  }, [hydrateEditor, onChange, recordHistory])

  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    if (isComposingRef.current) {
      pendingExternalValueRef.current = value
      return
    }

    if (serializeReviewEditor(editor) !== value) {
      hydrateEditor(value, true)
      resetHistory(value)
    } else {
      lastEmittedValueRef.current = value
    }
  }, [hydrateEditor, resetHistory, value])

  useLayoutEffect(() => {
    updateSpoilerVisibility(revealedSpoilerIds)
  }, [revealedSpoilerIds, updateSpoilerVisibility])

  const applyFormat = (format: ReviewMarkupFormat): void => {
    const editor = editorRef.current
    if (!editor || disabled) return

    let range = getEditorSelection(editor)
    if (!range) {
      placeCaretAtEnd(editor)
      range = getEditorSelection(editor)
    }
    if (!range) return

    const selectedFormatElement = getSelectedFormatElement(editor, range, format)
    if (selectedFormatElement) {
      keepCaretInsideFormatRef.current = false
      editor.focus()
      removeFormatElement(selectedFormatElement)
      emitCurrentValue(true)
      return
    }

    const wrapper = document.createElement('span')
    const manualNodeId = `manual-${manualNodeIdRef.current++}`
    wrapper.dataset.reviewFormat = format
    wrapper.dataset.reviewToken = REVIEW_MARKUP_TOKENS[format]
    wrapper.dataset.reviewNodeId = manualNodeId
    if (format === 'inline-spoiler') {
      wrapper.dataset.reviewSpoiler = 'true'
      wrapper.setAttribute('role', 'button')
      wrapper.setAttribute('tabindex', '0')
      wrapper.setAttribute('aria-label', '防剧透内容，点击显示或隐藏')
    }

    if (range.collapsed) {
      keepCaretInsideFormatRef.current = true
      wrapper.dataset.reviewEmpty = 'true'
      const emptyText = document.createTextNode('\u200B')
      wrapper.appendChild(emptyText)
      range.insertNode(wrapper)
      const caretRange = document.createRange()
      caretRange.setStart(emptyText, 0)
      caretRange.collapse(true)
      range = caretRange
    } else {
      wrapper.appendChild(range.extractContents())
      range.insertNode(wrapper)
      const selectedRange = document.createRange()
      selectedRange.selectNodeContents(wrapper)
      range = selectedRange
    }

    editor.focus()
    setSelection(range)
    emitCurrentValue(false, range.collapsed)
  }

  const applyHistoryStep = (direction: 'undo' | 'redo'): void => {
    const editor = editorRef.current
    if (!editor) return

    const history = historyRef.current
    const nextIndex = direction === 'undo' ? history.index - 1 : history.index + 1
    const nextEntry = history.entries[nextIndex]
    if (!nextEntry) return

    historyRef.current = { ...history, index: nextIndex }
    hydrateEditor(nextEntry.value, false, nextEntry.selection)
    lastEmittedValueRef.current = nextEntry.value
    latestValueRef.current = nextEntry.value
    onChange(nextEntry.value)
  }

  const toggleSpoiler = (spoiler: HTMLElement): void => {
    const nodeId = spoiler.dataset.reviewNodeId
    if (!nodeId) return

    toggleSpoilerAttribute(spoiler)
    setRevealedSpoilerIds(previous => {
      const next = new Set(previous)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      revealedSpoilerIdsRef.current = next
      return next
    })
  }

  const handleBeforeInput = (event: ReactFormEvent<HTMLDivElement>): void => {
    const inputEvent = event.nativeEvent as InputEvent
    if (inputEvent.inputType !== 'insertParagraph' && inputEvent.inputType !== 'insertLineBreak') return

    event.preventDefault()
    if (insertPlainTextAtSelection(event.currentTarget, '\n')) {
      emitCurrentValue(true, keepCaretInsideFormatRef.current)
    }
  }

  const handlePaste = (event: ReactClipboardEvent<HTMLDivElement>): void => {
    event.preventDefault()
    if (insertPlainTextAtSelection(event.currentTarget, event.clipboardData.getData('text/plain'))) {
      emitCurrentValue(true, keepCaretInsideFormatRef.current)
    }
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const shortcut = event.key.toLowerCase()
      if (shortcut === 'z') {
        event.preventDefault()
        applyHistoryStep(event.shiftKey ? 'redo' : 'undo')
        return
      }
      if (shortcut === 'y') {
        event.preventDefault()
        applyHistoryStep('redo')
        return
      }
    }

    const target = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>('[data-review-spoiler="true"]')
      : null
    const targetRange = getEditorSelection(event.currentTarget)
    if (target && targetRange?.collapsed !== false && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      toggleSpoiler(target)
      return
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      const range = getEditorSelection(event.currentTarget)
      if (range) {
        const caretAnchor = getCaretAnchor(event.currentTarget, range)
        if (caretAnchor && event.key === 'Backspace') {
          keepCaretInsideFormatRef.current = false
          event.preventDefault()
          if (deletePreviousCharacterAtCaretAnchor(caretAnchor)) emitCurrentValue(true)
          return
        }
        if (caretAnchor && event.key === 'Delete') {
          const previousNode = caretAnchor.previousSibling
          if (previousNode instanceof HTMLElement && previousNode.dataset.reviewFormat) {
            keepCaretInsideFormatRef.current = false
            event.preventDefault()
            removeFormatElementAtCaret(previousNode, 'end')
            emitCurrentValue(true)
            return
          }
        }

        const selectedFormatElement = MARKUP_TOOLS
          .map(tool => getSelectedFormatElement(event.currentTarget, range, tool.format))
          .find((element): element is HTMLElement => element !== null)
        if (selectedFormatElement) {
          keepCaretInsideFormatRef.current = false
          event.preventDefault()
          removeFormatElement(selectedFormatElement)
          emitCurrentValue(true)
          return
        }

        const boundaryFormatElement = getCaretBoundaryFormat(
          event.currentTarget,
          range,
          event.key === 'Backspace' ? 'start' : 'end',
        )
        if (boundaryFormatElement) {
          keepCaretInsideFormatRef.current = false
          event.preventDefault()
          removeFormatElementAtCaret(
            boundaryFormatElement,
            event.key === 'Backspace' ? 'start' : 'end',
          )
          emitCurrentValue(true)
          return
        }

        const emptyFormatElement = getAdjacentEmptyFormatElement(event.currentTarget, range, event.key)
        if (emptyFormatElement) {
          keepCaretInsideFormatRef.current = false
          event.preventDefault()
          removeEmptyFormatElement(emptyFormatElement, event.key)
          emitCurrentValue(true)
          return
        }
      }
    }

    if (event.key === 'Enter' && !(event.ctrlKey || event.metaKey || event.altKey)) {
      event.preventDefault()
      if (insertPlainTextAtSelection(event.currentTarget, '\n')) {
        emitCurrentValue(true, keepCaretInsideFormatRef.current)
      }
      return
    }

    if (!(event.ctrlKey || event.metaKey) || event.altKey) return
    const format = SHORTCUT_FORMATS[event.key.toLowerCase()]
    if (!format) return

    event.preventDefault()
    applyFormat(format)
  }

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>('[data-review-spoiler="true"]')
      : null
    if (!target || !event.currentTarget.contains(target)) return

    // 鼠标拖拽框选会在 mouseup 后触发 click。此时保留原生选区，
    // 不把“选中文字”误判成“点击剧透块并切换显示状态”。
    const selection = window.getSelection()
    if (
      selection
      && !selection.isCollapsed
      && event.currentTarget.contains(selection.anchorNode)
      && event.currentTarget.contains(selection.focusNode)
    ) {
      updateActiveFormats()
      return
    }

    toggleSpoiler(target)
  }

  const handleBlur = (event: ReactFocusEvent<HTMLDivElement>): void => {
    const relatedTarget = event.relatedTarget
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return
    clearActiveFormats()
  }

  const handlePointerDown = (): void => {
    pointerSelectingRef.current = true
  }

  const handlePointerUp = (): void => {
    pointerSelectingRef.current = false
    window.requestAnimationFrame(updateActiveFormats)
  }

  const handleCompositionStart = (): void => {
    isComposingRef.current = true
  }

  const handleCompositionEnd = (): void => {
    isComposingRef.current = false
    if (pendingExternalValueRef.current !== null && pendingExternalValueRef.current !== latestValueRef.current) {
      hydrateEditor(pendingExternalValueRef.current, true)
      return
    }
    pendingExternalValueRef.current = null
    emitCurrentValue(true, keepCaretInsideFormatRef.current)
  }

  const handleInput = (): void => {
    emitCurrentValue(!isComposingRef.current, keepCaretInsideFormatRef.current)
  }

  const editorHeight = Math.max(MIN_EDITOR_HEIGHT_PX, rows * 20 + 24)

  return (
    <>
      <div className="relative">
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
        <div
          ref={editorRef}
          data-slot="review-editor"
          contentEditable={!disabled}
          role="textbox"
          aria-label="评论内容"
          aria-multiline="true"
          aria-disabled={disabled || undefined}
          suppressContentEditableWarning
          spellCheck
          onInput={handleInput}
          onBeforeInput={handleBeforeInput}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onBlur={handleBlur}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          className="w-full overflow-y-auto whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm outline-none transition-shadow focus:ring-1 focus:ring-[#FB71A7]/50"
          style={{
            height: `${editorHeight}px`,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-line)',
            color: 'var(--text-primary)',
            caretColor: 'var(--text-primary)',
            overflowWrap: 'anywhere',
            cursor: disabled ? 'not-allowed' : undefined,
            opacity: disabled ? 0.5 : undefined,
          }}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1" aria-label="评论格式">
        {MARKUP_TOOLS.map(({ label, format, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onMouseDown={(event: ReactMouseEvent<HTMLButtonElement>) => event.preventDefault()}
            onClick={() => applyFormat(format)}
            disabled={disabled}
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
