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
  const people=[]
  for(const [name,email] of [['Cameron Rivera','synthetic-coffer-860@example.test'],['Alex Rivera','synthetic-coffer-864@example.test']])people.push(await donor(h,name,{email,household:'Rivera household'}))
  const gifts=[]
  for(const person of people)gifts.push(await h.command('gift.record',{donorId:person.id,amount:'250',receivedOn:'2025-08-10',method:'check',goods:'none'}))
  const batch=await h.command('ack.prepare',{giftIds:gifts.map(g=>g.id),onePiecePer:'household'})
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
  assert.equal(attempt.documents,2);assert.equal(sent.remaining,0)
  const held=await h.get(`/api/coffer/letters/${batch.id}`)
  assert.equal(held.letters.length,2);assert.deepEqual(held.letters.map(l=>l.gift_id).sort(),gifts.map(g=>g.id).sort())
  assert.equal(new Set(held.letters.map(l=>l.attempt_id)).size,2)
  for(const letter of held.letters){assert.equal(letter.delivery_status,'uncertain');assert.equal(letter.route,'postal');assert.ok(letter.attempt_id);assert.equal(letter.message_id,null)}
  assert.deepEqual(held.deliveryEvents,[])
  for(const person of people)assert.equal((await h.get(`/api/coffer/donors/${person.id}`)).gifts[0].acknowledgment.status,'not acknowledged')
  const repeated=await h.command('ack.sendPostal',{...input,version:sent.version})
  assert.deepEqual(repeated.postal,sent.postal)
  assert.equal(requests.length,1,'A second owner action must not retry a transport-uncertain piece')
  const snapshot=await archive(h),fresh=await installation({outboundService,bindings:{LOB_ENABLED:'true',LOB_API_KEY:'synthetic-coffer-861',LOB_WEBHOOK_SECRET:'synthetic-coffer-862',LOB_FROM_ADDRESS_ID:'synthetic-coffer-863'}})
  try{
   await restore(fresh,snapshot)
   const restored=await fresh.get(`/api/coffer/letters/${batch.id}`)
   assert.deepEqual(restored.letters.map(l=>[l.id,l.attempt_id,l.delivery_status]).sort(),held.letters.map(l=>[l.id,l.attempt_id,'uncertain']).sort())
   const afterRestart=await fresh.command('ack.sendPostal',{...input,version:restored.batch.version})
   assert.deepEqual(afterRestart.postal,sent.postal)
   assert.equal(requests.length,1,'A restored installation must preserve the permanent uncertain attempt')
  }finally{await fresh.close()}
 },{outboundService,bindings:{LOB_ENABLED:'true',LOB_API_KEY:'synthetic-coffer-861',LOB_WEBHOOK_SECRET:'synthetic-coffer-862',LOB_FROM_ADDRESS_ID:'synthetic-coffer-863'}})
}
