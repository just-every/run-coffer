import { runtimeBindings } from '../../auth.server'
import { operatorMail } from '../../mail.server.mjs'
import { all, email, fail, one, sha256 } from '../db'
import { e } from '../ui/common'
import { requireStripe, stripe, type GivingEnv } from './stripe'
import { cancellationPage, confirmationPage, invalidLinkPage, requestedPage, requestPage, subscriptionsPage, type PortalSubscription } from './portal-ui'

const LINK_LIFETIME = 30 * 60_000, SESSION_LIFETIME = 60 * 60_000
const TOKEN = /^[a-f0-9]{64}$/
const routes = new Set(['/giving/portal', '/giving/portal/request', '/giving/portal/confirm', '/giving/portal/card', '/giving/portal/cancel'])
type Donor = { id: string; name: string; email: string | null }
type Subscription = PortalSubscription & { customer_id: string; donor_id: string }
type StripeSubscription = { id: string; customer: string | { id: string }; status: string; cancel_at_period_end: boolean }
const context = (env: GivingEnv) => ({ db: env.DB })
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('')

function origin(env: GivingEnv) {
 const url = new URL(env.AUTH_ORIGIN)
 const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
 if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) fail('invalid_host', 'Use the configured secure Coffer address.', 403)
 return url.origin
}

function guardRequest(request: Request, env: GivingEnv) {
 const url = new URL(request.url), expected = origin(env)
 if (url.origin !== expected || (request.headers.has('host') && request.headers.get('host')?.toLowerCase() !== url.host.toLowerCase())) fail('invalid_host', 'This request was sent to the wrong address.', 403)
 if (!['GET', 'HEAD'].includes(request.method) && (request.headers.get('origin') !== expected || request.headers.get('sec-fetch-site') === 'cross-site')) fail('invalid_origin', 'Use the giving portal to make this change.', 403)
}

