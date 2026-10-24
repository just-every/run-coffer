import assert from 'node:assert/strict'
import {randomUUID,createHmac} from 'node:crypto'
import {run} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'
import {mkdir} from 'node:fs/promises'
export async function givingProtectionJourney(){
 const secret='synthetic-coffer-501',hookSecret='synthetic-coffer-502';let stripeCalls=0,sequence=0,lastIntent,lastSession,monthlyIntent,invoiceAttempt=1,invoicePaid=false,invoiceId='synthetic-coffer-542',wrongCustomer=false,providerPaid=false,checkoutUnavailable=false,challenge='pass'
 const outbound=async request=>{
  const u=new URL(request.url),p=new URLSearchParams(await request.text())
  if(u.hostname==='challenges.cloudflare.com'){
   assert.equal(p.get('secret'),secret)
   if(challenge==='unavailable')throw new Error('Synthetic unavailable edge')
   return Response.json({success:challenge==='pass',hostname:new URL(origin).hostname,action:'giving'})
  }
  assert.equal(u.hostname,'api.stripe.com');stripeCalls++
  if(u.pathname==='/v1/customers')return Response.json({id:'synthetic-coffer-503'})
  if(u.pathname==='/v1/checkout/sessions'){if(checkoutUnavailable)return Response.json({error:{}},{status:503});lastIntent=p.get('metadata[coffer_intent]');if(p.get('mode')==='subscription')monthlyIntent=lastIntent;lastSession='synthetic-coffer-'+(++sequence+510);return Response.json({id:lastSession,url:'https://checkout.stripe.com/c/pay/synthetic-coffer-504'})}
  if(u.pathname==='/v1/charges/synthetic-coffer-505')return Response.json({id:'synthetic-coffer-505',customer:wrongCustomer?'synthetic-coffer-999':'synthetic-coffer-503',status:providerPaid?'succeeded':'failed',paid:providerPaid,outcome:{type:'blocked',reason:'rule'},metadata:{coffer_intent:lastIntent}})
  if(u.pathname==='/v1/payment_intents/synthetic-coffer-540')return Response.json({id:'synthetic-coffer-540',customer:'synthetic-coffer-503',status:'requires_payment_method',metadata:{coffer_intent:lastIntent},last_payment_error:{charge:'synthetic-coffer-505'}})
  if(u.pathname==='/v1/checkout/sessions/'+lastSession)return Response.json({id:lastSession,customer:'synthetic-coffer-503',currency:'usd',payment_status:'unpaid'})
  if(u.pathname==='/v1/subscriptions/synthetic-coffer-541')return Response.json({id:'synthetic-coffer-541',customer:'synthetic-coffer-503',status:'past_due',metadata:{coffer_intent:monthlyIntent},items:{data:[{price:{unit_amount:100}}]}})
  if(u.pathname==='/v1/invoices/'+invoiceId)return Response.json({id:invoiceId,customer:wrongCustomer?'synthetic-coffer-999':'synthetic-coffer-503',currency:'usd',status:invoicePaid?'paid':'open',amount_paid:invoicePaid?100:0,status_transitions:{paid_at:Math.floor(Date.now()/1000)},attempt_count:invoiceAttempt,parent:{subscription_details:{subscription:'synthetic-coffer-541'}}})
  assert.fail('Unexpected Stripe path '+u.pathname)
 }
 let origin
 await run(async h=>{
  origin=h.origin
  const c=await h.api('/api/coffer/giving/campaigns',{name:'Synthetic protected form',slug:'protected',description:'Protected giving.',fund:'Books',goal:'1000'})

  const attempt=(slug='protected',ip='192.0.2.1',amount='1.00',token='synthetic-coffer-507',frequency='once')=>h.request('/give/'+slug+'/checkout',{method:'POST',as:'',headers:{'CF-Connecting-IP':ip,'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams({name:'Synthetic unconfirmed giver',email:'synthetic-coffer-508@example.test',amount,frequency,requestId:randomUUID(),'cf-turnstile-response':token}).toString()})
  const unprotected=await attempt('protected','192.0.2.100');assert.equal(unprotected.status,503);await unprotected.text();assert.equal(stripeCalls,0)
  const closedForm=await h.request('/give/protected',{as:''});assert.match(await closedForm.text(),/class="checkout" disabled/)
  await h.command('giving.protection',{siteKey:'synthetic-coffer-506',secret})
  await h.command('giving.resume',{campaignId:c.id})
  const statuses=[]
  for(let i=0;i<30;i++){const r=await attempt();statuses.push(r.status);await r.text()}
  assert.deepEqual(statuses.slice(0,10),Array(10).fill(303));assert.ok(statuses.slice(10).every(s=>s===429||s===409));assert.ok(statuses.includes(429));assert.equal(statuses.at(-1),409)
  const forms=(await h.get('/api/coffer/giving/protection')).forms,paused=forms.find(r=>r.campaign_id===c.id)
  assert.equal(paused.paused,1);assert.equal(paused.failures,10);assert.ok(paused.alerted_at)
  assert.equal((await h.get('/api/coffer/donors')).total,0)
  assert.equal((await h.get('/api/coffer/reports/attribution')).ledgerCents,0)
  const calls=stripeCalls
  await h.command('giving.resume',{campaignId:c.id})
  const below=await attempt('protected','192.0.2.2','0.50');assert.equal(below.status,400);await below.text();assert.equal(stripeCalls,calls)
  for(const mode of ['reject','unavailable']){challenge=mode;const r=await attempt('protected','192.0.2.3');assert.equal(r.status,403);await r.text();assert.equal(stripeCalls,calls)}
  const noToken=await attempt('protected','192.0.2.4','1.00','');assert.equal(noToken.status,403);await noToken.text()
  challenge='pass';const ready=await attempt('protected','192.0.2.5');assert.equal(ready.status,303);await ready.text()
  const event={id:'synthetic-coffer-509',type:'charge.failed',data:{object:{id:'synthetic-coffer-505'}}},raw=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000),signature=createHmac('sha256',hookSecret).update(timestamp+'.'+raw).digest('hex')
  for(let i=0;i<2;i++){const r=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw,headers:{'stripe-signature':`t=${timestamp},v1=${signature}`}});assert.equal(r.status,200,await r.text())}
  const radar=(await h.get('/api/coffer/giving/protection')).forms.find(r=>r.campaign_id===c.id)
  assert.equal(radar.failures,4,'The signed blocked charge counts once in addition to three refused challenges')
  assert.equal((await h.get('/api/coffer/donors')).total,0);assert.equal((await h.get('/api/coffer/reports/attribution')).ledgerCents,0)
  const send=async(id,type,objectId)=>{
   const body=JSON.stringify({id,type,data:{object:{id:objectId}}}),t=Math.floor(Date.now()/1000),sig=createHmac('sha256',hookSecret).update(t+'.'+body).digest('hex')
   const r=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw:body,headers:{'stripe-signature':`t=${t},v1=${sig}`}})
   assert.equal(r.status,200,await r.text())
  }
  const failures=async id=>(await h.get('/api/coffer/giving/protection')).forms.find(r=>r.campaign_id===id)
  // Different events for the charge and its payment intent describe one attempt.
  await Promise.all([
   send('synthetic-coffer-543','charge.failed','synthetic-coffer-505'),
   send('synthetic-coffer-544','payment_intent.payment_failed','synthetic-coffer-540'),
  ])
  assert.equal((await failures(c.id)).failures,4)
  wrongCustomer=true;await send('synthetic-coffer-545','charge.failed','synthetic-coffer-505');wrongCustomer=false
  providerPaid=true;await send('synthetic-coffer-546','charge.failed','synthetic-coffer-505');providerPaid=false
  assert.equal((await failures(c.id)).failures,4,'Mismatched customers and current successful payments are not failed attempts')
  checkoutUnavailable=true
  const unavailable=await attempt('protected','192.0.2.8');assert.equal(unavailable.status,502);await unavailable.text()
  checkoutUnavailable=false;assert.equal((await failures(c.id)).failures,5,'A refused hosted checkout counts as one failure')
  await Promise.all([0,1].map(n=>send('synthetic-coffer-hosted-'+n,'checkout.session.async_payment_failed',lastSession)))
  assert.equal((await failures(c.id)).failures,6,'Concurrent hosted failure events count the saved session once')
  const monthly=await h.api('/api/coffer/giving/campaigns',{name:'Synthetic monthly protection',slug:'monthly-protected',description:'Recurring protection.',fund:'Books',goal:'1000'})
  const starting=await attempt('monthly-protected','192.0.2.9','1.00','synthetic-coffer-507','monthly')
  assert.equal(starting.status,303,await starting.text())
  wrongCustomer=true;await send('synthetic-coffer-547','invoice.payment_failed','synthetic-coffer-542');wrongCustomer=false
  assert.equal((await failures(monthly.id)).failures,0,'Another customer cannot affect this form')
  await send('synthetic-coffer-548','customer.subscription.created','synthetic-coffer-541')
  assert.equal((await h.get('/api/coffer/donors')).total,0,'A failed subscription event cannot create a donor')
  for(invoiceAttempt=1;invoiceAttempt<=10;invoiceAttempt++){
   await Promise.all([0,1].map(n=>send('synthetic-coffer-invoice-'+invoiceAttempt+'-'+n,'invoice.payment_failed','synthetic-coffer-542')))
   assert.equal((await failures(monthly.id)).failures,invoiceAttempt,'One count per provider invoice attempt across concurrent events')
   assert.equal((await h.get('/api/coffer/donors')).total,0,'Failed first installments must not create donors')
  }
  const recurringPause=await failures(monthly.id)
  assert.equal(recurringPause.paused,1);assert.ok(recurringPause.alerted_at)
  assert.equal(recurringPause.attempts,11,'The form request and ten provider attempts form the observed denominator')
  const refusedMonthly=await attempt('monthly-protected','192.0.2.10','1.00','synthetic-coffer-507','monthly')
  assert.equal(refusedMonthly.status,409);await refusedMonthly.text()
  assert.equal((await h.get('/api/coffer/reports/attribution')).ledgerCents,0)
  await h.command('giving.resume',{campaignId:monthly.id})
  invoicePaid=true;invoiceId='synthetic-coffer-549';invoiceAttempt=1
  await send('synthetic-coffer-550','invoice.paid',invoiceId)
  const paidWindow=await failures(monthly.id)
  assert.equal(paidWindow.attempts,1);assert.equal(paidWindow.failures,0);assert.equal(paidWindow.paused,0)
  assert.equal((await h.get('/api/coffer/donors')).total,1,'Only a verified paid installment creates the new donor')
  assert.equal((await h.get('/api/coffer/reports/attribution')).ledgerCents,100)
  const member=await h.person('synthetic-coffer-530@example.test');await h.command('giving.resume',{campaignId:c.id},{as:member.cookie,status:403})
  await h.get('/api/coffer/giving/protection',{as:member.cookie,status:403})
  if(process.env.COFFER_PROTECTION_BROWSER){
   await mkdir(process.env.COFFER_PROTECTION_BROWSER,{recursive:true})
   // Recreate a paused state through the same address gate.
   for(let i=0;i<30;i++){const r=await attempt('protected','192.0.2.7');await r.text()}
   await withBrowserWorker(h,async(context,browserOrigin)=>{
    await context.route('https://challenges.cloudflare.com/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:''}))
    const page=await context.newPage()
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:1000});await page.goto(browserOrigin+'/app/giving/setup');await page.getByRole('alert').filter({hasText:'Synthetic protected form is paused'}).waitFor()
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
     await page.screenshot({path:`${process.env.COFFER_PROTECTION_BROWSER}/GIVE-007-alert-${width}.png`,fullPage:true})
     await page.goto(browserOrigin+'/give/protected');assert.equal(await page.locator('.cf-turnstile').count(),1)
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
     await page.screenshot({path:`${process.env.COFFER_PROTECTION_BROWSER}/GIVE-007-form-${width}.png`,fullPage:true})
    }
   })
  }
 },{entry:'tests/fixed-clock-worker.ts',givingProtection:false,bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-531',STRIPE_WEBHOOK_SECRET:hookSecret},outbound})
}
