import { describe, expect, it } from 'vitest'

import { formatAnnouncementTime } from '@/components/admin/announcement-utils'
import type { Announcement } from '@/types'

const baseAnnouncement: Announcement = {
  id: 1,
  title: '测试公告',
  body: '正文',
  is_published: true,
  published_at: null,
  expires_at: null,
  created_at: '2026-08-25T00:00:00Z',
}

describe('公告时间文案', () => {
  it('只显示已发布公告的发布时间', () => {
    expect(formatAnnouncementTime({
      ...baseAnnouncement,
      published_at: '2026-08-25T12:53:00Z',
    })).toMatch(/^发布于 /)
  })

  it('将未来发布时间标记为计划发布', () => {
    expect(formatAnnouncementTime({
      ...baseAnnouncement,
      published_at: '2099-08-25T12:53:00Z',
    })).toMatch(/^计划发布于 /)
  })

  it('草稿显示未发布', () => {
    expect(formatAnnouncementTime({ ...baseAnnouncement, is_published: false })).toBe('未发布')
  })
})
