import { intentRecognition } from '../recognition'
import { choice, email, fail, one, sha256, text } from '../db'
import { amount } from '../money'
import { campaign } from './campaigns'
import { requireStripe, stripe, type GivingEnv } from './stripe'

export async function limit(env: GivingEnv, key: string, max = 10) {
 const window = Math.floor(Date.now() / 600000), hashed = await sha256(key)
 const row = await env.DB.prepare('INSERT INTO cf_giving_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window RETURNING count').bind(hashed, window).first<{ count: number }>()
 if (!row || row.count > max) fail('rate_limited', 'Please wait a few minutes before trying again.', 429)
}

export async function checkout(env: GivingEnv, request: Request, slug: string, p: Record<string, any>) {
 requireStripe(env)
 await limit(env, 'checkout:' + (request.headers.get('CF-Connecting-IP') ?? 'local'))
 if (p.website) fail('INPUT', 'Please leave the website field empty.', 400)
 const c = await campaign({ db: env.DB }, slug), name = text(p.name, 'Your name', 200), mail = email(p.email)
 if (!mail) fail('INPUT', 'Enter your email address.', 400)
 const cents = amount(p, 'amount', 'Gift amount'), frequency = choice(p.frequency, ['once', 'monthly'] as const, 'gift frequency')
 if (cents < 100 || cents > 10000000) fail('INPUT', 'Give between $1 and $100,000.', 400)
 const recognition=intentRecognition(p)
 const consent = p.emailConsent === 'yes' ? 1 : 0, id = text(p.requestId, 'Checkout request', 100)
 if (!/^[0-9a-f-]{36}$/.test(id)) fail('INPUT', 'Reload the donation page and try again.', 400)
 await env.DB.prepare('INSERT OR IGNORE INTO cf_giving_intents(id,campaign_id,name,email,amount_cents,frequency,email_consent,created_at,anonymous,wall_opt_in,recognition_name) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id, c.id, name, mail, cents, frequency, consent, new Date().toISOString(),recognition.anonymous,recognition.wallOptIn,recognition.recognitionName).run()
 const intent = await one({ db: env.DB }, 'SELECT * FROM cf_giving_intents WHERE id=?', id)
 if (!intent || intent.campaign_id !== c.id || intent.name !== name || intent.email !== mail || intent.amount_cents !== cents || intent.frequency !== frequency || intent.email_consent !== consent || intent.anonymous!==recognition.anonymous || intent.wall_opt_in!==recognition.wallOptIn || intent.recognition_name!==recognition.recognitionName) fail('checkout_changed', 'Reload the donation page before changing this gift.', 409)
 if (intent.session_id) return stripe(env, '/checkout/sessions/' + encodeURIComponent(intent.session_id))
 // An unverified public email must not reveal an existing Stripe customer's saved details.
 const customer = (await stripe(env, '/customers', { name, email: mail, 'metadata[coffer_install]': env.AUTH_ORIGIN }, 'customer-' + id)).id
 await env.DB.prepare('UPDATE cf_giving_intents SET customer_id=? WHERE id=?').bind(customer, id).run()
 const params: Record<string, string> = {
  mode: frequency === 'monthly' ? 'subscription' : 'payment', customer,
  'allowed_payment_method_types[0]': 'card', 'allowed_payment_method_types[1]': 'link',
  'line_items[0][price_data][currency]': 'usd',
  'line_items[0][price_data][unit_amount]': String(cents),
  'line_items[0][price_data][product_data][name]': c.name,
  'line_items[0][quantity]': '1', 'metadata[coffer_intent]': id,
  success_url: env.AUTH_ORIGIN + '/giving/thanks?session_id={CHECKOUT_SESSION_ID}',
  cancel_url: env.AUTH_ORIGIN + '/give/' + slug + '?cancelled=1',
 }
 if (frequency === 'monthly') {
  params['line_items[0][price_data][recurring][interval]'] = 'month'
  params['subscription_data[metadata][coffer_intent]'] = id
 } else params['payment_intent_data[metadata][coffer_intent]'] = id
 const session = await stripe(env, '/checkout/sessions', params, 'checkout-' + id)
 await env.DB.prepare('UPDATE cf_giving_intents SET session_id=? WHERE id=?').bind(session.id, id).run()
 return session
}
