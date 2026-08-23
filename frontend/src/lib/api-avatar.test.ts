import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

describe('api.uploadAvatar', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('将 GIF 原文件和裁剪参数放入同一个 multipart 请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ avatar_url: '/api/avatars/1.gif?v=1', avatar_crop: { version: 1, x: 0, y: 0, size: 10 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['GIF89a'], 'avatar.gif', { type: 'image/gif' })
    const crop = { version: 1 as const, x: 2, y: 3, size: 10 }

    await api.uploadAvatar(file, crop)

    const body = fetchMock.mock.calls[0][1].body as FormData
    expect(body.get('file')).toBe(file)
    expect(body.get('crop')).toBe(JSON.stringify(crop))
  })
})
