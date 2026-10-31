import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {run,donor} from './harness.mjs'
import {dnsAnswer,dnsRecord,webhookDnsQuestion} from './webhook-dns-edge.mjs'
import {webhooksNetworkBrowser} from './webhooks-browser.mjs'

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const publicIp=type=>type===1?'93.184.216.34':'2606:4700:4700::1111'
const normal=q=>dnsAnswer(q,[dnsRecord(q.name,q.type,publicIp(q.type))])
const endpoint='https://receiver.example.test/network'

// A truncated response must not qualify even if its received JSON is parseable.
const framed=async(q,delta)=>{
 const body=await normal(q).text(),length=new TextEncoder().encode(body).length
 return new Response(body,{headers:{'content-type':'application/dns-json','content-length':String(length+delta)}})
}

/** Native subscription, gift, minute Cron and log readback; only network edges are faked. */
export async function webhookNetworkJourney(){
 let answer=q=>framed(q,0),block,receiverStatus=204,clock='2026-10-27T12:00:00.000Z'
 const submitted=[],resolved=[],probe=(point,output)=>console.log('PROBE API-002 '+point+': native subscription, gift, minute Cron and log -> '+output)
 await run(async h=>{
  const options=()=>({headers:{'x-test-now':clock}})
  const command=(name,p,extra={})=>h.command(name,p,{...options(),...extra})
  const state=()=>h.get('/api/coffer/webhooks')
  const tick=async()=>{const response=await h.request('/cdn-cgi/local/scheduled?cron=*+*+*+*+*&time='+Date.parse(clock));assert.equal(response.status,200,await response.text())}
  const subscribe=(name,extra={})=>command('webhook.subscribe',{name,endpoint,events:['gift.created'],reviewed:'yes'},extra)
  const signed=await subscribe('Synthetic network review')
  const d=await donor(h,'Synthetic network donor',{email:null,addressLine1:null},options())
  const gift=async()=>command('gift.record',{donorId:d.id,amount:'42.50',receivedOn:'2026-10-26',method:'cash',goods:'none'})
  const delivery=async id=>(await state()).deliveries.find(row=>row.subject_id===id)
  const successful=await gift()
  block={family:28,entered:deferred(),release:deferred()}
  const initialTicks=Promise.all([tick(),tick()])
  try {
   await block.entered.promise
   assert.equal(submitted.length,0,'Signed bytes wait for both address families to finish resolving')
  }finally{block.release.resolve();await initialTicks;block=null}
  const accepted=await delivery(successful.id),capture=submitted.find(row=>row.deliveryId===accepted.id)
  assert.equal(accepted.status,'delivered');assert.equal(accepted.attempts,1)
  assert.equal(submitted.filter(row=>row.deliveryId===accepted.id).length,1,'Concurrent minute ticks submit only once')
  const exact=JSON.stringify({id:accepted.event_id,type:'gift.created',occurredAt:accepted.occurred_at,data:{id:successful.id}})
  assert.equal(capture.body,exact,'Public answers submit the exact identifier-only bytes')
  const timestamp=String(Date.parse(clock)/1000)
  assert.equal(capture.signature,`t=${timestamp},v1=${createHmac('sha256',signed.secret).update(timestamp+'.'+exact).digest('hex')}`)
  assert.deepEqual(resolved.slice(0,2).map(q=>q.type).sort((a,b)=>a-b),[1,28],'Every delivery resolves both families')
  probe('public-and-concurrency','one exact signed submission and one retained attempt')

  // A private destination consumes the same six bounded attempts without target traffic.
  answer=q=>dnsAnswer(q,[dnsRecord(q.name,q.type,q.type===1?'127.0.0.1':publicIp(q.type))])
  const privateGift=await gift();let stopped=await delivery(privateGift.id),previousDelay=0
  const before=submitted.length
  for(let n=1;n<=6;n++){
   clock=stopped.next_at;await tick();stopped=await delivery(privateGift.id)
   assert.equal(stopped.attempts,n)
   assert.equal(stopped.status,n===6?'exhausted':'failed')
   assert.equal(stopped.last_status,null);assert.equal(stopped.last_failure_code,'dns_nonpublic')
   const delay=Date.parse(stopped.next_at)-Date.parse(clock)
   assert.ok(delay>previousDelay);previousDelay=delay
   if(n===1){clock=new Date(Date.parse(stopped.next_at)-1).toISOString();await tick();assert.equal((await delivery(privateGift.id)).attempts,1,'DNS refusal still respects backoff')}
  }
  assert.equal(submitted.length,before,'Private DNS answers never submit signed bytes')
  assert.equal((await state()).attempts.filter(row=>row.delivery_id===stopped.id).length,6)
  probe('backoff','six DNS refusals, increasing delays, zero target requests')

  // Cases share the native dangerous path and independently assert no receiver request.
  const cases=[]
  for(const ip of ['0.0.0.0','10.1.2.3','100.64.0.1','169.254.169.254','172.16.0.1','192.168.1.2','192.0.2.1','198.18.0.1','224.0.0.1','255.255.255.255'])cases.push([ip,'dns_nonpublic',q=>dnsAnswer(q,[dnsRecord(q.name,q.type,q.type===1?ip:publicIp(q.type))])])
  for(const ip of ['::1','::','fc00::1','fe80::1','::ffff:7f00:1','64:ff9b::7f00:1','2001:db8::1','2002:7f00:1::','3ffe::1','3fff::1'])cases.push([ip,'dns_nonpublic',q=>dnsAnswer(q,[dnsRecord(q.name,q.type,q.type===28?ip:publicIp(q.type))])])
  cases.push(
   ['mixed A','dns_nonpublic',q=>dnsAnswer(q,[dnsRecord(q.name,q.type,publicIp(q.type)),...(q.type===1?[dnsRecord(q.name,1,'10.0.0.1')]:[])])],
   ['mixed AAAA','dns_nonpublic',q=>dnsAnswer(q,[dnsRecord(q.name,q.type,publicIp(q.type)),...(q.type===28?[dnsRecord(q.name,28,'fd00::1')]:[])])],
   ['competing family failures','dns_nonpublic',q=>q.type===1?dnsAnswer(q,[dnsRecord(q.name,1,'127.0.0.1')]):new Response('{synthetic-coffer-2',{headers:{'content-type':'application/dns-json'}})],
   ['unsafe alias','dns_alias_unsafe',q=>dnsAnswer(q,[dnsRecord(q.name,5,'service.localhost.')])],
   ['literal alias','dns_alias_unsafe',q=>dnsAnswer(q,[dnsRecord(q.name,5,'127.0.0.1.')])],
   ['alias cycle','dns_alias_unsafe',q=>dnsAnswer(q,[dnsRecord(q.name,5,'alias.example.test.'),dnsRecord('alias.example.test',5,q.name+'.')])],
   ['alias disagreement','dns_alias_unsafe',q=>dnsAnswer(q,[dnsRecord(q.name,5,(q.type===1?'one':'two')+'.example.test.'),dnsRecord((q.type===1?'one':'two')+'.example.test',q.type,publicIp(q.type))])],
   ['alias depth','dns_alias_unsafe',q=>dnsAnswer(q,[...Array.from({length:10},(_,i)=>dnsRecord(i?'alias'+i+'.example.test':q.name,5,'alias'+(i+1)+'.example.test.')),dnsRecord('alias10.example.test',q.type,publicIp(q.type))])],
   ['alias private target','dns_nonpublic',q=>dnsAnswer(q,[dnsRecord(q.name,5,'alias.example.test.'),dnsRecord('alias.example.test',q.type,q.type===1?'127.0.0.1':publicIp(q.type))])],
   ['partial alias','dns_incomplete',q=>dnsAnswer(q,[dnsRecord(q.name,5,'alias.example.test.')])],
   ['no answer','dns_incomplete',q=>dnsAnswer(q,[])],
   ['truncated','dns_incomplete',q=>dnsAnswer(q,[dnsRecord(q.name,q.type,publicIp(q.type))],{TC:true})],
   ['malformed JSON','dns_malformed',()=>new Response('{synthetic-coffer-1',{headers:{'content-type':'application/dns-json'}})],
   ['wrong resolver media type','dns_malformed',()=>new Response('synthetic-coffer-3',{headers:{'content-type':'text/html'}})],
   ['invalid resolver UTF-8','dns_malformed',()=>new Response(new Uint8Array([0xff]),{headers:{'content-type':'application/dns-json'}})],
   ['oversized resolver response','dns_malformed',()=>new Response(' '.repeat(65537),{headers:{'content-type':'application/dns-json'}})],
   ['malformed address','dns_malformed',q=>dnsAnswer(q,[dnsRecord(q.name,q.type,q.type===1?'999.1.2.3':publicIp(q.type))])],
   ['wrong question','dns_malformed',q=>dnsAnswer({...q,name:'foreign.example.test'},[dnsRecord(q.name,q.type,publicIp(q.type))])],
   ['missing family','dns_incomplete',q=>q.type===1?normal(q):dnsAnswer(q,[])],
   ['malformed negative authority','dns_malformed',q=>q.type===1?normal(q):dnsAnswer(q,[],{Authority:[dnsRecord('example.test',6,'invalid..example.test. hostmaster.example.test. 1 3600 600 86400 60')]})],
   ['unavailable family','dns_unavailable',q=>q.type===1?normal(q):new Response('synthetic-coffer-private-resolver-body',{status:503})],
   ['truncated public A response','dns_unavailable',q=>q.type===1?framed(q,1):normal(q)],
   ['truncated public AAAA response','dns_unavailable',q=>q.type===28?framed(q,1):normal(q)],
   ['NXDOMAIN','dns_unavailable',q=>dnsAnswer(q,[],{Status:3})],
   ['resolver failure','dns_unavailable',()=>{throw Error('synthetic-coffer-private-resolver-error')}],
   ['resolver redirect','dns_unavailable',()=>new Response(null,{status:302,headers:{location:'https://redirect.example.test/private'}})],
  )
  const refusals=[]
  for(const [label,code,edge] of cases){
   answer=edge;const g=await gift(),count=submitted.length;await tick()
   const row=await delivery(g.id),attempts=(await state()).attempts.filter(a=>a.delivery_id===row.id)
   assert.equal(row.last_failure_code,code,label);assert.equal(row.status,'failed',label)
   assert.equal(row.last_status,null,label);assert.equal(attempts.length,1,label)
   assert.equal(attempts[0].failure_code,code,label);assert.equal(attempts[0].http_status,null,label)
   assert.equal(submitted.length,count,label+' sends no target request')
   refusals.push({id:row.id,code,label})
  }
  probe('refusals','private IPv4 and IPv6, retired 6bone, mixed answers, unsafe chains and incomplete, malformed or unavailable resolution refused, including truncated A and AAAA responses')
  const logs=JSON.stringify(await state())
  for(const privateValue of ['127.0.0.1','fd00::1','synthetic-coffer-private-resolver','93.184.216.34','2606:4700'])assert.equal(logs.includes(privateValue),false,'Readback retains no answers or network diagnostics')
  if(process.env.COFFER_WEBHOOK_BROWSER)await webhooksNetworkBrowser(h,process.env.COFFER_WEBHOOK_BROWSER,refusals)

  // Reviewed replay resolves again and retains original event identity and lineage.
  answer=q=>dnsAnswer(q,[dnsRecord(q.name,5,'alias.example.test.'),dnsRecord('alias.example.test',q.type,publicIp(q.type))])
  const replay=await command('webhook.replay',{deliveryId:stopped.id,reviewed:'yes'})
  await tick()
  const replayRow=(await state()).deliveries.find(row=>row.id===replay.id)
  assert.equal(replayRow.status,'delivered');assert.equal(replayRow.replay_of,stopped.id);assert.equal(replayRow.event_id,stopped.event_id)
  assert.equal((await state()).deliveries.find(row=>row.id===stopped.id).status,'exhausted','Replay preserves terminal original')
  assert.ok(submitted.some(row=>row.deliveryId===replay.id),'A complete public alias chain permits submission')
  // A complete negative AAAA response permits an ordinary IPv4-only public receiver.
  answer=q=>q.type===1?normal(q):dnsAnswer(q,[],{Authority:[dnsRecord('example.test',6,'ns.example.test. hostmaster.example.test. 1 3600 600 86400 60')]})
  const v4=await gift();await tick();assert.equal((await delivery(v4.id)).status,'delivered')
  // An IPv6-only receiver needs the same complete negative proof for A.
  answer=q=>q.type===28?normal(q):dnsAnswer(q,[],{Authority:[dnsRecord('example.test',6,'ns.example.test. hostmaster.example.test. 1 3600 600 86400 60')]})
  const v6=await gift();await tick()
  const v6Delivery=await delivery(v6.id)
  assert.equal(v6Delivery.status,'delivered')
  const v6Capture=submitted.find(row=>row.deliveryId===v6Delivery.id)
  const v6Bytes=JSON.stringify({id:v6Delivery.event_id,type:'gift.created',occurredAt:v6Delivery.occurred_at,data:{id:v6.id}})
  assert.equal(v6Capture.body,v6Bytes,'Complete public IPv6-only resolution submits the exact event bytes')
  assert.equal(v6Capture.signature,`t=${Date.parse(clock)/1000},v1=${createHmac('sha256',signed.secret).update(String(Date.parse(clock)/1000)+'.'+v6Bytes).digest('hex')}`)
  answer=normal;receiverStatus=302
  const redirect=await gift(),redirectCount=submitted.length;await tick()
  assert.equal(submitted.length,redirectCount+1,'A target redirect is not followed')
  assert.equal((await delivery(redirect.id)).last_status,302);assert.equal((await delivery(redirect.id)).status,'failed')
  assert.equal(JSON.stringify(await state()).includes('synthetic-coffer-private-receiver-body'),false,'Receiver response bodies stay private')
  receiverStatus=204
  probe('replay-and-redirect','public alias replay preserves identity; redirect refused; no response bytes retained')

  // Pause, version and current approver changes while native DNS is in flight.
  const duringResolution=async(change,expected='held')=>{
   const g=await gift(),row=await delivery(g.id),count=submitted.length
   block={entered:deferred(),release:deferred()};answer=normal
   const pending=tick()
   try {await block.entered.promise;await change(row)}finally{block.release.resolve();await pending;block=null}
   assert.equal(submitted.length,count,'In-flight change refuses disclosure')
   if(expected==='erased')assert.equal((await state()).deliveries.some(d=>d.id===row.id),false)
   else {const current=(await state()).deliveries.find(d=>d.id===row.id);assert.equal(current.status,expected);assert.equal(current.attempts,0,'Authority hold consumes no target attempt')}
  }
  await duringResolution(()=>command('webhook.pause',{subscriptionId:signed.id,version:1}))
  await command('webhook.resume',{subscriptionId:signed.id,version:2,reviewed:'yes'})
  await duringResolution(()=>command('webhook.rotate',{subscriptionId:signed.id,version:3,overlapMinutes:0,reviewed:'yes'}))
  await duringResolution(()=>command('donor.erase',{donorId:d.id,confirm:'ERASE'}),'erased')
  assert.equal((await state()).deliveries.length,0,'Erasure removes all failed, replay and in-flight identifiers')
  answer=normal;receiverStatus=503
  const retryDonor=await donor(h,'Synthetic retry donor',{email:null,addressLine1:null},options())
  const retryGift=await command('gift.record',{donorId:retryDonor.id,amount:'7.50',receivedOn:'2026-10-26',method:'cash',goods:'none'})
  await tick()
  let retry=await delivery(retryGift.id)
  assert.equal(retry.last_status,503);assert.equal(retry.last_failure_code,null)
  const sentBeforeDnsChange=submitted.length
  answer=q=>dnsAnswer(q,[dnsRecord(q.name,q.type,q.type===28?'fd00::1':publicIp(q.type))])
  clock=retry.next_at;await tick();retry=await delivery(retryGift.id)
  assert.equal(retry.last_failure_code,'dns_nonpublic');assert.equal(submitted.length,sentBeforeDnsChange,'An approved retry rechecks changed DNS before disclosure')
  answer=normal;receiverStatus=204;clock=retry.next_at;await tick();retry=await delivery(retryGift.id)
  assert.equal(retry.status,'delivered');assert.equal(retry.last_failure_code,null);assert.equal(retry.last_status,204)
  const retries=(await state()).attempts.filter(a=>a.delivery_id===retry.id)
  assert.deepEqual(retries.map(a=>a.failure_code),[null,'dns_nonpublic',null],'A later success clears only the latest failure, preserving all attempt outcomes')
  probe('dns-change-on-retry','approved retry refuses a newly private answer; later public success clears the current refusal and preserves history')
  await command('webhook.pause',{subscriptionId:signed.id,version:4})
  const admin=await h.person(['synthetic-coffer-2401','example.test'].join(String.fromCharCode(64)),'admin')
  const approved=await subscribe('Synthetic current approver',{as:admin.cookie})
  const newDonor=await donor(h,'Synthetic authority donor',{email:null,addressLine1:null},options())
  const g=await command('gift.record',{donorId:newDonor.id,amount:'12.00',receivedOn:'2026-10-26',method:'cash',goods:'none'})
  block={entered:deferred(),release:deferred()};const count=submitted.length,pending=tick()
  try {await block.entered.promise;await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})}finally{block.release.resolve();await pending;block=null}
  const revoked=await delivery(g.id)
  assert.equal(revoked.subscription_id,approved.id);assert.equal(revoked.status,'held');assert.equal(revoked.attempts,0)
  assert.equal(submitted.length,count,'Current approver revocation during resolution prevents target submission')
  probe('current-authority-and-erasure','in-flight pause, version change, revocation and erasure produce zero disclosure')

  await h.api('/auth/operator/status',{operatorId:admin.id,status:'active'})
  await tick()
  assert.equal((await state()).subscriptions.find(s=>s.id===approved.id).approved,0,'Reactivating the approver does not revive old endpoint approval')
  assert.equal((await delivery(g.id)).status,'held')
  assert.equal(submitted.length,count,'Reactivated credentials cannot disclose held history')
  await command('webhook.pause',{subscriptionId:approved.id,version:1})

  const roleAdmin=await h.person(['synthetic-coffer-2402','example.test'].join(String.fromCharCode(64)),'admin')
  const roleEndpoint=await subscribe('Synthetic restored role',{as:roleAdmin.cookie})
  const roleGift=await command('gift.record',{donorId:newDonor.id,amount:'15.00',receivedOn:'2026-10-26',method:'cash',goods:'none'})
  block={entered:deferred(),release:deferred()};const roleCount=submitted.length,rolePending=tick()
  try {
   await block.entered.promise
   await h.api('/auth/operator/role',{operatorId:roleAdmin.id,role:'member'})
   await h.api('/auth/operator/role',{operatorId:roleAdmin.id,role:'admin'})
  }finally{block.release.resolve();await rolePending;block=null}
  const roleHeld=await delivery(roleGift.id)
  assert.equal(roleHeld.subscription_id,roleEndpoint.id);assert.equal(roleHeld.status,'held');assert.equal(roleHeld.attempts,0)
  assert.equal(submitted.length,roleCount,'Restoring the role before DNS completes cannot reuse stale approval')
  assert.equal((await state()).subscriptions.find(s=>s.id===roleEndpoint.id).approved,0)
  const unapprovedGift=await command('gift.record',{donorId:newDonor.id,amount:'16.00',receivedOn:'2026-10-26',method:'cash',goods:'none'})
  await tick()
  assert.equal(await delivery(unapprovedGift.id),undefined,'Stale approval cannot queue new disclosure either')
  assert.equal(submitted.length,roleCount)
  await command('webhook.pause',{subscriptionId:roleEndpoint.id,version:1})
  await command('webhook.resume',{subscriptionId:roleEndpoint.id,version:2,reviewed:'yes'})
  await tick()
  assert.equal(submitted.length,roleCount,'Fresh future-event approval never requeues held history')
  const freshGift=await command('gift.record',{donorId:newDonor.id,amount:'17.00',receivedOn:'2026-10-26',method:'cash',goods:'none'})
  await tick()
  const freshDelivery=await delivery(freshGift.id),freshCapture=submitted.find(row=>row.deliveryId===freshDelivery.id)
  assert.equal(freshDelivery.status,'delivered');assert.equal(submitted.length,roleCount+1)
  const freshBytes=JSON.stringify({id:freshDelivery.event_id,type:'gift.created',occurredAt:freshDelivery.occurred_at,data:{id:freshGift.id}})
  assert.equal(freshCapture.body,freshBytes)
  assert.equal(freshCapture.signature,`t=${Date.parse(clock)/1000},v1=${createHmac('sha256',roleEndpoint.secret).update(String(Date.parse(clock)/1000)+'.'+freshBytes).digest('hex')}`)
  assert.equal((await delivery(roleGift.id)).status,'held','Fresh approval preserves the original authority hold')
  assert.equal((await delivery(g.id)).status,'held','An unrelated reviewed endpoint cannot revive revoked history')
  probe('restored-authority','reactivated account and restored role retain stale-approval holds; explicit review permits only new exact signed delivery')
 },{entry:'tests/advancing-clock-worker.ts',triggerHandlers:true,bindings:{COFFER_TEST_NOW:clock},outbound:async request=>{
  const q=webhookDnsQuestion(request)
  if(q){resolved.push(q);if(block&&q.type===(block.family??1)){block.entered.resolve();await block.release.promise}return answer(q)}
  assert.equal(request.url,endpoint,'No resolver or receiver redirect may be followed')
  submitted.push({body:await request.text(),signature:request.headers.get('coffer-signature'),deliveryId:request.headers.get('coffer-delivery-id')})
  return new Response(receiverStatus===204?null:'synthetic-coffer-private-receiver-body',{status:receiverStatus,headers:{location:'https://redirect.example.test/private'}})
 }})
}
if(process.argv[1]?.endsWith('/webhook-network-journey.mjs'))await webhookNetworkJourney()
