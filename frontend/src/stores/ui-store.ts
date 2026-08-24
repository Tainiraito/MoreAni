import { create } from 'zustand'

export interface ResourceFocus {
  contentId: number
  source?: 'mikan' | 'animegarden'
  fansubName?: string
  fansubId?: string
  resourceKey?: string
}

interface UIState {
  detailOpen: boolean
  detailContentId: number | null
  authOpen: boolean
  settingsOpen: boolean
  addAnimeOpen: boolean
  editContentId: number | null
  resourceFocus: ResourceFocus | null
  openDetail: (id: number) => void
  openDetailResource: (focus: ResourceFocus) => void
  clearResourceFocus: () => void
  closeDetail: () => void
  openAuth: () => void
  closeAuth: () => void
  openSettings: () => void
  closeSettings: () => void
  adminOpen: boolean
  openAdmin: () => void
  closeAdmin: () => void
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
  resourceFocus: null,

  openDetail: (id) => set({ detailOpen: true, detailContentId: id, resourceFocus: null }),
  openDetailResource: (focus) => set({ detailOpen: true, detailContentId: focus.contentId, resourceFocus: focus }),
  clearResourceFocus: () => set({ resourceFocus: null }),
  closeDetail: () => set({ detailOpen: false, detailContentId: null, resourceFocus: null }),
  openAuth: () => set({ authOpen: true }),
  closeAuth: () => set({ authOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  adminOpen: false,
  openAdmin: () => set({ adminOpen: true }),
  closeAdmin: () => set({ adminOpen: false }),
  openAddAnime: () => set({ addAnimeOpen: true }),
  closeAddAnime: () => set({ addAnimeOpen: false }),
  openEditContent: (id) => set({ editContentId: id }),
  closeEditContent: () => set({ editContentId: null }),
}))
