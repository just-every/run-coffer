import type { Bindings } from '../auth.server'
import { all, CofferError, fail, one, today, type Row } from './db'
import { recordDeliveryEvents } from './letter-delivery'
import { postalAcknowledgments } from './postal-acceptance'
import type { PostalBindings } from './postal-provider'
import { settings } from './settings'

const MAX_EVENT_BYTES = 1024 * 1024
const trackingNames: Record<string, string> = {
 'letter.mailed': 'Mailed', 'letter.in_transit': 'In Transit', 'letter.in_local_area': 'In Local Area',
 'letter.processed_for_delivery': 'Processed for Delivery', 'letter.delivered': 'Delivered',
 'letter.re-routed': 'Re-Routed', 'letter.returned_to_sender': 'Returned to Sender', 'letter.international_exit': 'International Exit',
}
const lifecycle = new Set(['letter.created', 'letter.rendered_pdf', 'letter.rendered_thumbnails', 'letter.failed', 'letter.rejected', 'letter.deleted'])
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '')

/** Verify the untouched bounded bytes before decoding any provider JSON. */
async function signedEvent(request: Request, env: PostalBindings): Promise<Row> {
 if (request.method !== 'POST') fail('METHOD', 'Send postal events with POST.', 405)
 if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') fail('JSON_REQUIRED', 'Send postal events as JSON.', 415)
 const secret = env.LOB_WEBHOOK_SECRET?.trim()
 if (!secret) fail('POSTAL_UNAVAILABLE', 'Postal tracking is not configured.', 503)
 const timestamp = request.headers.get('lob-signature-timestamp') ?? '', signature = request.headers.get('lob-signature') ?? ''
 if (!/^\d{10,13}$/.test(timestamp) || !/^[a-f\d]{64}$/i.test(signature)) fail('INVALID_SIGNATURE', 'Postal event signature is invalid or expired.', 401)
 const numeric = Number(timestamp), epoch = numeric >= 1e12 ? numeric : numeric * 1000
 if (!Number.isSafeInteger(numeric) || Math.abs(Date.now() - epoch) > 300000) fail('INVALID_SIGNATURE', 'Postal event signature is invalid or expired.', 401)
 const length = request.headers.get('content-length')
 if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_EVENT_BYTES)) fail('BODY_TOO_LARGE', 'Postal event body is too large or has an invalid length.', 413)
 const reader = request.body?.getReader()
 if (!reader) fail('INVALID_EVENT', 'Postal event body is required.', 400)
 const chunks: Uint8Array[] = []; let total = 0
 try {
  for (;;) {
   const { value, done } = await reader.read()
   if (done) break
   total += value.byteLength
   if (total > MAX_EVENT_BYTES) fail('BODY_TOO_LARGE', 'Postal event body is too large.', 413)
   chunks.push(value)
  }
 } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
 const prefix = new TextEncoder().encode(timestamp + '.'), input = new Uint8Array(prefix.byteLength + total)
 input.set(prefix); let offset = prefix.byteLength
 for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.byteLength }
 const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
 const bytes = new Uint8Array(signature.match(/../g)!.map(byte => parseInt(byte, 16)))
 if (!await crypto.subtle.verify('HMAC', key, bytes, input)) fail('INVALID_SIGNATURE', 'Postal event signature is invalid or expired.', 401)
 let result: unknown
 try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input.subarray(prefix.byteLength))) } catch { fail('INVALID_EVENT', 'Postal event body must be valid JSON.', 400) }
 if (!result || typeof result !== 'object' || Array.isArray(result)) fail('INVALID_EVENT', 'Postal event must be an object.', 400)
 return result as Row
}

function identifier(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && value.length <= 200 }
function occurrence(event: Row, type: string): string {
 let source = event.date_created
 if (Object.hasOwn(trackingNames,type)) {
  if (!Array.isArray(event.body?.tracking_events)) fail('INVALID_EVENT', 'A postal tracking event needs its USPS occurrence time.', 400)
  const matching = event.body.tracking_events.filter((item: Row) => item && typeof item.name === 'string' && normalized(item.name) === normalized(trackingNames[type]) && typeof item.time === 'string' && Number.isFinite(Date.parse(item.time)))
  if (!matching.length) fail('INVALID_EVENT', 'A postal tracking event needs its USPS occurrence time.', 400)
  source = matching.map((item: Row) => item.time).sort((a: string, b: string) => Date.parse(b) - Date.parse(a))[0]
 }
 if (typeof source !== 'string' || !Number.isFinite(Date.parse(source))) fail('INVALID_EVENT', 'Postal event occurrence time is invalid.', 400)
 return new Date(source).toISOString()
}

