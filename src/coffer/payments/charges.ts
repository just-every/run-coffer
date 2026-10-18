import { canonicalDonor } from '../donor-merge'
import { email, fail, newId, one, sql, type Context } from '../db'
import { settings } from '../settings'
import { stripe, type GivingEnv } from '../giving/stripe'
import { cents, day, stripeId, stripePages } from './stripe-data'
import { paymentWrite } from './write'

/** Resolve the processor's charge to the existing move-in or giving reference.
 * Never infer consent or restore a record after erasure. */
export async function syncCharge(env: GivingEnv, chargeId: string, authority?: Context) {
 const c = { db: env.DB }, saved = await one(c, 'SELECT * FROM cf_stripe_charges WHERE id=?', chargeId)
 if (saved) return saved
 const charge = await stripe(env, '/charges/' + encodeURIComponent(chargeId))
 if (charge.status !== 'succeeded' || !charge.paid) return null
 if (charge.currency !== 'usd') fail('currency', 'Only USD payments can be reconciled.', 409)
 const gross = cents(charge.amount), customerId = stripeId(charge.customer), pi = stripeId(charge.payment_intent)
 const refs = [charge.id, pi, stripeId(charge.invoice)].filter(Boolean)
 const savedIntent = customerId ? await one(c, 'SELECT i.*,c.fund FROM cf_giving_intents i JOIN cf_campaigns c ON c.id=i.campaign_id WHERE i.customer_id=? ORDER BY i.created_at DESC LIMIT 1', customerId) : null
 // Newer Stripe versions keep the recurring invoice association on InvoicePayment.
 const givingCustomer = customerId && await one(c, 'SELECT donor_id FROM cf_giving_customers WHERE customer_id=?', customerId)
 if ((givingCustomer || savedIntent) && pi) {
  for await (const payment of stripePages(env, '/invoice_payments?payment[type]=payment_intent&payment[payment_intent]=' + encodeURIComponent(pi))) {
   if (stripeId(payment.invoice)) refs.push(stripeId(payment.invoice))
  }
 }
 let gift = await one(c, "SELECT * FROM cf_gifts WHERE source='stripe' AND kind='gift' AND reference IN (SELECT value FROM json_each(?)) ORDER BY created_at LIMIT 1", JSON.stringify(refs))
 const now = new Date().toISOString()
 if (!gift) {
  let intent = charge.metadata?.coffer_intent ? await one(c, 'SELECT i.*,c.fund FROM cf_giving_intents i JOIN cf_campaigns c ON c.id=i.campaign_id WHERE i.id=?', charge.metadata.coffer_intent) : savedIntent
  if (!intent && pi) {
   const payment = await stripe(env, '/payment_intents/' + encodeURIComponent(pi))
   if (payment.metadata?.coffer_intent) intent = await one(c, 'SELECT i.*,c.fund FROM cf_giving_intents i JOIN cf_campaigns c ON c.id=i.campaign_id WHERE i.id=?', payment.metadata.coffer_intent)
  }
  let donor = intent?.donor_id ? await one(c, 'SELECT * FROM cf_donors WHERE id=?', intent.donor_id) : null
  const erased = customerId && await one(c, 'SELECT d.* FROM cf_erased_stripe_customers e JOIN cf_donors d ON d.id=e.donor_id WHERE e.customer_id=?', customerId)
  if (erased) donor = erased
  if (!donor && givingCustomer) donor = await one(c, 'SELECT * FROM cf_donors WHERE id=?', givingCustomer.donor_id)
  if (!donor && customerId) donor = await one(c, "SELECT * FROM cf_donors WHERE source='stripe' AND source_ref=?", customerId)
  let customer: any = null
  if (!donor && customerId) customer = await stripe(env, '/customers/' + encodeURIComponent(customerId))
  const mail = email(charge.billing_details?.email ?? charge.receipt_email ?? customer?.email)
  if (!donor && mail) donor = await one(c, 'SELECT * FROM cf_donors WHERE email=?', mail)
  if (!donor && !mail) fail('donor_match_required', 'Add a donor email to this Stripe payment before syncing it.', 409)
  if (!donor) {
   await paymentWrite(env, [sql("INSERT OR IGNORE INTO cf_donors(id,version,name,email,source,source_ref,created_at) VALUES(?,1,?,?,'stripe',?,?)", newId(), String(charge.billing_details?.name ?? customer?.name ?? mail).slice(0, 200), mail, customerId || charge.id, now)], authority)
   donor = await one(c, 'SELECT * FROM cf_donors WHERE email=?', mail)
  }
  if (donor) donor = await one(c, 'SELECT * FROM cf_donors WHERE id=?', await canonicalDonor(c,donor.id))
  if (!donor) fail('donor_match_required', 'This Stripe donor could not be matched.', 409)
  const giftId = intent ? 'giving-' + (refs.find(ref => ref.startsWith('in_')) ?? (pi || charge.id)) : 'stripe-' + charge.id
  const fund = String(intent?.fund ?? charge.metadata?.fund ?? 'Unrestricted').trim().slice(0, 100) || 'Unrestricted'
  // A Coffer Checkout return and a charge event use the same reference and ID.
  const reference = intent ? (refs.find(ref => ref.startsWith('in_')) ?? (pi || charge.id)) : charge.id
  await paymentWrite(env, [
   sql(`INSERT OR IGNORE INTO cf_gifts(id,version,donor_id,kind,received_on,amount_cents,method,reference,fund,goods,goods_cents,source,created_at,created_by)
    VALUES(?,1,?,'gift',?,?,'card',?,?,?,0,'stripe',?,'Stripe')`, giftId, donor.id, day(charge.created, (await settings(c)).timezone), gross, reference, fund, intent ? 'none' : 'unknown', now),
   ...(intent ? [sql('INSERT OR IGNORE INTO cf_campaign_gifts(gift_id,campaign_id) SELECT id,? FROM cf_gifts WHERE source=\'stripe\' AND reference=?', intent.campaign_id, reference)] : []),
   sql(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
    SELECT ?,'stripe','Stripe','agent','payments.gift','gift',id,donor_id,? FROM cf_gifts WHERE source='stripe' AND reference=? AND kind='gift'
    AND NOT EXISTS(SELECT 1 FROM cf_events WHERE action='payments.gift' AND subject_id=cf_gifts.id)`, now, JSON.stringify({ chargeId, amountCents: gross }), reference),
  ], authority)
  gift = await one(c, "SELECT * FROM cf_gifts WHERE source='stripe' AND reference=? AND kind='gift'", reference)
 }
 if (!gift || gift.amount_cents > gross) fail('payment_mismatch', 'The saved gift differs from this Stripe charge.', 409)
 // Saved-page move-in already netted refunds. Preserve those originals, and
 // apply only later changes to contribution totals; accounting retains gross.
 await paymentWrite(env, [sql('INSERT OR IGNORE INTO cf_stripe_charges(id,gift_id,refund_baseline,created_at) VALUES(?,?,?,?)', charge.id, gift.id, gross - gift.amount_cents, now)], authority)
 return one(c, 'SELECT * FROM cf_stripe_charges WHERE id=?', charge.id)
}
