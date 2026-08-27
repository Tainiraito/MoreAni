import { create } from 'zustand'
import { api } from '@/lib/api'
import { useToastStore } from '@/stores/toast-store'

interface FavoriteState {
  favoriteIds: number[]
  pendingIds: number[]
  isLoading: boolean
  loadFavorites: () => Promise<void>
  toggleFavorite: (id: number) => Promise<void>
  isFavorited: (id: number) => boolean
  isFavoritePending: (id: number) => boolean
}

export const useFavoriteStore = create<FavoriteState>((set, get) => ({
  favoriteIds: [],
  pendingIds: [],
  isLoading: false,

  loadFavorites: async () => {
    set({ isLoading: true })
    try {
      const res = await api.getMyStatuses()
      const statuses = (res.items || []) as { content_id: number; status: string }[]
      const favIds = statuses.filter(s => s.status === 'want').map(s => s.content_id)
      set({ favoriteIds: favIds, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  toggleFavorite: async (id: number) => {
    const { favoriteIds, pendingIds } = get()
    if (pendingIds.includes(id)) return
    const isFav = favoriteIds.includes(id)
    const toast = useToastStore.getState()
    set(state => ({ pendingIds: [...state.pendingIds, id] }))

    try {
      if (isFav) {
        await api.clearStatus(id)  // 保存到数据库
        set(state => ({ favoriteIds: state.favoriteIds.filter(fid => fid !== id) }))
        toast.addToast('success', '已取消收藏')
      } else {
        await api.setStatus({ content_id: id, status: 'want' })  // 保存到数据库
        set(state => ({ favoriteIds: state.favoriteIds.includes(id) ? state.favoriteIds : [...state.favoriteIds, id] }))
        toast.addToast('success', '已加入收藏')
      }
    } catch (err) {
      console.error('Toggle favorite failed:', err)
      toast.addToast('error', '收藏操作失败，请重试')
    } finally {
      set(state => ({ pendingIds: state.pendingIds.filter(pendingId => pendingId !== id) }))
    }
  },

  isFavorited: (id: number) => {
    return get().favoriteIds.includes(id)
  },

  isFavoritePending: (id: number) => get().pendingIds.includes(id),
}))
