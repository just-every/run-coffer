import assert from 'node:assert/strict'
import {run,donor} from './harness.mjs'

const at='2026-10-18T02:00:00.000Z'
const endpoint='https://receiver.example.test/history'
const sorted=rows=>rows.map(row=>JSON.stringify(row)).sort()

/** Reconcile retained history against command results and network submissions. */
export async function webhookHistoryJourney(){
 const expected=new Map(),submissions=[]
 let now=Date.parse(at),reject=true
 await run(async h=>{
  const subscription=await h.command('webhook.subscribe',{name:'Riverbend complete history',endpoint,events:['donor.created','gift.created'],reviewed:'yes'},{headers:{'x-test-now':at}})
  const constituent=await donor(h,'History reader',{email:'synthetic-coffer-1850@example.test',addressLine1:null},{headers:{'x-test-now':at}})
  const gift=await h.command('gift.record',{donorId:constituent.id,amount:'42.50',receivedOn:'2026-10-17',method:'check',goods:'none'},{headers:{'x-test-now':at}})
  const initial=await h.get('/api/coffer/webhooks')
  assert.deepEqual(sorted(initial.deliveries.map(row=>[row.subscription_id,row.event_type,row.subject_id,row.replay_of])),sorted([[subscription.id,'donor.created',constituent.id,null],[subscription.id,'gift.created',gift.id,null]]),'Initial native events have exact membership')
  for(const row of initial.deliveries)expected.set(row.id,{id:row.id,subscription_id:subscription.id,event_id:row.event_id,event_type:row.event_type,subject_id:row.subject_id,replay_of:null,status:'exhausted'})
  const tick=async when=>{
   now=when
   const response=await h.request('/cdn-cgi/local/scheduled?cron=*+*+*+*+*&time='+now)
   assert.equal(response.status,200,await response.text())
  }
  // Six explicit due instants leave two retained failures with complete attempts.
  for(const seconds of [0,60,180,420,900,1860])await tick(Date.parse(at)+seconds*1000)
  assert.equal(submissions.length,12,'Both original events submit all six failures')
  reject=false
  const original=initial.deliveries.find(row=>row.subject_id===gift.id)
  const replay=async parent=>{
   const result=await h.command('webhook.replay',{deliveryId:parent.id,reviewed:'yes'},{headers:{'x-test-now':at}})
   const row={...parent,id:result.id,replay_of:parent.id,status:'delivered'}
   expected.set(row.id,row)
   return row
  }
  // Same creation instant crosses multiple page boundaries on the ID tie-breaker.
  const firstReplay=await replay(expected.get(original.id))
  await tick(now+1000)
  const chain=await replay(firstReplay)
  await tick(now+1000)
  await replay(chain)
  for(let index=0;index<205;index++)await replay(expected.get(initial.deliveries[index%2].id))
  // Drain every known pending replay; the scheduler intentionally bounds each tick.
  for(let batch=0;batch<Math.ceil(206/25);batch++)await tick(now+1000)
  assert.equal(submissions.length,12+208,'Every reviewed replay submits once')

  const deliveries=[],attempts=[],deliveryIds=new Set(),attemptIds=new Set(),cursors=new Set()
  let cursor,pages=0,history
  do{
   history=await h.get('/api/coffer/webhooks'+(cursor?'?before='+encodeURIComponent(cursor):''))
   pages++
   for(const row of history.deliveries){
    assert.ok(!deliveryIds.has(row.id),'Complete history must not repeat a delivery')
    deliveryIds.add(row.id);deliveries.push(row)
   }
   for(const row of history.attempts){
    assert.ok(history.deliveries.some(delivery=>delivery.id===row.delivery_id),'Attempt belongs to this delivery page')
    assert.ok(!attemptIds.has(row.id),'Complete history must not repeat an attempt')
    attemptIds.add(row.id);attempts.push(row)
   }
   if(deliveryIds.size===expected.size)assert.equal(history.nextCursor,null,'The final retained delivery page exhausts its cursor')
   cursor=history.nextCursor
   if(cursor){assert.ok(!cursors.has(cursor),'History cursor must advance');cursors.add(cursor)}
   assert.ok(pages<=expected.size+1,'History must reach terminal cursor exhaustion')
  }while(cursor!==null)
  assert.equal(history.nextCursor,null,'Complete history explicitly exhausts its cursor')
  assert.ok(pages>=3,'History reconciliation crosses multiple retained pages')
  assert.deepEqual([...deliveryIds].sort(),[...expected.keys()].sort(),'Complete delivery history matches every expected delivery')
  for(const row of deliveries){
   const want=expected.get(row.id)
   assert.deepEqual(Object.fromEntries(Object.keys(want).map(key=>[key,row[key]])),want,'Complete replay lineage and native event identity are retained')
   assert.equal(row.attempts,submissions.filter(attempt=>attempt.delivery_id===row.id).length,'Delivery attempt count matches actual submissions')
  }
  assert.deepEqual(sorted(attempts.map(row=>[row.delivery_id,row.attempted_at,row.status,row.http_status])),sorted(submissions.map(row=>[row.delivery_id,row.attempted_at,row.status,row.http_status])),'Complete attempt history matches every network submission')
  const last=deliveries.at(-1)
  const exhausted=await h.get('/api/coffer/webhooks?before='+encodeURIComponent(btoa(JSON.stringify([last.created_at,last.id]))))
  assert.deepEqual(exhausted.deliveries,[],'A cursor beyond the final delivery returns no rows')
  assert.deepEqual(exhausted.attempts,[],'Terminal history contains no orphan attempts')
  assert.equal(exhausted.nextCursor,null,'The empty terminal page has no continuation')
 },{entry:'tests/advancing-clock-worker.ts',triggerHandlers:true,outbound:async request=>{
  assert.equal(request.url,endpoint)
  const event=await request.json(),delivery_id=request.headers.get('coffer-delivery-id'),row=expected.get(delivery_id)
  assert.ok(row,'Every network delivery was created through a known native door')
  assert.equal(event.id,row.event_id,'Replay submits its original stable event identity')
  submissions.push({delivery_id,attempted_at:new Date(now).toISOString(),status:reject?'failed':'delivered',http_status:reject?503:204})
  return new Response(null,{status:reject?503:204})
 }})
}
