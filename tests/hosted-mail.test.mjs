import test from 'node:test'
import assert from 'node:assert/strict'
import {run,donor,reviewed} from './harness.mjs'

const relay='https://relay.example.test/send'
const bindings={MAIL_PROVIDER:'rer',MAIL_RELAY_URL:relay,MAIL_API_KEY:'synthetic-coffer-3001',MAIL_FROM:'receipts@example.test',RER_INSTALLATION_ID:'synthetic-coffer-3002',RER_MANAGEMENT_ORIGIN:'https://runeditrun.com'}
async function approved(h) {
 await reviewed(h)
 const d=await donor(h,'Synthetic Mail',{email:'synthetic-coffer-3003@example.test'})
 await h.command('gift.record',{donorId:d.id,amount:'250',receivedOn:'2025-08-10',method:'check',goods:'none'})
 const b=await h.command('ack.prepare');await h.command('ack.approve',{batchId:b.id,version:1})
 return {d,b}
}

test('hosted receipt submission uses the selected provider once and retains its acceptance without claiming delivery',async()=>{
 for(const provider of ['rer','sendgrid','resend','cloudflare']) {
  const messages=[]
  await run(async h=>{
   const {b}=await approved(h)
   const sent=await h.command('ack.send',{batchId:b.id,version:2})
   assert.equal(sent.submitted,1);assert.equal(sent.delivered,0)
   const detail=await h.get('/api/coffer/letters/'+b.id),letter=detail.letters[0]
   assert.equal(letter.delivery_status,'submitted');assert.ok(letter.message_id)
   await h.command('ack.send',{batchId:b.id,version:sent.version})
   const wire=provider==='resend'?h.messages:messages
   assert.equal(wire.length,1)
   assert.ok(JSON.stringify(wire[0]).includes('250.00'))
   if(provider==='rer')assert.equal(wire[0].messageKey,letter.attempt_id)
   if(provider!=='sendgrid') {
    await h.command('ack.checkDelivery',{batchId:b.id,version:sent.version+1},{status:503})
    assert.equal(wire.length,1,'Delivery lookup never sends another provider credential to SendGrid')
   }
  },{bindings:{...bindings,MAIL_PROVIDER:provider,MAIL_ACCOUNT_ID:'0123456789abcdef0123456789abcdef'},outbound:async request=>{
   const url=new URL(request.url),body=await request.json();messages.push(body)
   if(provider==='rer') {assert.equal(request.url,relay);return Response.json({messageId:'<synthetic-coffer-3004@relay.example.test>'},{status:202})}
   if(provider==='sendgrid') {assert.equal(url.hostname,'api.sendgrid.com');return new Response(null,{status:202,headers:{'x-message-id':'synthetic-coffer-3005'}})}
   assert.equal(url.hostname,'api.cloudflare.com')
   return Response.json({success:true,errors:[],result:{message_id:'synthetic-coffer-3006',delivered:[],queued:body.to,permanent_bounces:[]}})
  }})
 }
})

test('Managed receipt refusal and uncertain acceptance never retry or claim delivery',async()=>{
 for(const [response,status] of [[()=>new Response(null,{status:429}),'rejected'],[()=>new Response(null,{status:503}),'uncertain'],[()=>Response.json({},{status:202}),'uncertain']]) {
  let calls=0
  await run(async h=>{
   const {b}=await approved(h)
   const sent=await h.command('ack.send',{batchId:b.id,version:2})
   assert.equal((await h.get('/api/coffer/letters/'+b.id)).letters[0].delivery_status,status)
   await h.command('ack.send',{batchId:b.id,version:sent.version});assert.equal(calls,1)
  },{bindings,outbound:async request=>{assert.equal(request.url,relay);calls++;return response()}})
 }
})

test('Managed pledge reminders retain the due consent checks and submit a durable relay attempt only once',async()=>{
 const messages=[]
 await run(async h=>{
  const {d}=await approved(h)
  await h.command('consent.record',{donorIds:[d.id],channel:'email',status:'granted',method:'paper form',evidence:'synthetic-coffer-3007',capturedOn:'2025-01-01'})
  const due=new Date(Date.now()+86400000).toISOString().slice(0,10)
  const p=await h.command('pledge.create',{donorId:d.id,amount:'100',pledgedOn:'2025-01-01',fund:'Unrestricted',installments:[{dueOn:due,amount:'100'}]})
  assert.equal((await h.command('pledge.remind',{pledgeId:p.id})).submitted,1)
  assert.equal((await h.command('pledge.remind',{pledgeId:p.id})).submitted,0)
  assert.equal(messages.length,1);assert.ok(messages[0].messageKey);assert.match(messages[0].text,/100\.00/)
 },{bindings,outbound:async request=>{assert.equal(request.url,relay);messages.push(await request.json());return Response.json({messageId:'<synthetic-coffer-3008@relay.example.test>'},{status:202})}})
})
