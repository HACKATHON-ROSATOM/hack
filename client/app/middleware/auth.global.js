import { useUserStore } from '~/stores/user'

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return
  const userStore = useUserStore()
  if (to.path === '/login') return
  try {
    if (!await userStore.restore()) return navigateTo('/login')
  } catch {
    return navigateTo('/login?session=unavailable')
  }
})
