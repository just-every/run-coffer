import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {run,donor,archive,restore,installation,reviewed} from './harness.mjs'
import {webhooksBrowser,webhooksHistoryBrowser} from './webhooks-browser.mjs'
import {verifyWebhook} from '../src/coffer/webhooks/receiver.mjs'
import {webhookSourcesJourney} from './webhook-sources-journey.mjs'
import {recurringStripeEdge} from './recurring-stripe-edge.mjs'
import {webhookContinuityJourney} from './webhook-continuity-journey.mjs'
import {webhookHistoryJourney} from './webhook-history-journey.mjs'

const events=['gift.created','gift.reversed','donor.created','donor.updated','plan.failed','plan.canceled','task.assigned','form.submitted']
const subscription={name:'Riverbend operations',endpoint:'https://receiver.example.test/events',events,reviewed:'yes'}
const at='2026-10-18T02:00:00.000Z'
const headers={'x-test-now':at}
const form=data=>({method:'POST',as:'',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(data).toString()})
const tick=async(h,when)=>{const response=await h.request('/cdn-cgi/local/scheduled?cron=*+*+*+*+*&time='+Date.parse(when));assert.equal(response.status,200,await response.text())}
const log=h=>h.get('/api/coffer/webhooks')

export async function webhooksJourney(){
 const received=[],effects=new Map(),secrets=new Map();let failing=true,receiverNow=Date.parse(at)
 const deliverAt=async(h,when)=>{receiverNow=Date.parse(when);await tick(h,when)}
 const receiver=async request=>{
  const body=await request.text(),signature=request.headers.get('coffer-signature')
  let event
  try{event=await verifyWebhook(secrets.get(new URL(request.url).pathname),signature,body,receiverNow)}catch{return new Response(null,{status:401})}
  received.push({body,event,signature,deliveryId:request.headers.get('coffer-delivery-id')})
  // The receiving network edge models one atomic insert of event ID and effect.
  if(!effects.has(event.id))effects.set(event.id,1)
  return new Response(null,{status:failing?503:204})
 }
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
  const foreign=await h.mf.dispatchFetch('https://elsewhere.test/api/coffer/webhooks',{headers:{cookie:h.owner,origin:h.origin}})
  assert.equal(foreign.status,403,'A foreign host cannot read the webhook log')
  const signed=await h.command('webhook.subscribe',subscription)
  const quiet=await h.command('webhook.subscribe',{...subscription,endpoint:'https://receiver.example.test/donor-changes',name:'Donor changes only',events:['donor.updated']})
  secrets.set('/events',signed.secret);secrets.set('/donor-changes',quiet.secret)
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
  receiverNow=Date.parse(initial)
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
  await deliverAt(h,new Date(Date.parse(target.next_at)-1).toISOString());assert.equal(received.length,count,'Backoff prevents early delivery')
  await deliverAt(h,target.next_at)
  const twice=(await log(h)).deliveries.find(x=>x.id===target.id)
  assert.equal(twice.attempts,2);assert.ok(Date.parse(twice.next_at)-Date.parse(target.next_at)>Date.parse(target.next_at)-Date.parse(initial),'Backoff increases after failure')
  failing=false
  await deliverAt(h,twice.next_at)
  const delivered=(await log(h)).deliveries.find(x=>x.id===target.id)
  assert.equal(delivered.status,'delivered');assert.equal(delivered.attempts,3)
  assert.deepEqual((await log(h)).attempts.filter(x=>x.delivery_id===target.id).map(x=>x.status),['failed','failed','delivered'])
  await h.command('webhook.replay',{deliveryId:target.id,reviewed:''},{status:400})
  await h.command('webhook.replay',{deliveryId:target.id,reviewed:'yes'},{...as,status:403})
  const replay=await h.command('webhook.replay',{deliveryId:target.id,reviewed:'yes'})
  const replayBefore=(await log(h)).deliveries.find(x=>x.id===replay.id)
  await deliverAt(h,new Date(Date.parse(replayBefore.next_at)+1000).toISOString())
  const replayAfter=(await log(h)).deliveries.find(x=>x.id===replay.id)
  assert.equal(replayAfter.status,'delivered');assert.equal(replayAfter.replay_of,target.id);assert.equal(replayAfter.event_id,target.event_id)
  assert.equal((await log(h)).deliveries.find(x=>x.id===target.id).attempts,3,'Replay retains original history')
  assert.ok(received.filter(x=>x.event.id===target.event_id).length>=4,'Retries and reviewed replay reach the receiver with a stable event ID')
  assert.equal(effects.get(target.event_id),1,'Ambiguous failures, retry and replay have one receiver effect')
  const effectCount=effects.size
  const probe=async(signature,body=first.body)=>receiver(new Request('https://receiver.example.test/events',{method:'POST',headers:{'coffer-signature':signature},body}))
  receiverNow=Number(timestamp)*1000+301000
  assert.equal((await probe(first.signature)).status,401,'Old signed bytes cannot bypass timestamp freshness')
  const future=String(Math.floor(receiverNow/1000)+301)
  assert.equal((await probe(`t=${future},v1=${createHmac('sha256',signed.secret).update(future+'.'+first.body).digest('hex')}`)).status,401,'Future signatures beyond the receiver clock window are refused')
  const fresh=String(Math.floor(receiverNow/1000))
  assert.equal((await probe(`t=${fresh},v1=${createHmac('sha256',signed.secret).update(fresh+'.'+first.body).digest('hex')}`,first.body+' ')).status,401,'Changed exact bytes fail signature verification')
  assert.equal(effects.size,effectCount,'Rejected receiver requests never apply effects')
  for(const attempt of received){
   const delivery=(await log(h)).deliveries.find(d=>d.id===attempt.deliveryId)
   const secret=delivery.subscription_id===signed.id?signed.secret:quiet.secret
   const [t,v]=attempt.signature.split(',').map(part=>part.split('=')[1])
   assert.equal(v,createHmac('sha256',secret).update(t+'.'+attempt.body).digest('hex'),'Every emitted event uses its endpoint key')
  }
  const admin=await h.person('synthetic-coffer-1803@example.test','admin')
  const approval=await h.command('webhook.subscribe',{...subscription,endpoint:'https://receiver.example.test/revoked',name:'Revoked approver',events:['donor.created']},{as:admin.cookie})
  await donor(h,'Authority Check',{addressLine1:null})
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  await h.get('/api/coffer/webhooks',{as:admin.cookie,status:401})
  const waiting=(await log(h)).deliveries.find(d=>d.subscription_id===approval.id)
  await deliverAt(h,new Date(Date.parse(waiting.next_at)+1000).toISOString())
  assert.equal((await log(h)).deliveries.find(d=>d.id===waiting.id).status,'held','Revoked approval stops queued disclosure')
  assert.equal(received.some(r=>r.deliveryId===waiting.id),false)
  if(process.env.COFFER_WEBHOOK_BROWSER)await webhooksBrowser(h,process.env.COFFER_WEBHOOK_BROWSER)
  failing=true
  const stoppedGift=await h.command('gift.record',{donorId:d.id,amount:'14.25',receivedOn:'2026-10-17',method:'cash',goods:'none'},{headers})
  let stopped=(await log(h)).deliveries.find(x=>x.subject_id===stoppedGift.id)
  for(let attempt=1;attempt<=6;attempt++){
   await deliverAt(h,stopped.next_at)
   stopped=(await log(h)).deliveries.find(x=>x.id===stopped.id)
   assert.equal(stopped.attempts,attempt,'Each due tick submits exactly one automatic attempt')
   assert.equal(stopped.status,attempt===6?'exhausted':'failed','Exhaustion starts at the sixth total attempt')
  }
  assert.equal(stopped.status,'exhausted','Repeated failures eventually stop automatic delivery')
  const stoppedCount=received.filter(x=>x.deliveryId===stopped.id).length
  assert.equal(stoppedCount,6,'Six total automatic network submissions include the initial attempt')
  assert.equal((await log(h)).attempts.filter(x=>x.delivery_id===stopped.id).length,6,'All six failures remain in the log')
  await deliverAt(h,new Date(Date.parse(stopped.next_at)+86400000).toISOString())
  assert.equal(received.filter(x=>x.deliveryId===stopped.id).length,stoppedCount,'Exhausted delivery waits for explicit replay')
  failing=false
  await h.command('webhook.pause',{subscriptionId:quiet.id,version:1})
  await h.command('webhook.pause',{subscriptionId:quiet.id,version:1},{status:409})
  const before=received.length
  await h.command('webhook.pause',{subscriptionId:signed.id,version:1})
  await h.command('webhook.replay',{deliveryId:target.id,reviewed:'yes'},{status:409})
  await deliverAt(h,new Date(Date.parse(twice.next_at)+86400000).toISOString());assert.equal(received.length,before,'Paused endpoints never send queued replays')
  const replacement=await h.command('webhook.subscribe',{...subscription,name:'Replacement after pause',endpoint:'https://receiver.example.test/replacement'})
  assert.notEqual(replacement.secret,signed.secret,'Replacement generates a new installation key')
  secrets.set('/replacement',replacement.secret)
  const replacementDonor=await donor(h,'Replacement endpoint donor',{addressLine1:null},{headers})
  const replacementDelivery=(await log(h)).deliveries.find(x=>x.subject_id===replacementDonor.id)
  assert.equal(replacementDelivery.subscription_id,replacement.id,'Only freshly approved replacement receives new events')
  await deliverAt(h,replacementDelivery.next_at)
  assert.equal((await log(h)).deliveries.find(x=>x.id===replacementDelivery.id).status,'delivered')
  await h.command('webhook.replay',{deliveryId:target.id,reviewed:'yes'},{status:409})
  // More than one page of retained history through the same reviewed replay door.
  for(let index=0;index<102;index++)await h.command('webhook.replay',{deliveryId:replacementDelivery.id,reviewed:'yes'})
  const ids=new Set();let history=await log(h),pages=0
  do{
   pages++
   for(const row of history.deliveries){assert.ok(!ids.has(row.id),'History pages do not repeat a delivery');ids.add(row.id)}
   if(!history.nextCursor)break
   history=await h.get('/api/coffer/webhooks?before='+encodeURIComponent(history.nextCursor))
  }while(pages<10)
  assert.ok(pages>1&&ids.size>100,'All retained deliveries are available beyond the first history page')
  assert.ok(ids.has(target.id),'Old paused delivery and replay lineage remain accessible')
  await h.get('/api/coffer/webhooks?before=invalid',{status:400})
  if(process.env.COFFER_WEBHOOK_BROWSER)await webhooksHistoryBrowser(h,process.env.COFFER_WEBHOOK_BROWSER)
  await h.command('webhook.pause',{subscriptionId:replacement.id,version:1})
  const exported=await archive(h)
  assert.ok(!JSON.stringify(exported).includes(signed.secret),'Archives omit signing secrets')
  const copy=await installation();try{await restore(copy,exported);assert.equal((await log(copy)).subscriptions.length,0);assert.equal((await log(copy)).deliveries.length,0)}finally{await copy.close()}
  await h.command('donor.erase',{donorId:d.id,confirm:'ERASE'})
  const erased=await log(h)
  assert.equal(erased.deliveries.filter(x=>[d.id,gift.id,...queued.deliveries.map(x=>x.subject_id)].includes(x.subject_id)).length,0,'Erasure removes private webhook identifiers and their delivery history')
  const audit=(await h.get('/api/coffer/audit?action=webhook.subscribe')).rows
  assert.ok(audit.length>=2);assert.ok(audit.every(x=>JSON.parse(x.detail).explicitDisclosureApproval===true))
 },{entry:'tests/advancing-clock-worker.ts',triggerHandlers:true,outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'receiver.example.test')
  return receiver(request)
 }})
 await webhookHistoryJourney()
 await webhookContinuityJourney()
 await webhookSourceJourney()
 await webhookSourcesJourney()
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
  for(const kind of ['form.submitted','plan.failed','plan.canceled','task.assigned']){
   const delivery=delivered.find(x=>x.event.type===kind);assert.ok(delivery,'Delivered '+kind)
   const [t,v]=delivery.signature.split(',').map(part=>part.split('=')[1])
   assert.equal(v,createHmac('sha256',signed.secret).update(t+'.'+delivery.body).digest('hex'),'Signed '+kind)
  }
 },{triggerHandlers:true,bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-1816',STRIPE_WEBHOOK_SECRET:'synthetic-coffer-1811'},outbound:async request=>{
  if(new URL(request.url).hostname==='receiver.example.test'){const body=await request.text();delivered.push({event:JSON.parse(body),body,signature:request.headers.get('coffer-signature')});return new Response(null,{status:204})}
  return edge.outbound(request)
 }})
}
