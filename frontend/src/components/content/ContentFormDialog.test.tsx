import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ContentFormDialog } from '@/components/content/ContentFormDialog'
import { api } from '@/lib/api'
import { useToastStore } from '@/stores/toast-store'

describe('ContentFormDialog 周历导入', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useToastStore.getState().clearToasts()
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
    const onSaved = vi.fn()
    const view = render(
      <ContentFormDialog
        open
        onClose={vi.fn()}
        onSaved={onSaved}
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
    expect(onSaved).toHaveBeenCalledWith({ contentId: 88, operation: 'created' })
  })

  it('选择搜索结果直接使用搜索返回的简介和标签', async () => {
    const getBangumiDetail = vi.spyOn(api, 'getBangumiDetail').mockRejectedValue(new Error('不应重复请求详情'))
    const searchBangumi = vi.spyOn(api, 'searchBangumi').mockResolvedValue({
      items: [{
        bgm_id: 1003,
        name: 'Search Anime',
        name_cn: '搜索番剧',
        cover_url: 'https://img.example/search.jpg',
        rating: 8.5,
        tags: ['奇幻', '冒险'],
        eps: 12,
        air_date: '2026-04-01',
        platform: 'TV',
        summary: '搜索结果中的简介',
      }],
    })
    const view = render(<ContentFormDialog open onClose={vi.fn()} />)
    const searchInput = view.getByPlaceholderText('从 Bangumi 搜索番剧...')

    fireEvent.change(searchInput, { target: { value: '搜索番剧' } })
    await waitFor(() => expect(searchBangumi).toHaveBeenCalledOnce())
    fireEvent.click(await view.findByText('搜索番剧'))

    expect(getBangumiDetail).not.toHaveBeenCalled()
    expect(view.getByDisplayValue('搜索结果中的简介')).toBeInTheDocument()
    expect(view.getByDisplayValue('奇幻, 冒险')).toBeInTheDocument()
  })

  it('添加模式仅显示两种类型，并支持封面失败后手动重新加载', async () => {
    const view = render(<ContentFormDialog open onClose={vi.fn()} />)
    const typeButton = view.getByRole('button', { name: '类型' })
    fireEvent.click(typeButton)
    expect(view.getByRole('option', { name: '番剧' })).toBeInTheDocument()
    expect(view.getByRole('option', { name: '动画电影' })).toBeInTheDocument()
    expect(view.queryByRole('option', { name: '电影' })).not.toBeInTheDocument()
    fireEvent.click(view.getByRole('option', { name: '番剧' }))

    const coverInput = view.getByPlaceholderText('https://...')
    fireEvent.change(coverInput, { target: { value: 'https://img.example/cover.jpg' } })
    const image = await view.findByAltText('封面预览')
    fireEvent.error(image)
    expect(view.getByText('封面加载失败，请重试')).toBeInTheDocument()

    const retryButton = view.getByRole('button', { name: '重新加载' })
    expect(retryButton).not.toBeDisabled()
    const failedSrc = image.getAttribute('src')
    fireEvent.click(retryButton)
    expect(retryButton).toBeDisabled()
    expect(view.getByAltText('封面预览').getAttribute('src')).not.toBe(failedSrc)
  })

  it('Bangumi 详情失败时保留周历标题并继续打开弹窗', async () => {
    vi.spyOn(api, 'getBangumiDetail').mockRejectedValue(new Error('Bangumi unavailable'))

    const view = render(
      <ContentFormDialog
        open
        onClose={vi.fn()}
        initialBangumiSubjectId={1002}
        initialBangumiTitle="周历番剧"
        initialBangumiTitleAlt="Weekly Anime"
      />,
    )

    await waitFor(() => expect(view.getByDisplayValue('周历番剧')).toBeInTheDocument())
    expect(view.getByDisplayValue('Weekly Anime')).toBeInTheDocument()
    expect(useToastStore.getState().toasts.map(toast => toast.message)).toEqual([
      'Bangumi 信息获取失败，请手动搜索或补充内容',
    ])
  })
})
