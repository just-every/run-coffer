import { operatorAuth, runtimeBindings, type Bindings } from '../auth.server'
import { CofferError } from './db'
export type Role = 'owner' | 'admin' | 'member' | 'agent'
/** `org` is display-only: the organization name the app shell shows in its top bar. */
export type Actor = { id: string; name: string; role: Role; org?: string }
export type Authority = { sql: string; params: any[] }
export const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), x => x.toString(16).padStart(2, '0')).join('')
/** Owners and admins manage; members do data entry; agents only prepare. */
export const manager = (actor: Actor) => actor.role === 'owner' || actor.role === 'admin'
export const person = (actor: Actor) => actor.role !== 'agent'
export function requireRole(actor: Actor, allowed: Role[], what: string) {
 if (!allowed.includes(actor.role)) throw new CofferError('FORBIDDEN', `Your role cannot ${what}.`, 403)
}

/** A bearer agent key or a native Base session. The returned authority is a SQL
 * predicate that every write batch re-checks, so a revoked session, a role
 * change or a revoked key stops a request that is already in flight. */
export async function identity(request: Request, original: Bindings): Promise<{ actor: Actor; authority: Authority; bearer: boolean }> {
 const env = runtimeBindings(original), bearer = request.headers.get('authorization')
 if (bearer) {
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(bearer)) throw new CofferError('invalid_agent_key', 'Supply a valid agent key.', 401)
  const hash = await digest(bearer.slice(7)), now = Date.now()
  const sql = "EXISTS(SELECT 1 FROM cf_agent_keys k JOIN oa_operators o ON o.id=k.created_by WHERE k.token_hash=? AND k.revoked_at IS NULL AND k.expires_at>? AND o.status='active' AND o.version=k.creator_version AND o.role IN ('owner','admin'))"
  const key = await env.DB.prepare(`SELECT k.id,k.label FROM cf_agent_keys k WHERE k.token_hash=? AND (${sql})`).bind(hash, hash, now).first<{ id: string; label: string }>()
  if (!key) throw new CofferError('invalid_agent_key', 'This agent key is unknown, expired or revoked.', 401)
  return { actor: { id: key.id, name: key.label, role: 'agent' }, authority: { sql, params: [hash, now] }, bearer: true }
 }
 const session = await operatorAuth(env).getSession(request)
 if (!session) throw new CofferError('sign_in_required', 'Sign in to continue.', 401)
 const { operator: o } = session
 return {
  actor: { id: o.id, name: o.displayName, role: o.role },
  bearer: false,
  authority: { sql: "EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id WHERE s.id=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.operator_version=o.version AND o.version=? AND o.status='active' AND o.role=?)", params: [session.id, Date.now(), o.version, o.role] },
 }
}

export function originGuard(request: Request, env: Bindings, bearer = false) {
 const url = new URL(request.url), origin = runtimeBindings(env).AUTH_ORIGIN
 if (url.origin !== origin || (request.headers.has('host') && request.headers.get('host')?.toLowerCase() !== url.host.toLowerCase())) throw new CofferError('invalid_host', 'This request was sent to the wrong address.', 403)
 if (request.headers.get('sec-fetch-site') === 'cross-site' || (!['GET', 'HEAD'].includes(request.method) && !bearer && request.headers.get('origin') !== origin)) throw new CofferError('invalid_origin', 'This request did not come from Coffer.', 403)
}
