import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {run,donor,archive,restore,installation,reviewed} from './harness.mjs'
import {webhooksBrowser} from './webhooks-browser.mjs'
import {recurringStripeEdge} from './recurring-stripe-edge.mjs'

const events=['gift.created','gift.reversed','donor.created','donor.updated','plan.failed','plan.canceled','task.assigned','form.submitted']
const subscription={name:'Riverbend operations',endpoint:'https://receiver.example.test/events',events,reviewed:'yes'}
const at='2026-10-18T02:00:00.000Z'
const headers={'x-test-now':at}
const form=data=>({method:'POST',as:'',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(data).toString()})
const tick=async(h,when)=>{const response=await h.request('/cdn-cgi/local/scheduled?cron=*+*+*+*+*&time='+Date.parse(when));assert.equal(response.status,200,await response.text())}
const log=h=>h.get('/api/coffer/webhooks')

export async function webhooksJourney(){
 const received=[];let failing=true
 await run(async h=>{
  await h.get('/api/coffer/webhooks',{as:'',status:401})
  await h.command('webhook.subscribe',{...subscription,reviewed:''},{status:400})
  for(const endpoint of ['http://receiver.example.test/','https://127.0.0.1/','https://[::1]/','https://localhost/','https://receiver.local/','https://receiver.example.test/?token=synthetic-coffer-1','https://user:synthetic-coffer-2@receiver.example.test/'])await h.command('webhook.subscribe',{...subscription,endpoint},{status:400})
  const member=await h.person('synthetic-coffer-1801@example.test'),as={as:member.cookie}
  await h.command('webhook.subscribe',subscription,{...as,status:403})
  await h.get('/api/coffer/webhooks',{...as,status:403})
  const key=await h.command('agent.create',{label:'Webhook-denied agent'})
  const agent={as:'',headers:{authorization:'Bearer '+key.token}}
  await h.command('webhook.subscribe',subscription,{...agent,status:403})
  await h.get('/api/coffer/webhooks',{...agent,status:403})
  await h.command('webhook.subscribe',subscription,{headers:{origin:'https://elsewhere.test'},status:403})
  const signed=await h.command('webhook.subscribe',subscription)
  const quiet=await h.command('webhook.subscribe',{...subscription,name:'Donor changes only',events:['donor.updated']})
  const d=await donor(h,'Riverbend Webhook Donor',{addressLine1:null,email:'synthetic-coffer-1802@example.test'},{headers})
  const gift=await h.command('gift.record',{donorId:d.id,amount:'85.50',receivedOn:'2026-10-17',method:'check',goods:'none'},{headers})
  await h.command('gift.record',{donorId:d.id,amount:'0',receivedOn:'2026-10-17',method:'check',goods:'none'},{headers,status:400})
  await h.command('gift.reverse',{giftId:gift.id,reason:'Check returned unpaid'},{headers})
  await h.command('donor.update',{donorId:d.id,version:1,name:'Riverbend Updated Donor',email:'synthetic-coffer-1802@example.test'},{headers})
  const queued=await log(h)
  assert.deepEqual(queued.deliveries.filter(x=>x.subscription_id===signed.id).map(x=>x.event_type).sort(),['donor.created','donor.updated','gift.created','gift.reversed'])
  assert.deepEqual(queued.deliveries.filter(x=>x.subscription_id===quiet.id).map(x=>x.event_type),['donor.updated'])
  assert.ok(!JSON.stringify(queued).includes(signed.secret),'Signing keys are absent from reads')
  const initial=new Date(Math.max(...queued.deliveries.map(x=>Date.parse(x.next_at)))+1000).toISOString()
  await Promise.all([tick(h,initial),tick(h,initial)])
  const failed=await log(h),target=failed.deliveries.find(x=>x.event_type==='gift.created')
  assert.equal(target.status,'failed');assert.equal(target.attempts,1)
  assert.equal(failed.attempts.filter(a=>a.delivery_id===target.id).length,1,'Concurrent ticks claim one delivery attempt')
  assert.equal(failed.attempts.find(a=>a.delivery_id===target.id).http_status,503)
  const first=received.find(x=>x.event.id===target.event_id)
  const [timestamp,signature]=first.signature.split(',').map(v=>v.split('=')[1])
  assert.equal(signature,createHmac('sha256',signed.secret).update(timestamp+'.'+first.body).digest('hex'))
  assert.deepEqual(first.event,{id:target.event_id,type:'gift.created',occurredAt:target.occurred_at,data:{id:gift.id}})
  assert.ok(!first.body.includes('Riverbend')&&!first.body.includes('8550')&&!first.body.includes('@'),'Payloads contain only event facts and identifiers')
  const count=received.length
  await tick(h,new Date(Date.parse(target.next_at)-1).toISOString());assert.equal(received.length,count,'Backoff prevents early delivery')
  await tick(h,target.next_at)
  const twice=(await log(h)).deliveries.find(x=>x.id===target.id)
  assert.equal(twice.attempts,2);assert.ok(Date.parse(twice.next_at)-Date.parse(target.next_at)>Date.parse(target.next_at)-Date.parse(initial),'Backoff increases after failure')
  failing=false
  await tick(h,twice.next_at)
  const delivered=(await log(h)).deliveries.find(x=>x.id===target.id)
  assert.equal(delivered.status,'delivered');assert.equal(delivered.attempts,3)
  assert.deepEqual((await log(h)).attempts.filter(x=>x.delivery_id===target.id).map(x=>x.status),['failed','failed','delivered'])
  await h.command('webhook.replay',{deliveryId:target.id,reviewed:''},{status:400})
  await h.command('webhook.replay',{deliveryId:target.id,reviewed:'yes'},{...as,status:403})
  const replay=await h.command('webhook.replay',{deliveryId:target.id,reviewed:'yes'})
  const replayBefore=(await log(h)).deliveries.find(x=>x.id===replay.id)
  await tick(h,new Date(Date.parse(replayBefore.next_at)+1000).toISOString())
  const replayAfter=(await log(h)).deliveries.find(x=>x.id===replay.id)
  assert.equal(replayAfter.status,'delivered');assert.equal(replayAfter.replay_of,target.id);assert.equal(replayAfter.event_id,target.event_id)
  assert.equal((await log(h)).deliveries.find(x=>x.id===target.id).attempts,3,'Replay retains original history')
  if(process.env.COFFER_WEBHOOK_BROWSER)await webhooksBrowser(h,process.env.COFFER_WEBHOOK_BROWSER)
  await h.command('webhook.pause',{subscriptionId:quiet.id,version:1})
  await h.command('webhook.pause',{subscriptionId:quiet.id,version:1},{status:409})
  const before=received.length
  await h.command('webhook.pause',{subscriptionId:signed.id,version:1})
  await h.command('webhook.replay',{deliveryId:target.id,reviewed:'yes'},{status:409})
  await tick(h,new Date(Date.parse(twice.next_at)+86400000).toISOString());assert.equal(received.length,before,'Paused endpoints never send queued replays')
  const exported=await archive(h)
  assert.ok(!JSON.stringify(exported).includes(signed.secret),'Archives omit signing secrets')
  const copy=await installation();try{await restore(copy,exported);assert.equal((await log(copy)).subscriptions.length,0);assert.equal((await log(copy)).deliveries.length,0)}finally{await copy.close()}
  await h.command('donor.erase',{donorId:d.id,confirm:'ERASE'})
  const erased=await log(h)
  assert.equal(erased.deliveries.filter(x=>['donor.created','donor.updated','gift.created','gift.reversed'].includes(x.event_type)).length,0,'Erasure removes private webhook identifiers and their delivery history')
  const audit=(await h.get('/api/coffer/audit?action=webhook.subscribe')).rows
  assert.ok(audit.length>=2);assert.ok(audit.every(x=>JSON.parse(x.detail).explicitDisclosureApproval===true))
 },{entry:'tests/advancing-clock-worker.ts',triggerHandlers:true,outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'receiver.example.test')
  const body=await request.text(),event=JSON.parse(body)
  received.push({body,event,signature:request.headers.get('coffer-signature'),deliveryId:request.headers.get('coffer-delivery-id')})
  return new Response(null,{status:failing?503:204})
 }})
 await webhookSourceJourney()
}

