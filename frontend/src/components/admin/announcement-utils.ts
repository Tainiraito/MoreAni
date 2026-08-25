import { formatDateTime } from '@/lib/utils'
import type { Announcement } from '@/types'

export function formatAnnouncementTime(announcement: Announcement): string {
  if (!announcement.is_published || !announcement.published_at) return '未发布'
  const formatted = formatDateTime(announcement.published_at)
  if (!formatted) return '未发布'
  const isScheduled = new Date(announcement.published_at).getTime() > Date.now()
  return `${isScheduled ? '计划发布于' : '发布于'} ${formatted}`
}
