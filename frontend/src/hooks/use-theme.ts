import { useSyncExternalStore, useCallback } from 'react'

type Theme = 'light' | 'dark'

// Shared store — all useTheme() instances read from the same source
let currentTheme: Theme = (() => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('moreani-theme') as Theme
    if (saved === 'light' || saved === 'dark') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
})()

const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function getSnapshot() {
  return currentTheme
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
  localStorage.setItem('moreani-theme', theme)
}

// Apply initial theme
applyTheme(currentTheme)

function setThemeValue(theme: Theme) {
  if (theme === currentTheme) return
  currentTheme = theme
  applyTheme(theme)
  listeners.forEach(cb => cb())
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot)

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeValue(newTheme)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeValue(currentTheme === 'light' ? 'dark' : 'light')
  }, [])

  return { theme, setTheme, toggleTheme }
}
