import { useUserStore } from '~/stores/user'

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return
  const userStore = useUserStore()
  try {
    if (!await userStore.restore()) return navigateTo('/login')
  } catch {
    return navigateTo('/login?session=unavailable')
  }
})