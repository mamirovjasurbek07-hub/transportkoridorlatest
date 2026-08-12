import { create } from 'zustand'
import { api, setCsrfToken } from './api'

interface User { id: string; email: string; role: string; is_active: boolean }
interface AuthState {
  user: User | null
  loading: boolean
  checked: boolean
  check: () => Promise<void>
  login: (email: string, password: string) => Promise<{ password_change_recommended: boolean }>
  logout: () => Promise<void>
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: false,
  checked: false,
  check: async () => {
    try { const result = await api<User & { csrf_token: string }>('/auth/me'); setCsrfToken(result.csrf_token); set({ user: result, checked: true }) }
    catch { set({ user: null, checked: true }) }
  },
  login: async (email, password) => {
    set({ loading: true })
    try {
      const result = await api<{ user: User; csrf_token: string; password_change_recommended: boolean }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      setCsrfToken(result.csrf_token)
      set({ user: result.user, checked: true })
      return { password_change_recommended: result.password_change_recommended }
    } finally { set({ loading: false }) }
  },
  logout: async () => { await api('/auth/logout', { method: 'POST' }); set({ user: null }) },
}))
