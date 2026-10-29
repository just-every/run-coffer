import { savePortalCommunicationPreferences } from './portal-communication-preferences'
import { savedCardConsentPage, saveSavedCardConsent } from './portal-saved-card-consent'
import { downloadProperty } from './portal-property'
import { portalContext, uniquePortalEmail } from './portal-identity'
import { givingHistory, downloadDocument, requestDocumentCopy } from './portal-documents'
import { communicationPage, requestEmailRegrant, withdrawEmail } from './portal-consent'
import { changePlan, managePlanPage, ownPlan, planQuery } from './portal-plans'
import { updatePaymentMethod, paymentMethodReturn } from './portal-card'
import { donorRequestPage, saveDonorRequest } from './portal-preferences'
import { runtimeBindings } from '../../auth.server'
import { operatorMail } from '../../mail.server.mjs'
import { all, email, fail, one, sha256 } from '../db'
import { e } from '../ui/common'
import { type GivingEnv } from './stripe'
import { cancellationPage, confirmationPage, invalidLinkPage, requestedPage, requestPage, subscriptionsPage, type PortalSubscription } from './portal-ui'

const LINK_LIFETIME = 30 * 60_000, SESSION_LIFETIME = 60 * 60_000
const TOKEN = /^[a-f0-9]{64}$/
const routes = new Set(['/giving/portal/saved-card','/giving/portal', '/giving/portal/request', '/giving/portal/confirm', '/giving/portal/card', '/giving/portal/cancel', '/giving/portal/preferences','/giving/portal/history','/giving/portal/document','/giving/portal/copy','/giving/portal/communications','/giving/portal/plan','/giving/portal/card-return','/giving/portal/property'])
type Donor = { id: string; name: string; email: string | null }
type Subscription = PortalSubscription & { customer_id: string; donor_id: string }
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
export async function emailPortalLink(original: GivingEnv, donorId: string, subject = 'Your private giving portal link', dispatch?: { body?: string; authorize?: () => Promise<void> }): Promise<boolean> {
 const env = runtimeBindings(original) as GivingEnv
 const sender = mailSender(env), base = origin(env)
 const donor = await one<Donor>(context(env), "SELECT id,name,email FROM cf_donors WHERE id=? AND erased_at IS NULL AND constituent_status='active'", donorId)
 if (!donor?.email || !await one(context(env),`SELECT 1 WHERE ${uniquePortalEmail}`,donor.email,donor.email)) return false
 const placeholder = '{{private_giving_portal_link}}'
 const template = dispatch?.body ?? `Open your private giving portal to view your gifts and statements, manage recurring giving, or set your communication preferences:\n\n${placeholder}\n\nThis one-use link expires in 30 minutes. If you did not request it, you can ignore this email.`
 if (!template.includes(placeholder)) fail('portal_template', 'The prepared message must include the private giving portal link.', 400)
 const token = randomToken(), hash = await sha256(token)
 const inserted = await env.DB.prepare(`INSERT INTO cf_donor_tokens(token_hash,donor_id,kind,expires_at,used_at,email_hash)
  SELECT ?,id,'link',?,NULL,? FROM cf_donors WHERE id=? AND erased_at IS NULL AND constituent_status='active' AND email=?`)
  .bind(hash, Date.now() + LINK_LIFETIME, await sha256(donor.email), donor.id, donor.email).run()
 if (inserted.meta.changes !== 1) return false
 const link = `${base}/giving/portal/confirm?token=${token}`
 const message = {
  deliveryId: crypto.randomUUID(), from: env.MAIL_FROM!, to: [donor.email], subject,
  text: template.replaceAll(placeholder, link),
  html: `<p>${e(template).replaceAll(placeholder, `<a href="${e(link)}">${e(link)}</a>`).replaceAll('\n', '<br>')}</p>`,
  headers: {},
 }
 const discardUnusedToken = () => env.DB.prepare("DELETE FROM cf_donor_tokens WHERE token_hash=? AND kind='link' AND used_at IS NULL").bind(hash).run()
 // No asynchronous preparation follows this final authority check. A refused
 // dispatch preserves the caller's reason and never reaches the mail provider.
 try { await dispatch?.authorize?.() } catch (error) {
  await discardUnusedToken()
  throw error
 }
 try {
  const result = await sender.send(message)
  if (result.status !== 'accepted') fail('mail_unavailable', 'The sign-in email could not be sent. Try again later.', 503)
  return true
 } catch {
  await discardUnusedToken()
  fail('mail_unavailable', 'The sign-in email could not be sent. Try again later.', 503)
 }
}

