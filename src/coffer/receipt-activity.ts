import type { Bindings } from '../auth.server'
import { fail, type Row } from './db'
import { assertReceiptMailAvailable } from './receipt-mail'

type Delivery = { id: string; event: 'delivered' | 'bounced' | 'complained'; occurredAt: string }
const SAFE_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,399}$/
const invalid = (): never => fail('mail_logs_invalid', 'SendGrid returned unreadable delivery events. Check this receipt in SendGrid Email Logs.', 502)

/** Explicit provider lookup; signed webhooks remain the automatic intake.
 * https://www.twilio.com/docs/sendgrid/api-reference/email-logs/filter-all-messages
 * https://www.twilio.com/docs/sendgrid/api-reference/email-logs/filter-messages-by-id
 */
async function logs(env: Bindings, path: string, body?: Row): Promise<Row> {
 let response: Response
 try {
  response = await fetch('https://api.sendgrid.com/v3/logs' + path, {
   method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${env.MAIL_API_KEY}`, 'Content-Type': 'application/json' },
   ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual', signal: AbortSignal.timeout(15_000),
  })
 } catch { fail('mail_logs_unavailable', 'SendGrid delivery events could not be reached. Check delivery in SendGrid Email Logs.', 502) }
 if ([401,403].includes(response.status)) fail('mail_logs_unavailable', 'Grant this installation’s SendGrid API key access to Email Logs, then check delivery again.', 503)
 if (response.status === 429) fail('mail_logs_unavailable', 'SendGrid is limiting delivery lookups. Check delivery again later.', 503)
 if (response.status !== 200) fail('mail_logs_unavailable', 'SendGrid could not provide delivery events. Check this receipt in SendGrid Email Logs.', 502)
 let value: unknown
 try { value = await response.json() } catch { invalid() }
 if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
 return value as Row
}

export async function readReceiptDelivery(env: Bindings, letter: Row): Promise<null | Delivery> {
 assertReceiptMailAvailable(env)
 if (env.MAIL_PROVIDER !== 'sendgrid') fail('mail_logs_unavailable', 'Delivery lookup is available only for SendGrid. Check this submission with your configured mail provider.', 503)
 const messageId = letter.message_id, recipient = letter.recipient_email
 if (typeof messageId !== 'string' || messageId.length > 200 || !SAFE_ID.test(messageId)) fail('mail_logs_missing_id', 'This receipt has no usable SendGrid message ID. Check it in SendGrid Email Logs.', 409)
 if (typeof recipient !== 'string' || !recipient || recipient.length > 254) invalid()
 const submitted = Date.parse(letter.submitted_at)
 if (!Number.isFinite(submitted)) invalid()
 // Logs supports equality on the full provider ID, not prefix searches. Narrow
 // by recipient and submission time, then match the stored acceptance ID exactly.
 const since = new Date(submitted - 60_000).toISOString()
 const result = await logs(env, '', { limit: 100, query: `to_email=${JSON.stringify(recipient)} AND sg_message_id_created_at >= TIMESTAMP "${since}"` })
 if (!Array.isArray(result.messages) || result.messages.length > 100) invalid()
 const match = result.messages.find((m: Row) => m && typeof m.sg_message_id === 'string' && SAFE_ID.test(m.sg_message_id) &&
  (m.sg_message_id === messageId || m.sg_message_id.startsWith(`${messageId}.`)) && m.to_email === recipient)
 if (!match) fail('mail_logs_pending', 'SendGrid has no matching delivery events yet. Check again after it processes this receipt.', 409)
 const detail = await logs(env, '/' + encodeURIComponent(match.sg_message_id))
 if (detail.sg_message_id !== match.sg_message_id || detail.to_email !== recipient || !Array.isArray(detail.events)) invalid()
 const found: Delivery[] = []
 for (const item of detail.events) {
  const event: Delivery['event'] | null = item?.event === 'delivered' ? 'delivered'
   : ['bounce','dropped','drop'].includes(item?.event) ? 'bounced' : item?.event === 'spamreport' ? 'complained' : null
  if (!event) continue
  if (item.custom_args?.coffer_letter_id !== letter.id || item.custom_args?.coffer_attempt_id !== letter.attempt_id) continue
  if (typeof item.sg_event_id !== 'string' || !item.sg_event_id || item.sg_event_id.length > 250 || !Number.isSafeInteger(item.timestamp) || item.timestamp < 0) invalid()
  found.push({ id: item.sg_event_id, event, occurredAt: new Date(item.timestamp * 1000).toISOString() })
 }
 found.sort((a,b) => Number(b.event !== 'delivered') - Number(a.event !== 'delivered') || b.occurredAt.localeCompare(a.occurredAt))
 return found[0] ?? null
}
