import type { Bindings } from '../auth.server'
import type { Row } from './db'

/** Persist the advertised address before dispatch. Opaque aliases stay short
 * even for receipts whose processor-derived IDs are long or contain underscores. */
export async function receiptReplyAddress(env: Bindings, letter: Row): Promise<string | undefined> {
 const fixed = env.COFFER_REPLY_ADDRESS?.trim().toLowerCase(), domain = env.COFFER_REPLY_DOMAIN?.trim().toLowerCase()
 if (!fixed && !domain) return undefined
 const address = fixed || `coffer+${crypto.randomUUID()}@${domain}`
 const saved = await env.DB.prepare('UPDATE cf_acks SET reply_to=COALESCE(reply_to,?) WHERE id=? AND attempt_id=? RETURNING reply_to').bind(address, letter.id, letter.attempt_id).first<{ reply_to: string }>()
 return saved?.reply_to
}
