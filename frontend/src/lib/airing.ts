import type { AiringCalendarWeek } from '@/types'

/** 按已关联状态规范化周历顺序，避免旧缓存或其他数据源恢复错误顺序。 */
export function normalizeAiringWeek(week: AiringCalendarWeek): AiringCalendarWeek {
  return {
    ...week,
    days: week.days.map(day => ({
      ...day,
      items: [...day.items].sort((left, right) => Number(right.matched) - Number(left.matched)),
    })),
  }
}
