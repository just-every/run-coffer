import type { Actor, Authority } from './auth'
import type { Bindings } from '../auth.server'

export class CofferError extends Error {
 constructor(public code: string, message: string, public status = 409, public details: unknown = null) { super(message); this.name = 'CofferError' }
}
export function fail(code: string, message: string, status = 409, details: unknown = null): never { throw new CofferError(code, message, status, details) }

export type Stmt = { sql: string; params: unknown[]; check?: { condition: string; code: string; message: string } }
/** Reviewed local-only adapters may collect native writes, then publish them
 * with their own receipt in one transaction. Never use with provider calls. */
export type TransactionPlan = { statements: Stmt[]; commits: number }
export type Context = { db: D1Database; actor: Actor; authority: Authority; now: string; env?: Bindings; transactionPlan?: TransactionPlan }
export type Row = Record<string, any>

export const sql = (text: string, ...params: unknown[]): Stmt => ({ sql: text, params })
/** A condition that must hold inside the write batch, or the whole batch aborts. */
export const guard = (condition: string, code: string, message: string, ...params: unknown[]): Stmt =>
 ({ sql: `INSERT INTO cf_assert(ok) SELECT CASE WHEN (${condition}) THEN 1 ELSE 0 END`, params, check: { condition, code, message } })
export const newId = () => crypto.randomUUID()

export async function one<T = Row>(c: { db: D1Database }, text: string, ...params: unknown[]): Promise<T | null> {
 return c.db.prepare(text).bind(...params).first<T>()
}
export async function all<T = Row>(c: { db: D1Database }, text: string, ...params: unknown[]): Promise<T[]> {
 return (await c.db.prepare(text).bind(...params).all<T>()).results ?? []
}

/** The audit row for a change: identifiers and amounts only, never donor personal data. */
export function event(c: { now: string; actor: { id: string; name: string; role: string; doorAgent?: Actor['doorAgent']; grant?: { id: string; version: number }; preparationGrant?: {id:string;version:number}; apiKey?: {id:string;scope:string} } }, action: string, subjectKind: string, subjectId: string, donorId: string | null, detail: Row = {}, table: 'cf_events' | 'cf_access_events' = 'cf_events'): Stmt {
 return sql(`INSERT INTO ${table}(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail) VALUES(?,?,?,?,?,?,?,?,?)`,
  c.now, c.actor.doorAgent?.id??c.actor.id, c.actor.name, c.actor.doorAgent?'agent':c.actor.role, action, subjectKind, subjectId, donorId, JSON.stringify({ ...detail, ...(c.actor.doorAgent?{agent:c.actor.doorAgent,preparedBy:c.actor.doorAgent.id,forPerson:c.actor.doorAgent.sponsorId}:{}), ...(c.actor.apiKey ? {apiKeyId:c.actor.apiKey.id,apiKeyScope:c.actor.apiKey.scope}:{}), ...((c.actor.grant??c.actor.preparationGrant) ? { grantId: (c.actor.grant??c.actor.preparationGrant)!.id, grantVersion: (c.actor.grant??c.actor.preparationGrant)!.version } : {}) }))
}

/** One D1 transaction: the caller's current authority, then the writes and
 * their guards. A failed guard is re-read to report which promise broke. */
