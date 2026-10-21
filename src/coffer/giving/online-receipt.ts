import { letterRecipient } from '../organizations'
import { letterHash } from '../acknowledgements'
import { one, today } from '../db'
import { mailSuppressed, sendReceipt } from '../receipt-mail'
import { settings } from '../settings'
import { giftTemplates, renderGiftLetter } from '../letter-templates'
import type { GivingEnv } from './stripe'

const SYSTEM = ['online-receipts', 'Automatic online receipt', 'system'] as const

/** One receipt per online gift, sent once. Deterministic IDs make the
 * thank-you page and the webhook race harmless: only one claim sends. */
export async function sendOnlineReceipt(env: GivingEnv, giftId: string): Promise<void> {
 const c = { db: env.DB }, s = await settings(c)
 if (s.online_receipts !== 'automatic' || !s.reviewed_at || !s.organisation) return
 if (env.RER_INSTALLATION_ID || env.RER_MANAGEMENT_ORIGIN) return
 const gift = await one(c, `SELECT g.*,d.name AS donor_name,d.email AS donor_email FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id
  WHERE g.id=? AND g.kind='gift' AND d.erased_at IS NULL AND d.email IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cf_acks a WHERE a.gift_id=g.id AND a.live=1)`, giftId)
 if (!gift) return
 const now = new Date().toISOString(), day = today(s.timezone, new Date(now)), batchId = `receipt-${giftId}`, letterId = `receipt-${giftId}`
 const donor = await one(c, 'SELECT * FROM cf_donors WHERE id=?', gift.donor_id)
 const recipient=await letterRecipient(c,donor!)
 const rendered = renderGiftLetter(s, gift, recipient.letter_salutation, day, (await giftTemplates(c, [gift])).get(gift.id))
 const letter = { id: letterId, batch_id: batchId, position: 0, gift_id: gift.id, donor_id: gift.donor_id, recipient_name: recipient.letter_name, recipient_email: gift.donor_email, address: recipient.letter_address, subject: rendered.subject, body: rendered.body, amount_cents: gift.amount_cents, received_on: gift.received_on }
 const hash = await letterHash(s.version, [letter])
 // The owner's setting is the standing approval for this exact letter.
 await env.DB.batch([
  env.DB.prepare("INSERT OR IGNORE INTO cf_ack_batches(id,version,status,content_hash,letters,total_cents,settings_version,prepared_by_id,prepared_by_name,prepared_by_role,prepared_at) VALUES(?,1,'approved',?,1,?,?,?,?,?,?)").bind(batchId, hash, gift.amount_cents, s.version, ...SYSTEM, now),
  env.DB.prepare(`INSERT OR IGNORE INTO cf_acks(id,batch_id,position,gift_id,donor_id,live,recipient_name,recipient_email,address,subject,body,amount_cents,received_on,template_kind,template_id,template_version)
   SELECT ?,?,0,?,?,1,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM cf_acks WHERE gift_id=? AND live=1)`).bind(letterId, batchId, gift.id, gift.donor_id, letter.recipient_name, letter.recipient_email, letter.address, letter.subject, letter.body, letter.amount_cents, letter.received_on, rendered.template_kind, rendered.template_id, rendered.template_version, gift.id),
  env.DB.prepare("INSERT OR IGNORE INTO cf_approvals VALUES(?,'acknowledgements',?,?,?,?,?,?,?,?,?)").bind(`approval-${batchId}`, batchId, hash, ...SYSTEM, SYSTEM[0], 'Online receipts setting', 'owner setting', now),
 ])
 const attempt = crypto.randomUUID()
 if (mailSuppressed(env)) {
  await env.DB.prepare("UPDATE cf_acks SET route='email',delivery_status='suppressed',delivery_note='Not emailed: email is switched off on this computer (local mode). Your hosted Coffer emails this receipt on its own.' WHERE id=? AND route='pending'").bind(letterId).run()
  return
 }
 const claim = await env.DB.prepare("UPDATE cf_acks SET route='email',delivery_status='sending',attempt_id=? WHERE id=? AND route='pending'").bind(attempt, letterId).run()
 if (!claim.meta.changes) return
 try {
  const sent = await sendReceipt(env, { ...(await one(c, 'SELECT * FROM cf_acks WHERE id=?', letterId))!, attempt_id: attempt })
  await env.DB.prepare("UPDATE cf_acks SET message_id=?,submitted_at=?,delivery_status=CASE WHEN delivery_status='sending' THEN 'submitted' ELSE delivery_status END WHERE id=? AND attempt_id=?").bind(sent.messageId, now, letterId, attempt).run()
 } catch (error: any) {
  const refused = ['mail_rejected', 'mail_rate_limited', 'mail_unavailable'].includes(error?.code)
  await env.DB.prepare("UPDATE cf_acks SET route=CASE WHEN ? THEN 'print' ELSE route END,delivery_status=?,delivery_note=? WHERE id=? AND attempt_id=? AND delivery_status='sending'")
   .bind(refused ? 1 : 0, refused ? 'rejected' : 'uncertain', refused ? `The receipt email was not sent (${error?.message ?? 'mail unavailable'}). This letter is in the print batch.` : 'Email submission could not be confirmed. Check the provider before printing; Coffer will not resend automatically.', letterId, attempt).run()
 }
}
