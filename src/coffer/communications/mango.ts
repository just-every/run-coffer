import type { Bindings } from '../../auth.server'
import { fail, type Row } from '../db'
import { csv } from '../csv'

export function communicationsUnavailable(env?: Bindings): string | null {
 if (env?.RER_INSTALLATION_ID || env?.RER_MANAGEMENT_ORIGIN) return 'Email marketing is not available yet on RER Managed.'
 if (!env?.MANGO_ORIGIN || !env.MANGO_SESSION_COOKIE) return 'Connect Mango with its origin and an active operator session.'
 return null
}
export function mangoConnection(env?: Bindings) {
 const unavailable = communicationsUnavailable(env)
 if (unavailable) fail('MANGO_UNAVAILABLE', unavailable, 503)
 let url: URL
 try { url = new URL(env!.MANGO_ORIGIN!) } catch { return fail('MANGO_CONFIG', 'Mango needs a valid origin.', 400) }
 const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
 if (url.pathname !== '/' || url.search || url.hash || url.username || url.password || !(url.protocol === 'https:' || local && url.protocol === 'http:')) fail('MANGO_CONFIG', 'Use Mango’s HTTPS origin, or HTTP on loopback.', 400)
 if (/[\r\n]/.test(env!.MANGO_SESSION_COOKIE!)) fail('MANGO_CONFIG', 'Mango session is invalid.', 400)
 return { origin: url.origin, cookie: env!.MANGO_SESSION_COOKIE!, devKey: local ? env!.MANGO_DEV_KEY : undefined }
}
export async function mangoRequest(env: Bindings | undefined, path: string, method = 'GET', body?: unknown): Promise<Row> {
 const conn = mangoConnection(env)
 let response: Response
 try {
  response = await fetch(conn.origin + path, { method, redirect: 'manual', signal: AbortSignal.timeout(20_000),
   headers: { cookie: conn.cookie, origin: conn.origin, ...(conn.devKey ? { 'x-rer-dev-key': conn.devKey } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
   ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
 } catch { return fail('MANGO_UNREACHABLE', 'Mango could not be reached. Check the saved campaign before submitting again.', 502) }
 if (!response.ok) fail('MANGO_REFUSED', response.status === 401 ? 'The Mango operator session expired. Reconnect Mango.' : `Mango refused this request (HTTP ${response.status}). Review it in Mango.`, 502, {providerStatus:response.status})
 try { return await response.json() as Row } catch { return fail('MANGO_RESPONSE', 'Mango returned an unreadable response.', 502) }
}
export async function mangoContact(env: Bindings | undefined, address: string): Promise<Row | null> {
 const data = await mangoRequest(env, `/api/contacts/search?address=${encodeURIComponent(address)}`)
 if (!Array.isArray(data.contacts)) fail('MANGO_RESPONSE', 'Mango did not return contact state.', 502)
 return data.contacts.find((d: Row) => d.email?.toLowerCase() === address.toLowerCase()) ?? null
}
export const restricted = (contact: Row) => ['unsubscribed', 'suppressed', 'cleaned'].includes(contact.emailStatus ?? contact.email_status)
export const subscribed = (contact: Row | null) => contact && (contact.emailStatus ?? contact.email_status) === 'subscribed'

/** Mango's existing reviewed import is the supported way to record an opt-out.
 * Restrictive imports never restore subscription or invent consent evidence. */
export async function suppressMango(env: Bindings | undefined, address: string): Promise<void> {
 const input = { files: [{ name: 'coffer-opt-out.csv', csv: csv(['email', 'status'], [[address, 'unsubscribed']]), preset: 'csv-unsubscribed' }] }
 const preview = await mangoRequest(env, '/api/audience/import-preview', 'POST', input)
 if (typeof preview.fingerprint !== 'string') fail('MANGO_RESPONSE', 'Mango did not return an opt-out review fingerprint.', 502)
 let { job } = await mangoRequest(env, '/api/audience/imports', 'POST', { fingerprint: preview.fingerprint })
 for (let chunk = 0; chunk < 12 && job && !['completed', 'failed', 'conflicted', 'abandoned'].includes(job.state); chunk++) {
  const next = await mangoRequest(env, `/api/audience/imports/${encodeURIComponent(job.id)}/resume`, 'POST', {})
  job = next.job
 }
 if (job?.state !== 'completed') fail('MANGO_IMPORT', 'Mango’s opt-out import is not complete. Refresh preferences before sending.', 502)
 const saved = await mangoContact(env, address)
 if (!saved || !restricted(saved)) fail('MANGO_IMPORT', 'Mango has not confirmed this opt-out. Refresh preferences before sending.', 502)
}
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
export async function createMangoCampaign(env: Bindings | undefined, row: Row) {
 const defaults = await mangoRequest(env, '/api/campaign-authoring')
 const replyTo = env?.COFFER_REPLY_ADDRESS?.trim().toLowerCase()
 if (!replyTo || defaults.sender?.replyToEmail?.toLowerCase() !== replyTo) fail('MANGO_REPLY', 'Set Coffer’s reply address to the reply-to address saved in Mango, and route it to this Worker.', 409)
 const created = await mangoRequest(env, '/api/campaigns', 'POST', { mode: 'blank' })
 if (typeof created.campaignId !== 'string' || typeof created.revisionId !== 'string') fail('MANGO_RESPONSE', 'Mango did not return campaign identifiers.', 502)
 return { campaignId:created.campaignId as string,revisionId:created.revisionId as string, sender: defaults.sender, timezone: defaults.timezone || 'UTC' }
}
export async function composeMangoCampaign(env: Bindings | undefined, row: Row, draft: Row) {
 const start = new Date(Date.now() + 60_000).toISOString(), end = new Date(Date.now() + 12 * 3600_000).toISOString()
 const html = row.body.split(/\n\s*\n/).map((p: string) => `<p>${escape(p).replaceAll('\n', '<br>')}</p>`).join('')
 await mangoRequest(env, `/api/campaign-revisions/${encodeURIComponent(draft.revisionId)}`, 'PATCH', {
  ...draft.sender, name: `Coffer ${row.id}`, emailSubject: row.subject, emailBody: html, emailText: row.body,
  messageCategory: 'newsletter', preheader: row.subject.slice(0, 250), trackingEnabled: false,
  inclusionRuleJson: JSON.stringify({version:1,operator:'all',predicates:[{sourceType:'contact',field:'email',comparator:'eq',value:row.email}]}),
  exclusionRulesJson: '[]', sourceTypesJson: '[]', links: [],
  steps: [{channel:'email',timezone:draft.timezone,scheduledAt:start,sendByAt:end,whyThisTime:'Approved Coffer outreach'}],
 })
 await mangoRequest(env, `/api/campaigns/${encodeURIComponent(draft.campaignId)}/approve`, 'POST', { revisionId: draft.revisionId, idempotencyKey: `coffer:${row.id}` })
}
