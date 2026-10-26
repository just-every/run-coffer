import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'

async function poll(read,accept,label){
 const deadline=Date.now()+120000
 let nextProgress=Date.now()+30000
 while(Date.now()<deadline){
  const value=await read(Math.max(1,Math.min(30000,deadline-Date.now())))
  const found=accept(value)
  if(found)return found
  if(Date.now()>=nextProgress){console.log(JSON.stringify({stage:'stripe-webhook-wait',waitingFor:label}));nextProgress+=30000}
  await new Promise(resolve=>setTimeout(resolve,Math.min(2000,Math.max(0,deadline-Date.now()))))
 }
 throw Error('Actual Stripe webhook delivery did not produce '+label+' within 120 seconds')
}

export async function proveStripeDelivery({stripe,app,receiver,query,db,subscriptionId}){
 const owned=await stripe.charge()
 console.log(JSON.stringify({stage:'stripe-test-charge-created',...owned,livemode:false}))
 const readHistory=timeout=>app.json('/api/coffer/webhooks',undefined,{timeout})
 const giftId='stripe-'+owned.chargeId,donorId='stripe-donor-'+owned.customerId
 const gift=await poll(readHistory,log=>log.deliveries.find(row=>row.subscription_id===subscriptionId&&row.event_type==='gift.created'&&row.subject_id===giftId),'native Stripe gift event')
 const eventId=await stripe.event('charge.succeeded',owned.chargeId)
 const donor=await app.json('/api/coffer/donors/'+encodeURIComponent(donorId))
 const recorded=donor.gifts.find(row=>row.id===giftId)
 assert.ok(recorded,'The hosted native donor history contains the Stripe gift')
 assert.equal(recorded.source,'stripe');assert.equal(recorded.reference,owned.chargeId);assert.equal(recorded.amount_cents,1234)
 const before=await receiver.controlled('state')
 await app.controlled('tick',{at:new Date(Math.max(Date.now(),Date.parse(gift.next_at))+1000).toISOString()})
 const failed=(await readHistory(30000)).deliveries.find(row=>row.id===gift.id)
 assert.equal(failed.status,'failed');assert.equal(failed.last_status,503)
 await app.controlled('tick',{at:failed.next_at})
 const delivered=(await readHistory(30000)).deliveries.find(row=>row.id===gift.id)
 assert.equal(delivered.status,'delivered');assert.equal(delivered.attempts,2)
 const after=await receiver.controlled('state')
 const signedBody=JSON.stringify({id:gift.event_id,type:'gift.created',occurredAt:gift.occurred_at,data:{id:giftId}})
 const receipts=after.receipts.filter(row=>row.event_id===gift.event_id)
 assert.equal(receipts.length,2,'Actual Stripe ingestion reaches the actual signed HTTPS receiver and retries')
 assert.ok(receipts.every(row=>row.body_sha256===createHash('sha256').update(signedBody).digest('hex')))
 assert.equal(after.seen.filter(row=>row.event_id===gift.event_id).length,1)
 assert.equal(after.business[0].gifts,before.business[0].gifts+1,'Stripe gift commits one durable business effect')
 const incoming=await poll(timeout=>query(db,'SELECT id,type FROM cf_giving_events WHERE id=?',[eventId],timeout),rows=>rows[0].results[0],'completed actual charge event')
 assert.equal(incoming.type,'charge.succeeded','Production Stripe signature verification accepted the actual provider event')
 console.log(JSON.stringify({stage:'stripe-hosted-delivery-proven',...owned,stripeEventId:eventId,giftId,outgoingEventId:gift.event_id,receiverSubmissions:receipts.length,livemode:false}))
 const refundId=await stripe.refund()
 const reversal=await poll(readHistory,log=>log.deliveries.find(row=>row.subscription_id===subscriptionId&&row.event_type==='gift.reversed'),'native processor reversal event')
 const refundEventId=await stripe.event('charge.refunded',owned.chargeId)
 const refunded=await poll(timeout=>query(db,'SELECT id,type FROM cf_giving_events WHERE id=?',[refundEventId],timeout),rows=>rows[0].results[0],'completed actual charge refund event')
 assert.equal(refunded.type,'charge.refunded')
 const updated=await app.json('/api/coffer/donors/'+encodeURIComponent(donorId))
 const ledger=updated.gifts.find(row=>row.id===reversal.subject_id)
 assert.ok(ledger,'The real refund appears in native donor history')
 assert.equal(ledger.kind,'reversal');assert.equal(ledger.amount_cents,-1234);assert.equal(ledger.reverses,giftId)
 await app.controlled('tick',{at:new Date(Math.max(Date.now(),Date.parse(reversal.next_at))+1000).toISOString()})
 assert.equal((await readHistory(30000)).deliveries.find(row=>row.id===reversal.id).status,'delivered')
 const final=await receiver.controlled('state')
 const received=final.receipts.filter(row=>row.event_id===reversal.event_id)
 assert.equal(received.length,1,'The actual processor reversal reaches the signed HTTPS receiver')
 const body=JSON.stringify({id:reversal.event_id,type:'gift.reversed',occurredAt:reversal.occurred_at,data:{id:reversal.subject_id}})
 assert.equal(received[0].body_sha256,createHash('sha256').update(body).digest('hex'))
 assert.equal(final.seen.filter(row=>row.event_id===reversal.event_id).length,1)
 assert.equal(final.business[0].gifts,after.business[0].gifts,'A reversal cannot apply another gift effect')
 console.log(JSON.stringify({stage:'stripe-hosted-refund-proven',chargeId:owned.chargeId,refundId,stripeEventId:refundEventId,nativeReversalId:reversal.subject_id,outgoingEventId:reversal.event_id,livemode:false}))
 return {...owned,giftId,stripeEventId:eventId,refundId,refundEventId}
}
