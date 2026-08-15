import { create } from 'zustand'
import { api } from '@/lib/api'

interface FavoriteState {
  favoriteIds: Set<number>
  isLoading: boolean
  loadFavorites: () => Promise<void>
  toggleFavorite: (id: number) => Promise<void>
  isFavorited: (id: number) => boolean
}

export const useFavoriteStore = create<FavoriteState>((set, get) => ({
  favoriteIds: new Set(),
  isLoading: false,

  loadFavorites: async () => {
    set({ isLoading: true })
    try {
      const res = await api.getMyStatuses()
      const statuses = (res.items || []) as { content_id: number; status: string }[]
      const favIds = new Set(statuses.filter(s => s.status === 'want').map(s => s.content_id))
      set({ favoriteIds: favIds, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  toggleFavorite: async (id: number) => {
    const { favoriteIds } = get()
    const isFav = favoriteIds.has(id)
    
    try {
      if (isFav) {
        await api.clearStatus(id)
        set(state => {
          const next = new Set(state.favoriteIds)
          next.delete(id)
          return { favoriteIds: next }
        })
      } else {
        await api.setStatus({ content_id: id, status: 'want' })
        set(state => ({
          favoriteIds: new Set(state.favoriteIds).add(id)
        }))
      }
    } catch (err) {
      console.error('Toggle favorite failed:', err)
    }
  },

  isFavorited: (id: number) => {
    return get().favoriteIds.has(id)
  },
}))
