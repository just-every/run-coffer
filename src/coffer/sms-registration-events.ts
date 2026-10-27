import type { Bindings } from '../auth.server'
import { CofferError, fail, one, type Row } from './db'
import { textEnvironment } from './giving/connections'

const MAX_BODY_BYTES = 1024 * 1024
const prefix = 'com.twilio.messaging.compliance.'
// Twilio documents these externalstatus values, including absent campaign SID
// after successful deregistration. That negative receipt can never arm sending.
// https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/event-streams-setup
const statuses: Record<string, string> = {
 'number-registration.successful': 'registered', 'number-registration.pending': 'pending_registration', 'number-registration.failed': 'failure',
 'number-deregistration.successful': 'unregistered', 'number-deregistration.pending': 'pending_deregistration', 'number-deregistration.failed': 'failure',
}
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const sid = (value: unknown, _kind: string): value is string => typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(value)
type NumberEvent = { id: string; type: string; status: string; at: string; account: string; service: string; campaign: string | null; phoneSid: string; phone: string }

/** JSON signatures authenticate the exact URL including the raw body SHA-256.
 * https://www.twilio.com/docs/events/webhook-quickstart#validate-the-webhook-signature
 * https://www.twilio.com/docs/usage/security#validating-requests-are-coming-from-twilio
 */
async function signedEvents(request: Request, token: string): Promise<unknown[]> {
 const hashes = new URL(request.url).searchParams.getAll('bodySHA256'), signature = request.headers.get('x-twilio-signature') ?? ''
 if (hashes.length !== 1 || !/^[a-f\d]{64}$/i.test(hashes[0]) || !/^[A-Za-z0-9+/]{27}=$/.test(signature)) fail('INVALID_SIGNATURE', 'Invalid Twilio signature.', 401)
 const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['verify'])
 if (!await crypto.subtle.verify('HMAC', key, Uint8Array.from(atob(signature), byte => byte.charCodeAt(0)), new TextEncoder().encode(request.url))) fail('INVALID_SIGNATURE', 'Invalid Twilio signature.', 401)
 const length = request.headers.get('content-length')
 if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) fail('BODY_TOO_LARGE', 'Event body is too large or has an invalid length.', 413)
 const reader = request.body?.getReader()
 if (!reader) fail('INVALID_EVENT', 'Event body is required.', 400)
 const chunks: Uint8Array[] = []; let total = 0
 try {
  for (;;) {
   const { value, done } = await reader.read()
   if (done) break
   total += value.byteLength
   if (total > MAX_BODY_BYTES) fail('BODY_TOO_LARGE', 'Event body is too large.', 413)
   chunks.push(value)
  }
 } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
 const bytes = new Uint8Array(total); let offset = 0
 for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
 const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
 if (hash !== hashes[0].toLowerCase()) fail('INVALID_SIGNATURE', 'Invalid Twilio body signature.', 401)
 let payload: unknown
 try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { fail('INVALID_EVENT', 'Event body must be valid JSON.', 400) }
 if (!Array.isArray(payload) || !payload.length || payload.length > 100) fail('INVALID_EVENT', 'Send a bounded JSON array of Twilio events.', 400)
 return payload
}

function numberEvent(value: unknown): NumberEvent | null {
 if (!object(value) || value.specversion !== '1.0' || typeof value.type !== 'string' || typeof value.id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value.id)) fail('INVALID_EVENT', 'Malformed Twilio event.', 400)
 if (!value.type.startsWith(prefix) || !Object.hasOwn(statuses, value.type.slice(prefix.length))) return null
 const type = value.type.slice(prefix.length), status = statuses[type], data = value.data
 if (value.datacontenttype !== 'application/json' || !object(data) || data.externalstatus !== status ||
  !sid(data.accountsid, 'AC') || !sid(data.messagingservicesid, 'MG') || !sid(data.phonenumbersid, 'PN') ||
  typeof data.phonenumber !== 'string' || !/^\+?[1-9]\d{7,14}$/.test(data.phonenumber) ||
  !Number.isSafeInteger(data.updateddate) || data.updateddate <= 0 || data.updateddate > 8640000000000000) fail('INVALID_EVENT', 'Malformed number registration evidence.', 400)
 const campaign = data.campaignsid === undefined && status === 'unregistered' ? null : data.campaignsid
 if (campaign !== null && !sid(campaign, 'CM')) fail('INVALID_EVENT', 'Malformed number registration campaign.', 400)
 if (campaign === null && status !== 'unregistered') fail('INVALID_EVENT', 'Number registration campaign is required.', 400)
 return { id: value.id, type: value.type, status, at: new Date(data.updateddate).toISOString(), account: data.accountsid,
  service: data.messagingservicesid, campaign, phoneSid: data.phonenumbersid, phone: '+' + data.phonenumber.replace(/^\+/, '') }
}

