import { describe, expect, it } from 'vitest'

import { formatDateTime, toLocalDateTimeInput, toUtcISOString } from '@/lib/utils'

describe('通知时间格式化', () => {
  it('将本地 DateTimePicker 值转换为 UTC ISO 字符串', () => {
    const value = toUtcISOString('2026-08-25T12:19')
    expect(value).toMatch(/2026-08-25T\d{2}:19:00\.000Z/)
  })

  it('可以将带时区的 API 时间转换为本地输入值', () => {
    const value = toLocalDateTimeInput('2026-08-25T04:19:00+00:00')
    expect(value).toMatch(/^2026-08-25T\d{2}:19$/)
  })

  it('格式化带时区的通知时间而不是直接截断字符串', () => {
    expect(formatDateTime('2026-08-25T04:19:00+00:00')).toContain('2026')
    expect(formatDateTime('invalid')).toBe('')
  })
})
