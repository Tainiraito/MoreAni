import { cleanup, fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Input } from '@/components/ui/input'

describe('Input clearable', () => {
  afterEach(() => cleanup())

  it('有内容时显示清空按钮并保留输入焦点', () => {
    const onClear = vi.fn()
    const view = render(<Input value="搜索内容" clearable onClear={onClear} aria-label="搜索" />)
    const input = view.getByRole('textbox', { name: '搜索' })
    const clearButton = view.getByRole('button', { name: '清空输入内容' })

    fireEvent.click(clearButton)

    expect(onClear).toHaveBeenCalledOnce()
    expect(input).toHaveFocus()
  })

  it('清空后不显示按钮', () => {
    function ControlledInput() {
      const [value, setValue] = useState('内容')
      return <Input value={value} onChange={event => setValue(event.target.value)} clearable onClear={() => setValue('')} />
    }

    const view = render(<ControlledInput />)
    fireEvent.click(view.getByRole('button', { name: '清空输入内容' }))

    expect(view.queryByRole('button', { name: '清空输入内容' })).not.toBeInTheDocument()
  })
})
