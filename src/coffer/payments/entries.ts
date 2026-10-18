import { fail, one, sql, type Context } from '../db'
import { settings } from '../settings'
import { stripe, type GivingEnv } from '../giving/stripe'
import { syncCharge } from './charges'
import { cents, day, stripeId } from './stripe-data'
import { paymentWrite } from './write'
import { settings } from '../settings'

/** The balance transaction ID is the financial idempotency key, independent of
 * webhook IDs, replay order, payout refreshes and Stripe's event versions. */
export async function syncEntry(env: GivingEnv, input: any, authority?: Context) {
 const txn = typeof input === 'string' ? await stripe(env, '/balance_transactions/' + encodeURIComponent(input)) : input
 if (txn.currency !== 'usd') fail('currency', 'Only USD payments can be reconciled.', 409)
 const amount = cents(txn.amount), fee = cents(txn.fee), net = cents(txn.net)
 if (net !== amount - fee) fail('payment_mismatch', 'Stripe returned an unbalanced transaction.', 409)
 const sourceId = stripeId(txn.source) || txn.id
 let source = typeof txn.source === 'object' ? txn.source : null
 let chargeId = '', kind = txn.type
 if (sourceId.startsWith('ch_') || sourceId.startsWith('py_')) { chargeId = sourceId; kind = 'charge' }
 else if (sourceId.startsWith('re_') || sourceId.startsWith('pyr_')) {
  source ??= await stripe(env, '/refunds/' + encodeURIComponent(sourceId))
  chargeId = stripeId(source.charge); kind = amount < 0 ? 'refund' : 'refund_reversal'
 } else if (sourceId.startsWith('dp_')) {
  source ??= await stripe(env, '/disputes/' + encodeURIComponent(sourceId))
  chargeId = stripeId(source.charge); kind = amount < 0 ? 'dispute' : 'dispute_reversal'
 }
 let gift: any = null
 if (chargeId) {
  const saved = await syncCharge(env, chargeId, authority)
  if (!saved) fail('payment_mismatch', 'A balance transaction has no successful gift.', 409)
  gift = await one({ db: env.DB }, 'SELECT * FROM cf_gifts WHERE id=?', saved.gift_id)
 }
 // Unsupported adjustments stay visible and prevent posting without a mapped
 // account. Never silently allocate money to a donor or fund.
 const fund = gift?.fund ?? 'Processor adjustments', now = new Date().toISOString()
 const existing = await one({ db: env.DB }, 'SELECT * FROM cf_payment_entries WHERE id=?', txn.id)
 if (existing) {
  if (existing.amount_cents !== amount || existing.fee_cents !== fee || existing.source_id !== sourceId) fail('payment_changed', 'A saved Stripe transaction differs from Stripe. No ledger entry was changed.', 409)
  return existing
 }
 // Refunds in a saved-page import have already reduced the original gift.
 // The baseline allocation and insertion happen in one atomic SQL statement.
 await paymentWrite(env, [sql(`INSERT OR IGNORE INTO cf_payment_entries
  (id,source_id,charge_id,kind,amount_cents,fee_cents,net_cents,fund,gift_id,contribution_cents,currency,received_on,created_at)
  SELECT ?,?,?,?,?,?,?,?,?,CASE WHEN ? IN ('refund','refund_reversal') THEN
   MAX(0,-prior-baseline)-MAX(0,-prior-?-baseline)
   WHEN ? IN ('dispute','dispute_reversal') THEN ? ELSE 0 END,'usd',?,?
  FROM (SELECT COALESCE((SELECT refund_baseline FROM cf_stripe_charges WHERE id=?),0) AS baseline,
   COALESCE((SELECT SUM(amount_cents) FROM cf_payment_entries WHERE charge_id=? AND kind IN ('refund','refund_reversal')),0) AS prior)` ,
   txn.id, sourceId, chargeId || null, kind, amount, fee, net, fund, gift?.id ?? null,
   kind, amount, kind, amount, day(txn.created, (await settings({ db: env.DB })).timezone), now, chargeId, chargeId),
  sql(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
   SELECT ?,'stripe','Stripe','agent','payments.entry','payment',p.id,g.donor_id,? FROM cf_payment_entries p LEFT JOIN cf_gifts g ON g.id=p.gift_id
   WHERE p.id=? AND NOT EXISTS(SELECT 1 FROM cf_events WHERE action='payments.entry' AND subject_id=p.id)`, now, JSON.stringify({ amountCents: amount, feeCents: fee, kind }), txn.id)], authority)
 return one({ db: env.DB }, 'SELECT * FROM cf_payment_entries WHERE id=?', txn.id)
}
