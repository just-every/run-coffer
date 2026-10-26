import { failedAttempt, protectCheckout } from './protection'
import { textLink } from './text'
import { givingTribute } from './tribute'
import { intentRecognition } from '../recognition'
import { choice, email, fail, one, sha256, text, today } from '../db'
import { settings } from '../settings'
import { amount } from '../money'
import { campaign } from './campaigns'
import { feeCoverTotal } from './fee-cover'
import { trackedAppeal } from './tracked-link'
import { requireStripe, stripe, type GivingEnv } from './stripe'
import { prepareEventCheckout } from '../event-checkout'

export async function limit(env: GivingEnv, key: string, max = 10) {
 const window = Math.floor(Date.now() / 600000), hashed = await sha256(key)
 const row = await env.DB.prepare('INSERT INTO cf_giving_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window RETURNING count').bind(hashed, window).first<{ count: number }>()
 if (!row || row.count > max) fail('rate_limited', 'Please wait a few minutes before trying again.', 429)
}

export async function checkout(env: GivingEnv, request: Request, slug: string, p: Record<string, any>, ticket?: Record<string, any>) {
 if(ticket)p={...p,amount:(ticket.price_cents/100).toFixed(2),frequency:'once',appeal:ticket.appeal_id,feeCover:'no',wallOptIn:'no',emailConsent:'no',textLink:null}
 const c = await campaign({ db: env.DB }, slug)
 if (c.closes_on && today((await settings({ db: env.DB })).timezone) > c.closes_on) fail('campaign_closed', 'This campaign has closed and is no longer accepting new gifts. Thank you for your support.', 409)
 requireStripe(env)
 await protectCheckout(env,request,c.id,p)
 const provider: typeof stripe = async (...args) => {
  try { return await stripe(...args) }
  catch(error) { await failedAttempt(env,c.id); throw error }
 }
 if (p.website) fail('INPUT', 'Please leave the website field empty.', 400)
 const name = text(p.name, 'Your name', 200), mail = email(p.email)
 if (!mail) fail('INPUT', 'Enter your email address.', 400)
 const base = amount(p, 'amount', 'Gift amount'), frequency = choice(p.frequency, ['once', 'monthly', 'quarterly', 'annually'] as const, 'gift frequency')
 if (base < 100 || base > 10000000) fail('INPUT', 'Give between $1 and $100,000.', 400)
 const storedFrequency = frequency === 'once' ? 'once' : 'monthly'
 const id = text(p.requestId, 'Checkout request', 100)
 if (!/^[0-9a-f-]{36}$/.test(id)) fail('INPUT', 'Reload the donation page and try again.', 400)
 const prior = await one({ db: env.DB }, 'SELECT * FROM cf_giving_intents WHERE id=?', id)
 const priorRegistration=await one({db:env.DB},'SELECT * FROM cf_event_orders WHERE intent_id=?',id)
 if(prior && (ticket?(!priorRegistration||priorRegistration.ticket_type_id!==ticket.id):Boolean(priorRegistration)))fail('checkout_changed','Reload before changing a checkout between a gift and an event ticket.',409)
 const eventCheckout=ticket?await prepareEventCheckout(env.DB,id,ticket,p,name,mail):null
 const covers = p.feeCover === 'yes'
 // A saved request retains its quoted rate even after campaign settings change.
 const rate = prior ? prior.fee_cover_rate_bps : c.fee_cover_rate_bps
 const fixed = prior ? prior.fee_cover_fixed_cents : c.fee_cover_fixed_cents
 if (covers && ((!prior && !c.fee_cover_enabled) || rate === null || fixed === null)) fail('fee_cover_unavailable', 'Fee cover is no longer available. Reload the donation page.', 409)
 const cents = covers ? feeCoverTotal(base, rate, fixed) : base
 if (covers && String(cents) !== String(p.quotedAmountCents)) fail('fee_cover_changed', 'The estimated total changed. Reload the donation page and review the amount before continuing.', 409)
 const tribute=givingTribute(p)
 const recognition=intentRecognition(p)
 const linkedText = await textLink(env, slug, p.textLink)
 const appeal = await trackedAppeal({ db: env.DB }, linkedText ? linkedText.appeal : p.appeal), consent = p.emailConsent === 'yes' ? 1 : 0
 const storedTribute=tribute??{kind:null,honoree:null,notified_name:null,notified_email:null,notified_address:null,amount_permission:0}
 await env.DB.batch([
  env.DB.prepare('INSERT OR IGNORE INTO cf_giving_intents(id,campaign_id,name,email,amount_cents,frequency,email_consent,created_at,anonymous,wall_opt_in,recognition_name,appeal,requested_amount_cents,fee_cover_cents,fee_cover_rate_bps,fee_cover_fixed_cents,giving_channel,billing_frequency) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id, c.id, name, mail, cents, storedFrequency, consent, new Date().toISOString(),recognition.anonymous,recognition.wallOptIn,recognition.recognitionName,appeal,base,cents-base,covers?rate:null,covers?fixed:null,linkedText?'text':'form',frequency),
  ...(eventCheckout?eventCheckout.statements:[]),
  env.DB.prepare('INSERT OR IGNORE INTO cf_giving_tributes(intent_id,kind,honoree,notified_name,notified_email,notified_address,amount_permission) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM cf_giving_intents WHERE id=? AND name=? AND email=? AND amount_cents=? AND frequency=?)').bind(id,storedTribute.kind,storedTribute.honoree,storedTribute.notified_name,storedTribute.notified_email,storedTribute.notified_address,storedTribute.amount_permission,id,name,mail,cents,storedFrequency),
 ])
 const intent = await one({ db: env.DB }, 'SELECT * FROM cf_giving_intents WHERE id=?', id)
 if (!intent || intent.campaign_id !== c.id || intent.name !== name || intent.email !== mail || intent.amount_cents !== cents || intent.billing_frequency !== frequency || intent.email_consent !== consent || intent.anonymous!==recognition.anonymous || intent.wall_opt_in!==recognition.wallOptIn || intent.recognition_name!==recognition.recognitionName || intent.appeal!==appeal || intent.requested_amount_cents!==base || intent.fee_cover_cents!==cents-base || intent.fee_cover_rate_bps!==(covers?rate:null) || intent.fee_cover_fixed_cents!==(covers?fixed:null)) fail('checkout_changed', 'Reload the donation page before changing this gift.', 409)
 const savedTribute=await one({db:env.DB},'SELECT kind,honoree,notified_name,notified_email,notified_address,amount_permission FROM cf_giving_tributes WHERE intent_id=?',id)
 if(JSON.stringify(savedTribute)!==JSON.stringify(storedTribute))fail('checkout_changed','Reload the donation page before changing this tribute.',409)
 if (intent.giving_channel !== (linkedText ? 'text' : 'form')) fail('checkout_changed', 'Reload the donation page before changing the source.', 409)
 const registration=await one({db:env.DB},'SELECT * FROM cf_event_orders WHERE intent_id=?',id)
 if(ticket?(!registration||registration.ticket_type_id!==ticket.id||registration.price_cents!==ticket.price_cents||registration.benefit_cents!==ticket.benefit_cents||registration.input_hash!==eventCheckout!.order.input_hash):Boolean(registration))fail('checkout_changed','Reload the registration before changing its ticket or guests.',409)
 if (intent.session_id) return provider(env, '/checkout/sessions/' + encodeURIComponent(intent.session_id))
 // An unverified public email must not reveal an existing Stripe customer's saved details.
 const customer = (await provider(env, '/customers', { name, email: mail, 'metadata[coffer_install]': env.AUTH_ORIGIN }, 'customer-' + id)).id
 await env.DB.prepare('UPDATE cf_giving_intents SET customer_id=? WHERE id=?').bind(customer, id).run()
 const params: Record<string, string> = {
  mode: frequency !== 'once' ? 'subscription' : 'payment', customer,
  'allowed_payment_method_types[0]': 'card', 'allowed_payment_method_types[1]': 'link',
  'line_items[0][price_data][currency]': 'usd',
  'line_items[0][price_data][unit_amount]': String(cents),
  'line_items[0][price_data][product_data][name]': c.name,
  'line_items[0][quantity]': '1', 'metadata[coffer_intent]': id,
  success_url: env.AUTH_ORIGIN + '/giving/thanks?session_id={CHECKOUT_SESSION_ID}',
  cancel_url: env.AUTH_ORIGIN + '/give/' + slug + '?cancelled=1' + (appeal ? '&appeal=' + encodeURIComponent(appeal) : '') + (linkedText ? '&text=' + encodeURIComponent(p.textLink) : ''),
 }
 if (frequency !== 'once') {
  params['line_items[0][price_data][recurring][interval]'] = frequency === 'annually' ? 'year' : 'month'
  params['line_items[0][price_data][recurring][interval_count]'] = frequency === 'quarterly' ? '3' : '1'
  params['subscription_data[metadata][coffer_intent]'] = id
 } else params['payment_intent_data[metadata][coffer_intent]'] = id
 const session = await provider(env, '/checkout/sessions', params, 'checkout-' + id)
 await env.DB.prepare('UPDATE cf_giving_intents SET session_id=? WHERE id=?').bind(session.id, id).run()
 return session
}
