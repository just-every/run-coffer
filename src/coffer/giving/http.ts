import { createNativePlan, nativeCreateState, nativePlan, nativePlans, changeNativePlan } from './installments'
import { installmentCreatePage, installmentsPage } from './installments-ui'
import { peerResponse } from '../peer/http'
import { publicPage } from '../peer/service'
import { publicMembershipResponse } from '../memberships/http'
import { fundraisingEvent } from '../fundraising-events'
import { registrationPage } from '../ui/fundraising-events'
import { givingEmbedScript } from './form-embed'
import { givingConnection } from './connections'
import { startPledgeCheckout, validatePledgeLink, completePledgeCheckout } from '../pledge-checkout'
import { usd } from '../money'
import { textLink } from './text'
import { runtimeBindings, type Bindings } from '../../auth.server'
import { CofferError, fail, type Context } from '../db'
import { requireRole, originGuard } from '../auth'
import { staffPlans, staffPlanState, changeStaffPlan } from './staff-plans'
import { createStaffPlan, staffPlanCreateState } from './staff-plan-create'
import { staffPlanCreatePage } from './staff-plan-create-ui'
import { staffPlansPage, staffPlanPage } from './manage-ui'
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
  const membership=await publicMembershipResponse(request,env)
  if(membership)return membership
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
  const registration=path.match(/^\/giving\/events\/([a-z0-9-]+)(\/checkout)?$/)
  if(registration){
   const current=await fundraisingEvent({db:env.DB},registration[1])
   if(request.method==='GET'&&!registration[2]){
    const security=await givingConnection(env,'turnstile'),nonce=crypto.randomUUID().replaceAll('-','')
    const response=await page(current.name,registrationPage(current,security?.siteKey??'',url.searchParams.get('ticketId')??undefined)+`<script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`)
    response.headers.set('content-security-policy',response.headers.get('content-security-policy')!.replace("form-action 'self'","form-action 'self' https://checkout.stripe.com")+`; script-src 'nonce-${nonce}' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com`)
    return response
   }
   if(request.method==='POST'&&registration[2]){
    const formData=new URLSearchParams(await givingBody(request)),data:Record<string,any>=Object.fromEntries(formData),ticket=current.tickets.find(t=>t.id===data.ticketId)
    if(!ticket)fail('INPUT','Choose a ticket type.',400)
    const answers=(prefix:string)=>Object.fromEntries((current.questions??[]).flatMap((q:Record<string,any>)=>{
     const values=formData.getAll(prefix+q.field_key)
     return values.length?[[q.field_key,q.entry==='pick-many'?values:values[0]]]:[]
    }))
    if(ticket.kind&&ticket.kind!=='single')data.guests=Array.from({length:Number(ticket.seats)},(_,i)=>{
     const prefix='guest'+(i+1)
     return {name:data[prefix+'Name'],email:data[prefix+'Email'],dietaryNotes:data[prefix+'DietaryNotes'],buyer:data[prefix+'Buyer']==='yes',answers:answers(prefix+'_answer_')}
    })
    else data.answers=answers('answer_')
    const session=await checkout(env,request,current.campaign_slug,data,{...ticket,appeal_id:current.appeal_id})
    if(typeof session.url!=='string'||new URL(session.url).hostname!=='checkout.stripe.com')fail('checkout_unavailable','The secure checkout is unavailable.',409)
    return givingRedirect(session.url)
   }
   fail('method_not_allowed','Use the registration form.',405)
  }
  const peer = await peerResponse(request, env); if (peer) return peer
  const portal = await portalResponse(request, env); if (portal) return portal
  const media = path.match(/^\/give\/([a-z0-9-]+)\/media\/(image|video)$/)
  if (media && ['GET', 'HEAD'].includes(request.method)) return await campaignMediaResponse(request, { db: env.DB, env }, media[1], media[2])
  if (path === '/giving/thanks' && request.method === 'GET') {
   const result = await completed(env, url.searchParams.get('session_id') ?? '')
   const response = await page(result.bankStatus==='returned'?'Bank payment returned':result.bankStatus==='failed'?'Bank payment failed':result.paid ? 'Thank you for your gift' : 'Payment is still processing', result.bankStatus==='returned'?'<p>The bank returned this payment. Its contribution has been reversed. The organization will review the return; no new debit has been requested.</p>':result.bankStatus==='failed'?'<p>The bank payment failed. No gift or receipt was created. No new debit has been requested.</p>':result.paid ? `<p>Your ${result.recurring ? 'recurring ' : ''}gift has been recorded. Thank you for your support.</p><p><a href="/giving/portal">Manage my giving</a></p>` : result.bankStatus==='processing'?'<p>Your bank payment is pending settlement. No gift or receipt is created until Stripe confirms funds. Please check this page again shortly.</p>':'<p>Stripe has not confirmed payment yet. Please check this page again shortly.</p>')
   response.headers.set('referrer-policy', 'strict-origin'); return response
  }
  const embed = path.match(/^\/give\/([a-z0-9-]+)\/embed\.js$/)
  if(embed && request.method==='GET') return givingEmbedScript(await campaign({db:env.DB},embed[1]))
  const m = path.match(/^\/give\/([a-z0-9-]+)(\/checkout)?$/)
  if (m && !m[2] && ['GET', 'HEAD'].includes(request.method)) { const peerPage=url.searchParams.get('peer')?await publicPage({db:env.DB},url.searchParams.get('peer')!):null; if(peerPage&&peerPage.campaign.slug!==m[1])fail('peer_campaign','Choose a page in this campaign.',409); const linkedText=await textLink(env,m[1],url.searchParams.get('text')); return campaignPage(await campaign({ db: env.DB }, m[1]), env, (await settings({ db: env.DB })).organisation, url.searchParams.has('cancelled'), await trackedAppeal({ db: env.DB }, linkedText ? linkedText.appeal : url.searchParams.get('appeal')), linkedText ? { phone: linkedText.phone, token: url.searchParams.get('text')! } : null, url.searchParams.get('embed')==='1', peerPage?.page ?? null) }
  if (m?.[2] && request.method === 'POST') {
   if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) fail('form_required', 'Send the donation form.', 415)
   const values = new URLSearchParams(await givingBody(request)), input: Record<string, any> = Object.fromEntries(values)
   input.answers = Object.fromEntries([...new Set([...values.keys()].filter(k=>k.startsWith('answer.')))].map(k=>[k.slice(7),values.getAll(k).length>1?values.getAll(k):values.get(k)]))
   for(const key of Object.keys(input))if(key.startsWith('answer.'))delete input[key]
   const session = await checkout(env, request, m[1], input)
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


