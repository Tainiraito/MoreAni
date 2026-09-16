/**
 * 轻量级 contenteditable 状态管理 Hook。
 *
 * 借鉴 editate 的思路：
 * - source of truth 是纯字符串（带 markup token）
 * - 渲染由外部提供（React 组件或 innerHTML）
 * - beforeinput 事件捕获编辑 → 更新 source → 同步 DOM → 恢复光标
 * - 不依赖外部库，核心逻辑 ~150 行
 */
import { useCallback, useEffect, useRef } from 'react'

import {
  renderEditableReviewMarkup,
  serializeReviewEditor,
} from '@/lib/review-markup'

export interface UseReviewEditorOptions {
  /** 初始/受控 source 文本 */
  value: string
  /** source 变化回调 */
  onChange: (nextValue: string) => void
  /** 是否禁用编辑 */
  disabled?: boolean
}

export interface UseReviewEditorReturn {
  /** 绑定到 contenteditable div 的 ref */
  editorRef: React.RefObject<HTMLDivElement | null>
  /** 将光标放到编辑器末尾 */
  focus(): void
}

/**
 * 计算光标在 source 字符串中的偏移。
 * 当光标在格式 span 内部时，需要加上 opening token 的长度。
 */
function getSourceOffsetForCaret(
  root: HTMLElement,
  container: Node,
  offset: number,
): number {
  // 如果光标在 root 上（直接子节点之间）
  if (container === root) {
    const children = Array.from(root.childNodes)
    let sourceOffset = 0
    for (let i = 0; i < Math.min(offset, children.length); i++) {
      sourceOffset += getNodeSourceLength(children[i])
    }
    return sourceOffset
  }

  // 向上遍历，找到最近的格式祖先和根路径
  let current: Node = container
  let localOffset = offset
  let formatAncestorTokenLen = 0

  while (current !== root) {
    const parent = current.parentNode
    if (!parent) break

    // 如果父节点是格式 span，记录其 token 长度
    if (parent instanceof HTMLElement && parent.dataset.reviewFormat) {
      formatAncestorTokenLen = getTokenLength(parent.dataset.reviewFormat)
    }

    localOffset = Array.from(parent.childNodes).indexOf(current as ChildNode)
    current = parent
  }

  if (current !== root) return 0

  // 计算 root 层级的 source offset
  const children = Array.from(root.childNodes)
  let sourceOffset = 0
  for (let i = 0; i < Math.min(localOffset, children.length); i++) {
    sourceOffset += getNodeSourceLength(children[i])
  }

  // 进入目标子节点
  if (localOffset < children.length) {
    const child = children[localOffset]
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.nodeValue ?? '').replace(/\u200B/g, '')
      sourceOffset += Math.min(offset, text.length)
    } else if (child instanceof HTMLElement && child.dataset.reviewFormat) {
      // 光标在格式 span 内部：opening token + 内容偏移
      sourceOffset += getTokenLength(child.dataset.reviewFormat)
      sourceOffset += getSourceOffsetInChildren(child, offset)
    } else if (child instanceof HTMLElement) {
      sourceOffset += getSourceOffsetInChildren(child, offset)
    }
  }

  // 如果光标在格式 span 内部，加上 opening token 长度
  sourceOffset += formatAncestorTokenLen

  return sourceOffset
}

function getSourceOffsetInChildren(parent: HTMLElement, offset: number): number {
  const children = Array.from(parent.childNodes)
  let sourceOffset = 0
  for (let i = 0; i < Math.min(offset, children.length); i++) {
    sourceOffset += getNodeSourceLength(children[i])
  }
  return sourceOffset
}

function getNodeSourceLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.nodeValue ?? '').replace(/\u200B/g, '').length
  }
  if (node instanceof HTMLBRElement) return 1
  if (!(node instanceof HTMLElement)) return 0

  const children = Array.from(node.childNodes)
  const contentLength = children.reduce((len, child) => len + getNodeSourceLength(child), 0)

  const format = node.dataset.reviewFormat
  if (format) {
    return getTokenLength(format) + contentLength + getTokenLength(format)
  }

  return contentLength
}

