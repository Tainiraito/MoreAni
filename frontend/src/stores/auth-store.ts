import { create } from 'zustand'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  token: string | null
  isGuest: boolean
  setUser: (user: User | null) => void
  setToken: (token: string | null) => void
  setGuest: (isGuest: boolean) => void
  logout: () => void
  isAuthenticated: () => boolean
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isGuest: false,

  setUser: (user) => set({ user }),
  setToken: (token) => set({ token }),
  setGuest: (isGuest) => set({ isGuest }),

  logout: () => set({ user: null, token: null, isGuest: false }),

  isAuthenticated: () => {
    const state = get()
    return state.user !== null || state.isGuest
  },
}))
