import { createEvent, fireEvent, render, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReviewEditor } from '@/components/review/ReviewEditor'

function selectEditorContents(editor: HTMLElement): void {
  const range = document.createRange()
  range.selectNodeContents(editor)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function notifySelectionChange(): void {
  fireEvent(document, new Event('selectionchange'))
}

describe('ReviewEditor', () => {
  afterEach(() => {
    cleanup()
    window.getSelection()?.removeAllRanges()
  })

  it('serializes user input immediately without re-rendering the editing DOM', () => {
    const onChange = vi.fn()
    const view = render(<ReviewEditor value="" onChange={onChange} />)
    const editor = view.getByRole('textbox')

    editor.textContent = '输入评论'
    fireEvent.input(editor)

    expect(onChange).toHaveBeenLastCalledWith('输入评论')
    expect(editor).toHaveAttribute('contenteditable', 'true')
  })

  it('supports undo and redo without losing the editable selection', () => {
    const onChange = vi.fn()
    const view = render(<ReviewEditor value="" onChange={onChange} />)
    const editor = view.getByRole('textbox')

    editor.textContent = '第一版'
    fireEvent.input(editor)
    editor.textContent = '第二版'
    fireEvent.input(editor)

    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true })
    expect(editor.textContent).toBe('第一版')
    expect(onChange).toHaveBeenLastCalledWith('第一版')

    fireEvent.keyDown(editor, { key: 'y', ctrlKey: true })
    expect(editor.textContent).toBe('第二版')
    expect(onChange).toHaveBeenLastCalledWith('第二版')
  })

  it('hydrates existing markup as editable format nodes without showing source tokens', () => {
    const view = render(
      <ReviewEditor
        value="*斜体* **加粗** __下划线__ ~~删除线~~ ||防剧透||"
        onChange={vi.fn()}
      />,
    )
    const editor = view.getByRole('textbox')

    expect(editor.textContent).toBe('斜体 加粗 下划线 删除线 防剧透')
    expect(editor.querySelector('[data-review-format="italic"]')).toHaveTextContent('斜体')
    expect(editor.querySelector('[data-review-format="bold"]')).toHaveTextContent('加粗')
    expect(editor.querySelector('[data-review-format="underline"]')).toHaveTextContent('下划线')
    expect(editor.querySelector('[data-review-format="strike"]')).toHaveTextContent('删除线')
    expect(editor.querySelector('[data-review-spoiler="true"]')).toHaveTextContent('防剧透')
    expect(editor.textContent).not.toContain('**')
  })

  it('keeps empty formats editable and visibly marks their syntax', () => {
    const view = render(<ReviewEditor value="||||" onChange={vi.fn()} />)
    const editor = view.getByRole('textbox')
    const spoiler = editor.querySelector('[data-review-spoiler="true"]') as HTMLElement

    expect(spoiler).toHaveAttribute('data-review-empty', 'true')
    expect(editor.textContent?.replaceAll('\u200B', '')).toBe('')
    expect(spoiler.textContent).toContain('\u200B')
  })

  it('marks every nested format around the current selection for live syntax decorations', () => {
    const view = render(<ReviewEditor value="**外层 *嵌套*外层**" onChange={vi.fn()} />)
    const editor = view.getByRole('textbox')
    const outer = editor.querySelector('[data-review-format="bold"]') as HTMLElement
    const inner = editor.querySelector('[data-review-format="italic"]') as HTMLElement

    selectEditorContents(inner)
    notifySelectionChange()

    expect(inner).toHaveAttribute('data-review-active', 'true')
    expect(outer).toHaveAttribute('data-review-active', 'true')
    expect(outer).toHaveAttribute('data-review-token', '**')
    expect(inner).toHaveAttribute('data-review-token', '*')
  })

  it('reveals a spoiler while its text is selected for editing', () => {
    const view = render(<ReviewEditor value="||编辑时可见||" onChange={vi.fn()} />)
    const editor = view.getByRole('textbox')
    const spoiler = editor.querySelector('[data-review-spoiler="true"]') as HTMLElement

    expect(spoiler).not.toHaveAttribute('data-review-revealed')
    selectEditorContents(spoiler)
    notifySelectionChange()

    expect(spoiler).toHaveAttribute('data-review-active', 'true')
    expect(spoiler).toHaveAttribute('data-review-token', '||')
  })

  it('wraps selected content through the toolbar and serializes the format', () => {
    function ControlledEditor() {
      return <ReviewEditor value="评论" onChange={vi.fn()} />
    }

    const view = render(<ControlledEditor />)
    const editor = view.getByRole('textbox')
    selectEditorContents(editor)

    fireEvent.click(view.getByRole('button', { name: '插入加粗' }))

    expect(editor.querySelector('[data-review-format="bold"]')).toHaveTextContent('评论')
  })

  it('toggles the selected format off when the same toolbar button is clicked again', () => {
    const onChange = vi.fn()
    const view = render(<ReviewEditor value="评论" onChange={onChange} />)
    const editor = view.getByRole('textbox')
    selectEditorContents(editor)

    const boldButton = view.getByRole('button', { name: '插入加粗' })
    fireEvent.mouseDown(boldButton)
    fireEvent.click(boldButton)
    expect(editor.querySelector('[data-review-format="bold"]')).toHaveTextContent('评论')

    fireEvent.mouseDown(boldButton)
    fireEvent.click(boldButton)

    expect(editor.querySelector('[data-review-format="bold"]')).not.toBeInTheDocument()
    expect(editor.textContent).toBe('评论')
    expect(onChange).toHaveBeenLastCalledWith('评论')
  })

  it('removes selected formatting with Backspace while preserving the selected text', () => {
    const onChange = vi.fn()
    const view = render(<ReviewEditor value="**评论**" onChange={onChange} />)
    const editor = view.getByRole('textbox')
    selectEditorContents(editor.querySelector('[data-review-format="bold"]') as HTMLElement)

    fireEvent.keyDown(editor, { key: 'Backspace' })

    expect(editor.querySelector('[data-review-format="bold"]')).not.toBeInTheDocument()
    expect(editor.textContent).toBe('评论')
    expect(onChange).toHaveBeenLastCalledWith('评论')
  })

  it('removes selected formatting with Delete as well', () => {
    const onChange = vi.fn()
    const view = render(<ReviewEditor value="**评论**" onChange={onChange} />)
    const editor = view.getByRole('textbox')
    selectEditorContents(editor.querySelector('[data-review-format="bold"]') as HTMLElement)

    fireEvent.keyDown(editor, { key: 'Delete' })

    expect(editor.querySelector('[data-review-format="bold"]')).not.toBeInTheDocument()
    expect(editor.textContent).toBe('评论')
    expect(onChange).toHaveBeenLastCalledWith('评论')
  })

  it('removes a format span directly from either caret boundary', () => {
    const onChange = vi.fn()
    const view = render(<ReviewEditor value="**开头边界**" onChange={onChange} />)
    const editor = view.getByRole('textbox')
    const format = editor.querySelector('[data-review-format="bold"]') as HTMLElement

    const startRange = document.createRange()
    startRange.selectNodeContents(format)
    startRange.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(startRange)
    fireEvent.keyDown(editor, { key: 'Backspace' })

    expect(editor.querySelector('[data-review-format="bold"]')).not.toBeInTheDocument()
    expect(editor.textContent).toBe('开头边界')

    view.rerender(<ReviewEditor value="**结尾边界**" onChange={onChange} />)
    const endFormat = editor.querySelector('[data-review-format="bold"]') as HTMLElement
    const endRange = document.createRange()
    endRange.selectNodeContents(endFormat)
    endRange.collapse(false)
    selection?.removeAllRanges()
    selection?.addRange(endRange)
    fireEvent.keyDown(editor, { key: 'Delete' })

    expect(editor.querySelector('[data-review-format="bold"]')).not.toBeInTheDocument()
    expect(editor.textContent).toBe('结尾边界')
  })

  it('handles caret boundaries represented by the editor parent node', () => {
    const onChange = vi.fn()
    const view = render(<ReviewEditor value="**父节点开头**" onChange={onChange} />)
    const editor = view.getByRole('textbox')
    const format = editor.querySelector('[data-review-format="bold"]') as HTMLElement
    const selection = window.getSelection()

    const startRange = document.createRange()
    startRange.setStart(editor, Array.from(editor.childNodes).indexOf(format))
    startRange.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(startRange)
    fireEvent.keyDown(editor, { key: 'Backspace' })

    expect(editor.querySelector('[data-review-format="bold"]')).not.toBeInTheDocument()

    view.rerender(<ReviewEditor value="**父节点结尾**" onChange={onChange} />)
    const endFormat = editor.querySelector('[data-review-format="bold"]') as HTMLElement
    const endRange = document.createRange()
    endRange.setStart(editor, Array.from(editor.childNodes).indexOf(endFormat) + 1)
    endRange.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(endRange)
    fireEvent.keyDown(editor, { key: 'Delete' })

    expect(editor.querySelector('[data-review-format="bold"]')).not.toBeInTheDocument()
    expect(editor.textContent).toBe('父节点结尾')
  })

  it('removes a format when the same visible text is selected again after focus moved', () => {
    const onChange = vi.fn()
    const view = render(<ReviewEditor value="**延后切换** 普通" onChange={onChange} />)
    const editor = view.getByRole('textbox')
    const target = editor.querySelector('[data-review-format="bold"]') as HTMLElement

    selectEditorContents(target)
    editor.focus()
    selectEditorContents(target)
    fireEvent.click(view.getByRole('button', { name: '插入加粗' }))

    expect(editor.querySelector('[data-review-format="bold"]')).not.toBeInTheDocument()
    expect(editor.textContent).toBe('延后切换 普通')
    expect(onChange).toHaveBeenLastCalledWith('延后切换 普通')
  })

  it('removes an empty format pair with Backspace instead of leaving invisible syntax behind', () => {
    const onChange = vi.fn()
    const view = render(<ReviewEditor value="||||" onChange={onChange} />)
    const editor = view.getByRole('textbox')
    editor.focus()
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    fireEvent.keyDown(editor, { key: 'Backspace' })

    expect(editor.querySelector('[data-review-format="inline-spoiler"]')).not.toBeInTheDocument()
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('inserts an empty spoiler pair at the current caret', () => {
    const onChange = vi.fn()
    const view = render(<ReviewEditor value="" onChange={onChange} />)
    const editor = view.getByRole('textbox')
    editor.focus()

    fireEvent.click(view.getByRole('button', { name: '插入防剧透' }))

    expect(onChange).toHaveBeenCalledWith('||||')
    expect(editor.querySelector('[data-review-spoiler="true"]')).toBeInTheDocument()
  })

  it('toggles editor spoilers without changing the serialized value', () => {
    const onChange = vi.fn()
    const view = render(<ReviewEditor value="||防剧透||" onChange={onChange} />)
    const spoiler = view.container.querySelector('[data-review-spoiler="true"]') as HTMLElement

    expect(spoiler).not.toHaveAttribute('data-review-revealed')
    fireEvent.click(spoiler)
    expect(spoiler).toHaveAttribute('data-review-revealed', 'true')
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.keyDown(spoiler, { key: 'Enter' })
    expect(spoiler).not.toHaveAttribute('data-review-revealed')
  })

  it('does not toggle a spoiler when a text selection bubbles a click event', () => {
    const onChange = vi.fn()
    const view = render(<ReviewEditor value="||可选中的剧透||" onChange={onChange} />)
    const editor = view.getByRole('textbox')
    const spoiler = editor.querySelector('[data-review-spoiler="true"]') as HTMLElement

    selectEditorContents(spoiler)
    notifySelectionChange()
    fireEvent.click(spoiler)

    expect(spoiler).not.toHaveAttribute('data-review-revealed')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('pastes plain text and preserves line breaks instead of importing HTML', () => {
    const onChange = vi.fn()
    const view = render(<ReviewEditor value="" onChange={onChange} />)
    const editor = view.getByRole('textbox')
    editor.focus()
    selectEditorContents(editor)

    const pasteEvent = createEvent.paste(editor)
    const getData = vi.fn((type: string) => type === 'text/plain' ? '第一行\n第二行' : '<strong>不导入标签</strong>')
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        getData,
      },
    })
    fireEvent(editor, pasteEvent)

    expect(getData).toHaveBeenCalledWith('text/plain')
    expect(onChange).toHaveBeenCalledWith('第一行\n第二行')
    expect(editor.textContent).toBe('第一行\n第二行')
    expect(editor.querySelector('strong')).not.toBeInTheDocument()
  })

  it('inserts a serialized line break when Enter is pressed', () => {
    const onChange = vi.fn()
    const view = render(<ReviewEditor value="第一行" onChange={onChange} />)
    const editor = view.getByRole('textbox')
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    fireEvent.keyDown(editor, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('第一行\n')
  })

  it('supports formatting shortcuts and external value hydration', () => {
    const onChange = vi.fn()
    const view = render(<ReviewEditor value="评论" onChange={onChange} />)
    const editor = view.getByRole('textbox')
    selectEditorContents(editor)

    fireEvent.keyDown(editor, { key: 'b', ctrlKey: true })
    expect(onChange).toHaveBeenCalledWith('**评论**')

    view.rerender(<ReviewEditor value="**外部更新**" onChange={onChange} />)
    expect(editor.querySelector('[data-review-format="bold"]')).toHaveTextContent('外部更新')
  })

  it('keeps the editor stable during composition input', () => {
    const onChange = vi.fn()
    const view = render(<ReviewEditor value="" onChange={onChange} />)
    const editor = view.getByRole('textbox')

    fireEvent.compositionStart(editor)
    editor.textContent = '拼音'
    fireEvent.input(editor)
    fireEvent.compositionEnd(editor)

    expect(editor.textContent).toBe('拼音')
    expect(onChange).toHaveBeenLastCalledWith('拼音')
  })

  it('shows the placeholder outside the editable content', () => {
    const view = render(<ReviewEditor value="" onChange={vi.fn()} placeholder="输入评论" />)

    expect(view.getByRole('textbox')).toHaveTextContent('')
    expect(view.container.querySelector('[data-slot="review-placeholder"]')).toHaveTextContent('输入评论')
  })
})
