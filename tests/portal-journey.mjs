import assert from 'node:assert/strict'
import {createHmac,randomUUID,generateKeyPairSync,sign} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {run,donor,reviewed} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

export const portalForm=(values,as='')=>({method:'POST',as,headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(values).toString()})
const value=(html,name)=>html.match(new RegExp(`name="${name}" value="([^"]*)"`))?.[1]
const plain=m=>m.text??m.content.find(c=>c.type==='text/plain').value
const recipient=m=>m.to?.[0]??m.personalizations?.[0].to[0].email
export const portalCookie=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')

/** Only Stripe and SendGrid network edges are faked; all application state
 * comes from native public checkout, webhook, command and donor-session doors. */
export function portalTestEdge(){
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'})
 const state={intent:null,amount:2500,interval:'month',intervalCount:1,status:'active',paused:false,cancelled:false,method:'synthetic-coffer-2001',hostedReturn:null,mutations:[],messages:[]}
 const subscription=()=>({id:'sub_portal',customer:'cus_portal',metadata:{coffer_intent:state.intent},status:state.status,cancel_at_period_end:state.cancelled,default_payment_method:null,pause_collection:state.paused?{behavior:'void'}:null,items:{data:[{id:'si_portal',quantity:1,price:{id:'price_portal',product:'prod_portal',unit_amount:state.amount,currency:'usd',recurring:{interval:state.interval,interval_count:state.intervalCount,usage_type:'licensed'}}}]},latest_invoice:'in_portal',created:Math.floor(Date.parse('2025-01-12T12:00:00Z')/1000)})
 const outbound=async request=>{
  const url=new URL(request.url)
  if(url.hostname==='api.sendgrid.com'){
   assert.equal(url.pathname,'/v3/mail/send');state.messages.push(await request.json())
   return new Response(null,{status:202,headers:{'x-message-id':'synthetic-coffer-'+(2100+state.messages.length)}})
  }
  assert.equal(url.hostname,'api.stripe.com')
  const p=new URLSearchParams(await request.text())
  if(url.pathname==='/v1/customers'&&request.method==='POST')return Response.json({id:'cus_portal'})
  if(url.pathname==='/v1/checkout/sessions'){
   state.intent=p.get('subscription_data[metadata][coffer_intent]');assert.ok(state.intent)
   return Response.json({id:'cs_portal',url:'https://checkout.stripe.com/c/pay/cs_portal'})
  }
  if(url.pathname==='/v1/subscriptions/sub_portal'){
   if(request.method==='POST'){
    assert.ok(request.headers.get('idempotency-key'),'Every donor mutation has a stable provider key')
    state.mutations.push({key:request.headers.get('idempotency-key'),params:Object.fromEntries(p)})
    if(p.has('cancel_at_period_end'))state.cancelled=p.get('cancel_at_period_end')==='true'
    if(p.has('pause_collection[behavior]')){assert.equal(p.get('pause_collection[behavior]'),'void');state.paused=true}
    if(p.has('pause_collection')){assert.equal(p.get('pause_collection'),'');state.paused=false}
    if(p.has('items[0][price_data][unit_amount]')){
     assert.equal(p.get('items[0][id]'),'si_portal');assert.equal(p.get('items[0][price_data][product]'),'prod_portal')
     assert.equal(p.get('proration_behavior'),'none');assert.equal(p.get('payment_behavior'),'error_if_incomplete')
     state.amount=Number(p.get('items[0][price_data][unit_amount]'));state.interval=p.get('items[0][price_data][recurring][interval]');state.intervalCount=Number(p.get('items[0][price_data][recurring][interval_count]'))
    }
   }
   return Response.json(subscription())
  }
  if(url.pathname==='/v1/customers/cus_portal')return Response.json({id:'cus_portal',invoice_settings:{default_payment_method:state.method}})
  if(url.pathname==='/v1/invoices/in_portal')return Response.json({id:'in_portal',customer:'cus_portal',currency:'usd',parent:{type:'subscription_details',subscription_details:{subscription:'sub_portal'}},status:'paid',amount_paid:2500,attempt_count:1,next_payment_attempt:null,status_transitions:{paid_at:Math.floor(Date.parse('2025-02-12T12:00:00Z')/1000)}})
  if(url.pathname==='/v1/billing_portal/configurations'){
   for(const name of ['customer_update','invoice_history','subscription_cancel','subscription_update'])assert.equal(p.get(`features[${name}][enabled]`),'false')
   assert.equal(p.get('features[payment_method_update][enabled]'),'true')
   return Response.json({id:'bpc_portal'})
  }
  if(url.pathname==='/v1/billing_portal/configurations/bpc_portal')return Response.json({id:'bpc_portal',active:true,features:{payment_method_update:{enabled:true},customer_update:{enabled:false},invoice_history:{enabled:false},subscription_cancel:{enabled:false},subscription_update:{enabled:false}},login_page:{enabled:false}})
  if(url.pathname==='/v1/billing_portal/sessions'){
   assert.equal(p.get('customer'),'cus_portal');assert.equal(p.get('flow_data[type]'),'payment_method_update')
   state.hostedReturn=p.get('flow_data[after_completion][redirect][return_url]')
   return Response.json({url:'https://billing.stripe.com/p/session/synthetic-coffer-2002'})
  }
  assert.fail('Unexpected provider request '+request.method+' '+url.pathname)
 }
 return {state,keys,options:{bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-2003',STRIPE_WEBHOOK_SECRET:'synthetic-coffer-2004',MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:'synthetic-coffer-2005',MAIL_EVENT_PUBLIC_KEY:keys.publicKey.export({type:'spki',format:'der'}).toString('base64')},outbound}}
}
export async function portalCopyEvent(h,edge,letterId,attempt,event,eventId){
 const timestamp=String(Math.floor(Date.now()/1000)),raw=JSON.stringify([{event,sg_event_id:eventId,timestamp:Number(timestamp),coffer_letter_id:letterId,coffer_attempt_id:attempt}])
 return h.request('/api/coffer/mail/events',{method:'POST',as:'',raw,headers:{'x-twilio-email-event-webhook-timestamp':timestamp,'x-twilio-email-event-webhook-signature':sign('sha256',Buffer.from(timestamp+raw),edge.keys.privateKey).toString('base64')}})
}
export async function signInPortal(h,email,messages=h.messages){
 const start=await h.request('/giving/portal/request',portalForm({email}));assert.equal(start.status,200,await start.text())
 const message=messages.findLast(m=>recipient(m)===email&&plain(m).includes('/giving/portal/confirm'));assert.ok(message,'Private link reached the real mail boundary')
 const link=new URL(plain(message).match(/https?:\/\/[^\s<>]+\/giving\/portal\/confirm\?token=[^\s<>]+/)[0])
 const view=await h.request(link.pathname+link.search,{as:''});assert.equal(view.status,200)
 const confirmed=await h.request('/giving/portal/confirm',portalForm({token:link.searchParams.get('token')}));assert.equal(confirmed.status,303,await confirmed.text())
 assert.equal((await h.request('/giving/portal/confirm',portalForm({token:link.searchParams.get('token')}))).status,400,'Sign-in links are one use')
 return {cookie:portalCookie(confirmed),link}
}
export async function paidPortalPlan(h,edge){
 const person=await donor(h,'Synthetic Portal Donor',{email:'synthetic-coffer-2006@example.test'})
 await h.api('/api/coffer/giving/campaigns',{name:'Synthetic portal reading',slug:'portal-reading',description:'Local readers',fund:'Reading',goal:'10000'})
 const response=await h.request('/give/portal-reading/checkout',portalForm({name:'Synthetic Portal Donor',email:'synthetic-coffer-2006@example.test',amount:'25',frequency:'monthly',emailConsent:'yes',requestId:randomUUID()}));assert.equal(response.status,303,await response.text())
 const timestamp=Math.floor(Date.now()/1000),raw=JSON.stringify({id:'evt_portal_paid',type:'invoice.paid',data:{object:{id:'in_portal'}}}),signature=createHmac('sha256','synthetic-coffer-2004').update(`${timestamp}.${raw}`).digest('hex')
 const delivered=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw,headers:{'stripe-signature':`t=${timestamp},v1=${signature}`}});assert.equal(delivered.status,200,await delivered.text())
 const history=await h.get('/api/coffer/donors/'+person.id)
 assert.equal(history.gifts.length,1);assert.equal(history.gifts[0].amount_cents,2500)
 return person
}
export async function portalJourney(){
 const edge=portalTestEdge()
 await run(async h=>{
  await reviewed(h)
  const person=await paidPortalPlan(h,edge),other=await donor(h,'Synthetic Portal Stranger',{email:'synthetic-coffer-2007@example.test'})
  const extra=await h.command('gift.record',{donorId:person.id,amount:'100',receivedOn:'2025-12-01',method:'check',goods:'none',fund:'Library'})
  const stranger=await h.command('gift.record',{donorId:other.id,amount:'999',receivedOn:'2025-06-01',method:'check',goods:'none'})
  const property=await h.command('inKind.save',{donorId:person.id,description:'Synthetic donated laptop',quantity:'1',statedValue:'900',receivedOn:'2025-07-01',goods:'none'})
  const propertyAck=await h.command('inKind.acknowledge',{donorId:person.id,inKindId:property.id,version:property.version,acknowledgedOn:'2025-07-02'})
  const otherProperty=await h.command('inKind.save',{donorId:other.id,description:'Private stranger property',quantity:'1',statedValue:'700',receivedOn:'2025-07-01',goods:'none'})
  const otherPropertyAck=await h.command('inKind.acknowledge',{donorId:other.id,inKindId:otherProperty.id,version:otherProperty.version,acknowledgedOn:'2025-07-02'})
  const annual=await h.command('ack.prepareStatements',{year:2025,donorId:person.id}),unapproved=await h.get('/api/coffer/letters/'+annual.id)
  const login=await signInPortal(h,'synthetic-coffer-2006@example.test',edge.state.messages),as=login.cookie
  const get=path=>h.request(path,{as})
  assert.equal((await get('/giving/portal/document?letter='+unapproved.letters[0].id)).status,404,'Prepared documents stay private until human approval')
  await h.command('ack.approve',{batchId:annual.id,version:1})
  await h.command('ack.send',{batchId:annual.id,version:2})
  const ownLetter=(await h.get('/api/coffer/letters/'+annual.id)).letters[0]
  const history=await get('/giving/portal/history'),html=await history.text()
  assert.equal(history.status,200);assert.match(html,/Synthetic donated laptop/);assert.doesNotMatch(html,/Private stranger property/)
  const propertyCopy=await get('/giving/portal/property?ack='+propertyAck.acknowledgmentId);assert.equal(propertyCopy.status,200);const propertyText=await propertyCopy.text();assert.match(propertyText,/Synthetic donated laptop/);assert.doesNotMatch(propertyText,/900\.00/)
  assert.equal((await get('/giving/portal/property?ack='+otherPropertyAck.acknowledgmentId)).status,404)
  assert.match(html,/\$25\.00/);assert.match(html,/\$100\.00/);assert.doesNotMatch(html,/\$999\.00|Synthetic Portal Stranger/)
  const document=await get('/giving/portal/document?letter='+ownLetter.id);assert.equal(document.status,200);assert.match(document.headers.get('content-disposition'),/attachment/);assert.match(await document.text(),/Total gifts: \$125\.00/)
  const otherBatch=await h.command('ack.prepareStatements',{year:2025,donorId:other.id});await h.command('ack.approve',{batchId:otherBatch.id,version:1})
  const otherLetter=(await h.get('/api/coffer/letters/'+otherBatch.id)).letters[0]
  assert.equal((await get('/giving/portal/document?letter='+otherLetter.id)).status,404)
  assert.equal((await h.request('/giving/portal/document?letter='+ownLetter.id,{as:''})).status,303)
  assert.equal((await h.request('/giving/portal/plan?subscription=sub_stranger',{as})).status,404)
  assert.equal((await h.request('/giving/portal/card',portalForm({subscription:'sub_stranger'},as))).status,404)
  const copy={letter:ownLetter.id,requestId:randomUUID()},before=edge.state.messages.length
  assert.equal((await h.request('/giving/portal/copy',portalForm(copy,as))).status,303)
  assert.equal((await h.request('/giving/portal/copy',portalForm(copy,as))).status,303)
  assert.equal(edge.state.messages.length,before+1,'A donor copy request hands the approved snapshot to the provider once')
  assert.match(plain(edge.state.messages.at(-1)),/Total gifts: \$125\.00/)
  assert.equal((await portalCopyEvent(h,edge,ownLetter.id,'synthetic-coffer-unknown-attempt','delivered','synthetic-coffer-2501')).status,200)
  assert.ok(!(await (await get('/giving/portal/history')).text()).includes('Requested copy delivered.'))
  for(let replay=0;replay<2;replay++)assert.equal((await portalCopyEvent(h,edge,ownLetter.id,copy.requestId,'delivered','synthetic-coffer-2502')).status,200)
  assert.match(await (await get('/giving/portal/history')).text(),/Requested copy delivered\./)
  const copyTimeline=(await h.get('/api/coffer/donors/'+person.id)).timelineSources.filter(t=>t.title==='Requested giving document copy delivered');assert.equal(copyTimeline.length,1,'Signed copy delivery and replay preserve one provider timeline fact')
  assert.equal((await h.get('/api/coffer/letters/'+annual.id)).letters.find(l=>l.id===ownLetter.id).delivery_status,'submitted','Delivery of a requested copy never overwrites the original attempt’s result')
  assert.equal((await h.request('/giving/portal/copy',portalForm({...copy,requestId:randomUUID(),letter:otherLetter.id},as))).status,404)
  const manage=async()=>{const r=await get('/giving/portal/plan?subscription=sub_portal');assert.equal(r.status,200,await r.clone().text());return r.text()}
  let planHtml=await manage(),change={subscription:'sub_portal',requestId:randomUUID(),version:value(planHtml,'version'),action:'change',amount:'15',frequency:'monthly',confirm:'yes'}
  assert.equal((await h.request('/giving/portal/plan',portalForm({...change,donorId:other.id},as))).status,403)
  assert.equal((await h.request('/giving/portal/plan',{...portalForm(change,as),headers:{'content-type':'application/x-www-form-urlencoded',origin:'https://wrong.example.test'}})).status,403)
  const consentBefore=(await h.get('/api/coffer/donors/'+person.id)).consents
  assert.equal((await h.request('/giving/portal/plan',portalForm(change,as))).status,303)
  assert.equal(edge.state.amount,1500)
  const count=edge.state.mutations.length
  assert.equal((await h.request('/giving/portal/plan',portalForm(change,as))).status,303);assert.equal(edge.state.mutations.length,count)
  assert.equal((await h.request('/giving/portal/plan',portalForm({...change,requestId:randomUUID(),amount:'10'},as))).status,409,'Stale provider-state forms cannot overwrite a later amount')
  assert.deepEqual((await h.get('/api/coffer/donors/'+person.id)).consents,consentBefore,'Financial changes never grant or withdraw communication consent')
  planHtml=await manage();change={...change,requestId:randomUUID(),version:value(planHtml,'version'),frequency:'quarterly'}
  assert.equal((await h.request('/giving/portal/plan',portalForm(change,as))).status,303)
  assert.deepEqual([edge.state.interval,edge.state.intervalCount],['month',3])
  const staffPlan=(await h.get('/api/coffer/donors/'+person.id)).summary.recurring[0];assert.deepEqual([staffPlan.interval,staffPlan.intervalCount],['month',3])
  assert.match(await (await h.request('/app/donors/'+person.id)).text(),/every 3 months/)
  for(const action of ['pause','resume']){
   planHtml=await manage()
   assert.equal((await h.request('/giving/portal/plan',portalForm({subscription:'sub_portal',requestId:randomUUID(),version:value(planHtml,'version'),action,confirm:'yes'},as))).status,303)
   assert.equal(edge.state.paused,action==='pause')
   assert.equal((await h.get('/api/coffer/donors/'+person.id)).summary.recurring[0].collectionsPaused,action==='pause')
  }
  const hosted=await h.request('/giving/portal/card',portalForm({subscription:'sub_portal'},as));assert.equal(hosted.status,303)
  assert.equal(new URL(hosted.headers.get('location')).hostname,'billing.stripe.com')
  const back=new URL(edge.state.hostedReturn)
  const donorFile=()=>h.api('/api/coffer/donors/'+person.id+'/data-request',{requestedOn:'2025-01-01',method:'email',reference:'synthetic-coffer-2601'})
  const pendingCard=(await donorFile()).records.portal_changes.find(change=>change.id===back.searchParams.get('request'))
  assert.ok(pendingCard);assert.ok(!JSON.stringify(pendingCard).includes(edge.state.method),'An unconfirmed hosted update retains no old opaque payment method in the donor’s data file')
  assert.equal((await get(back.pathname+back.search)).headers.get('location'),'/giving/portal?card=unchanged')
  edge.state.method='synthetic-coffer-2008'
  assert.equal((await get(back.pathname+back.search)).headers.get('location'),'/giving/portal?card=updated')
  const confirmedCard=(await donorFile()).records.portal_changes.find(change=>change.id===back.searchParams.get('request'))
  assert.deepEqual(JSON.parse(confirmedCard.request),{},'A verified update removes its old method comparison material from portable donor data')
  assert.equal((await get(back.pathname+back.search)).headers.get('location'),'/giving/portal?card=updated','A confirmed return remains replay-safe after its comparison material is discarded')
  let consentHtml=await (await get('/giving/portal/communications')).text(),withdraw={version:value(consentHtml,'version'),status:'withdrawn',confirm:'yes'}
  assert.equal((await h.request('/giving/portal/communications',portalForm({...withdraw,donorId:other.id},as))).status,403)
  assert.equal((await h.request('/giving/portal/communications',portalForm(withdraw,as))).status,303)
  assert.equal((await h.get('/api/coffer/donors/'+person.id)).consents[0].status,'withdrawn')
  assert.equal((await h.request('/giving/portal/communications',portalForm({...withdraw,status:'granted'},as))).status,403)
  consentHtml=await (await get('/giving/portal/communications')).text()
  const regrant={version:value(consentHtml,'version'),status:'regrant-request',confirm:'yes'}
  const sendRegrant=(values=regrant,options={})=>h.request('/giving/portal/communications',{...portalForm(values,as),...options})
  assert.equal((await sendRegrant({...regrant,confirm:'no'})).status,400)
  assert.equal((await sendRegrant({...regrant,donorId:other.id})).status,403)
  assert.equal((await sendRegrant({...regrant,version:withdraw.version})).status,409)
  assert.equal((await sendRegrant(regrant,{as:''})).status,303)
  assert.equal((await sendRegrant(regrant,{headers:{'content-type':'application/x-www-form-urlencoded',origin:'https://wrong.example.test'}})).status,403)
  const beforeRegrant=(await h.get('/api/coffer/donors/'+person.id)).consents
  const beforeRegrantMessages=edge.state.messages.length
  for(let replay=0;replay<2;replay++)assert.equal((await sendRegrant()).status,303)
  assert.deepEqual((await h.get('/api/coffer/donors/'+person.id)).consents,beforeRegrant,'A verified donor request cannot enable consent before staff evidence')
  assert.equal(edge.state.messages.length,beforeRegrantMessages,'Consent review never sends a message automatically')
  assert.match(await (await get('/giving/portal/communications')).text(),/Your request is with staff/,'Pending consent review survives a clean page reload')
  const regrantTasks=(await h.get('/api/coffer/tasks')).tasks.filter(t=>t.donor_id===person.id&&t.source_key.startsWith('portal-consent-regrant:'))
  assert.equal(regrantTasks.length,1,'Repeated donor requests create one owned review task per consent version')
  assert.equal(regrantTasks[0].is_ask,0);assert.ok(regrantTasks[0].owner_id)
  const requested=(await h.get('/api/coffer/donors/'+person.id)).events.filter(e=>e.action==='portal.consentRegrantRequested')
  assert.equal(requested.length,1);assert.equal(requested[0].actor_id,'donor:'+person.id)
  assert.equal(JSON.parse(requested[0].detail).status,'pending')
  await h.command('consent.record',{donorId:person.id,channel:'email',status:'granted',method:'web form',evidence:'Staff reviewed verified donor request at '+requested[0].at+' by '+person.id+' through their emailed portal sign-in.',capturedOn:requested[0].at.slice(0,10)})
  let reviewedConsent=(await h.get('/api/coffer/donors/'+person.id)).consents[0]
  assert.equal(reviewedConsent.status,'granted');assert.equal(reviewedConsent.recorded_by,'Morgan Lee');assert.equal(reviewedConsent.method,'web form');assert.ok(reviewedConsent.evidence.includes(requested[0].at))
  assert.match(await (await get('/giving/portal/communications')).text(),/current email permission is granted/)
  assert.equal((await sendRegrant()).status,409,'Staff review invalidates the old donor request')

  assert.equal((await h.request('/giving/portal/copy',portalForm({letter:ownLetter.id,requestId:randomUUID()},as))).status,303,'Requested transactional copies survive appeal withdrawal')
  if(process.env.COFFER_PORTAL_BROWSER)await portalBrowser(h,edge,person,ownLetter)
  const cancel={subscription:'sub_portal',requestId:randomUUID(),confirm:'yes'}
  assert.equal((await h.request('/giving/portal/cancel',portalForm(cancel,as))).status,303)
  assert.equal((await h.request('/giving/portal/cancel',portalForm(cancel,as))).status,303)
  assert.equal(edge.state.cancelled,true)
  const saved=await h.get('/api/coffer/donors/'+person.id)
  for(const action of ['portal.documentDownloaded','portal.copyRequested','portal.change','portal.pause','portal.resume','portal.paymentMethodUpdated','consent.record','portal.cancel'])assert.ok(saved.events.some(e=>e.action===action&&e.actor_role==='donor'),action+' reaches the staff timeline')
  const timeline=await (await h.request('/app/donors/'+person.id+'?timelineKind=portal')).text();assert.match(timeline,/Recurring gift amount or frequency changed/);assert.match(timeline,/Payment method change confirmed at Stripe/);assert.match(timeline,/Recurring gift cancelled at period end/)
  const shared=await donor(h,'Synthetic Shared Mailbox',{email:'synthetic-coffer-2401@example.test',household:'Synthetic shared mailbox household'})
  const sharedLogin=await signInPortal(h,'synthetic-coffer-2401@example.test',edge.state.messages)
  await donor(h,'Synthetic Shared Other',{email:'synthetic-coffer-2401@example.test',household:'Synthetic shared mailbox household'})
  assert.equal((await h.request('/giving/portal/history',{as:sharedLogin.cookie})).status,403,'A shared mailbox cannot identify one person even when a session predates sharing')
  assert.equal((await h.request('/giving/portal/communications',portalForm({status:'regrant-request',version:0,confirm:'yes'},sharedLogin.cookie))).status,403,'An ambiguous mailbox cannot submit a consent regrant request')
  const beforeAmbiguous=edge.state.messages.length
  assert.equal((await h.request('/giving/portal/request',portalForm({email:'synthetic-coffer-2401@example.test'}))).status,200)
  assert.equal(edge.state.messages.length,beforeAmbiguous,'An ambiguous mailbox receives no financial access link')
  const bouncedRequest={letter:ownLetter.id,requestId:randomUUID()}
  assert.equal((await h.request('/giving/portal/copy',portalForm(bouncedRequest,as))).status,303)
  for(let replay=0;replay<2;replay++)assert.equal((await portalCopyEvent(h,edge,ownLetter.id,bouncedRequest.requestId,'bounce','synthetic-coffer-2503')).status,200)
  const afterBounce=await h.get('/api/coffer/donors/'+person.id);assert.equal(afterBounce.receiptTasks.filter(t=>t.letter_id===ownLetter.id).length,1,'A requested-copy bounce opens one ordinary address-fix task')
  assert.equal((await h.request('/giving/portal/copy',portalForm({letter:ownLetter.id,requestId:randomUUID()},as))).status,409,'A known undeliverable copy address waits for a person')
  const calls=await h.get('/api/coffer/tasks');assert.equal(calls.tasks.filter(t=>t.donor_id===person.id&&t.source_key.startsWith('portal-cancel:')).length,1)
  assert.ok((await h.get('/api/coffer/donors/'+other.id)).gifts.some(g=>g.id===stranger.id&&g.amount_cents===99900))
  assert.equal((await h.get('/api/coffer/donors/'+person.id)).gifts.find(g=>g.id===extra.id).amount_cents,10000)
  await h.command('donor.erase',{donorId:person.id,confirm:'ERASE'})
  assert.equal((await get('/giving/portal/history')).status,303,'Erasure revokes donor sessions')
  assert.ok(!(await h.get('/api/coffer/tasks')).tasks.some(t=>t.donor_id===person.id),'Erasure removes consent review tasks as well as cancellation follow-up')
 },edge.options)
}
async function portalBrowser(h,edge,person,letter){
 const directory=process.env.COFFER_PORTAL_BROWSER;await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  const browserErrors=[];page.on('console',message=>{if(message.type()==='error')browserErrors.push(message.text())})
  // Playwright route() does not intercept redirected requests. Intercept the
  // provider at Chromium's network edge so the real application's 303 remains
  // intact and no synthetic hosted session reaches Stripe's live service.
  const provider=await context.newCDPSession(page)
  await provider.send('Fetch.enable',{patterns:[{urlPattern:'https://billing.stripe.com/*'}]})
  provider.on('Fetch.requestPaused',async({requestId})=>{
   const back=new URL(edge.state.hostedReturn)
   const body=`<!doctype html><title>Stripe payment update</title><h1>Update payment method at Stripe</h1><p>The current saved card expires next month.</p><form action="${origin+back.pathname}" method="get"><input type="hidden" name="request" value="${back.searchParams.get('request')}"><button>Save payment method at Stripe</button></form>`
   await provider.send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from(body).toString('base64')})
  })
  await context.clearCookies()
  const capture=async(name,width)=>{await page.evaluate(()=>scrollTo(0,0));await assertPortalTooltips(page);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${directory}/GIVE-005-${name}-${width}.png`,fullPage:true})}
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.goto(origin+'/giving/portal');await capture('sign-in',width);await page.getByLabel('Email address',{exact:true}).fill('synthetic-coffer-2006@example.test');await page.getByRole('button',{name:'Email a sign-in link'}).click();await page.getByRole('heading',{name:'Check your email',exact:true}).waitFor();await capture('link-requested',width)
   const message=edge.state.messages.findLast(m=>plain(m).includes('/giving/portal/confirm')),link=new URL(plain(message).match(/https?:\/\/[^\s<>]+\/giving\/portal\/confirm\?token=[^\s<>]+/)[0])
   await page.goto(origin+link.pathname+link.search);await capture('confirm',width);await page.getByRole('button',{name:'Continue',exact:true}).click();await capture('account',width);await page.getByRole('link',{name:'View gifts, receipts and statements'}).click()
   await capture('history',width)
   const downloading=page.waitForEvent('download');await page.getByRole('link',{name:'Download statement',exact:true}).click();const download=await downloading;await download.saveAs(`${directory}/GIVE-005-statement-${width}.html`)
   await page.getByRole('link',{name:'Read statement',exact:true}).click();await page.getByText('Total gifts: $125.00',{exact:false}).waitFor();await capture('statement',width)
   await page.goto(origin+'/giving/portal/plan?subscription=sub_portal');await page.getByLabel('Amount (USD)',{exact:true}).fill(width===1440?'14':'12');await page.getByRole('combobox',{name:/Frequency/}).selectOption('monthly');await page.getByRole('checkbox',{name:'I confirm this amount and billing frequency.'}).check();await capture('recurring-edit',width);await page.getByRole('button',{name:'Save recurring gift',exact:true}).click();await page.getByRole('status').waitFor();await capture('amount-lowered',width)
   // Stripe's hosted page is the network edge, outside the application. The
   // synthetic provider confirms its opaque default method on hosted submit.
   const cardResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/giving/portal/card')
   await page.getByRole('button',{name:'Update payment card',exact:true}).click()
   const handoff=await cardResponse;if(handoff.status()!==303)assert.fail(`Payment handoff returned ${handoff.status()}: ${await handoff.text()}`)
   try{await page.getByRole('heading',{name:'Update payment method at Stripe'}).waitFor()}catch(error){await capture('hosted-error',width);throw new Error(`${error.message}\nAt ${new URL(page.url()).origin+new URL(page.url()).pathname}\n${await page.locator('body').innerText()}\n${browserErrors.join('\n')}`)}
   await capture('stripe-hosted',width)
   edge.state.method='synthetic-coffer-'+(2200+width);await page.getByRole('button',{name:'Save payment method at Stripe'}).click()
   await page.getByText('Your payment method change was confirmed at Stripe.').waitFor();await capture('payment-updated',width)
   await h.command('consent.record',{donorId:person.id,channel:'email',status:'granted',method:'paper form',evidence:'Synthetic explicit permission before browser withdrawal',capturedOn:'2025-01-01'})
   await page.getByRole('link',{name:'Email preferences',exact:true}).click();await capture('consent',width);await page.getByRole('button',{name:'Withdraw email consent',exact:true}).click();await page.getByRole('status').waitFor();await capture('consent-withdrawn',width)
   await page.getByText('Request email permission again',{exact:true}).click()
   await page.getByRole('checkbox',{name:'I want to receive email news and appeals again.'}).check();await capture('consent-regrant-request',width)
   await page.getByRole('button',{name:'Request email regrant',exact:true}).click();await page.getByRole('status').waitFor();await page.goto(origin+'/giving/portal/communications');await page.getByRole('status').waitFor();await capture('consent-regrant-held',width)
   assert.equal((await h.get('/api/coffer/donors/'+person.id)).consents[0].status,'withdrawn')

   await page.goto(origin+'/giving/portal/cancel?subscription=sub_portal');await capture('cancellation',width)
   if(width===390){
    await page.getByRole('button',{name:'Cancel at end of billing period',exact:true}).click();await page.getByRole('status').waitFor();await capture('cancellation-saved',width)
    await page.setViewportSize({width:1440,height:1000});await capture('cancellation-saved',1440)
    await context.addCookies(h.owner.split('; ').map(v=>{const at=v.indexOf('=');return {name:v.slice(0,at),value:v.slice(at+1),domain:'127.0.0.1',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}}))
    await page.goto(origin+'/app/donors/'+person.id+'?timelineKind=portal')
    await page.getByText('Recurring gift cancelled at period end',{exact:true}).waitFor()
    for(const staffWidth of [1440,390]){await page.setViewportSize({width:staffWidth,height:1000});await capture('staff-timeline',staffWidth)}
   }
   await context.clearCookies()
  }
  await page.close()
 })
}

async function assertPortalTooltips(page){
 for(const control of await page.locator('a,button').all()){
  const info=await control.evaluate(el=>({text:el.innerText.trim(),label:el.getAttribute('aria-label'),tip:el.querySelector('[role="tooltip"]')?.textContent?.trim()}))
  if(!await control.isVisible()||info.text&&!info.tip)continue
  assert.ok(info.tip,'An icon-only control has a short tooltip: '+info.label)
  await control.focus()
  assert.equal(await control.locator('[role="tooltip"]').evaluate(el=>getComputedStyle(el).visibility),'visible')
 }
}
