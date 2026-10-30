import { bankCheckoutState } from '../giving/bank-checkout'
import { observeStaffPayment } from '../giving/staff-payment'
import { pledgeSessionForCharge } from '../pledge-checkout'
import { identify, recordGift } from '../giving/recording'
import { runGiftRules } from '../gift-rules'
import { canonicalDonor, lookupEmailDonor } from '../donor-merge'
import { email, fail, one, sql, type Context } from '../db'
import { settings } from '../settings'
import { stripe, type GivingEnv } from '../giving/stripe'
import { cents, day, stripeId, stripePages } from './stripe-data'
import { paymentWrite } from './write'
import { onlineAttribution } from '../attribution'

/** Resolve the processor's charge to the existing move-in or giving reference.
 * Never infer consent or restore a record after erasure. */
export async function syncCharge(env: GivingEnv, chargeId: string, authority?: Context) {
 const c = { db: env.DB }, saved = await one(c, 'SELECT * FROM cf_stripe_charges WHERE id=?', chargeId)
 if (saved) return saved
 const charge = await stripe(env, '/charges/' + encodeURIComponent(chargeId))
 if (charge.status !== 'succeeded' || !charge.paid) return null
 if (charge.currency !== 'usd') fail('currency', 'Only USD payments can be reconciled.', 409)
 if(charge.metadata?.coffer_pledge_checkout)await pledgeSessionForCharge(env,charge.metadata.coffer_pledge_checkout)
 const gross = cents(charge.amount), customerId = stripeId(charge.customer), pi = stripeId(charge.payment_intent)
 let providerIntentId=charge.metadata?.coffer_intent??''
 const staffPayment=pi&&await one(c,"SELECT 1 FROM cf_portal_changes p JOIN cf_giving_intents i ON i.id=p.id WHERE p.action='staff.payment' AND i.customer_id=?",customerId)
 if(staffPayment){const payment=await stripe(env,'/payment_intents/'+encodeURIComponent(pi));providerIntentId=payment.metadata?.coffer_intent??providerIntentId}
 if(staffPayment&&!await one(c,"SELECT 1 FROM cf_gifts WHERE source='stripe' AND reference=? AND kind='gift'",pi)&&await observeStaffPayment(env,pi,authority)){
  const recorded=await one(c,'SELECT * FROM cf_stripe_charges WHERE id=?',chargeId)
  if(recorded)return recorded
  return null
 }
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
  let intent = providerIntentId ? await one(c, 'SELECT i.*,c.fund FROM cf_giving_intents i JOIN cf_campaigns c ON c.id=i.campaign_id WHERE i.id=?', providerIntentId) : savedIntent?.staff_channel&&savedIntent.frequency==='once'?null:savedIntent
  if (!intent && pi) {
   const payment = await stripe(env, '/payment_intents/' + encodeURIComponent(pi))
   if (payment.metadata?.coffer_intent) intent = await one(c, 'SELECT i.*,c.fund FROM cf_giving_intents i JOIN cf_campaigns c ON c.id=i.campaign_id WHERE i.id=?', payment.metadata.coffer_intent)
  }
  if(intent?.payment_method==='us_bank_account'){
   const capture=await one(c,'SELECT fund FROM cf_giving_form_intents WHERE intent_id=?',intent.id)
   intent={...intent,fund:capture?.fund??intent.fund}
   const bank=await bankCheckoutState(env,intent,undefined,charge)
   if(bank.status!=='succeeded'&&bank.status!=='returned')return null
   if(intent.donor_id&&!(await one(c,'SELECT id FROM cf_donors WHERE id=? AND erased_at IS NULL',intent.donor_id)))return null
  }
  if (intent?.frequency === 'once' && (intent.customer_id !== customerId || intent.amount_cents !== gross)) fail('payment_mismatch', 'The charge differs from the agreed checkout total.', 409)
  // A verified paid charge can arrive before the browser return. Use the
  // giving recorder so designation, private answers, consent and receipts have
  // the same frozen source whichever transport observes payment first.
  if(intent){
   const giving = await identify(env,intent.id,customerId,true,authority)
   if(!giving&&intent.payment_method==='us_bank_account')return null
   if(giving){
    const reference=refs.find(ref=>ref.startsWith('in_'))??(pi||charge.id)
    await recordGift(env,giving,reference,gross,charge.created,undefined,authority)
    gift=await one(c,"SELECT * FROM cf_gifts WHERE source='stripe' AND reference=? AND kind='gift'",reference)
   }
  }
  if(!gift){
  let donor = intent?.donor_id ? await one(c, 'SELECT * FROM cf_donors WHERE id=?', intent.donor_id) : null
  const erased = customerId && await one(c, 'SELECT d.* FROM cf_erased_stripe_customers e JOIN cf_donors d ON d.id=e.donor_id WHERE e.customer_id=?', customerId)
  if (erased) donor = erased
  if (!donor && givingCustomer) donor = await one(c, 'SELECT * FROM cf_donors WHERE id=?', givingCustomer.donor_id)
  if (!donor && customerId) donor = await one(c, "SELECT * FROM cf_donors WHERE source='stripe' AND source_ref=?", customerId)
  let customer: any = null
  if (!donor && customerId) customer = await stripe(env, '/customers/' + encodeURIComponent(customerId))
  const mail = email(charge.billing_details?.email ?? charge.receipt_email ?? customer?.email)
  const donorName = String(charge.billing_details?.name ?? customer?.name ?? mail).slice(0,200)
  // An unlinked processor customer is a distinct source identity.
  if (!donor && mail && !customerId) donor = await lookupEmailDonor(c,mail,donorName)
  if (!donor && !mail) fail('donor_match_required', 'Add a donor email to this Stripe payment before syncing it.', 409)
  if (!donor) {
   const donorId = 'stripe-donor-' + (customerId || charge.id)
   await paymentWrite(env, [sql('INSERT INTO cf_identity_ingest VALUES(1)'),sql("INSERT OR IGNORE INTO cf_donors(id,version,name,email,source,source_ref,created_at) VALUES(?,1,?,?,'stripe',?,?)", donorId, donorName, mail, customerId || charge.id, now),sql('DELETE FROM cf_identity_ingest')], authority)
   donor = await one(c,'SELECT * FROM cf_donors WHERE id=? AND erased_at IS NULL',donorId)
  }
  if (donor) donor = await one(c, 'SELECT * FROM cf_donors WHERE id=?', await canonicalDonor(c,donor.id))
  if (!donor) fail('donor_match_required', 'This Stripe donor could not be matched.', 409)
  const giftId = intent ? 'giving-' + (refs.find(ref => ref.startsWith('in_')) ?? (pi || charge.id)) : 'stripe-' + charge.id
  const fund = String(intent?.fund ?? charge.metadata?.fund ?? 'Unrestricted').trim().slice(0, 100) || 'Unrestricted'
  // A Coffer Checkout return and a charge event use the same reference and ID.
  const reference = intent ? (refs.find(ref => ref.startsWith('in_')) ?? (pi || charge.id)) : charge.id
  await paymentWrite(env, [
   sql(`INSERT OR IGNORE INTO cf_gifts(id,version,donor_id,kind,received_on,amount_cents,method,reference,fund,goods,goods_cents,source,created_at,created_by)
    VALUES(?,1,?,'gift',?,?,'card',?,?,?,0,'stripe',?,?)`, giftId, donor.id, day(charge.created, (await settings(c)).timezone), gross, reference, fund, intent ? 'none' : 'unknown', now,intent?.staff_actor_name??'Stripe'),
   ...(intent ? [sql('INSERT OR IGNORE INTO cf_campaign_gifts(gift_id,campaign_id) SELECT id,? FROM cf_gifts WHERE source=\'stripe\' AND reference=?', intent.campaign_id, reference), ...onlineAttribution(intent, reference), ...(!intent.staff_channel?[sql("INSERT OR IGNORE INTO cf_dashboard_gift_forms(gift_id,form_id) SELECT id,? FROM cf_gifts WHERE source='stripe' AND reference=? AND kind='gift'",intent.campaign_id,reference)]:[])] : []),
   sql(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
    SELECT ?,'stripe','Stripe','agent','payments.gift','gift',id,donor_id,? FROM cf_gifts WHERE source='stripe' AND reference=? AND kind='gift'
    AND NOT EXISTS(SELECT 1 FROM cf_events WHERE action='payments.gift' AND subject_id=cf_gifts.id)`, now, JSON.stringify({ chargeId, amountCents: gross }), reference),
  ], authority)
  gift = await one(c, "SELECT * FROM cf_gifts WHERE source='stripe' AND reference=? AND kind='gift'", reference)
  if(gift)await runGiftRules(env,gift.id)
  }
 }
 if (!gift || gift.amount_cents > gross) fail('payment_mismatch', 'The saved gift differs from this Stripe charge.', 409)
 // Saved-page move-in already netted refunds. Preserve those originals, and
 // apply only later changes to contribution totals; accounting retains gross.
 await paymentWrite(env, [sql('INSERT OR IGNORE INTO cf_stripe_charges(id,gift_id,refund_baseline,created_at) VALUES(?,?,?,?)', charge.id, gift.id, gross - gift.amount_cents, now)], authority)
 return one(c, 'SELECT * FROM cf_stripe_charges WHERE id=?', charge.id)
}
