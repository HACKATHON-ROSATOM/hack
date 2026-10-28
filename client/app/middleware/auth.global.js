import { useUserStore } from '~/stores/user'

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login' || to.path === '/session-unavailable') return
  const userStore = useUserStore()
  try {
    if (!await userStore.restore()) return navigateTo('/login')
  } catch {
    return navigateTo({ path: '/session-unavailable', query: { returnTo: to.fullPath } })
  }
})