export async function commit(c: { db: D1Database; authority: Authority; actor?: {id:string;teamAccess?:Actor['teamAccess']}; transactionPlan?: TransactionPlan }, statements: Stmt[]) {
 // Restricted reads may retain access audit and rate accounting only. This
 // second boundary also protects services invoked without the HTTP dispatcher.
 if(c.actor?.teamAccess?.readOnly&&statements.some(s=>!s.check&&!/^INSERT INTO cf_(access_events|api_rate_windows)\b/i.test(s.sql.trim())))
  fail('READ_ONLY','Your Coffer access is read-only. Ask an owner or admin to change it.',403)
 if(c.transactionPlan){c.transactionPlan.statements.push(...statements);if(statements.length)c.transactionPlan.commits++;return}
 const batch = [guard(c.authority.sql, 'SESSION_CHANGED', 'Your access changed. Sign in again.', ...c.authority.params), ...statements, sql('DELETE FROM cf_assert')]
 try { await c.db.batch(batch.map(s => c.db.prepare(s.sql).bind(...s.params))) } catch (error) {
  const text = String(error)
  if (/CHECK constraint failed/i.test(text) && /cf_assert|ok = 1|ok=1/i.test(text)) {
   for (const s of batch) {
    if (!s.check) continue
    const row = await one<{ ok: number }>(c, `SELECT CASE WHEN (${s.check.condition}) THEN 1 ELSE 0 END AS ok`, ...s.params)
    if (row?.ok !== 1) fail(s.check.code, s.check.message, s.check.code === 'SESSION_CHANGED' ? 401 : 409)
   }
   fail('CONCURRENT_CHANGE', 'Records changed while saving. Refresh and try again.')
  }
  if (/UNIQUE constraint failed: cf_donors\.email/i.test(text)) fail('DUPLICATE_EMAIL', 'Another donor already uses that email address.')
  if (/COFFER_DUPLICATE_EMAIL/.test(text)) fail('DUPLICATE_EMAIL', 'Another donor outside this household already uses that email. Review possible duplicates before adding another record.')
  if (/UNIQUE constraint failed: cf_gifts\.source, cf_gifts\.reference|cf_gift_reference/i.test(text)) fail('DUPLICATE_REFERENCE', 'A gift with that reference is already recorded.')
  if (/UNIQUE constraint failed: cf_households/i.test(text)) fail('DUPLICATE_HOUSEHOLD', 'A household with that name already exists.')
  if (/UNIQUE constraint failed: cf_acks\.gift_id|cf_ack_live_gift/i.test(text)) fail('ALREADY_ACKNOWLEDGED', 'A gift is already in another acknowledgement batch.')
  const raised = text.match(/COFFER_[A-Z_]+/)
  if (raised) fail(raised[0], 'That record cannot be changed this way.')
  throw error
 }
}

// Input validation. Every message names the field the person can fix.
export function object(value: unknown, label = 'Input'): Row {
 if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INPUT', `${label} must be an object.`, 400)
 return value as Row
}
export function text(value: unknown, label: string, max = 200): string {
 if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail('INPUT', `${label} must contain 1–${max} characters.`, 400)
 return value.trim()
}
export function optional(value: unknown, label: string, max = 200): string | null {
 if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return null
 return text(value, label, max)
}
export function longText(value: unknown, label: string, max = 8000): string {
 if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail('INPUT', `${label} must contain 1–${max} characters.`, 400)
 return value.replace(/\r\n/g, '\n').trim()
}
export function email(value: unknown, label = 'Email'): string | null {
 const v = optional(value, label, 254)?.toLowerCase() ?? null
 if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail('INPUT', `${label} must be a valid email address.`, 400)
 return v
}
export function date(value: unknown, label: string): string {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail('INPUT', `${label} must be a date like 2026-03-31.`, 400)
 return value
}
export function integer(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
 if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail('INPUT', `${label} must be a whole number from ${min} to ${max}.`, 400)
 return value
}
export function choice<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
 if (!allowed.includes(value as T)) fail('INPUT', `Choose ${label}: ${allowed.join(', ')}.`, 400)
 return value as T
}
export const id = (value: unknown, label: string) => text(value, label, 100)

/** Today's calendar date in the organization's time zone. */
export function today(timezone: string, at = new Date()): string {
 const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
 const get = (type: string) => parts.find(p => p.type === type)!.value
 return `${get('year')}-${get('month')}-${get('day')}`
}
export function addDays(day: string, days: number): string {
 return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}
export function daysBetween(from: string, to: string): number {
 return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
}
export async function sha256(value: string): Promise<string> {
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), x => x.toString(16).padStart(2, '0')).join('')
}
