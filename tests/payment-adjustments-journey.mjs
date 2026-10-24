import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {run,reviewed,settings,donor,archive,restore} from './harness.mjs'

// PAY-003 crosses native authentication, refund HTTP, signed webhooks, ledger,
// receipt approval and manager mail. Only Stripe and SendGrid are network fakes.
export async function paymentAdjustmentsJourney() {
 const secret='synthetic_payment_adjustments_webhook',at=Math.floor(Date.now()/1000)
 const objects=new Map(),messages=[],refundCalls=[]
 const options={bindings:{STRIPE_SECRET_KEY:'sk_test_adjustments_edge',STRIPE_WEBHOOK_SECRET:secret,MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:'synthetic_adjustments_mail',MAIL_FROM:'receipts@example.test'},outbound:async request=>{
  const u=new URL(request.url)
  if(u.hostname==='api.sendgrid.com'){
   assert.equal(u.pathname,'/v3/mail/send');messages.push(await request.json())
   return new Response(null,{status:202,headers:{'x-message-id':'adjustment-mail-'+messages.length}})
  }
  assert.equal(u.hostname,'api.stripe.com')
  if(u.pathname==='/v1/refunds'&&request.method==='POST'){
   const body=new URLSearchParams(await request.text()),charge=body.get('charge'),requestId=body.get('metadata[coffer_refund_request]')
   assert.ok(requestId);assert.ok(request.headers.get('idempotency-key'),'Every provider refund has a stable idempotency key')
   assert.match(body.get('amount'),/^\d+$/)
   refundCalls.push({charge,requestId,key:request.headers.get('idempotency-key'),amount:Number(body.get('amount'))})
   if(charge==='ch_adjust_uncertain')throw new Error('Synthetic connection lost after request acceptance')
   const refund={id:'re_'+charge.slice(3),object:'refund',charge,amount:Number(body.get('amount')),currency:'usd',status:charge==='ch_adjust_failed'?'failed':'pending',metadata:{coffer_refund_request:requestId},balance_transaction:null}
   objects.set('/v1/refunds/'+refund.id,refund);return Response.json(refund)
  }
  if(objects.has(u.pathname))return Response.json(objects.get(u.pathname))
  assert.fail(`Unexpected network edge ${request.method} ${u.origin}${u.pathname}`)
 }}
 const event=async(h,id,type,objectId)=>{
  const raw=JSON.stringify({id,type,data:{object:{id:objectId}}}),timestamp=Math.floor(Date.now()/1000)
  const signature=createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex')
  const response=await h.mf.dispatchFetch(h.origin+'/api/coffer/giving/webhook',{method:'POST',headers:{host:new URL(h.origin).host,'stripe-signature':`t=${timestamp},v1=${signature}`},body:raw})
  assert.equal(response.status,200,await response.text())
 }
 const invite=async(h,email,role='member')=>{
  const response=await h.request('/app/people/invite',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams({email,role,displayName:email.startsWith('relationship-manager')?'Ana Rivera':'Sam Ortiz'}).toString()})
  assert.equal(response.status,303,await response.text())
  const mail=messages.findLast(m=>m.personalizations[0].to[0].email===email)
  const link=mail.content.find(c=>c.type==='text/plain').value.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0]
  const confirmed=await h.request('/auth/confirm',{method:'POST',as:'',body:{token:new URL(link).searchParams.get('token')}})
  assert.equal(confirmed.status,303)
  const cookie=confirmed.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
  return {...(await h.get('/auth/session',{as:cookie})).operator,cookie,email}
 }
 const paid=async(h,key,amount=10000)=>{
  const charge={id:'ch_adjust_'+key,object:'charge',paid:true,status:'succeeded',amount,currency:'usd',created:at,metadata:{fund:'Reading'},billing_details:{name:({'half':'Nora Bennett','dispute':'Luis Romero','failed':'Elaine Park','uncertain':'Miles Chen','browser-desktop':'Maya Torres','browser-mobile':'Owen Bell'}[key]??key),email:key+'.adjustment@example.test'},balance_transaction:'txn_adjust_'+key,amount_refunded:0}
  objects.set('/v1/charges/'+charge.id,charge)
  objects.set('/v1/balance_transactions/'+charge.balance_transaction,{id:charge.balance_transaction,type:'charge',source:charge.id,amount,fee:300,net:amount-300,currency:'usd',created:at})
  await event(h,'evt_paid_adjust_'+key,'charge.succeeded',charge.id)
  const donor=(await h.get('/api/coffer/donors')).donors.find(d=>d.email===charge.billing_details.email)
  let gift=(await h.get('/api/coffer/donors/'+donor.id)).gifts[0]
  await h.command('gift.classify',{giftId:gift.id,version:gift.version,goods:'none'})
  gift=(await h.get('/api/coffer/donors/'+donor.id)).gifts.find(g=>g.id===gift.id)
  return {charge,donor,gift}
 }
 const state=h=>h.get('/api/coffer/payments/adjustments')
 const personState=(h,fixture)=>h.get('/api/coffer/donors/'+fixture.donor.id)
 const issue=async(h,giftId)=>{
  const batch=await h.command('ack.prepare',{giftIds:[giftId]})
  await h.command('ack.approve',{batchId:batch.id,version:1});await h.command('ack.send',{batchId:batch.id,version:2})
  return (await h.get('/api/coffer/letters/'+batch.id)).letters[0]
 }
 const screenshot=async(h,stage)=>{
  if(process.env.COFFER_ADJUSTMENTS_BROWSER){const {paymentAdjustmentsBrowser}=await import('./payment-adjustments-browser.mjs');await paymentAdjustmentsBrowser(h,{directory:process.env.COFFER_ADJUSTMENTS_BROWSER,stage})}
 }
 await run(async h=>{
  await reviewed(h)
  await h.command('settings.update',{...settings,threshold:'1.00',version:(await h.get('/api/coffer/settings')).version})
  const empty=await state(h)
  for(const collection of [empty.refunds,empty.disputes,empty.notices,empty.gifts])assert.equal(collection.length,0)
  await screenshot(h,'empty')
  const clerk=await invite(h,'adjustment-clerk@example.test'),manager=await invite(h,'relationship-manager@example.test')
  const half=await paid(h,'half'),contested=await paid(h,'dispute',8000)
  const portfolio=await h.command('portfolio.save',{name:'Reading relationships',managerId:manager.id,untouchedDays:30})
  for(const fixture of [half,contested])await h.command('portfolio.assign',{donorId:fixture.donor.id,portfolioId:portfolio.id})
  const original=await issue(h,half.gift.id)
  half.gift=(await personState(h,half)).gifts.find(g=>g.id===half.gift.id)
  const request={giftId:half.gift.id,amount:'50.00',expectedNetCents:10000,requestId:randomUUID()}
  const post=(input,options)=>h.api('/api/coffer/payments/refunds',input,options)
  await h.get('/api/coffer/payments/adjustments',{as:'',status:401})
  await h.get('/api/coffer/payments/adjustments',{as:clerk.cookie,status:403})
  await post(request,{as:'',status:401});await post(request,{as:clerk.cookie,status:403})
  await post(request,{headers:{origin:'https://other.example.test'},status:403})
  for(const amount of ['0','-1','100.01','1.001'])await post({...request,requestId:randomUUID(),amount},{status:400})
  await post({...request,requestId:randomUUID(),expectedNetCents:9999},{status:409})
  assert.equal(refundCalls.length,0,'Rejected refunds never reach Stripe')
  const requested=await post(request)
  assert.equal(requested.status,'pending');assert.equal(refundCalls.length,1)
  assert.deepEqual(refundCalls[0],{charge:half.charge.id,requestId:request.requestId,key:refundCalls[0].key,amount:5000})
  assert.equal((await post(request)).id,requested.id);assert.equal(refundCalls.length,1)
  await post({...request,amount:'40.00'},{status:409})
  await post({...request,requestId:randomUUID()},{status:409})
  assert.equal((await personState(h,half)).totals.lifetimeCents,10000,'Pending provider refund leaves contribution and receipt valid')
  assert.equal((await h.get('/api/coffer/letters/'+original.batch_id)).letters[0].void_reason,null)
  await event(h,'evt_adjust_refund_pending','refund.updated',requested.refund_id)
  assert.equal((await personState(h,half)).totals.lifetimeCents,10000,'A signed pending refund still has no monetary reversal')
  const successful={...objects.get('/v1/refunds/'+requested.refund_id),status:'succeeded',balance_transaction:'txn_adjust_half_refund'}
  objects.set('/v1/refunds/'+successful.id,successful)
  objects.set('/v1/balance_transactions/'+successful.balance_transaction,{id:successful.balance_transaction,type:'refund',source:successful,amount:-5000,fee:0,net:-5000,currency:'usd',created:at})
  for(const id of ['evt_adjust_refund','evt_adjust_refund','evt_adjust_refund_another'])await event(h,id,'refund.updated',successful.id)
  const refunded=await personState(h,half)
  assert.equal(refunded.totals.lifetimeCents,5000)
  assert.deepEqual(refunded.gifts.find(g=>g.id===half.gift.id),half.gift,'Successful refund adds a reversal and never edits the original')
  assert.equal(refunded.gifts.filter(g=>g.kind==='reversal').length,1)
  assert.equal((await state(h)).refunds.find(r=>r.id===requested.id).status,'succeeded')
  assert.ok((await h.get('/api/coffer/letters/'+original.batch_id)).letters[0].void_reason)
  const replacement=await h.command('ack.correct',{letterId:original.id})
  await h.command('ack.send',{batchId:replacement.id,version:1},{status:409})
  await h.command('ack.approve',{batchId:replacement.id,version:1});await h.command('ack.send',{batchId:replacement.id,version:2})
  const corrected=(await h.get('/api/coffer/letters/'+replacement.id)).letters[0]
  assert.equal(corrected.amount_cents,5000);assert.equal(corrected.replaces_id,original.id)
  assert.ok(corrected.receipt_sequence>original.receipt_sequence)
  assert.ok(messages.some(m=>m.personalizations[0].to[0].email===half.donor.email&&m.content.some(c=>c.value.includes('50.00')&&c.value.includes('Corrected receipt'))),'Approved corrected receipt reaches donor')
  await post({...request,requestId:randomUUID()},{status:409})
  const disputed={id:'dp_adjust_reading',object:'dispute',charge:contested.charge.id,status:'needs_response',evidence_details:{due_by:at+86400,has_evidence:false,past_due:false},balance_transactions:[{id:'txn_adjust_dispute_withdrawal',type:'adjustment',source:'dp_adjust_reading',amount:-8000,fee:1500,net:-9500,currency:'usd',created:at}]}
  objects.set('/v1/disputes/'+disputed.id,disputed)
  await event(h,'evt_adjust_dispute','charge.dispute.created',disputed.id)
  const open=(await state(h)).disputes.find(d=>d.id===disputed.id)
  assert.equal(open.status,'needs_response');assert.equal(open.has_evidence,0)
  assert.equal(Date.parse(open.evidence_due_at),(at+86400)*1000);assert.equal(open.past_due,0)
  assert.equal((await personState(h,contested)).totals.lifetimeCents,0)
  await screenshot(h,'needs-response')
  disputed.status='won';disputed.evidence_details.has_evidence=true
  disputed.balance_transactions.push({id:'txn_adjust_dispute_won',type:'adjustment',source:disputed.id,amount:8000,fee:-1500,net:9500,currency:'usd',created:at})
  for(const id of ['evt_adjust_win','evt_adjust_win','evt_adjust_win_another'])await event(h,id,'charge.dispute.closed',disputed.id)
  const reinstated=await personState(h,contested)
  assert.equal(reinstated.totals.lifetimeCents,8000)
  assert.equal(reinstated.gifts.length,3,'Dispute and reinstatement remain separate immutable ledger entries')
  assert.deepEqual(reinstated.gifts.find(g=>g.id===contested.gift.id),contested.gift)
  const completed=await state(h)
  assert.equal(completed.disputes.find(d=>d.id===disputed.id).status,'won')
  assert.equal(completed.notices.length,3,'Refund, dispute and win each notify the relationship manager exactly once')
  assert.ok(completed.notices.every(n=>n.owner_id===manager.id&&n.status==='submitted'))
  assert.equal(new Set(completed.notices.map(n=>n.entry_id)).size,3)
  const notice=messages.find(m=>m.personalizations[0].to[0].email===manager.email&&m.subject==='Coffer: Stripe gift adjustment')
  assert.ok(notice.content.some(c=>c.value.includes('/app/donors/'+half.donor.id)||c.value.includes('/app/donors/'+contested.donor.id)),'Manager notices link to a donor record the existing staff role can open')
  assert.equal(messages.filter(m=>m.personalizations[0].to[0].email===manager.email).length,4,'One invitation and three payment notices reach the selected manager')
  const lines=(await h.get('/api/coffer/payments/fees')).lines
  assert.equal(lines.filter(l=>l.charge_id===half.charge.id&&l.kind==='refund').length,1)
  assert.equal(lines.filter(l=>l.charge_id===contested.charge.id&&l.kind.startsWith('dispute')).length,2)
  for(const key of ['failed','uncertain']){
   const fixture=await paid(h,key),input={giftId:fixture.gift.id,amount:'25.00',expectedNetCents:10000,requestId:randomUUID()},beforeCalls=refundCalls.length
   const result=await post(input)
   assert.equal(result.status,key);assert.equal((await personState(h,fixture)).totals.lifetimeCents,10000)
   assert.equal((await post(input)).id,result.id);assert.equal(refundCalls.length,beforeCalls+1,'Repeated failed or uncertain requests never blindly resend')
   if(key==='uncertain')await post({...input,requestId:randomUUID()},{status:409})
   else await event(h,'evt_adjust_failed_refund','refund.failed',result.refund_id)
   assert.equal((await personState(h,fixture)).gifts.length,1)
  }
  assert.equal((await state(h)).notices.length,3,'Failed and uncertain attempts have no monetary entry or success notice')
  await screenshot(h,'completed-and-unresolved')
  if(process.env.COFFER_ADJUSTMENTS_BROWSER){
   const gifts=[await paid(h,'browser-desktop'),await paid(h,'browser-mobile')]
   const {paymentAdjustmentsBrowser}=await import('./payment-adjustments-browser.mjs')
   await paymentAdjustmentsBrowser(h,{directory:process.env.COFFER_ADJUSTMENTS_BROWSER,stage:'native-refund',gifts})
   for(const fixture of gifts){assert.equal((await personState(h,fixture)).totals.lifetimeCents,10000);assert.equal((await state(h)).refunds.find(r=>r.gift_id===fixture.gift.id).status,'pending')}
  }
  if(process.env.COFFER_ADJUSTMENTS_ARCHIVE||process.env.COFFER_ADJUSTMENTS_BROWSER){
   const saved=await archive(h),expected=await state(h),beforeCalls=refundCalls.length,beforeMail=messages.length
   await run(async fresh=>{
    await restore(fresh,saved)
    const durable=view=>({...view,notices:view.notices.map(({owner_name,...notice})=>notice)})
    assert.deepEqual(durable(await state(fresh)),durable(expected),'Archive preserves refund request identity, dispute deadlines and notice custody')
    assert.deepEqual((await personState(fresh,half)).gifts,(await personState(h,half)).gifts)
    assert.deepEqual((await fresh.get('/api/coffer/letters/'+replacement.id)).letters,(await h.get('/api/coffer/letters/'+replacement.id)).letters)
    const survivor=await donor(fresh,'Nora B.')
    const compare=await fresh.get(`/api/coffer/duplicates/compare?source=${half.donor.id}&target=${survivor.id}`)
    const merge=await fresh.command('donor.merge',{sourceDonorId:half.donor.id,donorId:survivor.id,sourceVersion:compare.source.version,version:compare.target.version,fields:{},reason:'duplicate_record'})
    assert.equal((await state(fresh)).refunds.find(r=>r.id===requested.id).name,'Nora B.','Refund custody follows the gift through merge')
    await fresh.command('donor.unmerge',{mergeId:merge.mergeId,reason:'incorrect_match'})
    assert.equal((await state(fresh)).refunds.find(r=>r.id===requested.id).name,half.donor.name)
    const erased=await fresh.command('donor.erase',{donorId:half.donor.id,confirm:'ERASE'})
    const erasedState=await state(fresh)
    assert.equal(erasedState.refunds.find(r=>r.id===requested.id).amount_cents,5000)
    assert.ok(!JSON.stringify(erasedState).includes(half.donor.email)&&!JSON.stringify(erasedState).includes(half.donor.name),'Erasure keeps anonymous refund facts, no former donor text')
    assert.equal((await fresh.get('/api/coffer/donors/'+erased.donorId)).totals.lifetimeCents,5000)

   },{...options,givingProtection:false})
   assert.equal(refundCalls.length,beforeCalls);assert.equal(messages.length,beforeMail,'Restore never resends provider work')
  }
 },options)
}
