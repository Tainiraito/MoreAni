import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ContentFormDialog } from '@/components/content/ContentFormDialog'
import { api } from '@/lib/api'

describe('ContentFormDialog 周历导入', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('按 Bangumi subject_id 精确获取并填充新建表单', async () => {
    const getBangumiDetail = vi.spyOn(api, 'getBangumiDetail').mockResolvedValue({
      bgm_id: 1002,
      name: 'Exact Anime',
      name_cn: '精确番剧',
      cover_url: 'https://img.example/exact.jpg',
      summary: '来自 Bangumi 的简介',
      eps: 12,
      air_date: '2026-04-01',
      platform: 'TV',
      tags: ['奇幻', '冒险'],
    })
    const createContent = vi.spyOn(api, 'createContent').mockResolvedValue({ id: 88 })
    const view = render(
      <ContentFormDialog
        open
        onClose={vi.fn()}
        initialBangumiSubjectId={1002}
        initialBangumiTitle="周历番剧"
        initialBangumiTitleAlt="Weekly Anime"
      />,
    )

    await waitFor(() => expect(view.getByDisplayValue('精确番剧')).toBeInTheDocument())
    expect(getBangumiDetail).toHaveBeenCalledOnce()
    expect(getBangumiDetail).toHaveBeenCalledWith(1002)
    expect(view.getByDisplayValue('Exact Anime')).toBeInTheDocument()
    expect(view.getByDisplayValue('来自 Bangumi 的简介')).toBeInTheDocument()
    expect(view.getByRole('button', { name: '发行日期' })).toHaveTextContent('2026-04-01')

    await view.getByRole('button', { name: '添加' }).click()
    await waitFor(() => expect(createContent).toHaveBeenCalledOnce())
    expect(createContent).toHaveBeenCalledWith(expect.objectContaining({
      title: '精确番剧',
      content_type: 'anime',
      source_type: 'bangumi',
      source_id: '1002',
      source_url: 'https://bangumi.tv/subject/1002',
    }))
  })
})