function getTokenLength(format: string): number {
  const tokens: Record<string, number> = {
    italic: 1,     // *
    bold: 2,       // **
    underline: 2,  // __
    strike: 2,     // ~~
    'inline-spoiler': 2, // ||
  }
  return tokens[format] ?? 0
}

export function useReviewEditor({
  value,
  onChange,
  disabled = false,
}: UseReviewEditorOptions): UseReviewEditorReturn {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const sourceRef = useRef(value)
  const composingRef = useRef(false)
  const savedOffsetRef = useRef<number | null>(null)

  // 同步外部 value
  useEffect(() => {
    if (value !== sourceRef.current) {
      sourceRef.current = value
      const editor = editorRef.current
      if (editor && !composingRef.current) {
        const savedSel = saveSelection(editor)
        editor.innerHTML = renderEditableReviewMarkup(value, new Set())
        if (savedSel) restoreSelection(editor, savedSel)
      }
    }
  }, [value])

  // beforeinput 处理
  const handleBeforeInput = useCallback(
    (e: Event) => {
      if (disabled || composingRef.current) return
      const inputEvent = e as InputEvent
      const editor = editorRef.current
      if (!editor) return

      // 换行统一为 \n
      if (inputEvent.inputType === 'insertParagraph' || inputEvent.inputType === 'insertLineBreak') {
        e.preventDefault()
        document.execCommand('insertText', false, '\n')
        return
      }
    },
    [disabled],
  )

  // input 事件：浏览器编辑后同步 source
  const handleInput = useCallback(() => {
    if (disabled || composingRef.current) return
    const editor = editorRef.current
    if (!editor) return

    // 保存光标 source offset
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      if (editor.contains(range.commonAncestorContainer)) {
        savedOffsetRef.current = getSourceOffsetForCaret(
          editor,
          range.startContainer,
          range.startOffset,
        )
      }
    }

    // 序列化 DOM → source
    const nextSource = serializeReviewEditor(editor)
    if (nextSource !== sourceRef.current) {
      sourceRef.current = nextSource
      onChange(nextSource)
    }
  }, [disabled, onChange])

  // composition 事件：输入法兼容
  const handleCompositionStart = useCallback(() => {
    composingRef.current = true
  }, [])

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false
    // 输入法结束后同步一次
    handleInput()
  }, [handleInput])

  // 绑定事件
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    editor.addEventListener('beforeinput', handleBeforeInput)
    editor.addEventListener('input', handleInput)
    editor.addEventListener('compositionstart', handleCompositionStart)
    editor.addEventListener('compositionend', handleCompositionEnd)

    return () => {
      editor.removeEventListener('beforeinput', handleBeforeInput)
      editor.removeEventListener('input', handleInput)
      editor.removeEventListener('compositionstart', handleCompositionStart)
      editor.removeEventListener('compositionend', handleCompositionEnd)
    }
  }, [handleBeforeInput, handleInput, handleCompositionStart, handleCompositionEnd])

  // 初始化 DOM
  useEffect(() => {
    const editor = editorRef.current
    if (editor && editor.innerHTML !== renderEditableReviewMarkup(value, new Set())) {
      editor.innerHTML = renderEditableReviewMarkup(value, new Set())
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const focus = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    // 光标放到末尾
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    const sel = window.getSelection()
    if (sel) {
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }, [])

  return { editorRef, focus }
}

// ── 选区工具函数 ──

interface SavedSelection {
  startContainer: Node
  startOffset: number
  endContainer: Node
  endOffset: number
}

function saveSelection(root: HTMLElement): SavedSelection | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  return {
    startContainer: range.startContainer,
    startOffset: range.startOffset,
    endContainer: range.endContainer,
    endOffset: range.endOffset,
  }
}

function restoreSelection(root: HTMLElement, saved: SavedSelection): void {
  if (!root.contains(saved.startContainer) || !root.contains(saved.endContainer)) return
  const range = document.createRange()
  range.setStart(saved.startContainer, saved.startOffset)
  range.setEnd(saved.endContainer, saved.endOffset)
  const sel = window.getSelection()
  if (sel) {
    sel.removeAllRanges()
    sel.addRange(range)
  }
}
