import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {run,reviewed} from './harness.mjs'

/** The actual public checkout return and approved annual send share the native
 * Email Routing reply door, with only Stripe and SendGrid faked. */
export async function transactionalRepliesJourney(){
 const sent=[],requestId=randomUUID(),now=Math.floor(Date.now()/1000)
 await run(async h=>{
  await reviewed(h)
  await h.api('/api/coffer/giving/campaigns',{name:'Keep reading',slug:'keep-reading',description:'Support local readers.',fund:'Reading',goal:'60000'})
  const response=await h.request('/give/keep-reading/checkout',{method:'POST',as:'',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams({name:'Ana Receipt',email:'ana.receipt@example.org',amount:'25',frequency:'once','cf-turnstile-response':'synthetic-coffer-security-token',requestId}).toString()})
  assert.equal(response.status,303)
  const thanks=await h.request('/giving/thanks?session_id=cs_reply_test',{as:''});assert.equal(thanks.status,200,await thanks.text())
  const donor=(await h.get('/api/coffer/donors')).donors.find(d=>d.email==='ana.receipt@example.org')
  const state=await h.get(`/api/coffer/donors/${donor.id}`)
  assert.equal(state.gifts.length,1)
  const receipt=sent.find(m=>m.custom_args?.coffer_letter_id?.startsWith('receipt-giving-'))
  assert.ok(receipt)
  const receive=async(mail,text,key)=>{
   const to=mail.reply_to.email
   assert.match(to,/^coffer\+[0-9a-f-]{36}@replies\.example\.test$/)
   const response=await h.request('/test-email',{method:'POST',body:{from:'ana.receipt@example.org',to,headers:{subject:'Re: '+mail.subject,'message-id':`<${key}@example.test>`},raw:`Content-Type: text/plain; charset=utf-8\r\n\r\n${text}`}})
   assert.equal(response.status,200);const outcome=await response.json();assert.equal(outcome.rejected,null);assert.deepEqual(outcome.forwarded,['owner@example.test'])
  }
  await receive(receipt,'Thanks for this online receipt.','online-receipt')
  assert.equal((await h.get('/api/coffer/replies'))[0].source_kind,'receipt')
  const annual=await h.command('ack.prepareStatements',{year:Number(state.gifts[0].received_on.slice(0,4)),donorId:donor.id})
  await h.command('ack.approve',{batchId:annual.id,version:1});await h.command('ack.send',{batchId:annual.id,version:2})
  const statement=sent.find(m=>m.subject.includes('annual giving statement'))
  assert.ok(statement)
  await receive(statement,'Please remove me from future email appeals.','annual-statement')
  const replies=await h.get('/api/coffer/replies')
  assert.deepEqual(replies.map(r=>r.source_kind).sort(),['receipt','statement'])
  assert.equal(replies.find(r=>r.source_kind==='statement').stop_status,'automatic')
  assert.equal((await h.get(`/api/coffer/donors/${donor.id}`)).current.email.status,'withdrawn')
 },{entry:'tests/engagement-worker.ts',bindings:{MAIL_PROVIDER:'sendgrid',COFFER_REPLY_DOMAIN:'replies.example.test',STRIPE_SECRET_KEY:'synthetic-coffer-6000'},outbound:async request=>{
  const u=new URL(request.url)
  if(u.hostname==='api.sendgrid.com'){sent.push(await request.json());return new Response(null,{status:202,headers:{'x-message-id':`transactional-reply-${sent.length}`}})}
  assert.equal(u.hostname,'api.stripe.com')
  if(u.pathname==='/v1/customers')return Response.json({id:'cus_reply_test'})
  if(u.pathname==='/v1/checkout/sessions'&&request.method==='POST')return Response.json({id:'cs_reply_test',url:'https://checkout.stripe.com/c/pay/cs_reply_test'})
  if(u.pathname==='/v1/checkout/sessions/cs_reply_test')return Response.json({id:'cs_reply_test',metadata:{coffer_intent:requestId},customer:'cus_reply_test',currency:'usd',amount_total:2500,status:'complete',payment_status:'paid',payment_intent:'pi_reply_with_a_realistic_processor_reference'})
  if(u.pathname==='/v1/payment_intents/pi_reply_with_a_realistic_processor_reference')return Response.json({id:'pi_reply_with_a_realistic_processor_reference',status:'succeeded',currency:'usd',amount_received:2500,created:now})
  assert.fail(`Unexpected Stripe edge ${u.pathname}`)
 }})
}
