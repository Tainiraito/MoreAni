import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, ApiTimeoutError, api } from '@/lib/api'
import { useToastStore } from '@/stores/toast-store'
import type { AiringCalendarWeek } from '@/types'

const week: AiringCalendarWeek = {
  timezone: 'Asia/Shanghai',
  week_start: '2026-08-24',
  last_synced_at: null,
  sync_status: 'success',
  days: [],
}

describe('API 请求超时', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    sessionStorage.clear()
    useToastStore.getState().clearToasts()
  })

  it('列表请求超过 15 秒后抛出可识别的超时错误', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        }),
      ),
    )

    const request = api.listContent({ type: 'anime', page: '1', size: '20' })
    const rejection = expect(request).rejects.toBeInstanceOf(ApiTimeoutError)
    await vi.advanceTimersByTimeAsync(15_000)

    await rejection
  })

  it('统计分析请求超过 12 秒后终止，不会无限保持加载态', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        }),
      ),
    )

    const request = api.getAnalyticsOverview({
      scope: 'user',
      userId: 7,
      minScore: 0.5,
      maxScore: 10,
    })
    const rejection = expect(request).rejects.toBeInstanceOf(ApiTimeoutError)
    await vi.advanceTimersByTimeAsync(12_000)

    await rejection
  })

  it('周历请求保存 ETag，并在 304 时复用 sessionStorage 快照', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(week), { status: 200, headers: { 'Content-Type': 'application/json', ETag: '"week-v1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: '"week-v1"' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api.getAiringWeek()).resolves.toEqual(week)
    await expect(api.getAiringWeek()).resolves.toEqual(week)

    const secondInit = fetchMock.mock.calls[1][1] as RequestInit
    expect(new Headers(secondInit.headers).get('If-None-Match')).toBe('"week-v1"')
  })

  it('周历响应和缓存快照都会将已关联条目排在前面', async () => {
    const unorderedWeek: AiringCalendarWeek = {
      ...week,
      days: [{
        date: '2026-08-24',
        weekday: 1,
        label: '星期一',
        is_today: true,
        items: [
          {
            subject_id: 1,
            content_id: null,
            matched: false,
            title: '未关联',
            title_alt: '',
            cover_url: '',
            bangumi_url: 'https://bgm.tv/subject/1',
          },
          {
            subject_id: 2,
            content_id: 20,
            matched: true,
            title: '已关联',
            title_alt: '',
            cover_url: '',
            bangumi_url: 'https://bgm.tv/subject/2',
          },
        ],
      }],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(unorderedWeek), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ))

    const result = await api.getAiringWeek()

    expect(result.days[0].items.map(item => item.subject_id)).toEqual([2, 1])
  })

  it('Bangumi 详情错误交由弹窗处理，不重复弹出全局错误提示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Bangumi 服务暂时不可用，请稍后重试' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    await expect(api.getBangumiDetail(1002)).rejects.toBeInstanceOf(ApiError)

    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
