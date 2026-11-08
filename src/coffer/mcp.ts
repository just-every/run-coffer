import { catalogFor, describeTool } from './mcp/catalog'
import { validInput } from './mcp/input'
import { commit, event } from './db'
import { CofferError, type Context, type Row } from './db'

const CURRENT = '2026-07-28', LEGACY = '2025-11-25', versions = [CURRENT, LEGACY]
const serverInfo = { name: 'coffer', version: '1.0.0' }, capabilities = { tools: {} }
const instructions = 'Read donor context and prepare drafts under the key’s current authority. People approve ordinary drafts. Named grants may separately authorize sending standard receipts under a standing human approval; scope, templates, daily limits and kill switches apply to every call.'
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
const json = (value: unknown, status = 200, extra = {}) => Response.json(value, { status, headers: { ...headers, ...extra } })
const error = (id: string | number | null, code: number, message: string, status = 400, data?: unknown) => json({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }, status)
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)

function headerName(value: string | null): string | null {
 if (value === null) return null
 if (value.startsWith('=?base64?') && value.endsWith('?=')) {
  try { const bytes = Uint8Array.from(atob(value.slice(9, -2)), x => x.charCodeAt(0)); return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return null }
 }
 return /^[\x20-\x7e]+$/.test(value) && value.trim() === value ? value : null
}

/** Root supplies native bearer identity + authority, validates Origin, and reads
 * UTF-8 text with its bounded private-body reader (1 MiB). No sessions are kept. */
export async function mcpResponse(request: Request, c: Context, readBody: () => Promise<string>): Promise<Response> {
 const availableTools = catalogFor(c)
 if(c.actor.grant)await commit(c,[event(c,'mcp.request','agent_grant',c.actor.grant.id,null,{},'cf_access_events')])
 if (c.actor.role !== 'agent') return error(null, -32600, 'Use an existing Coffer agent bearer key.', 403)
 if (request.method !== 'POST') return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Use POST; this endpoint does not offer a GET stream or sessions.' } }, 405, { allow: 'POST' })
 if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return error(null, -32600, 'Send application/json.', 415)
 const accept = (request.headers.get('accept') ?? '').split(',').map(part => part.trim().toLowerCase()).filter(part => !/;\s*q=0(?:\.0*)?(?:;|$)/.test(part)).map(part => part.split(';')[0].trim())
 if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return error(null, -32600, 'Accept application/json and text/event-stream.', 406)
 let message: unknown
 try { message = JSON.parse(await readBody()) }
 catch (cause) {
  if (cause instanceof CofferError) return error(null, -32600, cause.message, cause.status, { code: cause.code })
  return error(null, -32700, 'Parse error: send one UTF-8 JSON-RPC message.')
 }
 if (!object(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || !message.method || (Object.hasOwn(message, 'id') && !(typeof message.id === 'string' || (typeof message.id === 'number' && Number.isSafeInteger(message.id)))) || (message.params !== undefined && !object(message.params)) || Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error')) return error(null, -32600, 'Invalid JSON-RPC request or notification.')
 const notification = !Object.hasOwn(message, 'id'), id = notification ? null : message.id as string | number
 const p = message.params ?? {}, version = request.headers.get('mcp-protocol-version')
 const modern = version === CURRENT || (object(p._meta) && p._meta['io.modelcontextprotocol/protocolVersion'] === CURRENT)
 if (modern) {
  if (version !== CURRENT || !object(p._meta) || p._meta['io.modelcontextprotocol/protocolVersion'] !== version || request.headers.get('mcp-method') !== message.method || (message.method === 'tools/call' && headerName(request.headers.get('mcp-name')) !== p.name)) return error(id, -32020, 'Required MCP headers are missing or do not match the message.')
  if (!object(p._meta['io.modelcontextprotocol/clientCapabilities']) || (p._meta['io.modelcontextprotocol/clientInfo'] !== undefined && (!object(p._meta['io.modelcontextprotocol/clientInfo']) || typeof p._meta['io.modelcontextprotocol/clientInfo'].name !== 'string' || typeof p._meta['io.modelcontextprotocol/clientInfo'].version !== 'string'))) return error(id, -32602, 'Supply valid per-request client metadata.')
 } else if ((version && version !== LEGACY) || (p._meta?.['io.modelcontextprotocol/protocolVersion'] !== undefined && p._meta['io.modelcontextprotocol/protocolVersion'] !== LEGACY)) return error(id, -32022, 'Unsupported protocol version.', 400, { supported: versions, requested: version ?? p._meta?.['io.modelcontextprotocol/protocolVersion'] })
 else if (message.method !== 'initialize' && version !== LEGACY) return error(id, -32020, 'Supply MCP-Protocol-Version on every request after initialization.')
 const result = (value: Row) => json({ jsonrpc: '2.0', id, result: modern ? { resultType: 'complete', ...value, _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo } } : value })
 if (notification) {
  if (!modern && ['notifications/initialized', 'notifications/cancelled', 'notifications/progress'].includes(message.method)) return new Response(null, { status: 202, headers })
  // Never execute a tool without an id: tool calls are requests, not notifications.
  return new Response(null, { status: 400, headers })
 }
 if (message.method === 'initialize' && !modern) {
  if (typeof p.protocolVersion !== 'string' || !object(p.capabilities) || !object(p.clientInfo) || typeof p.clientInfo.name !== 'string' || typeof p.clientInfo.version !== 'string') return error(id, -32602, 'Supply protocolVersion, clientInfo and capabilities.')
  return result({ protocolVersion: LEGACY, capabilities, serverInfo, instructions })
 }
 if (message.method === 'server/discover' && modern) return result({ supportedVersions: versions, capabilities, instructions })
 if (message.method === 'ping' && !modern) return result({})
 if (message.method === 'tools/list') {
  if (p.cursor !== undefined) return error(id, -32602, 'This catalog has one page; omit cursor.')
  return result({ tools: availableTools.map(describeTool) })
 }
 if (message.method !== 'tools/call') return error(id, -32601, 'Method not found.', modern ? 404 : 200)
 // DONOR-008: agent keys never grant record-file access, including direct
 // calls to document operations that are deliberately absent from discovery.
 if (typeof p.name === 'string' && p.name.startsWith('documents.')) return error(id, -32602, 'Agent keys cannot use record documents.', 403, { code: 'FORBIDDEN' })
 const tool = availableTools.find(tool => tool.name === p.name)
 if (!tool) return error(id, -32602, 'Unknown tool. Only the listed read and preparation tools are available.', modern ? 400 : 200)
 const args = p.arguments === undefined ? {} : p.arguments
 if (!validInput(args, tool.inputSchema)) return error(id, -32602, 'Tool arguments must match its inputSchema.', modern ? 400 : 200)
 try {
  const value = await tool.run(c, args)
  if(c.actor.preparationGrant)await commit(c,[event(c,'mcp.tool','agent_grant',c.actor.preparationGrant.id,tool.name==='donors.context'?String(args.donorId):null,{tool:tool.name},'cf_access_events')])
  return result({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: false })
 } catch (cause) {
  if (!(cause instanceof CofferError)) return error(id, -32603, 'Internal error.', 500)
  // Domain failures stay tool results so a client can correct its proposal.
  return result({ content: [{ type: 'text', text: JSON.stringify({ error: cause.code, message: cause.message, details: cause.details }) }], isError: true })
 }
}
