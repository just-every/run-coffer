import {test} from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync,sign} from 'node:crypto'
const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),publicKey=keys.publicKey.export({type:'spki',format:'der'}).toString('base64')
import {run,donor,reviewed} from './harness.mjs'
test('the agent queues small missing and bounced receipts for review, never sends them unseen, and can undo its batch',async()=>{
 await run(async h=>{
  await reviewed(h)
  const d=await donor(h,'Lena Brooks')
  const gift=await h.command('gift.record',{donorId:d.id,amount:'25',receivedOn:'2026-01-10',method:'cash',fund:'Reading',goods:'none'})
  let result=await h.api('/api/coffer/agent/receipts/queue',{})
  assert.equal(result.queued,1)
  let b=await h.get('/api/coffer/letters/'+result.id)
  assert.equal(b.batch.status,'prepared')
  assert.equal(b.letters[0].gift_id,gift.id)
  assert.equal(b.letters[0].route,'pending')
  assert.equal(h.messages.length,0)
  assert.equal((await h.api('/api/coffer/agent/receipts/queue',{})).queued,0)
  const activity=(await h.get('/api/coffer/agent')).activity.find(a=>a.kind==='receipts.prepare')
  await h.api('/api/coffer/agent/activity/undo',{id:activity.id})
  b=await h.get('/api/coffer/letters/'+result.id)
  assert.equal(b.batch.status,'discarded')
  result=await h.api('/api/coffer/agent/receipts/queue',{})
  await h.command('consent.record',{donorIds:[d.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic donor permits email',capturedOn:'2026-01-01'})
  await h.command('ack.approve',{batchId:result.id,version:1})
  await h.command('ack.send',{batchId:result.id,version:2})
  const letter=(await h.get('/api/coffer/letters/'+result.id)).letters[0]
  const timestamp=String(Math.floor(Date.now()/1000)),raw=JSON.stringify([{event:'bounce',sg_event_id:'agent-bounce',timestamp:Number(timestamp),coffer_letter_id:letter.id,coffer_attempt_id:letter.attempt_id}])
  const bounce=await h.request('/api/coffer/mail/events',{method:'POST',as:'',raw,headers:{'x-twilio-email-event-webhook-timestamp':timestamp,'x-twilio-email-event-webhook-signature':sign('sha256',Buffer.from(timestamp+raw),keys.privateKey).toString('base64')}})
  assert.equal(bounce.status,200)
  const again=await h.api('/api/coffer/agent/receipts/queue',{})
  assert.equal(again.queued,1)
  b=await h.get('/api/coffer/letters/'+again.id)
  assert.equal(b.batch.status,'prepared')
  assert.equal(b.letters[0].route,'pending')
  assert.equal(h.messages.length,0)
  await h.api('/api/coffer/agent/receipts/queue',{},{as:'',status:401})
 },{bindings:{MAIL_PROVIDER:'sendgrid',MAIL_EVENT_PUBLIC_KEY:publicKey},outbound:async r=>{assert.equal(new URL(r.url).hostname,'api.sendgrid.com');return new Response(null,{status:202,headers:{'x-message-id':'agent-receipt-message'}})}})
})