export async function portalSession(request: Request, env: GivingEnv) {
 const cookies = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${cookieName(env)}=`))
 if (cookies.length !== 1) return null
 const token = cookies[0].slice(cookieName(env).length + 1)
 if (!TOKEN.test(token)) return null
 const donor = await one<Donor & {sessionHash:string}>(context(env), `SELECT d.id,d.name,d.email,t.token_hash AS sessionHash FROM cf_donor_tokens t JOIN cf_donors d ON d.id=t.donor_id
  WHERE t.token_hash=? AND t.kind='session' AND t.used_at IS NULL AND t.expires_at>? AND d.erased_at IS NULL AND d.constituent_status='active'`, await sha256(token), Date.now())
 if(!donor)return null
 await portalContext(env,donor)
 return donor
}

async function confirm(request: Request, env: GivingEnv, token: string) {
 if (!TOKEN.test(token)) return invalidLinkPage()
 const hash = await sha256(token), now = Date.now()
 if (request.method === 'GET' || request.method === 'HEAD') {
  const valid = await one(context(env), `SELECT t.donor_id FROM cf_donor_tokens t JOIN cf_donors d ON d.id=t.donor_id
   WHERE t.token_hash=? AND t.kind='link' AND t.used_at IS NULL AND t.expires_at>? AND d.erased_at IS NULL AND d.constituent_status='active' AND t.email_hash IS NOT NULL`, hash, now)
  return valid ? confirmationPage(token) : invalidLinkPage()
 }
 const newSession = randomToken(), sessionHash = await sha256(newSession)
 // The batch is one transaction: concurrent confirmation can create only one session.
 const result = await env.DB.batch([
  env.DB.prepare(`INSERT INTO cf_donor_tokens(token_hash,donor_id,kind,expires_at,used_at,email_hash)
   SELECT ?,t.donor_id,'session',?,NULL,t.email_hash FROM cf_donor_tokens t JOIN cf_donors d ON d.id=t.donor_id
   WHERE t.token_hash=? AND t.kind='link' AND t.used_at IS NULL AND t.expires_at>? AND d.erased_at IS NULL AND d.constituent_status='active' AND t.email_hash IS NOT NULL`).bind(sessionHash, now + SESSION_LIFETIME, hash, now),
  env.DB.prepare("UPDATE cf_donor_tokens SET used_at=? WHERE token_hash=? AND kind='link' AND used_at IS NULL AND expires_at>?").bind(now, hash, now),
 ])
 if (result[0].meta.changes !== 1) return invalidLinkPage()
 const secure = new URL(origin(env)).protocol === 'https:' ? '; Secure' : ''
 return redirect('/giving/portal', `${cookieName(env)}=${newSession}; Max-Age=3600; Path=/; HttpOnly; SameSite=Lax${secure}`)
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
 const donor = await portalSession(request, env)
 if (!donor) return read && path === '/giving/portal' ? requestPage() : redirect('/giving/portal')
 if(path==='/giving/portal/saved-card'){
  if(read)return savedCardConsentPage(env,donor,url.searchParams.get('saved')==='1')
  await saveSavedCardConsent(env,donor,await form(request));return redirect('/giving/portal/saved-card?saved=1')
 }
 if (path === '/giving/portal/preferences') {
  if(read)return donorRequestPage(env,donor,url.searchParams.get('saved')==='1')
  await saveDonorRequest(env,donor,await form(request))
  return redirect('/giving/portal/preferences?saved=1')
 }
 if (path === '/giving/portal') {
  if (!read) fail('method_not_allowed', 'Use the portal buttons.', 405)
  return subscriptionsPage(donor.name, await all<Subscription>(context(env), `${planQuery} WHERE s.donor_id=? ORDER BY c.name,s.id`, donor.id), url.searchParams.get('cancelled') === '1',url.searchParams)
 }
 if(path==='/giving/portal/history'&&read)return givingHistory(env,donor,url.searchParams.get('copy')==='submitted')
 if(path==='/giving/portal/property'&&read)return downloadProperty(env,donor,url.searchParams.get('ack')??'')
 if(path==='/giving/portal/document'&&read)return downloadDocument(env,donor,url.searchParams.get('letter')??'',url.searchParams.get('view')==='1')
 if(path==='/giving/portal/copy'&&!read){await requestDocumentCopy(env,donor,await form(request));return redirect('/giving/portal/history?copy=submitted')}
 if(path==='/giving/portal/communications'){
  if(read)return communicationPage(env,donor,url.searchParams.get('saved')==='1')
  const data=await form(request)
  if(data.get('action')==='preferences'){await savePortalCommunicationPreferences(env,donor,data);return redirect('/giving/portal/communications?saved=1')}
  if(data.get('status')==='regrant-request'){await requestEmailRegrant(env,donor,data);return redirect('/giving/portal/communications?requested=1')}
  await withdrawEmail(env,donor,data);return redirect('/giving/portal/communications?saved=1')
 }
 if(path==='/giving/portal/plan'){
  if(read)return managePlanPage(env,donor,url.searchParams.get('subscription')??'')
  return changePlan(env,donor,await form(request))
 }
 if(path==='/giving/portal/card-return'&&read)return paymentMethodReturn(env,donor,url.searchParams.get('request')??'')
 if (path === '/giving/portal/cancel' && read) return cancellationPage((await ownPlan(env, donor, url.searchParams.get('subscription') ?? '')).own as unknown as PortalSubscription)
 if (read) fail('method_not_allowed', 'Use the portal buttons.', 405)
 if(path==='/giving/portal/card')return updatePaymentMethod(env,donor,await form(request))
 if(path==='/giving/portal/cancel')return changePlan(env,donor,await form(request),true)
 fail('not_found','This portal action is unavailable.',404)
}
