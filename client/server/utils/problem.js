import { STATUS_CODES } from 'node:http'
import { getRequestURL, setResponseHeader, setResponseStatus } from 'h3'

export function sendProblem(event, status, detail) {
  setResponseStatus(event, status)
  setResponseHeader(event, 'Content-Type', 'application/problem+json')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return {
    type: 'about:blank',
    title: STATUS_CODES[status],
    status,
    detail,
    instance: getRequestURL(event).pathname,
  }
}
