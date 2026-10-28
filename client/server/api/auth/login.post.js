import { sendProblem } from '../../utils/problem'

export default defineEventHandler(async (event) => {
  let body
  try {
    body = await readBody(event)
  } catch {
    return sendProblem(event, 400, 'Invalid JSON request body.')
  }
  if (typeof body?.login !== 'string' || typeof body?.password !== 'string') {
    return sendProblem(event, 400, 'Username and password are required.')
  }

  let result
  try {
    result = await $fetch(`${useRuntimeConfig(event).apiBase}/api/auth/login`, {
      method: 'POST',
      body: { login: body.login, password: body.password },
    })
  } catch (error) {
    if (error.response?.status === 401) return sendProblem(event, 401, 'Invalid username or password.')
    if (error.response?.status === 400) return sendProblem(event, 400, 'Invalid login input.')
    return sendProblem(event, 502, 'Authentication server is unavailable.')
  }

  setCookie(event, 'auth_token', result.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: getRequestURL(event).protocol === 'https:',
    path: '/',
  })
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return result.user
})
