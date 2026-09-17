/**
 * ReviewEditor v3 — 源字符串为唯一真相，DOM 是渲染结果。
 *
 * 核心思路（借鉴 editate）：
 * - 源字符串是唯一真相（**bold**, *italic* 等 markup token）
 * - DOM 由 renderEditableReviewMarkup 从源字符串渲染
 * - 每次编辑后，serializeReviewEditor 把 DOM 序列化回源字符串
 * - 如果源字符串变了，重新渲染 DOM 并恢复光标
 * - 格式操作直接修改源字符串，不手动操作 DOM
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Bold, Italic, Strikethrough, Underline, EyeOff, type LucideIcon } from 'lucide-react'

import {
  renderEditableReviewMarkup,
  serializeReviewEditor,
  getReviewEditorSelection,
  restoreReviewEditorSelection,
  REVIEW_MARKUP_TOKENS,
  type ReviewMarkupFormat,
  type ReviewEditorSelection,
} from '@/lib/review-markup'

// ── 格式检测 ──

/** 检查选区是否被匹配的格式 token 对包围，或恰好匹配一个格式块 */
function isSelectionWrappedByFormat(source: string, start: number, end: number, token: string): boolean {
  const tLen = token.length
  if (start < 0 || end > source.length) return false

  // 向前搜索匹配的开头 token（遇到非 token 文本不停止，继续搜索）
  function findOpenToken(pos: number): number {
    for (let i = pos - 1; i >= 0; i--) {
      if (source.slice(i, i + tLen) === token) return i
    }
    return -1
  }

  // 向后搜索匹配的结尾 token
  function findCloseToken(pos: number): number {
    for (let j = pos; j <= source.length - tLen; j++) {
      if (source.slice(j, j + tLen) === token) return j
    }
    return -1
  }

  // 检查两个 token 之间是否有非空白内容
  function hasContentBetween(openEnd: number, closeStart: number): boolean {
    return source.slice(openEnd, closeStart).replaceAll(/\s/g, '').length > 0
  }

  // Case 1: 选区在 token 对内部（选区不包含 token）
  {
    const openPos = findOpenToken(start)
    if (openPos >= 0) {
      const closePos = findCloseToken(end)
      if (closePos >= 0 && hasContentBetween(openPos + tLen, closePos)) return true
    }
  }

  // Case 2: 选区恰好包含 token 对（选中了整个格式块包括 token）
  if (start >= tLen && end + tLen <= source.length) {
    if (source.slice(start - tLen, start) === token
      && source.slice(end, end + tLen) === token
      && hasContentBetween(start, end)) {
      return true
    }
  }

  // Case 3: 选区从位置 0 开始且 source 以 token 开头 + 选区后有匹配的结尾 token
  if (start === 0 && source.slice(0, tLen) === token) {
    // 结尾 token 可能在选区末尾（选区覆盖整个源）或选区之后
    if (end + tLen <= source.length && source.slice(end, end + tLen) === token && hasContentBetween(tLen, end)) {
      return true
    }
    // 选区覆盖到源末尾，检查源是否以 token 结尾
    if (end === source.length && source.slice(end - tLen, end) === token && hasContentBetween(tLen, end - tLen)) {
      return true
    }
  }

  return false
}

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

// ── 源字符串操作 ──

/** 在源字符串的指定偏移处插入文本 */
function insertIntoSource(source: string, offset: number, text: string): string {
  return source.slice(0, offset) + text + source.slice(offset)
}