/** Signed requests alone may add provider evidence. Raw payloads are discarded. */
export async function postalEvents(request: Request, bindings: Bindings): Promise<Response> {
 try {
  const event = await signedEvent(request, bindings), type = event.event_type?.id
  if (!identifier(event.id) || !identifier(event.reference_id) || !event.body || event.body.id !== event.reference_id || typeof type !== 'string') fail('INVALID_EVENT', 'Postal event identifiers are malformed.', 400)
  if (!Object.hasOwn(trackingNames,type) && !lifecycle.has(type)) return Response.json({ ok: true, recorded: 0 }, { headers: { 'cache-control': 'no-store' } })
  const occurred = occurrence(event, type), c = { db: bindings.DB }, metadata = event.body.metadata
  let delivery = await one(c, 'SELECT * FROM cf_postal_deliveries WHERE provider_message_id=?', event.reference_id)
  // A signed event can resolve a timed-out submission only with both exact
  // immutable metadata identifiers. Redacted unknown resources remain unknown.
  if (!delivery && identifier(metadata?.coffer_attempt_id) && identifier(metadata?.coffer_piece_id)) {
   delivery = await one(c, "SELECT * FROM cf_postal_deliveries WHERE id=? AND piece_id=? AND provider_message_id IS NULL AND state IN ('sending','uncertain')", metadata.coffer_attempt_id, metadata.coffer_piece_id)
   if (delivery) {
    await bindings.DB.prepare("UPDATE cf_postal_deliveries SET provider_message_id=?,state='submitted',submitted_at=COALESCE(submitted_at,?) WHERE id=? AND provider_message_id IS NULL AND state IN ('sending','uncertain')").bind(event.reference_id, occurred, delivery.id).run()
    delivery = await one(c, 'SELECT * FROM cf_postal_deliveries WHERE id=? AND provider_message_id=?', delivery.id, event.reference_id)
   }
  }
  if (!delivery || (metadata?.coffer_attempt_id !== undefined && metadata.coffer_attempt_id !== delivery.id) || (metadata?.coffer_piece_id !== undefined && metadata.coffer_piece_id !== delivery.piece_id)) return Response.json({ ok: true, recorded: 0 }, { headers: { 'cache-control': 'no-store' } })
  const documents = await all(c, `SELECT p.letter_id,p.attempt_id,a.submitted_at FROM cf_postal_documents p JOIN cf_acks a ON a.id=p.letter_id JOIN cf_donors d ON d.id=a.donor_id
   WHERE p.delivery_id=? AND a.attempt_id=p.attempt_id AND a.route IN ('postal','print') AND a.void_reason IS NULL AND d.erased_at IS NULL`, delivery.id)
  const state = type === 'letter.delivered' ? 'delivered' : type === 'letter.returned_to_sender' ? 'bounced' : 'postal_' + type.slice(7).replace(/-/g, '_')
  const incoming = documents.map(document => ({ id: `lob:${event.id}:${document.letter_id}`, letterId: document.letter_id, attempt: document.attempt_id, state, occurred,
   provider: 'Lob', providerEvent: type, providerMessageId: event.reference_id, providerAttemptId: document.attempt_id, postalPieceId: delivery.piece_id }))
  if (incoming.length) await recordDeliveryEvents(bindings.DB, incoming, true)
  if (documents.length) {
   const now = new Date().toISOString(), failed = ['letter.failed', 'letter.rejected', 'letter.deleted'].includes(type)
   await bindings.DB.prepare(`UPDATE cf_acks SET message_id=COALESCE(message_id,?),submitted_at=COALESCE(submitted_at,?),
    delivery_status=CASE WHEN ?=1 AND delivery_status NOT IN ('bounced','complained') THEN 'rejected' WHEN delivery_status IN ('sending','uncertain') THEN 'submitted' ELSE delivery_status END,
    route=CASE WHEN ?=1 THEN 'print' ELSE route END,
    delivery_note=CASE WHEN ?=1 THEN 'Lob reported a failed or cancelled postal piece. This document remains printable; review the provider before any new mailing.' WHEN delivery_status IN ('sending','uncertain') THEN 'Lob confirmed this postal piece. USPS delivery is not yet confirmed.' ELSE delivery_note END
    WHERE id IN (SELECT letter_id FROM cf_postal_documents WHERE delivery_id=?) AND attempt_id IN (SELECT attempt_id FROM cf_postal_documents WHERE delivery_id=?) AND void_reason IS NULL`).bind(event.reference_id, occurred, failed ? 1 : 0, failed ? 1 : 0, failed ? 1 : 0, delivery.id, delivery.id).run()
   if (!failed && documents.some(document => !document.submitted_at)) {
    const statement = postalAcknowledgments(delivery.id, now, today((await settings(c)).timezone, new Date(occurred)), { id: 'coffer-postal', name: 'Lob', role: 'owner' })
    await bindings.DB.prepare(statement.sql).bind(...statement.params).run()
   }
  }
  return Response.json({ ok: true, recorded: incoming.length }, { headers: { 'cache-control': 'no-store' } })
 } catch (error) {
  const known = error instanceof CofferError
  return Response.json({ error: known ? error.code : 'INVALID_EVENT', message: known ? error.message : 'Postal event could not be recorded.' }, { status: known ? error.status : 400, headers: { 'cache-control': 'no-store' } })
 }
}