const cookieName = (env: GivingEnv) => new URL(origin(env)).protocol === 'https:' ? '__Host-coffer_donor' : 'coffer_donor'
function redirect(location: string, cookie?: string) {
 const headers = new Headers({ location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
 if (cookie) headers.set('set-cookie', cookie)
 return new Response(null, { status: 303, headers })
}

async function form(request: Request) {
 if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded')) fail('input', 'Submit the portal form.', 400)
 if (Number(request.headers.get('content-length') ?? 0) > 4096) fail('input', 'This form is too large.', 413)
 const reader = request.body?.getReader()
 if (!reader) fail('input', 'Submit the portal form.', 400)
 const chunks: Uint8Array[] = []
 let size = 0
 while (true) {
  const part = await reader.read()
  if (part.done) break
  size += part.value.byteLength
  if (size > 4096) { await reader.cancel(); fail('input', 'This form is too large.', 413) }
  chunks.push(part.value)
 }
 const bytes = new Uint8Array(size)
 let offset = 0
 for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
 return new URLSearchParams(new TextDecoder().decode(bytes))
}

/** Atomic counters in D1 work across requests and Worker instances. Keys contain no email or IP. */
async function withinLimit(env: GivingEnv, key: string, maximum: number) {
 const window = Math.floor(Date.now() / (15 * 60_000))
 const result = await env.DB.prepare(`INSERT INTO cf_giving_limits(key,window,count) VALUES(?,?,1)
  ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END, window=excluded.window RETURNING count`)
  .bind(key, window).first<{ count: number }>()
 return Boolean(result && result.count <= maximum)
}

function mailSender(env: GivingEnv) {
 if (env.AUTH_LOCAL === 'true' || env.RER_DEMO === '1') fail('mail_unavailable', 'Email sign-in is unavailable in development and demo mode. No email is sent.', 503)
 const sender = operatorMail(env)
 if (!sender || !env.MAIL_FROM?.trim()) fail('mail_unavailable', 'Email sign-in is unavailable until this installation has a mail provider and sender address.', 503)
 return sender
}

/** Only a hash is persisted. No development inbox or token response is created. */
export async function emailPortalLink(original: GivingEnv, donorId: string, subject = 'Your private giving portal link'): Promise<boolean> {
 const env = runtimeBindings(original) as GivingEnv
 requireStripe(env)
 const sender = mailSender(env), base = origin(env)
 const donor = await one<Donor>(context(env), 'SELECT id,name,email FROM cf_donors WHERE id=? AND erased_at IS NULL', donorId)
 if (!donor?.email) return false
 const token = randomToken(), hash = await sha256(token)
 const inserted = await env.DB.prepare(`INSERT INTO cf_donor_tokens(token_hash,donor_id,kind,expires_at,used_at)
  SELECT ?,id,'link',?,NULL FROM cf_donors WHERE id=? AND erased_at IS NULL AND email=?`)
  .bind(hash, Date.now() + LINK_LIFETIME, donor.id, donor.email).run()
 if (inserted.meta.changes !== 1) return false
 const link = `${base}/giving/portal/confirm?token=${token}`
 try {
  const result = await sender.send({
   deliveryId: crypto.randomUUID(), from: env.MAIL_FROM!, to: [donor.email], subject,
   text: `Open your private giving portal to view your monthly gifts, update your card, or cancel monthly giving:\n\n${link}\n\nThis one-use link expires in 30 minutes. If you did not request it, you can ignore this email.`,
   html: `<p>Open your private giving portal to view your monthly gifts, update your card, or cancel monthly giving.</p><p><a href="${e(link)}">Open your giving portal</a></p><p>This one-use link expires in 30 minutes. If you did not request it, you can ignore this email.</p>`,
   headers: {},
  })
  if (result.status !== 'accepted') fail('mail_unavailable', 'The sign-in email could not be sent. Try again later.', 503)
  return true
 } catch {
  await env.DB.prepare("DELETE FROM cf_donor_tokens WHERE token_hash=? AND kind='link'").bind(hash).run()
  fail('mail_unavailable', 'The sign-in email could not be sent. Try again later.', 503)
 }
}

async function session(request: Request, env: GivingEnv) {
 const cookies = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${cookieName(env)}=`))
 if (cookies.length !== 1) return null
 const token = cookies[0].slice(cookieName(env).length + 1)
 if (!TOKEN.test(token)) return null
 return one<Donor>(context(env), `SELECT d.id,d.name,d.email FROM cf_donor_tokens t JOIN cf_donors d ON d.id=t.donor_id
  WHERE t.token_hash=? AND t.kind='session' AND t.used_at IS NULL AND t.expires_at>? AND d.erased_at IS NULL`, await sha256(token), Date.now())
}

async function confirm(request: Request, env: GivingEnv, token: string) {
 if (!TOKEN.test(token)) return invalidLinkPage()
 const hash = await sha256(token), now = Date.now()
 if (request.method === 'GET' || request.method === 'HEAD') {
  const valid = await one(context(env), `SELECT t.donor_id FROM cf_donor_tokens t JOIN cf_donors d ON d.id=t.donor_id
   WHERE t.token_hash=? AND t.kind='link' AND t.used_at IS NULL AND t.expires_at>? AND d.erased_at IS NULL`, hash, now)
  return valid ? confirmationPage(token) : invalidLinkPage()
 }
 const newSession = randomToken(), sessionHash = await sha256(newSession)
 // The batch is one transaction: concurrent confirmation can create only one session.
 const result = await env.DB.batch([
  env.DB.prepare(`INSERT INTO cf_donor_tokens(token_hash,donor_id,kind,expires_at,used_at)
   SELECT ?,t.donor_id,'session',?,NULL FROM cf_donor_tokens t JOIN cf_donors d ON d.id=t.donor_id
   WHERE t.token_hash=? AND t.kind='link' AND t.used_at IS NULL AND t.expires_at>? AND d.erased_at IS NULL`).bind(sessionHash, now + SESSION_LIFETIME, hash, now),
  env.DB.prepare("UPDATE cf_donor_tokens SET used_at=? WHERE token_hash=? AND kind='link' AND used_at IS NULL AND expires_at>?").bind(now, hash, now),
 ])
 if (result[0].meta.changes !== 1) return invalidLinkPage()
 const secure = new URL(origin(env)).protocol === 'https:' ? '; Secure' : ''
 return redirect('/giving/portal', `${cookieName(env)}=${newSession}; Max-Age=3600; Path=/; HttpOnly; SameSite=Lax${secure}`)
}

const subscriptionQuery = `SELECT s.*,c.name AS campaign_name FROM cf_subscriptions s JOIN cf_campaigns c ON c.id=s.campaign_id`
async function ownSubscription(env: GivingEnv, donor: Donor, id: string) {
 const found = await one<Subscription>(context(env), `${subscriptionQuery} WHERE s.id=? AND s.donor_id=?`, id, donor.id)
 if (!found) fail('not_found', 'That monthly gift is not on your account.', 404)
 return found
}

function validateSubscription(value: StripeSubscription, own: Subscription) {
 const customer = typeof value.customer === 'string' ? value.customer : value.customer?.id
 if (value.id !== own.id || customer !== own.customer_id) fail('subscription_changed', 'This monthly gift could not be verified. Contact the organization.', 409)
 if (!['active', 'trialing', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'].includes(value.status) || typeof value.cancel_at_period_end !== 'boolean') fail('stripe_error', 'Stripe returned an unreadable subscription.', 502)
}

async function saveSubscription(env: GivingEnv, own: Subscription, value: StripeSubscription) {
 validateSubscription(value, own)
 await env.DB.prepare(`UPDATE cf_subscriptions SET status=?,cancel_at_period_end=?,updated_at=? WHERE id=? AND donor_id=? AND customer_id=?
  AND EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL)`)
  .bind(value.status, Number(value.cancel_at_period_end), new Date().toISOString(), own.id, own.donor_id, own.customer_id, own.donor_id).run()
}

async function cardConfiguration(env: GivingEnv) {
 const stored = await one<{ value: string }>(context(env), "SELECT value FROM cf_giving_config WHERE key='donor_card_configuration'")
 if (stored) {
  const config = await stripe(env, `billing_portal/configurations/${encodeURIComponent(stored.value)}`)
  const features = config.features ?? {}
  const onlyCardUpdates = ['customer_update', 'invoice_history', 'subscription_cancel', 'subscription_update'].every(name => features[name]?.enabled === false)
   && Object.keys(features).every(name => name === 'payment_method_update' || features[name]?.enabled !== true)
  if (config.id === stored.value && config.active === true && features.payment_method_update?.enabled === true && onlyCardUpdates && config.login_page?.enabled === false) return stored.value
  fail('portal_configuration_changed', 'Card updates are unavailable because the payment portal configuration changed. Contact the organization.', 503)
 }
 const config = await stripe(env, 'billing_portal/configurations', {
  'features[payment_method_update][enabled]': true,
  'features[customer_update][enabled]': false,
  'features[invoice_history][enabled]': false,
  'features[subscription_cancel][enabled]': false,
  'features[subscription_update][enabled]': false,
  'login_page[enabled]': false,
  default_return_url: `${origin(env)}/giving/portal`,
 }, `coffer-donor-card-${await sha256(origin(env))}`)
 if (typeof config.id !== 'string' || !config.id.startsWith('bpc_')) fail('stripe_error', 'Stripe returned an unreadable portal configuration.', 502)
 await env.DB.prepare("INSERT INTO cf_giving_config(key,value) VALUES('donor_card_configuration',?) ON CONFLICT(key) DO NOTHING").bind(config.id).run()
 return config.id
}

async function providerAction(env: GivingEnv, donor: Donor, data: URLSearchParams, action: 'card' | 'cancel') {
 requireStripe(env)
 const own = await ownSubscription(env, donor, data.get('subscription') ?? '')
 const current = await stripe<StripeSubscription>(env, `subscriptions/${encodeURIComponent(own.id)}`)
 validateSubscription(current, own)
 if (action === 'cancel') {
  if (data.get('confirm') !== 'yes') fail('confirmation_required', 'Confirm cancellation using the portal button.', 400)
  const ended = ['canceled', 'incomplete_expired'].includes(current.status)
  // Setting this flag is itself idempotent, including after an operator reinstates a gift.
  const changed = ended || current.cancel_at_period_end ? current : await stripe<StripeSubscription>(env, `subscriptions/${encodeURIComponent(own.id)}`, { cancel_at_period_end: true })
  await saveSubscription(env, own, changed)
  return redirect('/giving/portal?cancelled=1')
 }
 await saveSubscription(env, own, current)
 const result = await stripe(env, 'billing_portal/sessions', {
  customer: own.customer_id, configuration: await cardConfiguration(env), return_url: `${origin(env)}/giving/portal`,
  'flow_data[type]': 'payment_method_update',
  'flow_data[after_completion][type]': 'redirect',
  'flow_data[after_completion][redirect][return_url]': `${origin(env)}/giving/portal`,
 })
 let destination: URL
 try { destination = new URL(result.url) } catch { fail('stripe_error', 'Stripe returned an unreadable portal address.', 502) }
 if (destination.protocol !== 'https:' || destination.hostname !== 'billing.stripe.com' || destination.username || destination.password || destination.port) fail('stripe_error', 'Stripe returned an unexpected portal address.', 502)
 return redirect(destination.href)
}

export async function portalResponse(request: Request, original: GivingEnv): Promise<Response | null> {
 const url = new URL(request.url)
 if (!routes.has(url.pathname)) return null
 const env = runtimeBindings(original) as GivingEnv
 guardRequest(request, env)
 const path = url.pathname, read = ['GET', 'HEAD'].includes(request.method)
 if (!read && request.method !== 'POST') fail('method_not_allowed', 'Use the portal buttons.', 405)
 if (path === '/giving/portal/request') {
  if (read) return redirect('/giving/portal')
  requireStripe(env)
  mailSender(env)
  const data = await form(request), address = email(data.get('email'))
  if (!address) fail('input', 'Enter your email address.', 400)
  const [byEmail, byIp] = await Promise.all([
   withinLimit(env, `portal-email:${await sha256(address)}`, 5),
   withinLimit(env, `portal-ip:${await sha256(request.headers.get('CF-Connecting-IP') ?? 'unknown')}`, 20),
  ])
  if (byEmail && byIp) {
   const donor = await one<Donor>(context(env), 'SELECT id,name,email FROM cf_donors WHERE email=? AND erased_at IS NULL', address)
   if (donor) {
    // Provider failure is also generic, so this response cannot reveal account existence.
    try { await emailPortalLink(env, donor.id) } catch { /* Never expose a donor-dependent mail result. */ }
   }
  }
  return requestedPage()
 }
 if (path === '/giving/portal/confirm') return confirm(request, env, read ? url.searchParams.get('token') ?? '' : (await form(request)).get('token') ?? '')
 const donor = await session(request, env)
 if (!donor) return read && path === '/giving/portal' ? requestPage() : redirect('/giving/portal')
 if (path === '/giving/portal') {
  if (!read) fail('method_not_allowed', 'Use the portal buttons.', 405)
  return subscriptionsPage(donor.name, await all<Subscription>(context(env), `${subscriptionQuery} WHERE s.donor_id=? ORDER BY c.name,s.id`, donor.id), url.searchParams.get('cancelled') === '1')
 }
 if (path === '/giving/portal/cancel' && read) return cancellationPage(await ownSubscription(env, donor, url.searchParams.get('subscription') ?? ''))
 if (read) fail('method_not_allowed', 'Use the portal buttons.', 405)
 return providerAction(env, donor, await form(request), path === '/giving/portal/card' ? 'card' : 'cancel')
}
