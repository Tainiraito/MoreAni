import userEvent from '@testing-library/user-event'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ReviewEditor } from '@/components/review/ReviewEditor'

// ProseMirror 在事务后会读取光标几何信息；仅在编辑器测试文件内补齐
// jsdom 的最小实现，避免改变其他组件测试的布局测量语义。
const testRect = () => ({
  x: 0,
  y: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
})

Object.defineProperty(document, 'elementFromPoint', {
  configurable: true,
  writable: true,
  value: () => document.body,
})
Object.defineProperty(HTMLElement.prototype, 'getClientRects', {
  configurable: true,
  writable: true,
  value: () => [testRect()],
})
Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
  configurable: true,
  writable: true,
  value: testRect,
})
Object.defineProperty(Range.prototype, 'getClientRects', {
  configurable: true,
  writable: true,
  value: () => [testRect()],
})
Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
  configurable: true,
  writable: true,
  value: testRect,
})

async function renderReadyEditor(props: Parameters<typeof ReviewEditor>[0]) {
  const view = render(<ReviewEditor {...props} />)
  const editor = view.getByRole('textbox', { name: '评论内容' })
  await waitFor(() => expect(editor).toHaveAttribute('contenteditable', 'true'))
  return { view, editor }
}

describe('ReviewEditor', () => {
  afterEach(() => {
    cleanup()
    window.getSelection()?.removeAllRanges()
  })

  it('通过 ProseMirror 处理连续输入，并立即序列化为旧评论语法', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { editor } = await renderReadyEditor({ value: '', onChange })

    editor.focus()
    await user.type(editor, '输入评论', { skipClick: true })

    expect(onChange).toHaveBeenLastCalledWith('输入评论')
    expect(editor).toHaveAttribute('contenteditable', 'true')
  })

  it('把已有语法转换为可编辑格式节点，不把语法 token 当作正文显示', async () => {
    const { editor } = await renderReadyEditor({
      value: '*斜体* **加粗** __下划线__ ~~删除线~~ ||防剧透||',
      onChange: vi.fn(),
    })

    expect(editor).toHaveTextContent('斜体 加粗 下划线 删除线 防剧透')
    expect(editor.querySelector('[data-review-format="italic"]')).toHaveTextContent('斜体')
    expect(editor.querySelector('[data-review-format="bold"]')).toHaveTextContent('加粗')
    expect(editor.querySelector('[data-review-format="underline"]')).toHaveTextContent('下划线')
    expect(editor.querySelector('[data-review-format="strike"]')).toHaveTextContent('删除线')
    expect(editor.querySelector('[data-review-spoiler="true"]')).toHaveTextContent('防剧透')
  })

  it('通过工具栏设置输入时的 stored mark，并序列化输入内容', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { view, editor } = await renderReadyEditor({ value: '', onChange })

    editor.focus()
    await user.click(view.getByRole('button', { name: '插入加粗' }))
    await user.type(editor, '工具栏加粗', { skipClick: true })

    expect(onChange).toHaveBeenLastCalledWith('**工具栏加粗**')
    expect(editor.querySelector('[data-review-format="bold"]')).toHaveTextContent('工具栏加粗')
  })

  it('支持 Mod 快捷键和换行，并保留嵌套格式的序列化顺序', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { editor } = await renderReadyEditor({ value: '', onChange })

    editor.focus()
    await user.keyboard('{Control>}b{/Control}')
    await user.type(editor, '加粗', { skipClick: true })
    await user.keyboard('{Control>}b{/Control}')
    await user.keyboard('{Enter}')
    await user.type(editor, '第二行', { skipClick: true })

    expect(onChange).toHaveBeenLastCalledWith('**加粗**\n第二行')
    expect(editor.querySelector('[data-review-format="bold"]')).toHaveTextContent('加粗')
  })

  it('点击剧透格式可以显示和隐藏正文，编辑选区时仍保持可选中', async () => {
    const { editor } = await renderReadyEditor({ value: '||隐藏细节||', onChange: vi.fn() })
    const spoiler = editor.querySelector('[data-review-spoiler="true"]') as HTMLElement

    expect(spoiler).not.toHaveAttribute('data-review-revealed')
    fireEvent.click(spoiler)
    expect(spoiler).toHaveAttribute('data-review-revealed', 'true')
    fireEvent.click(spoiler)
    expect(spoiler).not.toHaveAttribute('data-review-revealed')
  })

  it('支持纯文本粘贴，并将换行交给 ProseMirror 段落模型', async () => {
    const onChange = vi.fn()
    const { editor } = await renderReadyEditor({ value: '', onChange })

    editor.focus()
    fireEvent.paste(editor, {
      clipboardData: {
        getData: () => '第一行\n第二行',
      },
    })

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('第一行\n第二行'))
    expect(editor).toHaveTextContent('第一行')
    expect(editor).toHaveTextContent('第二行')
  })

  it('外部 value 变化时只重建文档，不改变编辑器实例', async () => {
    const onChange = vi.fn()
    const view = render(<ReviewEditor value="初始" onChange={onChange} />)
    const editor = view.getByRole('textbox', { name: '评论内容' })
    await waitFor(() => expect(editor).toHaveAttribute('contenteditable', 'true'))

    view.rerender(<ReviewEditor value="**外部更新**" onChange={onChange} />)

    await waitFor(() => {
      expect(editor).toHaveTextContent('外部更新')
      expect(editor.querySelector('[data-review-format="bold"]')).toHaveTextContent('外部更新')
    })
    expect(onChange).not.toHaveBeenCalled()
  })
})
