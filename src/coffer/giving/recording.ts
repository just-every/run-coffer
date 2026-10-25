import { observePortalPlan } from './portal-plan-facts'
import { runGiftRules } from '../gift-rules'
import { tributeGiftStatement } from './tribute'
import { giftRecognitionStatement } from '../recognition'
import { canonicalDonor, lookupEmailDonor } from '../donor-merge'
import { fail, one, today, type Row } from '../db'
import { settings } from '../settings'
import { stripe, type GivingEnv } from './stripe'
import { sendOnlineReceipt } from './online-receipt'
import { onlineAttribution } from '../attribution'

export const stripeId = (value: any): string => typeof value === 'string' ? value : value?.id ?? ''

/** A provider object must name an intention created by this installation. */
export async function identify(env: GivingEnv, intentId: string, customer: string, createDonor = true): Promise<Row | null> {
 const c = { db: env.DB }, intent = await one(c, 'SELECT i.*,c.fund FROM cf_giving_intents i JOIN cf_campaigns c ON c.id=i.campaign_id WHERE i.id=?', intentId)
 if (!intent || !customer || intent.customer_id !== customer) return null
 let donor = intent.donor_id ? await one(c, 'SELECT * FROM cf_donors WHERE id=? AND erased_at IS NULL', intent.donor_id) : null
 if (intent.donor_id && !donor) return null // Erasure must never restore personal data.
 if (!donor) donor = await lookupEmailDonor(c,intent.email,intent.name)
 if (!donor && !createDonor) return null
 if (!donor) {
  // Checkout return and webhook share this identity even when they race.
  const donorId = 'giving-donor-' + intent.id
  await env.DB.batch([
   env.DB.prepare('INSERT INTO cf_identity_ingest VALUES(1)'),
   env.DB.prepare("INSERT OR IGNORE INTO cf_donors(id,version,name,email,source,source_ref,created_at) VALUES(?,1,?,?,'stripe',?,?)").bind(donorId, intent.name, intent.email, customer, new Date().toISOString()),
   env.DB.prepare('DELETE FROM cf_identity_ingest'),
  ])
  donor = await one(c,'SELECT * FROM cf_donors WHERE id=? AND erased_at IS NULL',donorId)
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
export async function syncSubscription(env: GivingEnv, subscriptionId: string, createDonor?: boolean) {
 const sub = await stripe(env, '/subscriptions/' + encodeURIComponent(subscriptionId))
 let intent = await identify(env, sub.metadata?.coffer_intent ?? '', stripeId(sub.customer), createDonor ?? ['active','trialing'].includes(sub.status))
 if (!intent) {
  // Imported plans retain their verified Stripe customer association and have no checkout intention.
  const existing=await one({db:env.DB}, `SELECT s.*,c.fund FROM cf_subscriptions s JOIN cf_campaigns c ON c.id=s.campaign_id JOIN cf_donors d ON d.id=s.donor_id WHERE s.id=? AND s.customer_id=? AND d.erased_at IS NULL`,sub.id,stripeId(sub.customer))
  if(existing)intent={...existing,frequency:'monthly'}
 }
 if (!intent || intent.frequency !== 'monthly') return null
 // Checkout initially saves a subscription-specific card. Let the customer's
 // default take over so Billing Portal card changes also repair this plan.
 if (sub.default_payment_method && !await one({ db: env.DB }, 'SELECT id FROM cf_subscriptions WHERE id=?', sub.id)) {
  await stripe(env, '/customers/' + encodeURIComponent(intent.customer_id), { 'invoice_settings[default_payment_method]': stripeId(sub.default_payment_method) })
  await stripe(env, '/subscriptions/' + encodeURIComponent(sub.id), { default_payment_method: '' })
 }
 const now = new Date().toISOString(), item=sub.items?.data?.[0], cents = item?.price?.unit_amount === undefined ? intent.amount_cents : item.price.unit_amount*(item.quantity??1)
 if(!Number.isSafeInteger(cents)||cents<=0)fail('invalid_payment','Stripe returned an invalid monthly amount.',409)
 await env.DB.prepare(`INSERT INTO cf_subscriptions(id,donor_id,campaign_id,customer_id,amount_cents,status,cancel_at_period_end,updated_at)
 VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,cancel_at_period_end=excluded.cancel_at_period_end,amount_cents=excluded.amount_cents,updated_at=excluded.updated_at`).bind(sub.id, intent.donor_id, intent.campaign_id, stripeId(sub.customer), cents, sub.status, sub.cancel_at_period_end ? 1 : 0, now).run()
 if(Number.isSafeInteger(sub.created)&&sub.created>0)await env.DB.prepare('UPDATE cf_subscription_lifetimes SET started_at=?,start_known=1 WHERE subscription_id=?').bind(new Date(sub.created*1000).toISOString(),sub.id).run()
 await observePortalPlan(env,sub)
 return { sub, intent }
}

const consentEvidence = (intent: Row) => `Ticked “Email me news and appeals” on the giving page at checkout ${intent.id}.`

/** The reference and deterministic ID make return-page/webhook races harmless. */
export async function recordGift(env: GivingEnv, intent: Row, reference: string, cents: number, paidAt: number, subscriptionId?: string) {
 if (!Number.isSafeInteger(cents) || cents <= 0 || !reference || !Number.isSafeInteger(paidAt)) fail('invalid_payment', 'Stripe returned an invalid gift.', 409)
 const ticket=await one({db:env.DB},'SELECT * FROM cf_event_registrations WHERE intent_id=?',intent.id)
 const id = 'giving-' + reference, now = new Date().toISOString(), day = today((await settings({ db: env.DB })).timezone, new Date(paidAt * 1000))
 await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO cf_gifts(id,version,donor_id,kind,received_on,amount_cents,method,reference,fund,goods,goods_cents,goods_description,source,created_at,created_by)
   VALUES(?,1,?,'gift',?,?,'card',?,?,?,?,?,'stripe',?,?)`).bind(id, intent.donor_id, day, cents, reference, intent.fund, ticket?'provided':'none',ticket?.benefit_cents??0,ticket?.benefit_description??null, now,intent.staff_actor_name??'Stripe'),
  env.DB.prepare('INSERT OR IGNORE INTO cf_campaign_gifts(gift_id,campaign_id) SELECT id,? FROM cf_gifts WHERE source=\'stripe\' AND reference=? AND kind=\'gift\'').bind(intent.campaign_id, reference),
  ...(ticket?[env.DB.prepare('UPDATE cf_event_registrations SET donor_id=? WHERE intent_id=?').bind(intent.donor_id,intent.id)]:[]),
  ...(!intent.staff_channel&&!ticket?[env.DB.prepare("INSERT OR IGNORE INTO cf_dashboard_gift_forms(gift_id,form_id) SELECT id,? FROM cf_gifts WHERE source='stripe' AND reference=? AND kind='gift'").bind(intent.campaign_id, reference)]:[]),
  ...onlineAttribution(ticket?{...intent,giving_channel:'event'}:intent, reference).map(s=>env.DB.prepare(s.sql).bind(...s.params)),
  ...(subscriptionId ? [env.DB.prepare('INSERT OR IGNORE INTO cf_subscription_gifts(subscription_id,gift_id) VALUES(?,?)').bind(subscriptionId,id)] : []),
  ...[tributeGiftStatement(id,intent.id,now)].map(s=>env.DB.prepare(s.sql).bind(...s.params)),
  ...[giftRecognitionStatement(id,intent)].map(s=>env.DB.prepare(s.sql).bind(...s.params)),
  // The donor ticked the separate appeal box at checkout; receipts never depend on it.
  ...(intent.email_consent ? [env.DB.prepare(`INSERT INTO cf_consents(donor_id,channel,status,method,evidence,captured_on,recorded_at,recorded_by)
   SELECT ?,'email','granted','web form',?,?,?,'Giving page' WHERE EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_consents WHERE donor_id=? AND evidence=?)`)
   .bind(intent.donor_id, consentEvidence(intent), day, now, intent.donor_id, intent.donor_id, consentEvidence(intent))] : []),
  env.DB.prepare(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
   SELECT ?,'stripe','Stripe','agent','giving.paid','gift',?,?,? WHERE NOT EXISTS(SELECT 1 FROM cf_events WHERE action='giving.paid' AND subject_id=?)`).bind(now, id, intent.donor_id, JSON.stringify({ amountCents: cents, campaignId: intent.campaign_id }), id),
 ])
 await runGiftRules(env,id)
 await sendOnlineReceipt(env, id)
 return id
}
