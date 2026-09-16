/**
 * ReviewEditor v2 — 基于 editate 思路的轻量级评论编辑器。
 *
 * 核心思路：
 * - source of truth 是纯字符串（带 markup token: **bold**, *italic* 等）
 * - contenteditable DOM 由 ref 直接管理（不走 React reconciliation）
 * - beforeinput/input 事件捕获编辑 → 序列化 DOM → 更新 source
 * - 格式操作通过 source 文本的 regex 替换实现
 * - 代码量从 ~900 行降到 ~250 行
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Bold, Italic, Strikethrough, Underline, EyeOff, type LucideIcon } from 'lucide-react'

import {
  renderEditableReviewMarkup,
  serializeReviewEditor,
  REVIEW_MARKUP_TOKENS,
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

// ── DOM 辅助 ──

function getClosestFormatElement(node: Node | null, editor: HTMLElement, format: string): HTMLElement | null {
  let current = node
  while (current && current !== editor) {
    if (current instanceof HTMLElement && current.dataset.reviewFormat === format) return current
    current = current.parentNode
  }
  return null
}

function findAdjacentFormat(editor: HTMLElement, range: Range, side: 'start' | 'end'): HTMLElement | null {
  const container = range.startContainer
  if (container === editor) {
    // 光标在编辑器根节点上
    if (side === 'start') {
      // Backspace：检查 offset 位置的子节点（光标前面的那个）
      const idx = range.startOffset
      if (idx > 0) {
        const child = editor.childNodes[idx - 1]
        return child instanceof HTMLElement && child.dataset.reviewFormat ? child : null
      }
      // offset=0：光标在最前面，第一个子节点如果是格式块就删除
      const firstChild = editor.firstChild
      return firstChild instanceof HTMLElement && firstChild.dataset.reviewFormat ? firstChild : null
    } else {
      // Delete：检查 offset 位置的子节点（光标后面的那个）
      const child = editor.childNodes[range.startOffset]
      return child instanceof HTMLElement && child.dataset.reviewFormat ? child : null
    }
  }
  if (container instanceof HTMLElement) {
    const idx = side === 'start' ? range.startOffset - 1 : range.startOffset
    const child = container.childNodes[idx]
    return child instanceof HTMLElement && child.dataset.reviewFormat ? child : null
  }
  return null
}

// ── 选区工具 ──

function saveSelection(root: HTMLElement): { sc: Node; so: number; ec: Node; eo: number } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  return {
    sc: range.startContainer, so: range.startOffset,
    ec: range.endContainer, eo: range.endOffset,
  }
}

function restoreSelection(root: HTMLElement, saved: { sc: Node; so: number; ec: Node; eo: number }): void {
  if (!root.contains(saved.sc) || !root.contains(saved.ec)) return
  const range = document.createRange()
  range.setStart(saved.sc, saved.so)
  range.setEnd(saved.ec, saved.eo)
  const sel = window.getSelection()
  if (sel) { sel.removeAllRanges(); sel.addRange(range) }
}

// ── 选区插入 ──

function insertTextAtSelection(text: string): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  range.deleteContents()

  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const fragment = document.createDocumentFragment()
  lines.forEach((line, index) => {
    if (index > 0) fragment.appendChild(document.createElement('br'))
    if (line) fragment.appendChild(document.createTextNode(line))
  })

  const lastNode = fragment.lastChild
  range.insertNode(fragment)

  // 光标放到插入内容之后
  if (lastNode) {
    const newRange = document.createRange()
    newRange.setStartAfter(lastNode)
    newRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(newRange)
  }
  return true
}

// ── 组件 ──

export function ReviewEditor({
  value,
  onChange,
  disabled = false,
  placeholder = '写点评论吧...（可选）',
  rows = 2,
}: ReviewEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef(value)
  const composingRef = useRef(false)
  const [spoilerRevealed, setSpoilerRevealed] = useState<ReadonlySet<string>>(new Set())

  // 初始化 DOM（同步，确保首次渲染后立即可用）
  useEffect(() => {
    const editor = editorRef.current
    if (editor) {
      const expected = renderEditableReviewMarkup(value, new Set())
      if (editor.innerHTML !== expected) {
        editor.innerHTML = expected
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 同步外部 value
  useEffect(() => {
    if (value !== sourceRef.current) {
      sourceRef.current = value
      const editor = editorRef.current
      if (editor && !composingRef.current) {
        const saved = saveSelection(editor)
        editor.innerHTML = renderEditableReviewMarkup(value, spoilerRevealed)
        if (saved) restoreSelection(editor, saved)
      }
    }
  }, [value, spoilerRevealed])

  // 序列化 DOM → source → onChange
  const syncFromDom = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const nextSource = serializeReviewEditor(editor)
    if (nextSource !== sourceRef.current) {
      sourceRef.current = nextSource
      onChange(nextSource)
    }
  }, [onChange])

  // ── 事件处理 ──

  const handleBeforeInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    if (disabled || composingRef.current) return
    const inputEvent = e.nativeEvent as InputEvent
    if (inputEvent.inputType === 'insertParagraph' || inputEvent.inputType === 'insertLineBreak') {
      e.preventDefault()
      if (insertTextAtSelection('\n')) syncFromDom()
    }
  }, [disabled, syncFromDom])

  const handleInput = useCallback(() => {
    if (disabled || composingRef.current) return
    syncFromDom()
  }, [disabled, syncFromDom])

  const handleCompositionStart = useCallback(() => { composingRef.current = true }, [])
  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false
    syncFromDom()
  }, [syncFromDom])

  // ── 格式操作 ──

  const applyFormat = useCallback((format: ReviewMarkupFormat) => {
    const editor = editorRef.current
    if (!editor || disabled) return

    const sel = window.getSelection()
    const token = REVIEW_MARKUP_TOKENS[format]

    // 有选区且在编辑器内
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      if (editor.contains(range.commonAncestorContainer) && !range.collapsed) {
        // 检查选区是否已被该格式包裹 → 取消格式
        const startEl = getClosestFormatElement(range.startContainer, editor, format)
        const endEl = getClosestFormatElement(range.endContainer, editor, format)
        if (startEl && startEl === endEl) {
          // 已包裹 → 移除格式（保留内容）
          const parent = startEl.parentNode
          if (parent) {
            while (startEl.firstChild) parent.insertBefore(startEl.firstChild, startEl)
            startEl.remove()
          }
          syncFromDom()
          return
        }

        // 包裹选中文本
        const wrapper = document.createElement('span')
        wrapper.dataset.reviewFormat = format
        wrapper.dataset.reviewToken = token
        wrapper.appendChild(range.extractContents())
        range.insertNode(wrapper)
        const selectedRange = document.createRange()
        selectedRange.selectNodeContents(wrapper)
        sel.removeAllRanges()
        sel.addRange(selectedRange)
        syncFromDom()
        return
      }
    }

    // 无选区 / 选区不在编辑器内 → 格式化全部内容
    const allRange = document.createRange()
    allRange.selectNodeContents(editor)
    const wrapper = document.createElement('span')
    wrapper.dataset.reviewFormat = format
    wrapper.dataset.reviewToken = token
    wrapper.appendChild(allRange.extractContents())
    allRange.insertNode(wrapper)
    const caretRange = document.createRange()
    caretRange.selectNodeContents(wrapper)
    caretRange.collapse(false)
    const newSel = window.getSelection()
    if (newSel) { newSel.removeAllRanges(); newSel.addRange(caretRange) }
    syncFromDom()
  }, [disabled, syncFromDom])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (disabled) return

    // Ctrl/Cmd + B/I/U/S 格式快捷键
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const shortcut = e.key.toLowerCase()
      const format = SHORTCUT_FORMATS[shortcut]
      if (format) {
        e.preventDefault()
        applyFormat(format)
        return
      }
      return
    }

    // Backspace/Delete：删除光标旁的格式块 或 删除选中的格式内容
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const editor = editorRef.current
      if (!editor) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      if (!editor.contains(range.commonAncestorContainer)) return

      // 有选区：检查是否选中了整个格式块的内容
      if (!range.collapsed) {
        for (const tool of MARKUP_TOOLS) {
          const startEl = getClosestFormatElement(range.startContainer, editor, tool.format)
          const endEl = getClosestFormatElement(range.endContainer, editor, tool.format)
          if (startEl && startEl === endEl) {
            // 选区完全在同一个格式块内 → 移除格式块
            e.preventDefault()
            const parent = startEl.parentNode
            if (parent) {
              while (startEl.firstChild) parent.insertBefore(startEl.firstChild, startEl)
              startEl.remove()
            }
            syncFromDom()
            return
          }
        }
        return // 有选区但不在格式块内，让浏览器处理
      }

      // 无选区：找光标旁边的格式元素
      // 1. 检查光标是否在格式块边界（内部边界）
      let boundaryFormat: HTMLElement | null = null
      let current: Node | null = range.startContainer
      while (current && current !== editor) {
        if (current instanceof HTMLElement && current.dataset.reviewFormat) {
          // 检查光标是否在格式块的开头（Backspace）或结尾（Delete）
          const isAtStart = range.startOffset === 0 && current.contains(range.startContainer)
          const isAtEnd = range.startContainer === current
            ? range.startOffset === current.childNodes.length
            : range.startOffset === (range.startContainer.nodeValue?.length ?? 0)
              && range.startContainer.parentNode === current
          if ((e.key === 'Backspace' && isAtStart) || (e.key === 'Delete' && isAtEnd)) {
            boundaryFormat = current
            break
          }
        }
        current = current.parentNode
      }
      if (boundaryFormat) {
        e.preventDefault()
        const parent = boundaryFormat.parentNode
        if (parent) {
          while (boundaryFormat.firstChild) parent.insertBefore(boundaryFormat.firstChild, boundaryFormat)
          boundaryFormat.remove()
        }
        syncFromDom()
        return
      }

      // 2. 检查光标旁边的兄弟格式元素
      const side = e.key === 'Backspace' ? 'start' : 'end'
      const adjacent = findAdjacentFormat(editor, range, side)
      if (adjacent) {
        e.preventDefault()
        const parent = adjacent.parentNode
        if (parent) {
          while (adjacent.firstChild) parent.insertBefore(adjacent.firstChild, adjacent)
          adjacent.remove()
        }
        syncFromDom()
        return
      }
    }

    // Enter → 插入换行
    if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey || e.altKey)) {
      e.preventDefault()
      if (insertTextAtSelection('\n')) syncFromDom()
      return
    }
  }, [disabled, applyFormat, syncFromDom])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (disabled) return
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (text && insertTextAtSelection(text)) syncFromDom()
  }, [disabled, syncFromDom])

  // ── 剧透切换 ──

  const handleClick = useCallback((e: ReactMouseEvent) => {
    const target = e.target instanceof HTMLElement
      ? e.target.closest<HTMLElement>('[data-review-spoiler="true"]')
      : null
    if (!target || !editorRef.current?.contains(target)) return

    const nodeId = target.dataset.reviewNodeId
    if (!nodeId) return

    setSpoilerRevealed(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      // 更新 DOM 中的 revealed 属性
      if (target.hasAttribute('data-review-revealed')) {
        target.removeAttribute('data-review-revealed')
      } else {
        target.setAttribute('data-review-revealed', 'true')
      }
      return next
    })
  }, [])

  // ── 渲染 ──

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
          onBeforeInput={handleBeforeInput}
          onPaste={handlePaste}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onClick={handleClick}
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
            onMouseDown={(e: ReactMouseEvent<HTMLButtonElement>) => e.preventDefault()}
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
