import { receiptText } from './receipt-format'
import { receiptReplyAddress } from './receipt-replies'
import type { Bindings } from '../auth.server'
import { donorMailUnavailable, sendDonorMail, DonorMailError } from './outbound-mail'
// The shared verifier has no TypeScript declaration; it owns strict DER-to-P1363 conversion.
// @ts-expect-error Shared JavaScript mail module.
import { verifyWebhook } from '../modules/mail/src/events/verify.mjs'
import { CofferError, fail, id, type Row } from './db'

const MAX_EVENT_BYTES = 1024 * 1024

/** Local and demo installations switch email off; senders record that instead of claiming acceptance. */
export const mailSuppressed = (env: Bindings) => env.AUTH_LOCAL === 'true' || env.RER_DEMO === '1' || env.MAIL_PROVIDER === 'development'

/** Receipt sending must never report development mail suppression as acceptance. */
export function assertReceiptMailAvailable(env: Bindings): void {
 const unavailable = donorMailUnavailable(env)
 if (unavailable) fail('mail_unavailable', unavailable, 503)
}

/** One submission only: Provider acceptance is separate from confirmed delivery. */
export async function sendReceipt(env: Bindings, letter: Row): Promise<{ messageId: string }> {
 assertReceiptMailAvailable(env)
 const letterId = id(letter.id, 'Receipt letter'), attemptId = id(letter.attempt_id, 'Receipt email attempt')
 if (letter.void_reason) fail('VOID_RECEIPT', 'A voided receipt cannot be sent.')
 const body = letter.address&&JSON.parse(letter.address).organization ? `${letter.recipient_name}\n\n${receiptText(letter)}` : receiptText(letter)
 const replyTo = await receiptReplyAddress(env, letter)
 let result
 try {
  result = await sendDonorMail(env, {
    deliveryId: attemptId, from: env.MAIL_FROM!, to: [letter.recipient_email],
    subject: letter.subject, text: body, html: `<div>${String(body).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!)).replace(/\n/g,'<br>')}</div>`, ...(replyTo ? { replyTo } : {}),
    customArgs: { coffer_letter_id: letterId, coffer_attempt_id: attemptId },
  })
 } catch (error) {
  // Never expose provider bodies, submitted donor data or credentials.
  if (error instanceof DonorMailError && error.outcome === 'rejected') fail('mail_rejected', 'The mail provider did not accept this receipt email.', 502)
  if (error instanceof DonorMailError && error.outcome === 'rate_limited') fail('mail_rate_limited', 'The mail provider is busy. This receipt email was not accepted.', 503)
  fail('mail_uncertain', 'Receipt email acceptance could not be confirmed. Check delivery before sending again.', 502)
 }
 if (!result.providerMessageId) fail('mail_uncertain', 'The mail provider accepted the email without a message ID. Check delivery before sending again.', 502)
 return { messageId: result.providerMessageId }
}

/** Bound the streamed body as well as Content-Length before allocating it. */
async function eventBody(request: Request): Promise<Uint8Array> {
 const declared = request.headers.get('content-length')
 if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) fail('invalid_events', 'Invalid email event body length.', 400)
 if (declared !== null && Number(declared) > MAX_EVENT_BYTES) fail('body_too_large', 'Email event body is too large.', 413)
 const reader = request.body?.getReader()
 if (!reader) fail('invalid_events', 'Email event body is required.', 400)
 const chunks: Uint8Array[] = []
 let length = 0
 try {
  for (;;) {
   const { value, done } = await reader.read()
   if (done) break
   length += value.byteLength
   if (length > MAX_EVENT_BYTES) fail('body_too_large', 'Email event body is too large.', 413)
   chunks.push(value)
  }
 } catch (error) {
  if (error instanceof CofferError) throw error
  fail('invalid_events', 'Email event body could not be read.', 400)
 } finally {
  await reader.cancel().catch(() => {})
  reader.releaseLock()
 }
 const raw = new Uint8Array(length)
 let offset = 0
 for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength }
 return raw
}

/** Verify timestamp + untouched raw body before decoding any event JSON.
 * SendGrid specifies ASN.1 DER r/s, handled by the shared WebCrypto verifier:
 * https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features
 */
export async function verifySendgridEvents(request: Request, env: Bindings): Promise<Row[]> {
 if (request.method !== 'POST') fail('method_not_allowed', 'Send email events with POST.', 405)
 if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') fail('json_required', 'Send email events as JSON.', 415)
 const key = env.MAIL_EVENT_PUBLIC_KEY?.trim()
 if (!key) fail('mail_unavailable', 'Email delivery tracking is not configured.', 503)
 const raw = await eventBody(request)
 if (!await verifyWebhook({ provider: 'sendgrid', rawBody: raw, headers: request.headers, key, now: Date.now(), toleranceSeconds: 600 })) fail('invalid_signature', 'Email event signature is invalid or expired.', 401)
 let events: unknown
 try { events = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) } catch { fail('invalid_events', 'Email event body must be valid JSON.', 400) }
 if (!Array.isArray(events) || !events.length || events.length > 1000) fail('invalid_events', 'Email events must be a list of 1–1000 events.', 400)
 for (const event of events) {
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
      typeof event.event !== 'string' || !event.event || event.event.length > 100 ||
      typeof event.sg_event_id !== 'string' || !event.sg_event_id || event.sg_event_id.length > 1024 ||
      !Number.isSafeInteger(event.timestamp) || event.timestamp < 0) fail('invalid_events', 'An email event is malformed.', 400)
 }
 return events
}
