import type { Bindings } from '../auth.server'
import { fail, text, type Row } from './db'
import { receiptText } from './receipt-format'

export type PostalBindings = Bindings & {
 LOB_API_KEY?: string; LOB_WEBHOOK_SECRET?: string; LOB_FROM_ADDRESS_ID?: string; LOB_ENABLED?: string
}

export function postalAvailable(env?: PostalBindings): env is PostalBindings {
 return !!env && env.LOB_ENABLED === 'true' && !!env.LOB_API_KEY?.trim() && !!env.LOB_WEBHOOK_SECRET?.trim() && !!env.LOB_FROM_ADDRESS_ID?.trim()
  && env.AUTH_LOCAL !== 'true' && env.RER_DEMO !== '1' && env.MAIL_PROVIDER !== 'development'
}

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!))

/** Lob inserts its address sheet so the vendor cannot obscure frozen text. */
export function postalFile(letter: Row, organisation: string): string {
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>@page{size:letter;margin:.75in}body{font:11pt Arial;line-height:1.5;color:#000}header{white-space:pre-wrap;font-weight:bold}h1{font-size:12pt}main{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><header>${escape(organisation)}</header><h1>${escape(letter.subject)}</h1><main>${escape(receiptText(letter))}</main></body></html>`
}

/** Use the approved address snapshot, never a fresh donor lookup. */
export function postalRecipient(piece: Row): Row {
 let address: Row
 try { address = JSON.parse(piece.address ?? '{}') } catch { fail('POSTAL_ADDRESS', 'This frozen mailing address is invalid. Prepare a fresh batch.') }
 const country = String(address.country ?? 'US').trim().toUpperCase()
 if (!['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'].includes(country)) fail('POSTAL_COUNTRY', 'This postal connection supports United States addresses. Export other letters for a mail house.')
 return {
  name: text(piece.recipient_name, 'Frozen addressee', 200),
  address_line1: text(address.line1, 'Frozen street address', 200),
  ...(address.line2 ? { address_line2: text(address.line2, 'Frozen second address line', 200) } : {}),
  address_city: text(address.city, 'Frozen city', 200),
  address_state: text(address.region, 'Frozen state', 100),
  address_zip: text(address.postalCode, 'Frozen ZIP code', 30), address_country: 'US',
 }
}

/** Exactly one network call. Even a definite rejection stays recorded. */
export async function submitPostal(env: PostalBindings, attempt: string, piece: Row, to: Row, file: string): Promise<{ state: 'submitted' | 'uncertain' | 'rejected'; messageId?: string }> {
 let response: Response
 try {
  response = await fetch('https://api.lob.com/v1/letters', {
   method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000),
   headers: { authorization: `Basic ${btoa(env.LOB_API_KEY!.trim() + ':')}`, 'content-type': 'application/json', 'idempotency-key': attempt, 'lob-version': '2024-01-01' },
   body: JSON.stringify({ to, from: env.LOB_FROM_ADDRESS_ID!.trim(), file, color: false, double_sided: false, address_placement: 'insert_blank_page', mail_type: 'usps_first_class', use_type: 'operational',
    metadata: { coffer_piece_id: piece.id, coffer_attempt_id: attempt } }),
  })
 } catch { return { state: 'uncertain' } }
 if (!response.ok) {
  await response.body?.cancel().catch(() => {})
  return { state: response.status >= 400 && response.status < 500 && ![408,409,429].includes(response.status) ? 'rejected' : 'uncertain' }
 }
 // Never store provider bodies or signed preview URLs containing donor data.
 let result: Row
 try { result = await response.json() as Row } catch { return { state: 'uncertain' } }
 if (!result || typeof result.id !== 'string' || !result.id.trim() || result.id.length > 200 || result.object !== 'letter') return { state: 'uncertain' }
 return { state: 'submitted', messageId: result.id }
}
