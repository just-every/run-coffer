import { fail } from '../db'
import type { PaymentsEnv } from './pantry'

export type Proposal = {
 id: string; kind: string; summary: string; payload: Record<string, unknown>; status: string
 result_kind?: string | null; result_id?: string | null
}
type Account = { id: string; type: string; subtype: string; active: number; revision: string }
type RemoteContext = { accounts: Account[]; documents: { id: string; sha256?: string; text?: string }[]; proposals: Proposal[] }

export function connection(env: PaymentsEnv) {
 let url: URL
 try { url = new URL(env.PANTRY_ORIGIN ?? '') } catch { fail('PANTRY_CONFIG', 'Set a valid PANTRY_ORIGIN to connect Pantry.', 503) }
 const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
 if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || !(url.protocol === 'https:' || loopback && url.protocol === 'http:')) fail('PANTRY_CONFIG', 'Pantry requires a bare HTTPS origin, or HTTP on loopback.', 400)
 const token = env.PANTRY_AGENT_TOKEN?.trim()
 if (!token || !/^pantry_agent_[A-Za-z0-9_-]{32,}$/.test(token)) fail('PANTRY_CONFIG', 'Set a valid PANTRY_AGENT_TOKEN to connect Pantry.', 503)
 return { origin: url.origin, token }
}

export async function request<T>(conn: ReturnType<typeof connection>, path: string, body?: unknown): Promise<T> {
 let response: Response
 try {
  response = await fetch(conn.origin + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
   headers: { authorization: `Bearer ${conn.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
   ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
 } catch { fail('PANTRY_UNAVAILABLE', 'Pantry could not be reached. Refresh the saved submission before taking further action.', 502) }
 if (!response.ok) fail('PANTRY_REFUSED', `Pantry refused the request (HTTP ${response.status}). Check its token, accounts, evidence and accounting period.`, 502)
 try { return await response.json() as T } catch { fail('PANTRY_RESPONSE', 'Pantry returned an unreadable response. Refresh the saved submission.', 502) }
}

export async function context(conn: ReturnType<typeof connection>) {
 const remote = await request<RemoteContext>(conn, '/api/pantry/agent/context')
 if (!remote || !Array.isArray(remote.accounts) || !Array.isArray(remote.documents) || !Array.isArray(remote.proposals)) fail('PANTRY_RESPONSE', 'Pantry returned incomplete accounting context.', 502)
 return remote
}
