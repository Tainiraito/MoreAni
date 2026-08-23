import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { CollapsibleText } from '@/components/ui/CollapsibleText'

function setMeasuredHeight(element: HTMLElement, height: number) {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: height })
  window.dispatchEvent(new Event('resize'))
}

describe('CollapsibleText', () => {
  afterEach(cleanup)

  it('内容不超过三行时不显示按钮和渐隐', async () => {
    const { getByTestId, queryByRole, queryByTestId } = render(
      <CollapsibleText label="简介" lineHeight={28}>
        三行以内的简介
      </CollapsibleText>,
    )
    setMeasuredHeight(getByTestId('collapsible-content'), 84)

    await waitFor(() => {
      expect(queryByRole('button')).not.toBeInTheDocument()
    })
    expect(queryByTestId('collapsible-fade')).not.toBeInTheDocument()
  })

  it('内容超过三行时默认折叠并显示渐隐和展开按钮', async () => {
    const { getByRole, getByTestId } = render(
      <CollapsibleText label="简介" lineHeight={28}>
        很长的简介
      </CollapsibleText>,
    )
    const content = getByTestId('collapsible-content')
    setMeasuredHeight(content, 140)

    const expandButton = await waitFor(() => getByRole('button', { name: '展开简介' }))
    expect(expandButton).toHaveAttribute('aria-expanded', 'false')
    expect(content).toHaveStyle({ maxHeight: '84px' })
    expect(getByTestId('collapsible-fade')).toBeInTheDocument()
  })

  it('窗口尺寸变化后重新检测内容是否溢出', async () => {
    const { getByRole, getByTestId, queryByRole } = render(
      <CollapsibleText label="标签" lineHeight={24}>
        会随宽度变化而重新换行的标签
      </CollapsibleText>,
    )
    const content = getByTestId('collapsible-content')
    setMeasuredHeight(content, 72)
    await waitFor(() => expect(queryByRole('button')).not.toBeInTheDocument())

    setMeasuredHeight(content, 120)
    expect(await waitFor(() => getByRole('button', { name: '展开标签' }))).toBeInTheDocument()
  })

  it('保留简介换行并支持标签节点作为子内容', () => {
    const { getByTestId } = render(
      <CollapsibleText label="简介" lineHeight={28}>
        {'第一行简介\n第二行简介'}
        <span>#动作</span>
      </CollapsibleText>,
    )

    const content = getByTestId('collapsible-content')
    expect(content.textContent).toBe('第一行简介\n第二行简介#动作')
    expect(content.querySelector('span')).toHaveTextContent('#动作')
  })

  it('可以展开和收起，并正确更新无障碍状态', async () => {
    const { getByRole, getByTestId, queryByTestId } = render(
      <CollapsibleText label="标签" lineHeight={24}>
        #动作 #科幻 #长篇标签
      </CollapsibleText>,
    )
    setMeasuredHeight(getByTestId('collapsible-content'), 100)

    fireEvent.click(await waitFor(() => getByRole('button', { name: '展开标签' })))
    expect(getByRole('button', { name: '收起标签' })).toHaveAttribute('aria-expanded', 'true')
    expect(queryByTestId('collapsible-fade')).not.toBeInTheDocument()
    expect(getByTestId('collapsible-content')).toHaveStyle({ maxHeight: '' })

    fireEvent.click(getByRole('button', { name: '收起标签' }))
    expect(getByRole('button', { name: '展开标签' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('resetKey 变化后恢复折叠状态', async () => {
    const { getByRole, getByTestId, rerender } = render(
      <CollapsibleText label="简介" lineHeight={28} resetKey="first">
        第一版很长的简介
      </CollapsibleText>,
    )
    setMeasuredHeight(getByTestId('collapsible-content'), 140)
    fireEvent.click(await waitFor(() => getByRole('button', { name: '展开简介' })))

    rerender(
      <CollapsibleText label="简介" lineHeight={28} resetKey="second">
        第二版很长的简介
      </CollapsibleText>,
    )
    setMeasuredHeight(getByTestId('collapsible-content'), 140)

    expect(await waitFor(() => getByRole('button', { name: '展开简介' }))).toHaveAttribute('aria-expanded', 'false')
    expect(getByTestId('collapsible-fade')).toBeInTheDocument()
  })
})
