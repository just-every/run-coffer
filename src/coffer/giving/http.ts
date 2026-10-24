import { startPledgeCheckout, validatePledgeLink, completePledgeCheckout } from '../pledge-checkout'
import { usd } from '../money'
import { textLink } from './text'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { CofferError, fail } from '../db'
import { e, page } from '../ui/common'
import { campaign } from './campaigns'
import { checkout } from './checkout'
import { trackedAppeal } from './tracked-link'
import { completed, webhook } from './webhooks'
import { portalResponse } from './portal'
import { campaignPage } from './ui'
import { settings } from '../settings'
import { campaignMediaResponse } from './media'

const publicPath = /^\/(give(?:\/|$)|giving(?:\/|$)|api\/coffer\/giving\/webhook$)/
const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' }
export const givingRedirect = (location: string) => new Response(null, { status: 303, headers: { ...headers, location } })
export async function givingBody(request: Request): Promise<string> {
 const reader = request.body?.getReader(); if (!reader) return ''
 const chunks: Uint8Array[] = []; let size = 0
 try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 256000) fail('too_large', 'That request is too large.', 413); chunks.push(value) } } finally { await reader.cancel() }
 const bytes = new Uint8Array(size); let offset = 0
 for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
 return new TextDecoder().decode(bytes)
}
export async function givingResponse(request: Request, original: Bindings): Promise<Response | null> {
 const path = new URL(request.url).pathname
 if (!publicPath.test(path)) return null
 const env = runtimeBindings(original)
 try {
  const url = new URL(request.url)
  if (url.origin !== env.AUTH_ORIGIN || (request.headers.has('host') && request.headers.get('host')?.toLowerCase() !== url.host.toLowerCase())) fail('invalid_host', 'This request was sent to the wrong address.', 403)
  if (path === '/api/coffer/giving/webhook') {
   if (request.method !== 'POST') fail('method_not_allowed', 'Use POST.', 405)
   await webhook(env, request, await givingBody(request))
   return Response.json({ received: true }, { headers })
  }
  if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('origin') !== env.AUTH_ORIGIN) fail('invalid_origin', 'This request did not come from Coffer.', 403)
  if(path==='/giving/pledge/thanks'&&request.method==='GET'){
   const result=await completePledgeCheckout(env,url.searchParams.get('session_id')??'')
   if(!result)fail('not_found','That pledge payment is unavailable.',404)
   return page(result.paid?'Pledge payment recorded':'Payment is still processing',result.paid?'<p>Thank you. Your payment is recorded against your pledge installment.</p>':'<p>Stripe has not confirmed payment. Check again shortly.</p>')
  }
  const pledge=path.match(/^\/giving\/pledge\/([^/]+)$/)
  if(pledge){
   const id=decodeURIComponent(pledge[1]),i=await validatePledgeLink(env,id,url)
   if(request.method==='POST')return givingRedirect(await startPledgeCheckout(env,id,url))
   if(request.method!=='GET')fail('method_not_allowed','Use the payment button.',405)
   const remaining=i.amount_cents-i.paid_cents
   const response=await page('Pledge installment',remaining>0?`<p>${e(usd(remaining))} remains on the installment due ${e(i.due_on)}.</p><form method="post" action="${e(url.pathname+url.search)}"><button>Pay ${e(usd(remaining))} with Stripe</button></form><p>Card details go directly to Stripe.</p>`:'<p>This installment has no unpaid balance. No payment is requested.</p>')
   response.headers.set('referrer-policy','no-referrer');return response
  }
  const portal = await portalResponse(request, env); if (portal) return portal
  const media = path.match(/^\/give\/([a-z0-9-]+)\/media\/(image|video)$/)
  if (media && ['GET', 'HEAD'].includes(request.method)) return await campaignMediaResponse(request, { db: env.DB, env }, media[1], media[2])
  if (path === '/giving/thanks' && request.method === 'GET') {
   const result = await completed(env, url.searchParams.get('session_id') ?? '')
   const response = await page(result.paid ? 'Thank you for your gift' : 'Payment is still processing', result.paid ? `<p>Your ${result.monthly ? 'monthly ' : ''}gift has been recorded. Thank you for your support.</p><p><a href="/giving/portal">Manage my giving</a></p>` : '<p>Stripe has not confirmed payment yet. Please check this page again shortly.</p>')
   response.headers.set('referrer-policy', 'strict-origin'); return response
  }
  const m = path.match(/^\/give\/([a-z0-9-]+)(\/checkout)?$/)
  if (m && !m[2] && ['GET', 'HEAD'].includes(request.method)) { const linkedText=await textLink(env,m[1],url.searchParams.get('text')); return campaignPage(await campaign({ db: env.DB }, m[1]), env, (await settings({ db: env.DB })).organisation, url.searchParams.has('cancelled'), await trackedAppeal({ db: env.DB }, linkedText ? linkedText.appeal : url.searchParams.get('appeal')), linkedText ? { phone: linkedText.phone, token: url.searchParams.get('text')! } : null) }
  if (m?.[2] && request.method === 'POST') {
   if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) fail('form_required', 'Send the donation form.', 415)
   const session = await checkout(env, request, m[1], Object.fromEntries(new URLSearchParams(await givingBody(request))))
   if (typeof session.url !== 'string' || new URL(session.url).hostname !== 'checkout.stripe.com') fail('checkout_unavailable', 'This checkout is no longer available. Reload the donation page.', 409)
   return givingRedirect(session.url)
  }
  fail('not_found', 'That page is not available.', 404)
 } catch (error) {
  const known = error instanceof CofferError, status = known ? error.status : 500, message = known ? error.message : 'This request could not be completed.'
  if (!known) console.error('giving request failed', error)
  if (path.startsWith('/api/')) return Response.json({ error: known ? error.code : 'operation_failed', message }, { status, headers })
  const response = await page('Could not complete that', `<p role="alert">${e(message)}</p><p><a href="/giving/portal">Manage my giving</a></p>`, undefined, status)
  response.headers.set('referrer-policy', 'strict-origin'); return response
 }
}
