import { createError, getRequestURL, proxyRequest } from 'h3'

export default defineEventHandler((event) => {
  const { apiBase } = useRuntimeConfig(event)
  if (!apiBase) {
    throw createError({ statusCode: 500, statusMessage: 'NUXT_API_BASE is not configured' })
  }
  const requestUrl = getRequestURL(event)
  const target = `${apiBase.replace(/\/+$/, '')}${requestUrl.pathname}${requestUrl.search}`
  return proxyRequest(event, target)
})
