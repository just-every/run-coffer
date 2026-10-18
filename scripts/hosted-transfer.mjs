// Hosted restore transport. A retry always reuses the same job, index and bytes.
import { setTimeout as delay } from 'node:timers/promises'

export class HostedTransferError extends Error {
 constructor(path, status, reason) {
  super(`Hosted import ${path.split('/')[2] ?? 'request'} failed${status ? ` (HTTP ${status})` : ''}: ${reason}`)
  this.status = status
 }
}
const transient = status => status === undefined || status === 408 || status === 429 || status >= 500

export function restoreTransport({ origin, cookie }) {
 const safe = value => typeof value === 'string' && value.length <= 1000 && !/[\x00-\x1f\x7f]/.test(value) && ![cookie, cookie.slice(cookie.indexOf('=') + 1)].filter(Boolean).some(secret => value.includes(secret))
 async function request(path, method = 'GET', body, retry = false) {
  for (let attempt = 0; ; attempt++) {
   let status, result, reason = 'The connection failed. Resume this job to continue.'
   try {
    const response = await fetch(`${origin}/api/portability/${path}`, {
     method, redirect: 'error', headers: { Cookie: cookie, Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
     body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120_000),
    })
    status = response.status
    const bytes = await boundedBody(response)
    try { result = JSON.parse(bytes) } catch { /* Provider errors need not be JSON. */ }
    if (response.ok && result && typeof result === 'object' && !Array.isArray(result)) return result
    reason = safe(result?.message) ? result.message : safe(result?.error) ? result.error : response.ok ? 'The server returned an invalid response.' : `The server refused the request${safe(bytes) && !bytes.includes('<') ? `: ${bytes}` : '.'}`
   } catch { status = undefined; /* Retry a lost response with the exact same upload bytes. */ }
   if (!retry || !transient(status) || attempt >= 4) throw new HostedTransferError(path, status, reason)
   const milliseconds = 500 * 2 ** attempt
   console.error(`Retrying ${path.split('/')[2] ?? 'status'}${path.includes('/parts/') ? ` part ${path.split('/')[3]}` : ''} after ${status ? `HTTP ${status}` : 'a connection failure'} (${attempt + 1}/4; ${milliseconds} ms).`)
   await delay(milliseconds)
  }
 }
 return {
  get: (path, method = 'GET', body) => request(path, method, body, method === 'GET' || path.endsWith('/finalize')),
  async upload(id, part) {
   const path = `imports/${id}/parts/${part.index}`
   try { return await request(path, 'PUT', part, true) }
   catch (error) { if (!(error instanceof HostedTransferError) || error.status !== 413) throw error }
   // Split transport bytes, not archive parts: indices and archive checksums stay intact.
   const bytes = Buffer.from(JSON.stringify(part))
   let size = Math.min(256 * 1024, Math.floor(bytes.length / 2))
   for (let offset = 0; offset < bytes.length;) {
    const chunk = bytes.subarray(offset, offset + size)
    try {
     await request(path, 'PUT', { kind: 'fragment', offset, total: bytes.length, sha256: part.sha256, data: chunk.toString('base64') }, true)
     offset += chunk.length
    } catch (error) {
     if (!(error instanceof HostedTransferError) || error.status !== 413 || size <= 1024) throw error
     size = Math.floor(size / 2)
    }
   }
  },
 }
}

async function boundedBody(response) {
 const reader = response.body?.getReader()
 if (!reader) return ''
 const chunks = []; let length = 0
 try {
  for (;;) {
   const { value, done } = await reader.read()
   if (done) return Buffer.concat(chunks).toString('utf8')
   length += value.length
   if (length > 16384) return ''
   chunks.push(value)
  }
 } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
