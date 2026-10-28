const messages = {
  400: 'Invalid request.',
  401: 'Authentication required.',
  403: 'You do not have permission to perform this action.',
  404: 'Resource not found.',
  409: 'The request conflicts with the current data.',
  502: 'API server is unavailable.',
}

export function apiProblem(error) {
  const problem = error?.data || {}
  const status = problem.status ?? error?.statusCode ?? error?.response?.status ?? 0
  const detail = problem.detail && !/[А-Яа-яЁё]/.test(problem.detail)
    ? problem.detail
    : messages[status] || 'Unable to complete the request.'

  return {
    status,
    detail,
  }
}
