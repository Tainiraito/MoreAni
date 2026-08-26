import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiTimeoutError, api } from '@/lib/api'

describe('API 请求超时', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
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
})
