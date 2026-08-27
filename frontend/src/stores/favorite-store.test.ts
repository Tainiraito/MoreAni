import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useFavoriteStore } from '@/stores/favorite-store'

describe('favorite-store 请求防重', () => {
  afterEach(() => {
    useFavoriteStore.setState({ favoriteIds: [], pendingIds: [], isLoading: false })
    vi.restoreAllMocks()
  })

  it('同一内容的请求未完成前只提交一次，并在完成后解除 pending', async () => {
    let resolveRequest: (value: { ok: boolean }) => void = () => undefined
    const request = new Promise<{ ok: boolean }>(resolve => { resolveRequest = resolve })
    const setStatus = vi.spyOn(api, 'setStatus').mockReturnValue(request)

    const first = useFavoriteStore.getState().toggleFavorite(42)
    const second = useFavoriteStore.getState().toggleFavorite(42)

    expect(setStatus).toHaveBeenCalledOnce()
    expect(useFavoriteStore.getState().isFavoritePending(42)).toBe(true)

    resolveRequest({ ok: true })
    await Promise.all([first, second])

    expect(useFavoriteStore.getState().isFavorited(42)).toBe(true)
    expect(useFavoriteStore.getState().isFavoritePending(42)).toBe(false)
  })

  it('失败后也会恢复可操作状态', async () => {
    vi.spyOn(api, 'setStatus').mockRejectedValue(new Error('network error'))

    await useFavoriteStore.getState().toggleFavorite(42)

    expect(useFavoriteStore.getState().isFavoritePending(42)).toBe(false)
    expect(useFavoriteStore.getState().isFavorited(42)).toBe(false)
  })
})
