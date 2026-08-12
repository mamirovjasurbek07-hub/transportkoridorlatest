const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api').replace(/\/$/, '')
let csrfToken = ''

export function setCsrfToken(value: string): void {
  csrfToken = value
}

function cookie(name: string): string {
  const match = document.cookie.split('; ').find((item) => item.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : ''
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message)
  }
}

export async function api<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const method = (init.method || 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('X-CSRF-Token', csrfToken || cookie('csrf_token'))
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include', signal })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const payload = body?.error
    if (response.status === 401 && location.pathname.startsWith('/admin') && location.pathname !== '/admin/login') location.assign('/admin/login')
    throw new ApiError(response.status, payload?.message || `So'rov bajarilmadi (${response.status})`, payload?.details)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export { API_BASE }
