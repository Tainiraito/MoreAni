import { ref, computed } from 'vue'
import type { User } from '@/types'

const token = ref<string | null>(localStorage.getItem('moreani_token'))
const currentUser = ref<User | null>(null)

try {
  const saved = localStorage.getItem('moreani_user')
  if (saved) currentUser.value = JSON.parse(saved)
} catch {
  localStorage.removeItem('moreani_user')
}

export function useAuth() {
  const isLoggedIn = computed(() => !!token.value)

  function setAuth(authToken: string, user: User) {
    token.value = authToken
    currentUser.value = user
    localStorage.setItem('moreani_token', authToken)
    localStorage.setItem('moreani_user', JSON.stringify(user))
  }

  function clearAuth() {
    token.value = null
    currentUser.value = null
    localStorage.removeItem('moreani_token')
    localStorage.removeItem('moreani_user')
  }

  return {
    token,
    currentUser,
    isLoggedIn,
    setAuth,
    clearAuth
  }
}