/** Receipt evidence always clears approval; an explicit provider refresh arms it. */
export async function smsRegistrationEvents(request: Request, bindings: Bindings, at = new Date().toISOString()): Promise<Response> {
 const headers = { 'cache-control': 'no-store' }
 try {
  if (request.method !== 'POST') fail('METHOD', 'Send Twilio events with POST.', 405)
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') fail('JSON_REQUIRED', 'Send Twilio events as JSON.', 415)
  const env = await textEnvironment(bindings)
  if (!sid(env.TWILIO_ACCOUNT_SID, 'AC') || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) fail('SMS_UNAVAILABLE', 'Twilio events are not configured.', 503)
  const events = (await signedEvents(request, env.TWILIO_AUTH_TOKEN)).map(numberEvent).filter((value): value is NumberEvent => value !== null).sort((a, b) => a.at.localeCompare(b.at))
  const saved = await one({ db: bindings.DB }, `SELECT r.* FROM cf_sms_registration r WHERE r.id=1
   AND r.connection_sealed IS (SELECT sealed FROM cf_giving_connections WHERE name='twilio')`)
  if (!saved || saved.account_sid !== env.TWILIO_ACCOUNT_SID || saved.sender !== env.TWILIO_FROM || !saved.number_configured_at || !saved.number_campaign_sid || !saved.phone_number_sid) return Response.json({ ok: true, recorded: 0 }, { headers })
  const statements: D1PreparedStatement[] = []
  for (const receipt of events) {
   if (receipt.account !== saved.account_sid || receipt.service !== saved.messaging_service_sid || receipt.phoneSid !== saved.phone_number_sid || receipt.phone !== saved.sender ||
    (receipt.campaign !== null && receipt.campaign !== saved.number_campaign_sid) || receipt.at < saved.number_configured_at) continue
   const condition = `id=1 AND account_sid=? AND messaging_service_sid=? AND campaign_sid=? AND sender=? AND phone_number_sid=?
    AND number_campaign_sid=? AND number_configured_at=? AND connection_sealed IS ?
    AND connection_sealed IS (SELECT sealed FROM cf_giving_connections WHERE name='twilio')
    AND ? >= number_configured_at AND (number_status_at IS NULL OR number_status_at < ? OR (number_status_at=? AND number_status='registered' AND ?<>'registered')) AND (number_event_id IS NULL OR number_event_id<>?)`
   const params = [receipt.account, receipt.service, saved.campaign_sid, receipt.phone, receipt.phoneSid, saved.number_campaign_sid, saved.number_configured_at,
    saved.connection_sealed, receipt.at, receipt.at, receipt.at, receipt.status, receipt.id]
   const detail = JSON.stringify({ eventId: receipt.id, eventType: receipt.type, numberStatus: receipt.status, occurredAt: receipt.at,
    messagingServiceSid: receipt.service, numberCampaignSid: saved.number_campaign_sid, phoneNumberSid: receipt.phoneSid })
   statements.push(bindings.DB.prepare(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
    SELECT ?,'twilio-registration','Twilio registration','system','sms.registration.number-event','sms-registration',campaign_sid,NULL,?
    FROM cf_sms_registration WHERE ${condition}`).bind(at, detail, ...params))
   statements.push(bindings.DB.prepare(`UPDATE cf_sms_registration SET number_status=?,number_status_at=?,number_event_id=?,approved=0,version=version+1
    WHERE ${condition}`).bind(receipt.status, receipt.at, receipt.id, ...params))
  }
  const results = statements.length ? await bindings.DB.batch(statements) : []
  const recorded = results.reduce((count, result, index) => count + (index % 2 ? result.meta.changes : 0), 0)
  return Response.json({ ok: true, recorded }, { headers })
 } catch (error) {
  if (error instanceof CofferError) return Response.json({ ok: false, error: error.code, message: error.message }, { status: error.status, headers })
  return Response.json({ ok: false, error: 'EVENT_UNAVAILABLE', message: 'Twilio event receipt is unavailable.' }, { status: 503, headers })
 }
}
