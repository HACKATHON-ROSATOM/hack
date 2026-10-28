import { defineStore } from 'pinia'

const storageKey = 'service-session'
const roles = { DUTY: 'dispatcher', ENGINEER: 'engineer', DIRECTOR: 'director' }
const restores = new WeakMap()

function validSession(session) {
  return typeof session?.token === 'string' && session.token.length > 0 &&
    typeof session.user?.id === 'string' && typeof session.user?.name === 'string' &&
    Object.hasOwn(roles, session.user?.role)
}

export const useUserStore = defineStore('user', {
  state: () => ({
    user: null,
    token: null,
    role: null,
    sessionVersion: 0,
  }),
  actions: {
    async login(login, password) {
      const session = await $fetch('/api/auth/login', {
        method: 'POST',
        body: { login, password },
      })
      if (!validSession(session)) throw new Error('Некорректный ответ сервера')
      this.sessionVersion++
      this.user = session.user
      this.token = session.token
      this.role = roles[session.user.role]
      if (import.meta.client) localStorage.setItem(storageKey, JSON.stringify(session))
      return session.user
    },
    logout() {
      this.sessionVersion++
      this.user = null
      this.token = null
      this.role = null
      if (import.meta.client) localStorage.removeItem(storageKey)
    },
    async restore() {
      if (import.meta.server) return false
      if (this.token && this.user) return true
      if (restores.has(this)) return restores.get(this)

      const version = this.sessionVersion
      const restore = (async () => {
        let session
        try {
          session = JSON.parse(localStorage.getItem(storageKey) || 'null')
        } catch {
          localStorage.removeItem(storageKey)
          return false
        }
        if (!validSession(session)) {
          localStorage.removeItem(storageKey)
          return false
        }
        try {
          await $fetch('/api/requests', { headers: { Authorization: `Bearer ${session.token}` } })
        } catch (error) {
          if (error?.statusCode === 401 || error?.response?.status === 401) {
            if (this.sessionVersion === version) this.logout()
            return false
          }
          throw error
        }
        if (this.sessionVersion !== version) return Boolean(this.token && this.user)
        this.user = session.user
        this.token = session.token
        this.role = roles[session.user.role]
        return true
      })()
      restores.set(this, restore)
      try {
        return await restore
      } finally {
        if (restores.get(this) === restore) restores.delete(this)
      }
    },
    async api(path, options = {}) {
      const token = this.token
      const headers = new Headers(options.headers)
      if (token) headers.set('Authorization', `Bearer ${token}`)
      try {
        return await $fetch(path, { ...options, headers })
      } catch (error) {
        if ((error?.statusCode === 401 || error?.response?.status === 401) && token === this.token) {
          this.logout()
          if (import.meta.client) await navigateTo('/login?session=expired')
        }
        throw error
      }
    },
  },
})
