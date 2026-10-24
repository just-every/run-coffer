import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {run,donor} from './harness.mjs'
import {fixedNow} from './fixed-clock.mjs'

const webhookSecret='synthetic-coffer-3001'
const form=(values,as='')=>({method:'POST',as,headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(values).toString()})
const cookie=response=>response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')

// Only Stripe and mail are faked. Payment state, donor matching, ledger entries,
// campaign totals and portal authorization all run through the real HTTP handlers.
function stripeEdge() {
 const state={attempt:1,status:'past_due',cancelled:false,intent:null}
 const subscription=()=>({id:'sub_monthly',customer:'cus_monthly',metadata:{coffer_intent:state.intent},status:state.status,cancel_at_period_end:state.cancelled,items:{data:[{id:'si_monthly',quantity:1,price:{id:'price_monthly',unit_amount:2500,currency:'usd',product:'prod_reading',recurring:{interval:'month',interval_count:1}}}]},latest_invoice:'in_monthly'})
 const invoice=()=>({id:'in_monthly',customer:'cus_monthly',currency:'usd',parent:{type:'subscription_details',subscription_details:{subscription:'sub_monthly'}},status:state.status==='active'?'paid':'open',amount_paid:state.status==='active'?2500:0,attempt_count:state.attempt,next_payment_attempt:state.status==='active'?null:Math.floor(Date.now()/1000)+86400,status_transitions:{paid_at:state.status==='active'?Math.floor(Date.now()/1000):null}})
 const outbound=async request=>{
  const url=new URL(request.url)
  assert.equal(url.hostname,'api.stripe.com')
  const params=new URLSearchParams(await request.text())
  if(url.pathname==='/v1/customers'&&request.method==='POST')return Response.json({id:'cus_monthly'})
  if(url.pathname==='/v1/customers/cus_monthly'&&request.method==='GET')return Response.json({id:'cus_monthly',invoice_settings:{default_payment_method:'pm_current'}})
  if(url.pathname==='/v1/checkout/sessions'&&request.method==='POST') {
   assert.equal(params.get('mode'),'subscription')
   assert.equal(params.get('line_items[0][price_data][unit_amount]'),'2500')
   assert.equal(params.get('line_items[0][price_data][recurring][interval]'),'month')
   state.intent=params.get('subscription_data[metadata][coffer_intent]')
   assert.ok(state.intent)
   assert.equal(state.intent,params.get('metadata[coffer_intent]'))
   return Response.json({id:'cs_monthly',url:'https://checkout.stripe.com/c/pay/cs_monthly'})
  }
  if(url.pathname==='/v1/subscriptions/sub_monthly') {
   if(request.method==='POST') {
    assert.equal(params.get('cancel_at_period_end'),'true')
    state.cancelled=true
   }
   return Response.json(subscription())
  }
  if(url.pathname==='/v1/invoices/in_monthly'&&request.method==='GET')return Response.json(invoice())
  if(url.pathname==='/v1/billing_portal/configurations'&&request.method==='POST') {
   assert.equal(params.get('features[payment_method_update][enabled]'),'true')
   for(const feature of ['customer_update','invoice_history','subscription_cancel','subscription_update'])assert.equal(params.get(`features[${feature}][enabled]`),'false')
   assert.equal(params.get('login_page[enabled]'),'false')
   return Response.json({id:'bpc_card_only'})
  }
  if(url.pathname==='/v1/billing_portal/configurations/bpc_card_only'&&request.method==='GET')return Response.json({id:'bpc_card_only',active:true,features:{payment_method_update:{enabled:true},customer_update:{enabled:false},invoice_history:{enabled:false},subscription_cancel:{enabled:false},subscription_update:{enabled:false}},login_page:{enabled:false}})
  if(url.pathname==='/v1/billing_portal/sessions'&&request.method==='POST') {
   assert.equal(params.get('customer'),'cus_monthly')
   assert.equal(params.get('configuration'),'bpc_card_only')
   assert.equal(params.get('flow_data[type]'),'payment_method_update')
   return Response.json({url:'https://billing.stripe.com/p/session/card-update'})
  }
  assert.fail(`Unexpected Stripe request: ${request.method} ${url.pathname}`)
 }
 return {state,outbound}
}