/** 在源字符串中包裹格式 token */
function wrapWithFormat(source: string, start: number, end: number, format: ReviewMarkupFormat): string {
  const token = REVIEW_MARKUP_TOKENS[format]
  return source.slice(0, start) + token + source.slice(start, end) + token + source.slice(end)
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
  const historyRef = useRef<string[]>([value])
  const historyIndexRef = useRef(0)

  // ── 从源字符串渲染 DOM ──

  const renderFromSource = useCallback((source: string, selection?: ReviewEditorSelection) => {
    const editor = editorRef.current
    if (!editor) return
    const html = renderEditableReviewMarkup(source, spoilerRevealed)
    // 总是更新 innerHTML（spoilerRevealed 变化时 HTML 会不同）
    editor.innerHTML = html
    if (selection) {
      restoreReviewEditorSelection(editor, selection)
    }
  }, [spoilerRevealed])

  // 初始化 DOM
  useEffect(() => {
    const editor = editorRef.current
    if (editor) {
      editor.innerHTML = renderEditableReviewMarkup(value, new Set())
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 同步外部 value
  useEffect(() => {
    if (value !== sourceRef.current) {
      sourceRef.current = value
      const editor = editorRef.current
      if (editor && !composingRef.current) {
        // 保存当前选区
        const sel = getReviewEditorSelection(editor)
        editor.innerHTML = renderEditableReviewMarkup(value, spoilerRevealed)
        if (sel) restoreReviewEditorSelection(editor, sel)
      }
    }
  }, [value, spoilerRevealed])

  // ── 核心：输入后同步源字符串 ──

  const syncAfterInput = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return

    // 1. 保存当前选区为源偏移
    const sel = getReviewEditorSelection(editor)

    // 2. 序列化 DOM → 新源字符串
    const newSource = serializeReviewEditor(editor)

    // 3. 如果源字符串变了，更新并重新渲染
    if (newSource !== sourceRef.current) {
      sourceRef.current = newSource

      // 记录历史
      const history = historyRef.current
      const idx = historyIndexRef.current
      history.length = idx + 1
      history.push(newSource)
      historyIndexRef.current = history.length - 1

      onChange(newSource)

      // 重新渲染（使用保存的选区）
      const html = renderEditableReviewMarkup(newSource, spoilerRevealed)
      if (editor.innerHTML !== html) {
        editor.innerHTML = html
        if (sel) restoreReviewEditorSelection(editor, sel)
      }
    }
  }, [onChange, spoilerRevealed])

  // ── 事件处理 ──

  // 暂存 beforeinput 时的选区和源字符串
  const beforeInputSelRef = useRef<{ sel: ReviewEditorSelection; source: string } | null>(null)

  const handleInput = useCallback(() => {
    if (disabled || composingRef.current) return
    const editor = editorRef.current
    if (!editor) return

    const saved = beforeInputSelRef.current
    beforeInputSelRef.current = null

    // 暂存的 InputEvent
    const inputEvent = (window as any).__lastInputEvent as InputEvent | undefined
    ;(window as any).__lastInputEvent = null

    // 根据 inputType 直接操作源字符串
    let newSource: string | null = null
    let newCursor = 0

    if (saved && inputEvent) {
      const { sel: prevSel, source: prevSource } = saved
      newCursor = prevSel.start

      const it = inputEvent.inputType
      if (it === 'insertText' && inputEvent.data) {
        if (prevSel.start !== prevSel.end) {
          newSource = prevSource.slice(0, prevSel.start) + inputEvent.data + prevSource.slice(prevSel.end)
        } else {
          newSource = insertIntoSource(prevSource, prevSel.start, inputEvent.data)
        }
        newCursor = prevSel.start + inputEvent.data.length
      } else if (it === 'deleteContentBackward') {
        if (prevSel.start !== prevSel.end) {
          newSource = prevSource.slice(0, prevSel.start) + prevSource.slice(prevSel.end)
          newCursor = prevSel.start
        } else if (prevSel.start > 0) {
          newSource = prevSource.slice(0, prevSel.start - 1) + prevSource.slice(prevSel.start)
          newCursor = prevSel.start - 1
        }
      } else if (it === 'deleteContentForward') {
        if (prevSel.start !== prevSel.end) {
          newSource = prevSource.slice(0, prevSel.start) + prevSource.slice(prevSel.end)
          newCursor = prevSel.start
        } else if (prevSel.start < prevSource.length) {
          newSource = prevSource.slice(0, prevSel.start) + prevSource.slice(prevSel.start + 1)
          newCursor = prevSel.start
        }
      }
    }

    if (!newSource) {
      // fallback：用 serializeReviewEditor（普通编辑器外的修改）
      newSource = serializeReviewEditor(editor)
    }

    if (newSource && newSource !== sourceRef.current) {
      sourceRef.current = newSource
      const history = historyRef.current
      const idx = historyIndexRef.current
      history.length = idx + 1
      history.push(newSource)
      historyIndexRef.current = history.length - 1
      onChange(newSource)
      renderFromSource(newSource, { start: newCursor, end: newCursor })
    }
  }, [disabled, onChange, renderFromSource])

  const handleBeforeInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    if (disabled || composingRef.current) return
    const editor = editorRef.current
    if (!editor) return

    // 保存 beforeinput 时的选区和源字符串
    const sel = getReviewEditorSelection(editor)
    if (sel) {
      beforeInputSelRef.current = { sel, source: sourceRef.current }
    }

    // 暂存 InputEvent 给 handleInput 使用
    const inputEvent = e.nativeEvent as InputEvent
    ;(window as any).__lastInputEvent = inputEvent

    // Enter 键：插入换行而非段落
    if (inputEvent.inputType === 'insertParagraph' || inputEvent.inputType === 'insertLineBreak') {
      e.preventDefault()
      if (!sel) return
      const newSource = insertIntoSource(sourceRef.current, sel.start, '\n')
      sourceRef.current = newSource
      const history = historyRef.current
      const idx = historyIndexRef.current
      history.length = idx + 1
      history.push(newSource)
      historyIndexRef.current = history.length - 1
      onChange(newSource)
      renderFromSource(newSource, { start: sel.start + 1, end: sel.start + 1 })
    }
  }, [disabled, onChange, renderFromSource])

  const handleCompositionStart = useCallback(() => { composingRef.current = true }, [])
  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false
    syncAfterInput()
  }, [syncAfterInput])

  // ── 格式操作（直接修改源字符串） ──

  const applyFormat = useCallback((format: ReviewMarkupFormat) => {
    const editor = editorRef.current
    if (!editor || disabled) return

    const sel = getReviewEditorSelection(editor)
    if (!sel) return

    const token = REVIEW_MARKUP_TOKENS[format]
    const source = sourceRef.current


    if (sel.start === sel.end) {
      // ── 光标无选区 ──
      // 检查光标是否在匹配的格式 token 对内部
      if (isSelectionWrappedByFormat(source, sel.start, sel.start, token)) {
        // 光标在格式块内 → 找到 token 对并移除
        let openPos = -1
        for (let i = sel.start - 1; i >= 0; i--) {
          if (source.slice(i, i + token.length) === token) { openPos = i; break }
        }
        let closePos = -1
        for (let j = sel.start; j <= source.length - token.length; j++) {
          if (source.slice(j, j + token.length) === token) { closePos = j; break }
        }
        if (openPos >= 0 && closePos >= 0) {
          const newSource = source.slice(0, openPos) + source.slice(openPos + token.length, closePos) + source.slice(closePos + token.length)
          sourceRef.current = newSource
          const history = historyRef.current
          const idx = historyIndexRef.current
          history.length = idx + 1
          history.push(newSource)
          historyIndexRef.current = history.length - 1
          onChange(newSource)
          renderFromSource(newSource, { start: sel.start - token.length, end: sel.start - token.length })
          return
        }
      }
      // 光标不在同格式块内 → 插入空格式对
      const newSource = insertIntoSource(source, sel.start, token + token)
      sourceRef.current = newSource
      const history = historyRef.current
      const idx = historyIndexRef.current
      history.length = idx + 1
      history.push(newSource)
      historyIndexRef.current = history.length - 1
      onChange(newSource)
      // 光标放在两个 token 之间
      renderFromSource(newSource, { start: sel.start + token.length, end: sel.start + token.length })
      return
    }

    // ── 有选区 ──
    // 检查选区是否已被该格式 token 对包围
    if (isSelectionWrappedByFormat(source, sel.start, sel.end, token)) {
      const tLen = token.length
      // 向前搜索匹配的开头 token
      let openPos = -1
      for (let i = sel.start - 1; i >= 0; i--) {
        if (source.slice(i, i + tLen) === token) { openPos = i; break }
      }
      // 向后搜索匹配的结尾 token
      let closePos = -1
      for (let j = sel.end; j <= source.length - tLen; j++) {
        if (source.slice(j, j + tLen) === token) { closePos = j; break }
      }

      // Case 2: 选区恰好包含 token 对
      if (openPos < 0 && sel.start >= tLen && sel.end + tLen <= source.length) {
        if (source.slice(sel.start - tLen, sel.start) === token
          && source.slice(sel.end, sel.end + tLen) === token) {
          openPos = sel.start - tLen
          closePos = sel.end
        }
      }

      // Case 3: 选区从位置 0 开始
      if (openPos < 0 && sel.start === 0 && source.slice(0, tLen) === token) {
        if (sel.end + tLen <= source.length && source.slice(sel.end, sel.end + tLen) === token) {
          openPos = 0
          closePos = sel.end
        } else if (sel.end === source.length && source.slice(sel.end - tLen, sel.end) === token) {
          openPos = 0
          closePos = sel.end - tLen
        }
      }

      if (openPos >= 0 && closePos >= 0) {
        const newSource = source.slice(0, openPos) + source.slice(openPos + tLen, closePos) + source.slice(closePos + tLen)
        sourceRef.current = newSource
        const history = historyRef.current
        const idx = historyIndexRef.current
        history.length = idx + 1
        history.push(newSource)
        historyIndexRef.current = history.length - 1
        onChange(newSource)
        const newStart = Math.min(sel.start - tLen, openPos + tLen)
        const newEnd = Math.min(sel.end - tLen, closePos)
        renderFromSource(newSource, { start: Math.max(0, newStart), end: Math.max(0, newEnd) })
        return
      }
    }

    // 包裹选中文本
    const newSource = wrapWithFormat(source, sel.start, sel.end, format)
    sourceRef.current = newSource
    const history = historyRef.current
    const idx = historyIndexRef.current
    history.length = idx + 1
    history.push(newSource)
    historyIndexRef.current = history.length - 1
    onChange(newSource)
    renderFromSource(newSource, { start: sel.end + token.length, end: sel.end + token.length })
  }, [disabled, onChange, renderFromSource])

  // ── 键盘处理 ──

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (disabled) return

    // Ctrl/Cmd 操作
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const shortcut = e.key.toLowerCase()

      // Ctrl+Z 撤销
      if (shortcut === 'z' && !e.shiftKey) {
        e.preventDefault()
        const idx = historyIndexRef.current
        if (idx > 0) {
          historyIndexRef.current = idx - 1
          const prev = historyRef.current[idx - 1]
          sourceRef.current = prev
          onChange(prev)
          renderFromSource(prev)
        }
        return
      }

      // Ctrl+Shift+Z / Ctrl+Y 重做
      if ((shortcut === 'z' && e.shiftKey) || shortcut === 'y') {
        e.preventDefault()
        const history = historyRef.current
        const idx = historyIndexRef.current
        if (idx < history.length - 1) {
          historyIndexRef.current = idx + 1
          const next = history[idx + 1]
          sourceRef.current = next
          onChange(next)
          renderFromSource(next)
        }
        return
      }

      // Ctrl+B/I/U/S 格式快捷键
      const format = SHORTCUT_FORMATS[shortcut]
      if (format) {
        e.preventDefault()
        applyFormat(format)
        return
      }
      return
    }

    // Backspace/Delete：选中文本时，如果选区在格式块内，清除格式 token
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const editor = editorRef.current
      if (!editor) return
      const sel = getReviewEditorSelection(editor)
      if (!sel) return

      const source = sourceRef.current

      // ── Collapsed: 检查光标是否在格式块边界 ──
      if (sel.start === sel.end) {
        for (const tool of MARKUP_TOOLS) {
          const token = REVIEW_MARKUP_TOKENS[tool.format]
          const tLen = token.length
          // 光标在开头 token 内部（Backspace → 删除整个格式块）
          if (e.key === 'Backspace' && source.slice(sel.start - tLen, sel.start) === token) {
            // 向前找到完整的开头 token
            const openStart = sel.start - tLen
            // 向后找到匹配的结尾 token
            for (let j = sel.start; j <= source.length - tLen; j++) {
              if (source.slice(j, j + tLen) === token) {
                e.preventDefault()
                const newSource = source.slice(0, openStart) + source.slice(openStart + tLen, j) + source.slice(j + tLen)
                sourceRef.current = newSource
                const history = historyRef.current
                const idx = historyIndexRef.current
                history.length = idx + 1
                history.push(newSource)
                historyIndexRef.current = history.length - 1
                onChange(newSource)
                renderFromSource(newSource, { start: openStart, end: openStart })
                return
              }
            }
          }
          // 光标在结尾 token 内部（Delete → 删除整个格式块）
          if (e.key === 'Delete' && source.slice(sel.start, sel.start + tLen) === token) {
            const closeStart = sel.start
            // 向前找到匹配的开头 token
            for (let i = closeStart - 1; i >= 0; i--) {
              if (source.slice(i, i + tLen) === token) {
                e.preventDefault()
                const newSource = source.slice(0, i) + source.slice(i + tLen, closeStart) + source.slice(closeStart + tLen)
                sourceRef.current = newSource
                const history = historyRef.current
                const idx = historyIndexRef.current
                history.length = idx + 1
                history.push(newSource)
                historyIndexRef.current = history.length - 1
                onChange(newSource)
                renderFromSource(newSource, { start: i, end: i })
                return
              }
            }
          }
        }

        // 空格式对 Backspace: 光标在 `token + token` 中间，或紧接在 `token + token` 后面
        for (const tool of MARKUP_TOOLS) {
          const token = REVIEW_MARKUP_TOKENS[tool.format]
          const tLen = token.length
          // Case A: 光标在两个 token 中间
          if (e.key === 'Backspace'
            && sel.start >= tLen && sel.start <= source.length - tLen
            && source.slice(sel.start - tLen, sel.start) === token
            && source.slice(sel.start, sel.start + tLen) === token) {
            e.preventDefault()
            const newSource = source.slice(0, sel.start - tLen) + source.slice(sel.start + tLen)
            sourceRef.current = newSource
            const history = historyRef.current
            const idx = historyIndexRef.current
            history.length = idx + 1
            history.push(newSource)
            historyIndexRef.current = history.length - 1
            onChange(newSource)
            renderFromSource(newSource, { start: sel.start - tLen, end: sel.start - tLen })
            return
          }
          // Case B: 光标紧接在 `token + token` 后面
          if (e.key === 'Backspace'
            && sel.start >= tLen * 2
            && source.slice(sel.start - tLen * 2, sel.start) === token + token) {
            e.preventDefault()
            const newSource = source.slice(0, sel.start - tLen * 2) + source.slice(sel.start)
            sourceRef.current = newSource
            const history = historyRef.current
            const idx = historyIndexRef.current
            history.length = idx + 1
            history.push(newSource)
            historyIndexRef.current = history.length - 1
            onChange(newSource)
            renderFromSource(newSource, { start: sel.start - tLen * 2, end: sel.start - tLen * 2 })
            return
          }
        }

        return // collapsed 无匹配，让浏览器处理
      }

      // ── Non-collapsed: 选中文本时清除格式 token ──
      // 按 token 长度降序检查，避免 ** 被 * 先匹配
      const sortedTools = [...MARKUP_TOOLS].sort((a, b) =>
        REVIEW_MARKUP_TOKENS[b.format].length - REVIEW_MARKUP_TOKENS[a.format].length
      )
      for (const tool of sortedTools) {
        const token = REVIEW_MARKUP_TOKENS[tool.format]
        const wrapped = isSelectionWrappedByFormat(source, sel.start, sel.end, token)
        if (wrapped) {
          e.preventDefault()
          const tLen = token.length
          // 向前搜索匹配的开头 token
          let openPos = -1
          for (let i = sel.start - 1; i >= 0; i--) {
            if (source.slice(i, i + tLen) === token) { openPos = i; break }
          }
          // 向后搜索匹配的结尾 token
          let closePos = -1
          for (let j = sel.end; j <= source.length - tLen; j++) {
            if (source.slice(j, j + tLen) === token) { closePos = j; break }
          }

          // Case 2: 选区恰好包含 token 对
          if (openPos < 0 && sel.start >= tLen && sel.end + tLen <= source.length) {
            if (source.slice(sel.start - tLen, sel.start) === token
              && source.slice(sel.end, sel.end + tLen) === token) {
              openPos = sel.start - tLen
              closePos = sel.end
            }
          }

          // Case 3: 选区从位置 0 开始
          if (openPos < 0 && sel.start === 0 && source.slice(0, tLen) === token) {
            if (sel.end + tLen <= source.length && source.slice(sel.end, sel.end + tLen) === token) {
              openPos = 0
              closePos = sel.end
            } else if (sel.end === source.length && source.slice(sel.end - tLen, sel.end) === token) {
              openPos = 0
              closePos = sel.end - tLen
            }
          }

          if (openPos >= 0 && closePos >= 0) {
            const newSource = source.slice(0, openPos) + source.slice(openPos + tLen, closePos) + source.slice(closePos + tLen)
            sourceRef.current = newSource
            const history = historyRef.current
            const idx = historyIndexRef.current
            history.length = idx + 1
            history.push(newSource)
            historyIndexRef.current = history.length - 1
            onChange(newSource)
            const newStart = Math.min(sel.start - tLen, openPos + tLen)
            const newEnd = Math.min(sel.end - tLen, closePos)
            renderFromSource(newSource, { start: Math.max(0, newStart), end: Math.max(0, newEnd) })
            return
          }
        }
      }
      return // 让浏览器处理普通删除
    }

    // Enter → 插入换行
    if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey || e.altKey)) {
      e.preventDefault()
      const editor = editorRef.current
      if (!editor) return
      const sel = getReviewEditorSelection(editor)
      if (!sel) return
      const newSource = insertIntoSource(sourceRef.current, sel.start, '\n')
      sourceRef.current = newSource
      const history = historyRef.current
      const idx = historyIndexRef.current
      history.length = idx + 1
      history.push(newSource)
      historyIndexRef.current = history.length - 1
      onChange(newSource)
      renderFromSource(newSource, { start: sel.start + 1, end: sel.start + 1 })
      return
    }
  }, [disabled, applyFormat, onChange, renderFromSource])

  // ── 粘贴 ──

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (disabled) return
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (!text) return

    const editor = editorRef.current
    if (!editor) return
    const sel = getReviewEditorSelection(editor)
    if (!sel) return

    const newSource = insertIntoSource(sourceRef.current, sel.start, text)
    sourceRef.current = newSource
    const history = historyRef.current
    const idx = historyIndexRef.current
    history.length = idx + 1
    history.push(newSource)
    historyIndexRef.current = history.length - 1
    onChange(newSource)
    renderFromSource(newSource, { start: sel.start + text.length, end: sel.start + text.length })
  }, [disabled, onChange, renderFromSource])

  // ── Active format 标记 ──

  const updateActiveFormats = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const sel = window.getSelection()
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
    const insideEditor = range !== null && editor.contains(range.commonAncestorContainer)

    editor.querySelectorAll<HTMLElement>('[data-review-format]').forEach(el => {
      if (insideEditor && range && el.contains(range.commonAncestorContainer)) {
        el.setAttribute('data-review-active', 'true')
      } else {
        el.removeAttribute('data-review-active')
      }
    })
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', updateActiveFormats)
    return () => document.removeEventListener('selectionchange', updateActiveFormats)
  }, [updateActiveFormats])

  // ── 剧透切换 ──

  const handleClick = useCallback((e: ReactMouseEvent) => {
    const target = e.target instanceof HTMLElement
      ? e.target.closest<HTMLElement>('[data-review-spoiler="true"]')
      : null
    if (!target || !editorRef.current?.contains(target)) return

    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && sel.toString().length > 0) return

    const nodeId = target.dataset.reviewNodeId
    if (!nodeId) return

    // 直接操作 DOM 属性（不触发 re-render，保持元素引用稳定）
    setSpoilerRevealed(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
        target.removeAttribute('data-review-revealed')
      } else {
        next.add(nodeId)
        target.setAttribute('data-review-revealed', 'true')
      }
      return next
    })
  }, [])

  const handleKeyDownOnSpoiler = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const target = e.target instanceof HTMLElement
        ? e.target.closest<HTMLElement>('[data-review-spoiler="true"]')
        : null
      if (!target || !editorRef.current?.contains(target)) return
      e.preventDefault()
      const nodeId = target.dataset.reviewNodeId
      if (!nodeId) return
      setSpoilerRevealed(prev => {
        const next = new Set(prev)
        if (next.has(nodeId)) {
          next.delete(nodeId)
        } else {
          next.add(nodeId)
        }
        return next
      })
    }
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
          onKeyDownCapture={handleKeyDownOnSpoiler}
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