async function webhookSourceJourney(){
 const edge=recurringStripeEdge(),delivered=[]
 await run(async h=>{
  const signed=await h.command('webhook.subscribe',subscription)
  await reviewed(h)
  const campaign=await h.api('/api/coffer/giving/campaigns',{name:'Community reading',slug:'webhook-reading',description:'Books for local readers.',fund:'Reading',goal:'10000'})
  const data={requestId:randomUUID(),name:'Community Reader',email:'synthetic-coffer-1810@example.test',amount:'25',frequency:'monthly','cf-turnstile-response':'synthetic-coffer-security-token'}
  const checkout=await h.request('/give/'+campaign.slug+'/checkout',form(data));assert.equal(checkout.status,303,await checkout.text())
  const send=async(type,id,eventId)=>{
   const raw=JSON.stringify({id:eventId,type,data:{object:{id}}}),timestamp=Math.floor(Date.now()/1000)
   const signature=createHmac('sha256','synthetic-coffer-1811').update(timestamp+'.'+raw).digest('hex')
   const response=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw,headers:{'stripe-signature':`t=${timestamp},v1=${signature}`}})
   assert.equal(response.status,200,await response.text())
  }
  const plan=[...edge.state.plans.values()][0]
  await send('customer.subscription.created',plan.id,'synthetic-coffer-1812')
  const bill={id:'synthetic-coffer-1813',customer:plan.customer,currency:'usd',parent:{subscription_details:{subscription:plan.id}},status:'open',amount_paid:0,attempt_count:1,next_payment_attempt:null,status_transitions:{paid_at:null}}
  plan.status='past_due';plan.latest_invoice=bill.id;edge.state.invoices.set(bill.id,bill)
  await send('invoice.payment_failed',bill.id,'synthetic-coffer-1814')
  await send('invoice.payment_failed',bill.id,'synthetic-coffer-1814')
  plan.cancel_at_period_end=true
  await send('customer.subscription.updated',plan.id,'synthetic-coffer-1815')
  const donorId=(await h.get('/api/coffer/donors')).donors.find(d=>d.email===data.email).id
  await h.command('task.repeatCreate',{donorId,ownerId:(await h.get('/auth/session')).operator.id,dueOn:'2026-10-28',intervalMonths:1,title:'Thank the reader',isAsk:'no'})
  const state=await log(h),types=state.deliveries.filter(x=>x.subscription_id===signed.id).map(x=>x.event_type)
  for(const kind of ['form.submitted','donor.created','plan.failed','plan.canceled','task.assigned'])assert.equal(types.filter(x=>x===kind).length,1,kind+' captured once through its public door')
  const when=new Date(Math.max(...state.deliveries.map(d=>Date.parse(d.next_at)))+1000).toISOString()
  await tick(h,when)
  for(const kind of ['form.submitted','plan.failed','plan.canceled','task.assigned'])assert.ok(delivered.some(x=>x.type===kind),'Delivered '+kind)
 },{triggerHandlers:true,bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-1816',STRIPE_WEBHOOK_SECRET:'synthetic-coffer-1811'},outbound:async request=>{
  if(new URL(request.url).hostname==='receiver.example.test'){delivered.push(await request.json());return new Response(null,{status:204})}
  return edge.outbound(request)
 }})
}
