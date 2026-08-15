import { create } from 'zustand'

interface UIState {
  detailOpen: boolean
  detailContentId: number | null
  authOpen: boolean
  settingsOpen: boolean
  addAnimeOpen: boolean
  editContentId: number | null
  openDetail: (id: number) => void
  closeDetail: () => void
  openAuth: () => void
  closeAuth: () => void
  openSettings: () => void
  closeSettings: () => void
  openAddAnime: () => void
  closeAddAnime: () => void
  openEditContent: (id: number) => void
  closeEditContent: () => void
}

export const useUIStore = create<UIState>((set) => ({
  detailOpen: false,
  detailContentId: null,
  authOpen: false,
  settingsOpen: false,
  addAnimeOpen: false,
  editContentId: null,

  openDetail: (id) => set({ detailOpen: true, detailContentId: id }),
  closeDetail: () => set({ detailOpen: false, detailContentId: null }),
  openAuth: () => set({ authOpen: true }),
  closeAuth: () => set({ authOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openAddAnime: () => set({ addAnimeOpen: true }),
  closeAddAnime: () => set({ addAnimeOpen: false }),
  openEditContent: (id) => set({ editContentId: id }),
  closeEditContent: () => set({ editContentId: null }),
}))
