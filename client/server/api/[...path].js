import { getCookie, getRequestURL, proxyRequest } from 'h3'
import { sendProblem } from '../utils/problem'

export default defineEventHandler(async (event) => {
  const { apiBase } = useRuntimeConfig(event)
  if (!apiBase) {
    return sendProblem(event, 500, 'API server is not configured.')
  }
  const requestUrl = getRequestURL(event)
  const target = `${apiBase.replace(/\/+$/, '')}${requestUrl.pathname}${requestUrl.search}`
  const token = getCookie(event, 'auth_token')
  try {
    return await proxyRequest(event, target, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  } catch {
    return sendProblem(event, 502, 'API server is unavailable.')
  }
})