/** Called after the native staff session has supplied its current authority. */
export async function staffPlanResponse(request:Request,c:Context):Promise<Response|null>{
 const url=new URL(request.url),native=url.pathname.match(/^\/(app|api\/coffer)\/giving\/installments(?:\/([^/]+))?$/)
 if(native){
  requireRole(c.actor,['owner','admin'],'manage native recurring plans');originGuard(request,c.env!)
  const api=native[1]==='api/coffer',id=native[2]?decodeURIComponent(native[2]):undefined
  if(request.method==='GET'){
   const donorId=url.searchParams.get('donorId')??''
   if(id==='new')return api?Response.json(await nativeCreateState(c,donorId),{headers}):page('Prepare monthly plan',await installmentCreatePage(c,donorId),c.actor)
   return api?Response.json(id?await nativePlan(c,id):{plans:await nativePlans(c)},{headers}):page('Native monthly plans',await installmentsPage(c,id),c.actor)
  }
  if(request.method!=='POST')fail('method_not_allowed','Use POST.',405)
  const raw=await givingBody(request)
  let input:Record<string,unknown>
  try{input=api?JSON.parse(raw):Object.fromEntries(new URLSearchParams(raw))}catch{fail('INPUT','Send a plan instruction.',400)}
  if(!input||typeof input!=='object'||Array.isArray(input))fail('INPUT','Send a plan instruction.',400)
  const result=!id||id==='new'?await createNativePlan(c,input):await changeNativePlan(c,id,input)
  return api?Response.json(result,{headers}):givingRedirect('/app/giving/installments/'+encodeURIComponent(result.id))
 }
 const match=url.pathname.match(/^\/(app|api\/coffer)\/giving\/plans(?:\/([^/]+))?$/)
 if(!match)return null
 requireRole(c.actor,['owner','admin'],'manage recurring plans')
 originGuard(request,c.env!)
 const api=match[1]==='api/coffer',id=match[2]?decodeURIComponent(match[2]):null
 if(request.method==='GET'){
  if(id==='new')return api?Response.json(await staffPlanCreateState(c,url.searchParams.get('donorId')??''),{headers}):page('Start recurring plan',await staffPlanCreatePage(c,url.searchParams.get('donorId')),c.actor,200,'/app/giving')
  if(api)return Response.json(id?await staffPlanState(c,id):{plans:await staffPlans(c)},{headers})
  return page(id?'Manage recurring plan':'Recurring plans',id?await staffPlanPage(c,id,url.searchParams.get('saved')==='1'):await staffPlansPage(c),c.actor,200,'/app/giving')
 }
 if(request.method!=='POST'||(!id&&!api))fail('method_not_allowed','Use a recurring plan change form.',405)
 const type=request.headers.get('content-type')??''
 if(api&&!type.startsWith('application/json')||!api&&!type.startsWith('application/x-www-form-urlencoded'))fail('form_required','Use the plan change form or JSON transport.',415)
 const body=await givingBody(request)
 let input:Record<string,unknown>
 if(api){try{input=JSON.parse(body)}catch{fail('INPUT','Send a JSON object.',400)}if(!input||typeof input!=='object'||Array.isArray(input))fail('INPUT','Send a JSON object.',400)}
 else input=Object.fromEntries(new URLSearchParams(body))
 const result=await (!id||id==='new'?createStaffPlan(c,input):changeStaffPlan(c,id,input))
 return api?Response.json(result,{headers}):givingRedirect('/app/giving/plans/'+encodeURIComponent(result.id)+'?saved=1')
}
