import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  token: string | null
  setUser: (user: User | null) => void
  setToken: (token: string | null) => void
  logout: () => void
  isAuthenticated: () => boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,

      setUser: (user) => set({ user }),
      setToken: (token) => set({ token }),

      logout: () => set({ user: null, token: null }),

      isAuthenticated: () => {
        const state = get()
        return state.user !== null
      },
    }),
    {
      name: 'moreani-auth', // localStorage key
      partialize: (state) => ({
        user: state.user,
        token: state.token,
      }),
    }
  )
)
