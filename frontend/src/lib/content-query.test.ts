import { describe, expect, it } from 'vitest'

import type { ContentItem } from '@/types'
import {
  buildContentListParams,
  buildLoopItems,
  getRecommendationSequenceWidth,
  getRecommendationSize,
  LatestRequestGate,
} from '@/lib/content-query'

const filters = {
  activeType: 'anime' as const,
  searchQuery: '星空',
  myFilter: 'favorited' as const,
  sortBy: 'rating',
  seasonFilter: '2026-07',
  userFilter: '42',
}

function item(id: number): ContentItem {
  return { id } as ContentItem
}

describe('内容查询参数', () => {
  it('首批和下一页仅页码不同，完整保留季度、用户和状态筛选', () => {
    const first = buildContentListParams(filters, 1, 20)
    const next = buildContentListParams(filters, 2, 20)
    expect({ ...next, page: '1' }).toEqual(first)
    expect(next).toMatchObject({ season: '2026-07', rated_by: '42', favorited: 'favorited' })
  })

  it('旧请求晚返回时不能通过请求门覆盖新筛选结果', async () => {
    const gate = new LatestRequestGate()
    let displayed = ''
    let resolveOld!: (value: string) => void
    const oldResponse = new Promise<string>(resolve => { resolveOld = resolve })
    const oldId = gate.begin()
    const oldTask = oldResponse.then(value => {
      if (gate.isCurrent(oldId)) displayed = value
    })
    const newId = gate.begin()
    if (gate.isCurrent(newId)) displayed = '新筛选'
    resolveOld('旧筛选')
    await oldTask
    expect(displayed).toBe('新筛选')
  })
})

describe('推荐序列', () => {
  it.each([[320, 12], [1440, 12], [1920, 15], [3840, 26], [10000, 30]])(
    '%ipx 视口请求 %i 条',
    (width, expected) => expect(getRecommendationSize(width)).toBe(expected),
  )

  it.each([1440, 3840])('逻辑序列唯一且在 %ipx 下宽于视口，DOM 只复制两份', viewport => {
    const size = getRecommendationSize(viewport)
    const unique = Array.from({ length: size }, (_, index) => item(index + 1))
    const loop = buildLoopItems([...unique, unique[0]])
    expect(new Set(loop.slice(0, size).map(entry => entry.id)).size).toBe(size)
    expect(loop).toHaveLength(size * 2)
    expect(getRecommendationSequenceWidth(size)).toBeGreaterThan(viewport)
  })
})
