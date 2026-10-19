import { fail, one } from '../db'
import { observeRecovery } from '../agent/recovery'
import { identify, recordGift, stripeId, syncSubscription } from './recording'
import { requireStripe, stripe, verifyStripeSignature, type GivingEnv } from './stripe'
import { paymentEvent } from '../payments/events'

export async function invoice(env: GivingEnv, id: string, failureEventId?: string) {
 const current = await stripe(env, '/invoices/' + encodeURIComponent(id))
 const subscriptionId = stripeId(current.parent?.subscription_details?.subscription)
 if (!subscriptionId) return
 const synced = await syncSubscription(env, subscriptionId)
 if (!synced) return
 const { sub, intent } = synced
 if (current.currency !== 'usd' || stripeId(current.customer) !== intent.customer_id) fail('invalid_payment', 'Stripe returned a different currency or customer.', 409)
 if (current.status === 'paid' && current.amount_paid > 0) {
  await recordGift(env, intent, current.id, current.amount_paid, current.status_transitions.paid_at, subscriptionId)
  if (stripeId(sub.latest_invoice) === current.id) await env.DB.prepare('UPDATE cf_subscriptions SET recovered=CASE WHEN failed_attempts>0 OR ?>1 THEN 1 ELSE recovered END,next_attempt_at=NULL WHERE id=?').bind(current.attempt_count, sub.id).run()
 } else if (current.status === 'open' && current.attempt_count > 0 && stripeId(sub.latest_invoice) === current.id) {
  await env.DB.prepare("UPDATE cf_subscriptions SET failed_attempts=MAX(failed_attempts,?),recovered=0,next_attempt_at=? WHERE id=? AND NOT EXISTS(SELECT 1 FROM cf_gifts WHERE source='stripe' AND reference=?)").bind(current.attempt_count, current.next_payment_attempt ?? null, sub.id, current.id).run()
 }
 const observedAt=new Date().toISOString()
 if(current.status==='open'&&current.attempt_count>0)await env.DB.prepare('INSERT OR IGNORE INTO cf_recurring_payment_health(invoice_id,subscription_id,failed_at) VALUES(?,?,?)').bind(current.id,sub.id,observedAt).run()
 if(current.status==='paid'&&current.amount_paid>0)await env.DB.prepare('UPDATE cf_recurring_payment_health SET recovered_at=COALESCE(recovered_at,?) WHERE invoice_id=?').bind(new Date(current.status_transitions.paid_at*1000).toISOString(),current.id).run()
 await observeRecovery(env, current, sub, intent, failureEventId)
}

export async function completed(env: GivingEnv, sessionId: string) {
 const saved = await one({ db: env.DB }, 'SELECT * FROM cf_giving_intents WHERE session_id=?', sessionId)
 if (!saved) fail('not_found', 'That checkout is not available.', 404)
 const session = await stripe(env, '/checkout/sessions/' + encodeURIComponent(sessionId))
 if (session.metadata?.coffer_intent !== saved.id || stripeId(session.customer) !== saved.customer_id || session.currency !== 'usd' || session.amount_total !== saved.amount_cents) fail('invalid_payment', 'Stripe returned a different checkout.', 409)
 if (session.status !== 'complete' || session.payment_status !== 'paid') return { paid: false, monthly: saved.frequency === 'monthly' }
 const intent = await identify(env, saved.id, saved.customer_id)
 if (!intent) fail('not_found', 'That donor is not available.', 404)
 if (saved.frequency === 'monthly') {
  const synced = await syncSubscription(env, stripeId(session.subscription))
  if (synced?.sub.latest_invoice) await invoice(env, stripeId(synced.sub.latest_invoice))
 } else {
  const pi = await stripe(env, '/payment_intents/' + encodeURIComponent(stripeId(session.payment_intent)))
  if (pi.status !== 'succeeded' || pi.currency !== 'usd' || pi.amount_received !== saved.amount_cents) fail('invalid_payment', 'Payment has not completed.', 409)
  await recordGift(env, intent, pi.id, pi.amount_received, pi.created)
 }
 return { paid: true, monthly: saved.frequency === 'monthly' }
}

export async function webhook(env: GivingEnv, request: Request, raw: string) {
 requireStripe(env)
 if (!await verifyStripeSignature(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET ?? '')) fail('invalid_signature', 'Invalid Stripe signature.', 400)
 let event: any
 try { event = JSON.parse(raw) } catch { fail('invalid_event', 'Invalid Stripe event.', 400) }
 if (typeof event.id !== 'string' || typeof event.type !== 'string' || !event.data?.object?.id) fail('invalid_event', 'Invalid Stripe event.', 400)
 if (await one({ db: env.DB }, 'SELECT id FROM cf_giving_events WHERE id=?', event.id)) return
 const object = event.data.object
 if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
  const saved = await one({ db: env.DB }, 'SELECT id FROM cf_giving_intents WHERE session_id=?', object.id)
  if (saved) await completed(env, object.id)
 } else if (['invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed', 'invoice.updated'].includes(event.type)) {
  await invoice(env, object.id, event.type === 'invoice.payment_failed' ? event.id : undefined)
 } else if (['customer.subscription.updated', 'customer.subscription.deleted', 'customer.subscription.created'].includes(event.type)) {
  await syncSubscription(env, object.id)
 }
 await paymentEvent(env, event)
 await env.DB.prepare('INSERT OR IGNORE INTO cf_giving_events(id,type,processed_at) VALUES(?,?,?)').bind(event.id, event.type, new Date().toISOString()).run()
}
