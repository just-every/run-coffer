import { commit, event, newId, type Context, type Row } from '../db'
import { catalogFor } from './catalog'

type Target = { kind: 'donor' | 'ack_batch' | 'appeal'; id: string }
type Outcome = 'done' | 'refused' | 'failed'

/** Execution and admission-refusal correlation recognize the same MCP name. */
export function headerName(value: string | null): string | null {
 if (value === null) return null
 if (value.startsWith('=?base64?') && value.endsWith('?=')) {
  try { const bytes = Uint8Array.from(atob(value.slice(9, -2)), x => x.charCodeAt(0)); return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return null }
 }
 return /^[\x20-\x7e]+$/.test(value) && value.trim() === value ? value : null
}

/** Retain only the bounded version-00 W3C context, never arbitrary metadata,
 * client names, RPC IDs, arguments, idempotency keys or exception messages. */
function traceparent(request: Request): string | undefined {
 const value = request.headers.get('traceparent')
 if (!value || !/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/.test(value)) return
 const [, trace, parent] = value.split('-')
 if (/^0+$/.test(trace) || /^0+$/.test(parent)) return
 return value
}

/** Targets come exclusively from the completed native result. Refusals and
 * attempts retain no caller-supplied identifiers, even for missing records. */
function authorizedTargets(tool: string, value: Row): Target[] {
 if (tool === 'donors.list') return value.donors.map((donor: Row) => ({ kind: 'donor', id: donor.id }))
 if (tool === 'donors.context') return [{ kind: 'donor', id: value.donor.id }]
 return [{ kind: tool === 'appeal.prepare' ? 'appeal' : 'ack_batch', id: value.id }]
}

/** Only called for a recognized tool after native authentication and protocol
 * validation. Identity is the server's key and grant snapshot, not client info.
 * These are access facts; native decisions and domain transactions stay native. */
export async function beginToolAudit(c: Context, request: Request, tool: string) {
 const grant = c.actor.grant ?? c.actor.preparationGrant!
 const trace = traceparent(request)
 const detail = { attemptId: newId(), requestId: c.requestId ?? newId(), keyId: c.actor.id,
  grantProfile: c.actor.grant ? 'named-grant' : 'preparation-only', tool,
  ...(trace ? { traceparent: trace } : {}) }
 await commit(c, [event(c, 'mcp.tool.attempt', 'agent_grant', grant.id, null, { ...detail, targets: [] }, 'cf_access_events')])
 return async (outcome: Outcome, code: string | number, value?: Row) => {
  const targets = outcome === 'done' && value ? authorizedTargets(tool, value) : []
  const row = event({ ...c, now: new Date().toISOString() }, 'mcp.tool.outcome', 'agent_grant', grant.id,
   tool === 'donors.context' ? targets[0]?.id ?? null : null, { ...detail, targets, outcome, code }, 'cf_access_events')
  // An authenticated attempt must retain its terminal fact even when the
  // native operation detects a revoked key or changed grant. Append only this
  // captured access row; never use an expired authority for a domain write.
  await c.db.batch([c.db.prepare(row.sql).bind(...row.params)])
 }
}

/** Admission quotas still run first and keep their native response. A bounded
 * inspection can correlate a recognized tool refusal without executing it or
 * treating request arguments as authorized facts. Discovery, notifications,
 * malformed envelopes and unknown tools create no tool attempt. */
export async function auditAdmissionRefusal(c: Context, request: Request, readBody: () => Promise<string>, code: string) {
 if (request.method !== 'POST' || request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return
 const accept = (request.headers.get('accept') ?? '').split(',').map(part => part.trim().toLowerCase()).filter(part => !/;\s*q=0(?:\.0*)?(?:;|$)/.test(part)).map(part => part.split(';')[0].trim())
 if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return
 let message: Row
 try { message = JSON.parse(await readBody()) } catch { return }
 const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
 if (!object(message) || message.jsonrpc !== '2.0' || message.method !== 'tools/call' || !(typeof message.id === 'string' || (typeof message.id === 'number' && Number.isSafeInteger(message.id))) || !object(message.params) || Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error')) return
 const p = message.params, version = request.headers.get('mcp-protocol-version'), meta = p._meta
 if (version === '2026-07-28') {
  if (request.headers.get('mcp-method') !== message.method || headerName(request.headers.get('mcp-name')) !== p.name || !object(meta) || meta['io.modelcontextprotocol/protocolVersion'] !== version || !object(meta['io.modelcontextprotocol/clientCapabilities'])) return
  const client = meta['io.modelcontextprotocol/clientInfo']
  if (client !== undefined && (!object(client) || typeof client.name !== 'string' || typeof client.version !== 'string')) return
 } else if (version !== '2025-11-25' || (meta?.['io.modelcontextprotocol/protocolVersion'] !== undefined && meta['io.modelcontextprotocol/protocolVersion'] !== version)) return
 const tool = catalogFor(c).find(tool => tool.name === p.name)
 if (tool) await (await beginToolAudit(c, request, tool.name))('refused', code)
}
