export default defineEventHandler(async (event) => {
  const token = getCookie(event, 'auth_token')
  if (token) {
    try {
      await $fetch(`${useRuntimeConfig(event).apiBase}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {
      // The browser session is cleared even if the API session has already expired.
    }
  }
  deleteCookie(event, 'auth_token', { path: '/' })
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { ok: true }
})
