import { reconcileRefund } from './refunds'
import { recordDispute } from './disputes'
import { stripe, type GivingEnv } from '../giving/stripe'
import { syncCharge } from './charges'
import { syncEntry } from './entries'
import { syncPayout } from './payouts'
import { stripeId, stripePages } from './stripe-data'

export async function paymentEvent(env: GivingEnv, event: any) {
 const id = event.data.object.id, type = event.type
 if (['charge.succeeded', 'charge.updated', 'charge.refunded'].includes(type)) {
  const charge = await stripe(env, '/charges/' + encodeURIComponent(id))
  if (charge.status !== 'succeeded' || !charge.paid) return
  await syncCharge(env, id)
  if (charge.balance_transaction) await syncEntry(env, stripeId(charge.balance_transaction))
  if (charge.amount_refunded > 0) for await (const refund of stripePages(env, '/refunds?charge=' + encodeURIComponent(id))) {
   await reconcileRefund(env,refund)
  }
 } else if (['refund.created', 'refund.updated', 'refund.failed'].includes(type)) {
  const refund = await stripe(env, '/refunds/' + encodeURIComponent(id))
  // Pending and failed refunds do not reverse a donation.
  await reconcileRefund(env,refund)
 } else if (type.startsWith('charge.dispute.')) {
  const dispute = await stripe(env, '/disputes/' + encodeURIComponent(id))
  for (const txn of dispute.balance_transactions ?? []) await syncEntry(env, txn)
  await recordDispute(env,dispute)
 } else if (type === 'charge.failed' || type === 'payment_intent.payment_failed') {
  // Store no card details, error text or donor data. Failures never become gifts.
  await env.DB.prepare('INSERT OR IGNORE INTO cf_payment_failures(id,charge_id,status,created_at) VALUES(?,?,?,?)')
   .bind(event.id, id, 'failed', new Date().toISOString()).run()
 } else if (type.startsWith('payout.')) await syncPayout(env, id)
}
