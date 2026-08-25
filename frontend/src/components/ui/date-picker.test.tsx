import { cleanup, fireEvent, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { DatePicker } from '@/components/ui/date-picker'
import { DateTimePicker } from '@/components/ui/date-time-picker'

afterEach(cleanup)

describe('日期选择器 Popover', () => {
  it('点击外部空白处可以关闭日期面板', async () => {
    const user = userEvent.setup()
    const { getByRole, queryByRole } = render(<DatePicker value="" onChange={() => undefined} placeholder="选择日期" />)
    await user.click(getByRole('button'))
    expect(getByRole('dialog')).toBeInTheDocument()

    await user.click(document.body)
    expect(queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('点击时间输入不会关闭日期时间面板，点击外部后关闭', async () => {
    const user = userEvent.setup()
    const { getByRole, getByDisplayValue, queryByRole } = render(
      <DateTimePicker value="2026-08-25T10:00" onChange={() => undefined} />,
    )
    await user.click(getByRole('button'))
    const timeInput = getByDisplayValue('10:00')
    fireEvent.change(timeInput, { target: { value: '11:00' } })
    expect(getByRole('dialog')).toBeInTheDocument()

    await user.click(document.body)
    expect(queryByRole('dialog')).not.toBeInTheDocument()
  })
})
