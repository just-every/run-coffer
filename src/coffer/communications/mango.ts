import { fail, type Row } from '../db'
import { nameMergeFields } from '../person-names'
import type { Connection } from './connection'

/** Mango's scoped integration API (Mango → Settings → Integration credentials).
 * A credential can sync contacts, lists and opt-outs; only a person in Mango approves a campaign. */
const SCOPES: Record<string, string> = {
 'contacts:read': 'Read contacts', 'contacts:write': 'Write contacts', 'events:read': 'Read campaign events', 'campaigns:send': 'Send to a segment',
}
async function call(conn: Connection, path: string, method = 'GET', body?: unknown): Promise<Response> {
 try {
  return await fetch(`${conn.origin}/api/integrations/v1${path}`, { method, redirect: 'manual', signal: AbortSignal.timeout(20_000),
   headers: { authorization: `Bearer ${conn.credential}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
   ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
 } catch { return fail('MANGO_UNREACHABLE', `Coffer could not reach Mango at ${conn.origin}. Check that Mango is running and the address is right.`, 502) }
}
async function refusal(response: Response): Promise<never> {
 const data = await response.json().catch(() => ({})) as Row
 if (response.status === 401) fail('MANGO_CREDENTIAL', 'Mango no longer accepts this credential. Create a new one in Mango (Settings → Integration credentials) and save it on the Connect Mango page.', 502, { providerStatus: 401 })
 if (response.status === 403) fail('MANGO_SCOPE', `This Mango credential is missing “${SCOPES[data.requiredScope] ?? data.requiredScope ?? 'a permission'}”. Create a credential with all four boxes ticked and save it again.`, 502, { providerStatus: 403 })
 if (response.status === 429) fail('MANGO_BUSY', 'Mango asked Coffer to slow down. Wait a minute, then continue.', 503, { providerStatus: 429 })
 return fail('MANGO_REFUSED', `Mango refused this request (${data.error ?? `HTTP ${response.status}`}).`, 502, { providerStatus: response.status })
}
async function request(conn: Connection, path: string, method = 'GET', body?: unknown): Promise<Row> {
 const response = await call(conn, path, method, body)
 if (!response.ok) return refusal(response)
 try { return await response.json() as Row } catch { return fail('MANGO_RESPONSE', 'Mango returned an unreadable response.', 502) }
}

/** Every scope is checked without changing anything: a granted write scope answers 400 to an empty body. */
export async function checkMango(conn: Connection): Promise<{ ok: boolean; note: string; lists: string[] }> {
 const segments = await request(conn, '/segments')
 await request(conn, '/events?cursor=0&limit=1')
 const missing: string[] = []
 for (const [path, scope] of [['/contacts', 'contacts:write'], ['/campaigns/coffer-connection-check/send', 'campaigns:send']] as const) {
  const response = await call(conn, path, path === '/contacts' ? 'PUT' : 'POST', {})
  if (response.status === 403) missing.push(SCOPES[scope])
  else if (response.status !== 400) await refusal(response)
 }
 const lists = Array.isArray(segments.segments) ? segments.segments.map((s: Row) => String(s.name ?? s.id)) : []
 return missing.length ? { ok: false, note: `Mango accepted the credential, but it is missing: ${missing.join(', ')}. Create a new credential with all four boxes ticked.`, lists }
  : { ok: true, note: `Connected. Mango accepted the credential with all four permissions${lists.length ? ` and has ${lists.length} Coffer list${lists.length === 1 ? '' : 's'}` : ''}.`, lists }
}

export async function mangoContact(conn: Connection, address: string): Promise<Row | null> {
 const data = await request(conn, `/contacts?email=${encodeURIComponent(address)}&limit=1`)
 if (!Array.isArray(data.contacts)) fail('MANGO_RESPONSE', 'Mango did not return contact state.', 502)
 return data.contacts.find((d: Row) => d.email?.toLowerCase() === address.toLowerCase()) ?? null
}
export const restricted = (contact: Row) => ['unsubscribed', 'suppressed', 'cleaned'].includes(contact.emailStatus)
export const subscribed = (contact: Row | null) => contact?.emailStatus === 'subscribed'

export async function suppressMango(conn: Connection, address: string, key: string): Promise<void> {
 await request(conn, '/suppressions', 'POST', { email: address, reason: 'Email consent withdrawn in Coffer', idempotencyKey: `coffer:${key}`.slice(0, 200) })
 const saved = await mangoContact(conn, address)
 if (saved && !restricted(saved)) fail('MANGO_PREFERENCE', 'Mango has not confirmed this opt-out. Sync email preferences again before sending.', 502)
}

const consent = (donor: Row, organisation: string) => ({ source: 'Coffer consent record', evidence: donor.evidence, brandOrLegalSender: organisation, messageCategory: 'newsletter',
 frequencyDisclosure: 'Occasional appeals and welcome emails', destinationJurisdiction: 'US', consentVersion: `coffer-consent-${donor.consent_id}`, occurredAt: `${donor.captured_on}T00:00:00.000Z` })
/** Puts one consenting donor on a Coffer list in Mango, carrying Coffer's consent evidence. */
export async function listInMango(conn: Connection, donor: Row, organisation: string, listName: string, fields: Row = {}): Promise<Row> {
 const data = await request(conn, '/contacts', 'PUT', { email: donor.email, displayName: donor.name, segmentName: listName.slice(0, 160), fields: { cofferDonorId: donor.id, ...fields, ...nameMergeFields(donor) }, tags: ['coffer'], subscribe: true, consent: consent(donor, organisation) })
 if (!data.contact || typeof data.contact.emailStatus !== 'string') fail('MANGO_RESPONSE', 'Mango did not confirm the contact.', 502)
 return data.contact
}
