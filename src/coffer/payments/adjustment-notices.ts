import { newId, one, sql, type Context } from '../db'
import { routingOwner } from '../relationship-owner'
import { pledgeMailUnavailable } from '../pledges'
import { sendDonorMail } from '../outbound-mail'
import type { GivingEnv } from '../giving/stripe'
import { paymentWrite } from './write'

/** One durable claim per money entry. Acceptance is not a delivery claim;
 * interrupted submissions remain uncertain and are never repeated on replay. */
export async function notifyAdjustment(env: GivingEnv, entryId: string, authority?: Context) {
 const c={db:env.DB},entry=await one(c,`SELECT p.*,g.donor_id,d.erased_at FROM cf_payment_entries p JOIN cf_gifts g ON g.id=p.gift_id JOIN cf_donors d ON d.id=g.donor_id WHERE p.id=? AND p.kind IN ('refund','refund_reversal','dispute','dispute_reversal')`,entryId)
 if(!entry || entry.erased_at)return
 const owner=await routingOwner(env.DB,entry.donor_id),noticeId=newId(),now=new Date().toISOString()
 const state=owner && !pledgeMailUnavailable(env)?'uncertain':'unavailable'
 // The entry's unique index elects one claim; operator-triggered sync also
 // rechecks its authority inside that same write transaction.
 await paymentWrite(env,[sql('INSERT OR IGNORE INTO cf_payment_notices(id,entry_id,gift_id,owner_id,status,created_at) VALUES(?,?,?,?,?,?)',noticeId,entryId,entry.gift_id,owner?.id??null,state,now)],authority)
 if((await one(c,'SELECT id FROM cf_payment_notices WHERE entry_id=?',entryId))?.id!==noticeId || state==='unavailable')return
 try {
  const text=`Stripe recorded ${entry.kind.replaceAll('_',' ')} of $${(Math.abs(entry.amount_cents)/100).toFixed(2)}.\nGift: ${entry.gift_id}\nProcessor entry: ${entry.id}\nDonor record: ${env.AUTH_ORIGIN}/app/donors/${entry.donor_id}\nAn owner or admin reviews receipt corrections and dispute deadlines under Payouts → Refunds and disputes.\nProvider acceptance of this notice does not establish delivery.`
  const result=await sendDonorMail(env,{deliveryId:noticeId,from:env.MAIL_FROM!,to:[owner!.email],subject:'Coffer: Stripe gift adjustment',text})
  if(result.providerMessageId)await env.DB.prepare("UPDATE cf_payment_notices SET status='submitted',submitted_at=? WHERE id=? AND status='uncertain'").bind(now,noticeId).run()
 } catch { /* Keep the durable uncertain state; no automatic repeat. */ }
 await paymentWrite(env,[sql(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail) VALUES(?,'stripe','Stripe','agent','payments.notice','payment',?,?, '{}')`,now,entryId,entry.donor_id)],authority)
}
