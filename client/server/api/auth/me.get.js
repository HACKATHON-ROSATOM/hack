import { sendProblem } from '../../utils/problem'

export default defineEventHandler(async (event) => {
  const token = getCookie(event, 'auth_token')
  if (!token) return sendProblem(event, 401, 'Authentication required.')

  try {
    const user = await $fetch(`${useRuntimeConfig(event).apiBase}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    setResponseHeader(event, 'Cache-Control', 'no-store')
    return user
  } catch (error) {
    if (error.response?.status === 401) {
      deleteCookie(event, 'auth_token', { path: '/' })
      return sendProblem(event, 401, 'Session expired.')
    }
    return sendProblem(event, 502, 'Authentication server is unavailable.')
  }
})
