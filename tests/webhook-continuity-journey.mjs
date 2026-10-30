import {publicWebhookDns} from './webhook-dns-edge.mjs'
import assert from 'node:assert/strict'
import {run,donor} from './harness.mjs'
import {verifyWebhook} from '../src/coffer/webhooks/receiver.mjs'
import {webhooksContinuityBrowser} from './webhooks-browser.mjs'

const initial='2026-10-27T19:00:00.000Z'
const subscription=(number,events=['donor.created'])=>({name:'synthetic-coffer-'+number,endpoint:'https://receiver.example.test/synthetic-coffer-'+number,events,reviewed:'yes'})

export async function webhookContinuityJourney(){
 const requests=[]
 let blockedDelivery,notifyStarted,releaseRequest,waitingRequest
 await run(async h=>{
  let clock=initial,cookie=h.owner
  const options=extra=>({as:cookie,headers:{'x-test-now':clock},...extra})
  const command=(name,input,extra)=>h.command(name,input,options(extra))
  const state=()=>h.get('/api/coffer/webhooks',options())
  const sub=async id=>(await state()).subscriptions.find(row=>row.id===id)
  const tick=async()=>{const response=await h.request('/cdn-cgi/local/scheduled?cron=*+*+*+*+*&time='+Date.parse(clock),options());assert.equal(response.status,200,await response.text())}
  const create=number=>donor(h,'synthetic-coffer-'+number,{addressLine1:null,email:'synthetic-coffer-'+number+'@example.test'},options())
  const source=await command('webhook.subscribe',subscription(2301))
  const person=await h.person('synthetic-coffer-2302@example.test'),admin=await h.person('synthetic-coffer-2303@example.test','admin')
  const changed={subscriptionId:source.id,version:1,overlapMinutes:10,reviewed:'yes'}
  for(const name of ['webhook.rotate','webhook.recover','webhook.resume','webhook.retireOverlap','webhook.migrateReplay']){
   await command(name,changed,{as:person.cookie,status:403})
   await command(name,changed,{as:'',status:401})
   await command(name,{...changed,reviewed:''},{status:400})
   await command(name,changed,{headers:{origin:'https://elsewhere.test'},status:403})
  }
  const agent=await command('agent.create',{label:'synthetic-coffer-2304'})
  await h.command('webhook.rotate',changed,{as:'',headers:{authorization:'Bearer '+agent.token},status:403})
  const queued=await create(2305)
  const before=(await state()).deliveries.find(row=>row.subject_id===queued.id)
  const rotated=await command('webhook.rotate',changed,{as:admin.cookie})
  assert.notEqual(rotated.secret,source.secret)
  assert.equal((await sub(source.id)).id,source.id,'Rotation preserves the endpoint identity')
  assert.equal((await sub(source.id)).key_generation,2)
  assert.equal(requests.length,0,'Rotation and approval never submit a request')
  await command('webhook.rotate',changed,{status:409})
  await command('webhook.rotate',{...changed,version:2},{status:409})
  await tick()
  const overlap=requests.find(row=>row.deliveryId===before.id)
  assert.ok(overlap)
  assert.equal(overlap.signature.split(',').length,3,'Overlap contains the current and previous signatures')
  for(const key of [source.secret,rotated.secret])assert.equal((await verifyWebhook(key,overlap.signature,overlap.body,Date.parse(clock))).id,before.event_id,'Either receiver key verifies the same stable event')
  await assert.rejects(verifyWebhook('synthetic-coffer-2306',overlap.signature,overlap.body,Date.parse(clock)))
  clock='2026-10-27T19:11:00.000Z'
  const afterExpiry=await create(2307);await tick()
  const single=requests.find(row=>JSON.parse(row.body).data.id===afterExpiry.id)
  assert.equal(single.signature.split(',').length,2)
  await verifyWebhook(rotated.secret,single.signature,single.body,Date.parse(clock))
  await assert.rejects(verifyWebhook(source.secret,single.signature,single.body,Date.parse(clock)),'Expired overlap no longer signs with the old key')
  const again=await command('webhook.rotate',{...changed,version:2})
  await command('webhook.retireOverlap',{subscriptionId:source.id,version:3,reviewed:'yes'})
  assert.equal((await sub(source.id)).previous_key,0)
  const afterRetirement=await create(2308);await tick()
  const retired=requests.find(row=>JSON.parse(row.body).data.id===afterRetirement.id)
  await verifyWebhook(again.secret,retired.signature,retired.body,Date.parse(clock))
  await assert.rejects(verifyWebhook(rotated.secret,retired.signature,retired.body,Date.parse(clock)))
  const target=await command('webhook.subscribe',subscription(2309))
  const wrong=await command('webhook.subscribe',subscription(2310,['gift.created']))
  const migrate={deliveryId:before.id,subscriptionId:target.id,version:1,reviewed:'yes'}
  await command('webhook.migrateReplay',{...migrate,subscriptionId:source.id,version:4},{status:409})
  await command('webhook.migrateReplay',{...migrate,subscriptionId:wrong.id},{status:409})
  const pendingDonor=await create(2311),pending=(await state()).deliveries.find(row=>row.subject_id===pendingDonor.id&&row.subscription_id===source.id)
  await command('webhook.migrateReplay',{...migrate,deliveryId:pending.id},{status:409})
  blockedDelivery=pending.id
  const started=new Promise(resolve=>{notifyStarted=resolve})
  waitingRequest=new Promise(resolve=>{releaseRequest=resolve})
  const inFlight=tick()
  try {
   await started
   assert.equal((await state()).deliveries.find(row=>row.id===pending.id).status,'sending')
   await command('webhook.migrateReplay',{...migrate,deliveryId:pending.id},{status:409})
  }finally{releaseRequest();await inFlight;blockedDelivery=undefined}
  const heldDonor=await create(2316),heldCandidate=(await state()).deliveries.find(row=>row.subject_id===heldDonor.id&&row.subscription_id===source.id)
  await command('webhook.pause',{subscriptionId:source.id,version:4})
  const held=(await state()).deliveries.find(row=>row.id===heldCandidate.id)
  const count=requests.length,replay=await command('webhook.migrateReplay',{...migrate,deliveryId:held.id})
  assert.equal(requests.length,count,'Migration queues only after review and sends nothing itself')
  const migrated=(await state()).deliveries.find(row=>row.id===replay.id)
  assert.equal(migrated.event_id,held.event_id);assert.equal(migrated.replay_of,held.id);assert.equal(migrated.subscription_id,target.id)
  assert.deepEqual((await state()).deliveries.find(row=>row.id===held.id),held,'Migration preserves the complete original delivery')
  await tick()
  const delivered=requests.find(row=>row.deliveryId===replay.id)
  await verifyWebhook(target.secret,delivered.signature,delivered.body,Date.parse(clock))
  const revoked=await command('webhook.subscribe',subscription(2312),{as:admin.cookie})
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'},options())
  await command('webhook.migrateReplay',{...migrate,subscriptionId:revoked.id},{status:409})
  if(process.env.COFFER_WEBHOOK_BROWSER)await webhooksContinuityBrowser({...h,owner:cookie},process.env.COFFER_WEBHOOK_BROWSER,{sourceId:source.id,targetId:target.id,deliveryId:before.id})
  const browserRecoveries=process.env.COFFER_WEBHOOK_BROWSER?await Promise.all([2320,2321].map(number=>command('webhook.subscribe',subscription(number)))):[]
  const recoveryDonor=await create(2313),recoveryDelivery=(await state()).deliveries.find(row=>row.subject_id===recoveryDonor.id&&row.subscription_id===target.id)
  await h.replaceBindings({SESSION_SECRET:'synthetic-coffer-23142314231423142314231423142314'})
  const login=await h.request('/auth/magic-link',{method:'POST',as:'',body:{email:'owner@example.test'},headers:{'x-test-now':clock}})
  assert.equal(login.status,202,await login.text())
  const link=h.messages.findLast(message=>message.subject.startsWith('Your sign-in link')).text.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0]
  const confirmed=await h.request('/auth/confirm',{method:'POST',as:'',body:{token:new URL(link).searchParams.get('token')},headers:{'x-test-now':clock}})
  assert.equal(confirmed.status,303);cookie=confirmed.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
  if(process.env.COFFER_WEBHOOK_BROWSER)await webhooksContinuityBrowser({...h,owner:cookie,get:(path,extra)=>h.get(path,options(extra))},process.env.COFFER_WEBHOOK_BROWSER,{recoveryIds:browserRecoveries.map(row=>row.id)})
  assert.equal((await sub(target.id)).key_available,false,'Real session-secret replacement makes old sealed keys unreadable')
  const submissions=requests.length;await tick()
  assert.equal(requests.length,submissions,'Unreadable keys disclose no event')
  const unavailable=(await state()).deliveries.find(row=>row.id===recoveryDelivery.id)
  assert.equal(unavailable.status,'held');assert.equal(unavailable.attempts,0,'Storage-key failure consumes no network attempts')
  const recovery={subscriptionId:target.id,version:1,reviewed:'yes'}
  await command('webhook.recover',{...recovery,reviewed:''},{status:400})
  const recovered=await command('webhook.recover',recovery)
  assert.notEqual(recovered.secret,target.secret)
  assert.equal((await sub(target.id)).enabled,0,'Fresh-key recovery requires separate approval to resume')
  assert.equal((await sub(target.id)).key_available,true)
  await command('webhook.recover',{...recovery,version:2},{status:409})
  await tick();assert.equal(requests.length,submissions)
  await command('webhook.resume',{...recovery,version:2,reviewed:''},{status:400})
  await command('webhook.resume',{...recovery,version:2})
  await tick();assert.equal(requests.length,submissions,'Resuming never silently requeues held history')
  const recoveredReplay=await command('webhook.replay',{deliveryId:recoveryDelivery.id,reviewed:'yes'});await tick()
  const fresh=requests.find(row=>row.deliveryId===recoveredReplay.id)
  assert.equal((await verifyWebhook(recovered.secret,fresh.signature,fresh.body,Date.parse(clock))).id,recoveryDelivery.event_id)
  await assert.rejects(verifyWebhook(target.secret,fresh.signature,fresh.body,Date.parse(clock)),'Recovery cannot revive or disclose the old key')
  const future=await create(2315);await tick()
  assert.ok(requests.some(row=>JSON.parse(row.body).data.id===future.id),'Explicitly resumed endpoint receives future events')
  const publicState=JSON.stringify(await state())
  for(const secret of [source.secret,rotated.secret,again.secret,target.secret,recovered.secret])assert.ok(!publicState.includes(secret))
  for(const action of ['webhook.rotate','webhook.retireOverlap','webhook.migrateReplay','webhook.recover','webhook.resume']){
   const audit=(await h.get('/api/coffer/audit?action='+action,options())).rows
   assert.ok(audit.length,action+' has attributable audit')
   for(const row of audit)for(const secret of [source.secret,rotated.secret,again.secret,recovered.secret])assert.ok(!row.detail.includes(secret),'Audit contains no signing material')
  }
  await command('donor.erase',{donorId:heldDonor.id,confirm:'ERASE'})
  assert.equal((await state()).deliveries.some(row=>row.event_id===held.event_id),false,'Donor erasure removes source and migrated history together')
 },{entry:'tests/advancing-clock-worker.ts',bindings:{COFFER_TEST_NOW:initial},triggerHandlers:true,outbound:async request=>{
  const dns=publicWebhookDns(request);if(dns)return dns
  assert.equal(new URL(request.url).hostname,'receiver.example.test')
  requests.push({body:await request.text(),signature:request.headers.get('coffer-signature'),deliveryId:request.headers.get('coffer-delivery-id')})
  if(request.headers.get('coffer-delivery-id')===blockedDelivery){notifyStarted();await waitingRequest}
  return new Response(null,{status:204})
 }})
}

if(process.argv[1]?.endsWith('/webhook-continuity-journey.mjs'))await webhookContinuityJourney()