async function deliver(h,id,type,{invalid=false}={}) {
 const raw=JSON.stringify({id,type,data:{object:{id:'in_monthly'}}}),timestamp=Math.floor(Date.now()/1000)
 const signature=createHmac('sha256',invalid?'wrong-signing-secret':webhookSecret).update(`${timestamp}.${raw}`).digest('hex')
 // Stripe has no browser Origin or operator session.
 return h.mf.dispatchFetch(h.origin+'/api/coffer/giving/webhook',{method:'POST',headers:{host:new URL(h.origin).host,'content-type':'application/json','stripe-signature':`t=${timestamp},v1=${signature}`},body:raw})
}

test('CAMP-001: recurring campaign progress; a failed monthly donation recovers on its second retry without duplicate gifts, with a private card and cancellation portal',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse(fixedNow)})
 const edge=stripeEdge()
 await run(async h=>{
  const known=await donor(h,'Ana Diaz')
  const campaign=await h.api('/api/coffer/giving/campaigns',{name:'Keep reading',slug:'keep-reading',description:'Monthly support for local readers.',fund:'Reading',goal:'60000.00'})
  const summary=async()=>{
   const {campaigns}=await h.get('/api/coffer/giving/campaigns')
   return campaigns.find(value=>value.id===campaign.id)
  }
  const history=()=>h.get(`/api/coffer/donors/${known.id}`)
  const page=await h.request('/give/keep-reading',{as:''})
  assert.equal(page.status,200)
  const donation=await page.text()
  assert.match(donation,/action="\/give\/keep-reading\/checkout"/)
  assert.match(donation,/name="emailConsent"/,'The giving page asks for appeal consent separately from the receipt')
  const checkout=await h.request('/give/keep-reading/checkout',form({name:'Ana Diaz',email:'ana.diaz@example.org',amount:'25.00',frequency:'monthly','cf-turnstile-response':'synthetic-coffer-security-token',emailConsent:'yes',requestId:randomUUID()}))
  assert.equal(checkout.status,303,await checkout.text())
  assert.equal(new URL(checkout.headers.get('location')).hostname,'checkout.stripe.com')
  assert.equal((await history()).gifts.length,0)

  const invalid=await deliver(h,'evt_initial_failure','invoice.payment_failed',{invalid:true})
  assert.equal(invalid.status,400,await invalid.text())
  assert.equal((await history()).gifts.length,0)
  assert.equal(h.messages.length,0)
  for(const attempt of [1,2]) {
   edge.state.attempt=attempt
   const response=await deliver(h,`evt_failure_${attempt}`,'invoice.payment_failed')
   assert.equal(response.status,200,await response.text())
   const current=await history()
   assert.equal(current.donor.id,known.id)
   assert.equal(current.gifts.length,0,'Failed charges never enter the gift ledger')
   assert.equal(current.totals.lifetimeCents,0)
   assert.equal(current.subscriptions.length,1)
   assert.equal(current.subscriptions[0].failed_attempts,attempt)
   assert.equal(current.subscriptions[0].status,'past_due')
   assert.equal(current.subscriptions[0].recovered,0)
   const progress=await summary()
   assert.equal(progress.raised_cents,0)
   assert.equal(progress.gift_count,0)
   assert.equal(progress.recurring_donors,1)
  }
  const stopped=(await h.get('/api/coffer/lapses')).rows.find(r=>r.sourceId==='sub_monthly')
  assert.equal(stopped.donorId,known.id)
  assert.equal(stopped.lastGift,null)
  assert.equal(stopped.amountCents,30000)
  assert.equal((await h.get('/api/coffer/donors')).total,1,'Checkout matches the donor already using this email')
  const updateMail=h.messages.findLast(message=>message.to.includes('ana.diaz@example.org'))
  assert.ok(updateMail,'A failed charge sends the donor a private card update link')
  const match=updateMail.text.match(/https?:\/\/[^\s<>]+\/giving\/portal\/confirm\?token=[a-f0-9]+/)
  assert.ok(match)
  const link=new URL(match[0]),token=link.searchParams.get('token')
  assert.equal(link.origin,h.origin)
  const confirmPage=await h.request(link.pathname+link.search,{as:''})
  assert.equal(confirmPage.status,200)
  const confirmed=await h.request('/giving/portal/confirm',form({token}))
  assert.equal(confirmed.status,303)
  const donorCookie=cookie(confirmed)
  assert.ok(donorCookie)
  const portal=await h.request('/giving/portal',{as:donorCookie})
  assert.equal(portal.status,200)
  assert.match(await portal.text(),/name="subscription" value="sub_monthly"/)
  const updateCard=await h.request('/giving/portal/card',form({subscription:'sub_monthly'},donorCookie))
  assert.equal(updateCard.status,303,await updateCard.text())
  assert.equal(new URL(updateCard.headers.get('location')).hostname,'billing.stripe.com')

  edge.state.attempt=3
  edge.state.status='active'
  const paid=await deliver(h,'evt_retry_paid','invoice.paid')
  assert.equal(paid.status,200,await paid.text())
  const recovered=await history()
  assert.equal(recovered.gifts.length,1)
  assert.deepEqual(recovered.consents.map(x=>[x.channel,x.status,x.recorded_by]),[['email','granted','Giving page']],'The ticked appeal box becomes consent evidence once the gift is paid')
  assert.equal(recovered.gifts[0].amount_cents,2500)
  assert.equal(recovered.gifts[0].reference,'in_monthly')
  assert.equal(recovered.gifts[0].fund,'Reading')
  assert.equal(recovered.totals.lifetimeCents,2500)
  assert.equal(recovered.subscriptions[0].status,'active')
  assert.equal(recovered.summary.recurring[0].status,'active')
  assert.equal(recovered.summary.recurring[0].amountCents,2500)
  assert.equal(recovered.subscriptions[0].recovered,1)
  assert.equal(recovered.subscriptions[0].next_attempt_at,null)
  assert.equal((await h.get('/api/coffer/lapses')).rows.some(r=>r.sourceId==='sub_monthly'),false)
  // Status still diagnoses a stopped plan after its linked paid history exists.
  edge.state.status='canceled'
  const stoppedAgain=await deliver(h,'evt_stopped_plan','invoice.updated')
  assert.equal(stoppedAgain.status,200,await stoppedAgain.text())
  const linked=(await h.get('/api/coffer/lapses')).rows.find(r=>r.sourceId==='sub_monthly')
  assert.equal(linked.lastGift,recovered.gifts[0].received_on)
  edge.state.status='active'
  const activeAgain=await deliver(h,'evt_active_plan','invoice.paid')
  assert.equal(activeAgain.status,200,await activeAgain.text())
  const donorPage=await h.request(`/app/donors/${known.id}`)
  assert.equal(donorPage.status,200)
  const progress=await summary()
  assert.equal(progress.raised_cents,2500)
  assert.equal(progress.gift_count,1)
  assert.equal(progress.recurring_donors,1)
  const campaignReport=await h.get('/api/coffer/giving/campaigns/'+campaign.id)
  assert.deepEqual([campaignReport.raisedCents,campaignReport.recurringDonors,campaignReport.donorCount],[2500,1,1])
  const publicProgress=await h.request('/give/keep-reading',{as:''})
  assert.equal(publicProgress.status,200)
  assert.match(await publicProgress.text(),/\$25\.00/)

  const messagesBeforeReplay=h.messages.length
  for(const [id,type] of [['evt_retry_paid','invoice.paid'],['evt_failure_2','invoice.payment_failed'],['evt_payment_succeeded','invoice.payment_succeeded']]) {
   const replay=await deliver(h,id,type)
   assert.equal(replay.status,200,await replay.text())
  }
  assert.equal((await history()).gifts.length,1)
  assert.equal((await history()).subscriptions[0].recovered,1)
  assert.equal((await summary()).raised_cents,2500)
  assert.equal(h.messages.length,messagesBeforeReplay)

  // DONOR-015: the authenticated donor can request a stronger restriction,
  // never clear one or grant consent, and cannot name somebody else's record.
  const preferences=await h.request('/giving/portal/preferences',{as:donorCookie});assert.equal(preferences.status,200)
  assert.equal((await h.request('/giving/portal/preferences',{as:''})).status,303)
  const other=await donor(h,'Synthetic Portal Other',{email:'synthetic-coffer-1201@example.test'})
  const askPrefs=(values,extra={})=>h.request('/giving/portal/preferences',{...form(values,donorCookie),...extra})
  assert.equal((await askPrefs({version:'0',type:'stop',confirm:'yes',donorId:other.id})).status,403)
  const consentBefore=(await history()).consents
  const channelRequest=await askPrefs({version:'0',type:'channels',channels:'mail',confirm:'yes'});assert.equal(channelRequest.status,303,await channelRequest.text())
  assert.deepEqual((await history()).solicitation.channels,['mail'])
  assert.equal((await askPrefs({version:'1',type:'none',confirm:'yes'})).status,400)
  assert.equal((await askPrefs({version:'1',type:'channels',channels:'email',confirm:'yes'})).status,409,'The portal cannot remove an existing restricted channel')
  // Staff may replace a restriction; the donor may then only tighten its limit.
  await h.command('solicitation.set',{donorId:known.id,version:1,type:'limit',maxAsks:3,period:'rolling-12-months',startsOn:'2025-01-01'})
  assert.equal((await askPrefs({version:'2',type:'limit',maxAsks:'4',period:'rolling-12-months',confirm:'yes'})).status,409)
  assert.equal((await askPrefs({version:'2',type:'limit',maxAsks:'1',period:'calendar-year',confirm:'yes'})).status,409)
  assert.equal((await askPrefs({version:'2',type:'limit',maxAsks:'1',period:'rolling-12-months',confirm:'yes'})).status,303)
  assert.equal((await history()).solicitation.max_asks,1)
  assert.equal((await history()).solicitation.starts_on,'2025-01-01','Strengthening retains the earlier restriction start')
  const savedRequest=await askPrefs({version:'3',type:'stop',confirm:'yes'});assert.equal(savedRequest.status,303,await savedRequest.text())
  const restricted=await history()
  assert.equal(restricted.solicitation.type,'stop');assert.equal(restricted.solicitation.source,'portal')
  assert.equal(restricted.solicitation.recorded_by_id,'donor:'+known.id)
  assert.ok(restricted.events.some(e=>e.action==='solicitation.set'&&e.actor_role==='donor'))
  assert.deepEqual(restricted.consents,consentBefore,'A donor request does not grant or withdraw channel permission')
  assert.equal((await askPrefs({version:'0',type:'stop',confirm:'yes'})).status,409,'A stale form cannot replace a later decision')
  assert.equal((await askPrefs({version:'4',type:'none',confirm:'yes'})).status,400,'The portal cannot resume asks or clear a staff restriction')
  assert.equal((await history()).solicitation.type,'stop');assert.equal((await h.get('/api/coffer/donors/'+other.id)).solicitation.type,'none')
  const noAsk=await h.command('appeal.prepare',{name:'Synthetic portal request exclusion',channel:'email'},{status:409});assert.equal(noAsk.details['do not solicit'],1)
  const stillCard=await h.request('/giving/portal/card',form({subscription:'sub_monthly'},donorCookie));assert.equal(stillCard.status,303)
  if(process.env.COFFER_PORTAL_RESTRICTION_BROWSER){
   const {mkdir}=await import('node:fs/promises');await mkdir(process.env.COFFER_PORTAL_RESTRICTION_BROWSER,{recursive:true})
   const {withBrowserWorker}=await import('./browser-worker.mjs')
   await withBrowserWorker(h,async(context,origin)=>{
    await context.clearCookies();await context.addCookies(donorCookie.split('; ').map(v=>{const at=v.indexOf('=');return {name:v.slice(0,at),value:v.slice(at+1),domain:'127.0.0.1',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}}))
    const page=await context.newPage()
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:1000});await page.goto(origin+'/giving/portal');await page.getByRole('link',{name:'Manage donation requests'}).click()
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${process.env.COFFER_PORTAL_RESTRICTION_BROWSER}/DONOR-015-portal-${width}.png`,fullPage:true})
     await page.getByRole('checkbox',{name:'Do not ask me for donations.'}).check();await page.getByRole('button',{name:'Save do not solicit'}).click();await page.waitForURL('**/giving/portal/preferences?saved=1')
     assert.ok(await page.getByRole('status').count());await page.screenshot({path:`${process.env.COFFER_PORTAL_RESTRICTION_BROWSER}/DONOR-015-portal-saved-${width}.png`,fullPage:true})
    }
   })
  }

  const cancellation=await h.request('/giving/portal/cancel?subscription=sub_monthly',{as:donorCookie})
  assert.equal(cancellation.status,200)
  const cancelled=await h.request('/giving/portal/cancel',form({subscription:'sub_monthly',confirm:'yes'},donorCookie))
  assert.equal(cancelled.status,303,await cancelled.text())
  assert.equal(edge.state.cancelled,true)
  assert.equal((await history()).subscriptions[0].cancel_at_period_end,1)
  assert.equal((await history()).gifts.length,1,'Cancellation preserves the recovered gift')
  assert.equal((await summary()).recurring_donors,0)
  const contact=(await history()).donor
  await h.command('donor.update',{donorId:known.id,version:contact.version,name:contact.name,email:contact.email,phone:contact.phone,addressLine1:contact.address_line1,addressLine2:contact.address_line2,city:contact.city,region:contact.region,postalCode:contact.postal_code,country:contact.country,household:'Synthetic portal household'})
  await donor(h,'Synthetic Portal Spouse',{email:contact.email,household:'Synthetic portal household'})
  assert.equal((await h.request('/giving/portal/preferences',{as:donorCookie})).status,403,'A shared email does not authenticate one donor for preference writes')
  await h.command('donor.erase',{donorId:known.id,confirm:'ERASE'})
  assert.equal((await h.request('/giving/portal/preferences',{as:donorCookie})).status,303)
  const expiredPortal=await h.request('/giving/portal',{as:donorCookie})
  assert.equal(expiredPortal.status,200)
  assert.doesNotMatch(await expiredPortal.text(),/name="subscription" value="sub_monthly"/)
  assert.equal((await summary()).raised_cents,2500,'Erasure keeps anonymous financial history')
 },{entry:'tests/fixed-clock-worker.ts',bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-3002',STRIPE_WEBHOOK_SECRET:webhookSecret},outbound:edge.outbound})
})

test('REPORT-006: monthly health preserves starts, amount changes, failed payments, recoveries and cancellations across the clock',async()=>{
 const {recurringHealthJourney}=await import('./recurring-health-journey.mjs')
 await recurringHealthJourney()
})


test('GIFT-011: checkout publication choices, donor and gift anonymity, honor rolls and custody',async()=>{const {recognitionJourney}=await import('./recognition-journey.mjs');await recognitionJourney()})

 test('CAMP-001 / GIVE-002 / PAY-004: dated campaigns reconcile gifts and custody; public media pages close new giving and count donors',async()=>{const {campaignProgressJourney}=await import('./campaign-progress-journey.mjs');await campaignProgressJourney();const {campaignPageJourney}=await import('./campaign-page-journey.mjs');await campaignPageJourney();const {feeCoverJourney}=await import('./fee-cover-journey.mjs');await feeCoverJourney()})


test('GIVE-005: donor-only documents, plan self-service, verified card replacement, preferences and owned cancellation follow-up',async()=>{const {portalJourney}=await import('./portal-journey.mjs');await portalJourney()})
test('GIVE-008: signed keyword links prefill the mobile form, attribute paid gifts and honor STOP without marketing grants',async()=>{
 const {textGivingJourney}=await import('./text-giving-journey.mjs');await textGivingJourney()
})

test('GIVE-007: address bursts pause giving, alert administrators and count verified Radar failures without donor records',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse(fixedNow)})
 const {givingProtectionJourney}=await import('./giving-protection-journey.mjs');await givingProtectionJourney()
})
