import { canonicalDonor } from '../donor-merge'
import { fail, newId, one, type Row } from '../db'
import { stripe, type GivingEnv } from './stripe'

export const stripeId = (value: any): string => typeof value === 'string' ? value : value?.id ?? ''

/** A provider object must name an intention created by this installation. */
export async function identify(env: GivingEnv, intentId: string, customer: string): Promise<Row | null> {
 const c = { db: env.DB }, intent = await one(c, 'SELECT i.*,c.fund FROM cf_giving_intents i JOIN cf_campaigns c ON c.id=i.campaign_id WHERE i.id=?', intentId)
 if (!intent || !customer || intent.customer_id !== customer) return null
 let donor = intent.donor_id ? await one(c, 'SELECT * FROM cf_donors WHERE id=? AND erased_at IS NULL', intent.donor_id) : null
 if (intent.donor_id && !donor) return null // Erasure must never restore personal data.
 if (!donor) {
  await env.DB.prepare("INSERT OR IGNORE INTO cf_donors(id,version,name,email,source,source_ref,created_at) VALUES(?,1,?,?,'stripe',?,?)").bind(newId(), intent.name, intent.email, customer, new Date().toISOString()).run()
  donor = await one(c, 'SELECT * FROM cf_donors WHERE email=? AND erased_at IS NULL', intent.email)
 }
 if (donor) donor = await one(c, 'SELECT * FROM cf_donors WHERE id=? AND erased_at IS NULL', await canonicalDonor(c,donor.id))
 if (!donor) fail('donor_unavailable', 'The donor record is not available.', 409)
 await env.DB.batch([
  env.DB.prepare('INSERT OR IGNORE INTO cf_giving_customers(customer_id,donor_id) VALUES(?,?)').bind(customer, donor.id),
  env.DB.prepare('UPDATE cf_giving_intents SET donor_id=? WHERE id=?').bind(donor.id, intent.id),
 ])
 return { ...intent, donor_id: donor.id }
}

/** Read current Stripe state so delayed webhook deliveries cannot undo recovery. */
export async function syncSubscription(env: GivingEnv, subscriptionId: string) {
 const sub = await stripe(env, '/subscriptions/' + encodeURIComponent(subscriptionId))
 const intent = await identify(env, sub.metadata?.coffer_intent ?? '', stripeId(sub.customer))
 if (!intent || intent.frequency !== 'monthly') return null
 // Checkout initially saves a subscription-specific card. Let the customer's
 // default take over so Billing Portal card changes also repair this plan.
 if (sub.default_payment_method && !await one({ db: env.DB }, 'SELECT id FROM cf_subscriptions WHERE id=?', sub.id)) {
  await stripe(env, '/customers/' + encodeURIComponent(intent.customer_id), { 'invoice_settings[default_payment_method]': stripeId(sub.default_payment_method) })
  await stripe(env, '/subscriptions/' + encodeURIComponent(sub.id), { default_payment_method: '' })
 }
 const now = new Date().toISOString(), cents = sub.items?.data?.[0]?.price?.unit_amount ?? intent.amount_cents
 await env.DB.prepare(`INSERT INTO cf_subscriptions(id,donor_id,campaign_id,customer_id,amount_cents,status,cancel_at_period_end,updated_at)
 VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,cancel_at_period_end=excluded.cancel_at_period_end,amount_cents=excluded.amount_cents,updated_at=excluded.updated_at`).bind(sub.id, intent.donor_id, intent.campaign_id, stripeId(sub.customer), cents, sub.status, sub.cancel_at_period_end ? 1 : 0, now).run()
 return { sub, intent }
}

/** The reference and deterministic ID make return-page/webhook races harmless. */
export async function recordGift(env: GivingEnv, intent: Row, reference: string, cents: number, paidAt: number) {
 if (!Number.isSafeInteger(cents) || cents <= 0 || !reference || !Number.isSafeInteger(paidAt)) fail('invalid_payment', 'Stripe returned an invalid gift.', 409)
 const id = 'giving-' + reference, now = new Date().toISOString(), day = new Date(paidAt * 1000).toISOString().slice(0, 10)
 await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO cf_gifts(id,version,donor_id,kind,received_on,amount_cents,method,reference,fund,goods,goods_cents,source,created_at,created_by)
   VALUES(?,1,?,'gift',?,?,'card',?,?,'none',0,'stripe',?,'Stripe')`).bind(id, intent.donor_id, day, cents, reference, intent.fund, now),
  env.DB.prepare('INSERT OR IGNORE INTO cf_campaign_gifts(gift_id,campaign_id) SELECT id,? FROM cf_gifts WHERE source=\'stripe\' AND reference=? AND kind=\'gift\'').bind(intent.campaign_id, reference),
  env.DB.prepare(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
   SELECT ?,'stripe','Stripe','agent','giving.paid','gift',?,?,? WHERE NOT EXISTS(SELECT 1 FROM cf_events WHERE action='giving.paid' AND subject_id=?)`).bind(now, id, intent.donor_id, JSON.stringify({ amountCents: cents, campaignId: intent.campaign_id }), id),
 ])
 return id
}
