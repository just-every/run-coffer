const maximumDiscardBytes = 64 * 1024
const maximumDiscardMs = 2000

/**
 * Finish a rejected upload before returning its response. This preserves the
 * intended status through workerd's upload proxy without buffering input.
 * Drain only a bounded amount; stopping the drain never changes the original
 * application status or reason. Only the endpoint can diagnose an oversized body.
 */
export async function rejectedResponse(request: Request, response: Response): Promise<Response> {
  if (!request.body || request.bodyUsed || request.body.locked) return response
  const reader = request.body.getReader()
  let bytes = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), maximumDiscardMs)
  })
  try {
    for (;;) {
      const result = await Promise.race([reader.read(), deadline])
      if (result === 'timeout') {
        void reader.cancel('Rejected upload exceeded time limit').catch(() => {})
        return response
      }
      if (result.done) return response
      bytes += result.value.byteLength
      if (bytes > maximumDiscardBytes) {
        void reader.cancel('Rejected upload exceeded size limit').catch(() => {})
        return response
      }
    }
  } catch {
    return response
  } finally {
    clearTimeout(timer)
  }
}

export function notFoundResponse(request: Request): Promise<Response> {
  return rejectedResponse(request, new Response('404 Not Found', { status: 404 }))
}
