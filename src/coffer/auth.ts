import { operatorAuth, runtimeBindings, type Bindings } from '../auth.server'
import { CofferError } from './db'
export type Role = 'owner' | 'admin' | 'member' | 'agent'
/** `org` is display-only: the organization name the app shell shows in its top bar. */
export type Actor = { id: string; name: string; role: Role; org?: string; grant?: { id: string; version: number }; preparationGrant?: {id:string;version:number} }
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
  const sql = "EXISTS(SELECT 1 FROM cf_agent_keys k JOIN oa_operators o ON o.id=k.created_by WHERE k.token_hash=? AND k.revoked_at IS NULL AND k.expires_at>MAX(?,unixepoch('now')*1000) AND o.status='active' AND o.version=k.creator_version AND o.role IN ('owner','admin'))"
  const key = await env.DB.prepare(`SELECT k.id,k.label,k.grant_id,g.version AS grant_version,control.version AS control_version,pg.id AS preparation_id,pg.version AS preparation_version FROM cf_agent_keys k LEFT JOIN cf_agent_grants g ON g.id=k.grant_id LEFT JOIN cf_agent_preparation_grants pg ON pg.key_id=k.id CROSS JOIN cf_agent_grant_control control WHERE k.token_hash=? AND (${sql})`).bind(hash, hash, now).first<{ id: string; label: string; grant_id: string | null; grant_version: number; control_version: number; preparation_id:string|null;preparation_version:number }>()
  if (!key || (!key.grant_id&&!key.preparation_id)) throw new CofferError('invalid_agent_key', 'This agent key is unknown, expired or revoked.', 401)
  const grantSql = key.grant_id ? ` AND EXISTS(SELECT 1 FROM cf_agent_keys WHERE token_hash=? AND grant_id=?) AND EXISTS(SELECT 1 FROM cf_agent_grants g JOIN oa_operators approver ON approver.id=g.approved_by_id WHERE g.id=? AND g.version=? AND g.enabled=1 AND approver.status='active' AND approver.version=g.approver_version AND approver.role IN ('owner','admin')) AND EXISTS(SELECT 1 FROM cf_agent_grant_control WHERE id=1 AND enabled=1 AND version=?)` : ' AND EXISTS(SELECT 1 FROM cf_agent_keys WHERE token_hash=? AND grant_id IS NULL) AND EXISTS(SELECT 1 FROM cf_agent_preparation_grants WHERE id=? AND version=? AND enabled=1) AND EXISTS(SELECT 1 FROM cf_agent_grant_control WHERE id=1 AND enabled=1 AND version=?)'
  return { actor: { id: key.id, name: key.label, role: 'agent', ...(key.grant_id ? { grant: { id: key.grant_id, version: key.grant_version } } : {preparationGrant:{id:key.preparation_id!,version:key.preparation_version}}) }, authority: { sql: sql + grantSql, params: [hash, now, ...(key.grant_id ? [hash,key.grant_id,key.grant_id, key.grant_version,key.control_version]  : [hash,key.preparation_id,key.preparation_version,key.control_version])] }, bearer: true }
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
