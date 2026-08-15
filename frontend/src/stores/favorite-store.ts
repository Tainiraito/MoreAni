import { create } from 'zustand'
import { api } from '@/lib/api'

interface FavoriteState {
  favoriteIds: number[]
  isLoading: boolean
  loadFavorites: () => Promise<void>
  toggleFavorite: (id: number) => Promise<void>
  isFavorited: (id: number) => boolean
}

export const useFavoriteStore = create<FavoriteState>((set, get) => ({
  favoriteIds: [],
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
    const { favoriteIds } = get()
    const isFav = favoriteIds.includes(id)
    
    try {
      if (isFav) {
        await api.clearStatus(id)  // 保存到数据库
        set({ favoriteIds: favoriteIds.filter(fid => fid !== id) })
      } else {
        await api.setStatus({ content_id: id, status: 'want' })  // 保存到数据库
        set({ favoriteIds: [...favoriteIds, id] })
      }
    } catch (err) {
      console.error('Toggle favorite failed:', err)
    }
  },

  isFavorited: (id: number) => {
    return get().favoriteIds.includes(id)
  },
}))
