import assert from 'node:assert/strict'
import {archive,donor,installation,restore,reviewed,run} from './harness.mjs'

// Destroy the native HTTP socket after consuming the request. Throwing in a
// Miniflare Fetch handler produces HTTP 500, which cannot prove fetch rejection.
export async function postalTransportJourney(){
 const requests=[]
 const outboundService={node:async(request,response)=>{
  const chunks=[];for await(const chunk of request)chunks.push(chunk)
  assert.equal(request.method,'POST')
  const body=JSON.parse(Buffer.concat(chunks).toString())
  requests.push({attempt:request.headers['idempotency-key'],body})
  response.destroy()
 }}
 await run(async h=>{
  await reviewed(h)
  const person=await donor(h,'Cameron Rivera',{email:'synthetic-coffer-860@example.test'})
  const gift=await h.command('gift.record',{donorId:person.id,amount:'250',receivedOn:'2025-08-10',method:'check',goods:'none'})
  const batch=await h.command('ack.prepare',{giftIds:[gift.id],onePiecePer:'gift'})
  await h.command('ack.approve',{batchId:batch.id,version:1})
  const approved=await h.get(`/api/coffer/letters/${batch.id}`)
  const input={batchId:batch.id,version:approved.batch.version,contentHash:approved.batch.content_hash,approvePostage:true}
  const sent=await h.command('ack.sendPostal',input)
  assert.equal(requests.length,1,'A rejected fetch must never trigger a second provider request')
  assert.equal(sent.postal.length,1,'Transport uncertainty retains one permanent piece attempt')
  const attempt=sent.postal[0]
  assert.equal(attempt.state,'uncertain');assert.equal(attempt.provider_message_id,null)
  assert.equal(attempt.id,requests[0].attempt)
  assert.equal(attempt.id,requests[0].body.metadata.coffer_attempt_id)
  assert.equal(attempt.piece_id,requests[0].body.metadata.coffer_piece_id)
  assert.equal(attempt.documents,1);assert.equal(sent.remaining,0)
  const held=await h.get(`/api/coffer/letters/${batch.id}`)
  assert.equal(held.letters.length,1);assert.equal(held.letters[0].delivery_status,'uncertain')
  assert.equal(held.letters[0].route,'postal');assert.ok(held.letters[0].attempt_id)
  assert.equal(held.letters[0].message_id,null);assert.deepEqual(held.deliveryEvents,[])
  assert.equal((await h.get(`/api/coffer/donors/${person.id}`)).gifts[0].acknowledgment.status,'not acknowledged')
  const repeated=await h.command('ack.sendPostal',{...input,version:sent.version})
  assert.deepEqual(repeated.postal,sent.postal)
  assert.equal(requests.length,1,'A second owner action must not retry a transport-uncertain piece')
  const snapshot=await archive(h),fresh=await installation({outboundService,bindings:{LOB_ENABLED:'true',LOB_API_KEY:'synthetic-coffer-861',LOB_WEBHOOK_SECRET:'synthetic-coffer-862',LOB_FROM_ADDRESS_ID:'synthetic-coffer-863'}})
  try{
   await restore(fresh,snapshot)
   const restored=await fresh.get(`/api/coffer/letters/${batch.id}`)
   assert.equal(restored.letters[0].attempt_id,held.letters[0].attempt_id)
   assert.equal(restored.letters[0].delivery_status,'uncertain')
   const afterRestart=await fresh.command('ack.sendPostal',{...input,version:restored.batch.version})
   assert.deepEqual(afterRestart.postal,sent.postal)
   assert.equal(requests.length,1,'A restored installation must preserve the permanent uncertain attempt')
  }finally{await fresh.close()}
 },{outboundService,bindings:{LOB_ENABLED:'true',LOB_API_KEY:'synthetic-coffer-861',LOB_WEBHOOK_SECRET:'synthetic-coffer-862',LOB_FROM_ADDRESS_ID:'synthetic-coffer-863'}})
}
