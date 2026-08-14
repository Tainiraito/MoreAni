import { create } from 'zustand'

interface UIState {
  detailOpen: boolean
  detailContentId: number | null
  authOpen: boolean
  settingsOpen: boolean
  openDetail: (id: number) => void
  closeDetail: () => void
  openAuth: () => void
  closeAuth: () => void
  openSettings: () => void
  closeSettings: () => void
}

export const useUIStore = create<UIState>((set) => ({
  detailOpen: false,
  detailContentId: null,
  authOpen: false,
  settingsOpen: false,

  openDetail: (id) => set({ detailOpen: true, detailContentId: id }),
  closeDetail: () => set({ detailOpen: false, detailContentId: null }),
  openAuth: () => set({ authOpen: true }),
  closeAuth: () => set({ authOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}))
