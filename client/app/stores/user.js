import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const roles = { DUTY: 'dispatcher', ENGINEER: 'engineer', DIRECTOR: 'director' }

function validUser(user) {
  return typeof user?.id === 'string' && typeof user?.name === 'string' &&
    Object.hasOwn(roles, user.role)
}

export const useUserStore = defineStore('user', () => {
  const user = ref(null)
  const role = computed(() => roles[user.value?.role] ?? null)

  function setUser(value) {
    if (!validUser(value)) throw new Error('Invalid server response')
    user.value = value
  }

  async function login(login, password) {
    const value = await $fetch('/api/auth/login', {
      method: 'POST',
      body: { login, password },
    })
    setUser(value)
    return value
  }

  async function logout() {
    user.value = null
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // The local session is cleared even if the API is unavailable.
    }
  }

  async function restore() {
    if (user.value) return true
    try {
      const requestFetch = import.meta.server ? useRequestFetch() : $fetch
      setUser(await requestFetch('/api/auth/me'))
      return true
    } catch (error) {
      if (error?.statusCode === 401 || error?.response?.status === 401) return false
      throw error
    }
  }

  async function api(path, options = {}) {
    try {
      return await $fetch(path, options)
    } catch (error) {
      if (error?.statusCode === 401 || error?.response?.status === 401) {
        await logout()
        if (import.meta.client) await navigateTo('/login?session=expired')
      }
      throw error
    }
  }

  return { user, role, login, logout, restore, api }
})
