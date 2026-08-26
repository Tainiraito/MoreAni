import { create } from 'zustand'

export interface ResourceFocus {
  contentId: number
  source?: 'mikan' | 'animegarden'
  fansubName?: string
  fansubId?: string
  resourceKey?: string
}

export interface AddAnimePreset {
  bangumiId: number
  title?: string
  titleAlt?: string
}

interface UIState {
  detailOpen: boolean
  detailContentId: number | null
  authOpen: boolean
  settingsOpen: boolean
  addAnimeOpen: boolean
  addAnimePreset: AddAnimePreset | null
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
  openAddAnime: (preset?: AddAnimePreset) => void
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
  addAnimePreset: null,
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
  openAddAnime: (preset) => set({ addAnimeOpen: true, addAnimePreset: preset ?? null }),
  closeAddAnime: () => set({ addAnimeOpen: false, addAnimePreset: null }),
  openEditContent: (id) => set({ editContentId: id }),
  closeEditContent: () => set({ editContentId: null }),
}))
