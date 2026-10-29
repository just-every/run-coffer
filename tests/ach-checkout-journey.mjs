import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {run,donor,reviewed,archive,restore} from './harness.mjs'
import {achEdge} from './ach-checkout-edge.mjs'
import {achBrowser} from './ach-checkout-browser.mjs'

const address=name=>name+String.fromCharCode(64)+'example.test'
const signingValue='synthetic-coffer-9401'
export const achForm=values=>({method:'POST',as:'',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(values).toString()})
export async function achEvent(h,item,type,id=randomUUID(),{invalid=false}={}){
 const object=type.startsWith('checkout.')?item.session.id:type.startsWith('charge.dispute.')?'dp_ach_'+item.n:type.startsWith('charge.')?'ch_ach_'+item.n:'pi_ach_'+item.n
 const raw=JSON.stringify({id,type,data:{object:{id:object,metadata:{coffer_intent:item.intent}}}}),timestamp=Math.floor(Date.now()/1000)
 const signature=createHmac('sha256',invalid?'synthetic-coffer-9402':signingValue).update(`${timestamp}.${raw}`).digest('hex')
 return h.request('/api/coffer/giving/webhook',{method:'POST',as:'',headers:{'stripe-signature':`t=${timestamp},v1=${signature}`},raw})
}
const okay=async response=>{assert.equal(response.status,200,await response.clone().text());return response}
const values=(name,extra={})=>({requestId:randomUUID(),name,email:address(name.toLowerCase().replaceAll(' ','.')),amount:'100.00',frequency:'once',paymentMethod:'us_bank_account','cf-turnstile-response':'synthetic-coffer-security-token',...extra})

export async function achCheckoutJourney(){
 const edge=achEdge(),options={bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-9400',STRIPE_WEBHOOK_SECRET:signingValue},outbound:edge.outbound}
 await run(async h=>{
  await reviewed(h)
  const known=await donor(h,'Bank Giver',{email:address('bank.giver')})
  const campaign=await h.api('/api/coffer/giving/campaigns',{name:'Bank reading',slug:'bank-reading',description:'More books for our neighbors.',fund:'Reading',goal:'1000'})
  await h.api('/api/coffer/giving/campaigns/'+campaign.id+'/fee-cover',{version:1,feeCoverEnabled:'yes',feeCoverRateBps:290,feeCoverFixedCents:30})
  const history=()=>h.get('/api/coffer/donors/'+known.id),progress=()=>h.get('/api/coffer/giving/campaigns/'+campaign.id),wall=async()=>await (await h.request('/give/bank-reading',{as:''})).text()
  const addresses=new Map()
  const start=p=>{if(!addresses.has(p.email))addresses.set(p.email,'192.0.2.'+(addresses.size+1));const form=achForm(p);return h.request('/give/bank-reading/checkout',{...form,headers:{...form.headers,'cf-connecting-ip':addresses.get(p.email)}})}
  const v=values('Bank Giver',{feeCover:'yes',quotedAmountCents:'10330',wallOptIn:'yes',recognitionName:'Book Circle'})
  const writes=()=>edge.state.writes.filter(w=>w.path==='/v1/checkout/sessions').length
  assert.equal((await start({...v,frequency:'monthly'})).status,400)
  assert.equal((await start({...v,accountNumber:'synthetic-coffer-9403'})).status,400)
  assert.equal((await start({...v,quotedAmountCents:'10000'})).status,409);assert.equal(writes(),0)
  const started=await start(v);assert.equal(started.status,303,await started.text())
  const item=[...edge.state.sessions.values()].at(-1)
  assert.equal(item.amount,10330,'Independent $100 gift plus agreed $3.30 cover')
  const thanks=()=>h.request('/giving/thanks?session_id='+item.session.id,{as:''})
  const pending=await thanks();await okay(pending);assert.match(await pending.text(),/Payment is still processing/)
  for(const type of ['checkout.session.completed','payment_intent.processing','charge.succeeded'])await okay(await achEvent(h,item,type))
  assert.deepEqual([(await history()).gifts.length,(await history()).letters.length,(await progress()).raisedCents,h.messages.length],[0,0,0,0])
  assert.doesNotMatch(await wall(),/Book Circle/)
  assert.equal((await start({...v,paymentMethod:'card'})).status,409,'Saved method cannot be changed')
  assert.equal((await start({...v,amount:'101.00'})).status,409)
  assert.equal((await start(v)).status,303);assert.equal(writes(),1)
  const invalid=await achEvent(h,item,'payment_intent.succeeded',randomUUID(),{invalid:true});assert.equal(invalid.status,400)
  edge.state.unavailable=true;assert.equal((await thanks()).status,502);edge.state.unavailable=false
  edge.state.mismatch=true;assert.equal((await thanks()).status,409);edge.state.mismatch=false
  assert.equal((await history()).gifts.length,0)
  await achBrowser(h,edge,item,{campaign,known,stage:'pending',input:v})
  item.mandateStatus='inactive'
  assert.equal((await thanks()).status,409,'A revoked mandate cannot authorize a pending payment')
  assert.equal((await history()).gifts.length,0)
  item.mandateStatus=null
  item.status='succeeded'
  item.mandateMethod='pm_other'
  assert.equal((await thanks()).status,409,'A mandate for another instrument cannot settle this quote')
  assert.equal((await history()).gifts.length,0)
  item.mandateMethod=null
  // A charge can beat both the session and PaymentIntent notifications.
  await okay(await achEvent(h,item,'charge.succeeded'))
  const paid=await history(),gift=paid.gifts.find(g=>g.kind==='gift')
  assert.ok(gift);assert.equal(paid.gifts.length,1);assert.equal(gift.amount_cents,10330);assert.equal(gift.method,'bank transfer');assert.equal(gift.reference,'pi_ach_'+item.n);assert.equal(gift.fund,'Reading')
  assert.equal(paid.totals.lifetimeCents,10330);assert.equal((await progress()).raisedCents,10330)
  assert.match(await wall(),/Book Circle<\/strong> · \$103\.30/)
  assert.equal(paid.letters.length,1);assert.equal(paid.letters[0].amount_cents,10330)
  const receipt=await h.get('/api/coffer/letters/'+paid.letters[0].batch_id)
  assert.match(receipt.letters[0].body,/\$103\.30/);assert.match(receipt.letters[0].body,/No goods or services/)
  const frozenReceipt=receipt.letters[0].body
  const file=await h.api('/api/coffer/donors/'+known.id+'/data-request',{requestedOn:'2026-09-15',method:'email'})
  const capture=file.records.giving_intents.find(row=>row.id===v.requestId),bank=file.records.bank_checkouts.find(row=>row.intent_id===v.requestId)
  assert.deepEqual([capture.payment_method,capture.requested_amount_cents,capture.fee_cover_cents,capture.amount_cents],['us_bank_account',10000,330,10330])
  assert.deepEqual([bank.payment_intent_id,bank.payment_method_id,bank.mandate_id,bank.status],['pi_ach_'+item.n,'pm_ach_'+item.n,'mandate_ach_'+item.n,'succeeded'])
  const fees=await h.get('/api/coffer/payments/fees')
  assert.deepEqual(fees.totals,{gross_cents:10330,fee_cents:83,net_cents:10247})
  for(const group of [fees.byFund,fees.byCampaign,fees.byForm])assert.deepEqual(group.map(r=>[r.gross_cents,r.fee_cents,r.net_cents]),[[10330,83,10247]])
  const eventId=randomUUID()
  for(const [type,id] of [['payment_intent.succeeded',eventId],['payment_intent.succeeded',eventId],['checkout.session.async_payment_succeeded',randomUUID()],['payment_intent.processing',randomUUID()],['charge.updated',randomUUID()]])await okay(await achEvent(h,item,type,id))
  assert.equal((await history()).gifts.length,1);assert.equal((await history()).letters.length,1)
  item.status='processing'
  assert.equal((await achEvent(h,item,'payment_intent.processing')).status,409,'A regressed provider state cannot replay settlement')
  assert.equal((await history()).gifts.length,1)
  item.status='succeeded'
  // A failed first debit contributes no money, receipt or public recognition.
  const failedDonor=await donor(h,'Failed Bank',{email:address('failed.bank')})
  const failed=await start(values('Failed Bank'));assert.equal(failed.status,303,await failed.text())
  const failure=[...edge.state.sessions.values()].at(-1);await okay(await achEvent(h,failure,'checkout.session.completed'))
  failure.status='requires_payment_method'
  await okay(await achEvent(h,failure,'payment_intent.payment_failed'))
  await okay(await achEvent(h,failure,'checkout.session.async_payment_failed'))
  const failedHistory=await h.get('/api/coffer/donors/'+failedDonor.id)
  assert.deepEqual([failedHistory.gifts.length,failedHistory.letters.length,failedHistory.totals.lifetimeCents],[0,0,0])
  assert.match(await (await h.request('/giving/thanks?session_id='+failure.session.id,{as:''})).text(),/Bank payment failed/)
  // An interrupted create remains held; recovery is a signed independently read session.
  edge.state.uncertain=true
  const uncertainInput=values('Uncertain Bank'),uncertain=await start(uncertainInput)
  assert.equal(uncertain.status,502)
  const held=[...edge.state.sessions.values()].at(-1),beforeWrites=writes()
  assert.equal((await start(uncertainInput)).status,409);assert.equal(writes(),beforeWrites)
  await okay(await achEvent(h,held,'checkout.session.completed'))
  assert.equal((await start(uncertainInput)).status,303);assert.equal(writes(),beforeWrites)
  await achBrowser(h,edge,item,{campaign,known,stage:'settled'})
  // Stripe's documented post-success insufficient_funds dispute is an R01 return.
  item.returned=true
  const returnId=randomUUID()
  for(const id of [returnId,returnId,randomUUID()])await okay(await achEvent(h,item,'charge.dispute.created',id))
  const returned=await history()
  assert.equal(returned.gifts.filter(g=>g.kind==='gift').length,1);assert.equal(returned.gifts.filter(g=>g.kind==='reversal').length,1)
  assert.equal(returned.gifts.find(g=>g.kind==='reversal').amount_cents,-10330)
  assert.equal(returned.totals.lifetimeCents,0);assert.equal((await progress()).raisedCents,0);assert.doesNotMatch(await wall(),/Book Circle/)
  const tasks=(await h.get('/api/coffer/tasks')).tasks.filter(t=>t.source_key==='bank-return:ch_ach_'+item.n)
  assert.equal(tasks.length,1);assert.equal(tasks[0].is_ask,0);assert.ok(tasks[0].owner_id);assert.equal(tasks[0].task_kind,'follow_up');assert.equal(tasks[0].gift_id,gift.id)
  const returnedReceipt=await h.get('/api/coffer/letters/'+paid.letters[0].batch_id)
  assert.equal(returnedReceipt.letters[0].body,frozenReceipt,'The original paid receipt facts remain frozen')
  const afterFees=await h.get('/api/coffer/payments/fees')
  assert.deepEqual(afterFees.totals,{gross_cents:0,fee_cents:483,net_cents:-483})
  await okay(await achEvent(h,item,'payment_intent.succeeded'));assert.match(await (await thanks()).text(),/Bank payment returned/)
  assert.equal((await history()).gifts.filter(g=>g.kind==='reversal').length,1)
  await achBrowser(h,edge,item,{campaign,known,stage:'returned'})
  // A return may arrive before processing or success notifications. Stripe can
  // already have deactivated its mandate; reconcile the historical funds only.
  for(const observedProcessing of [true,false]){
   const name=observedProcessing?'Reordered Bank':'Return First Bank'
   const reorderedDonor=await donor(h,name,{email:address(name.toLowerCase().replaceAll(' ','.'))})
   assert.equal((await start(values(name))).status,303)
   const reordered=[...edge.state.sessions.values()].at(-1)
   if(observedProcessing)await okay(await achEvent(h,reordered,'payment_intent.processing'))
   const beforeReturn=await h.get('/api/coffer/donors/'+reorderedDonor.id)
   assert.deepEqual([beforeReturn.gifts.length,beforeReturn.letters.length,beforeReturn.totals.lifetimeCents],[0,0,0])
   reordered.status='succeeded';reordered.returned=true
   const reorderedId=randomUUID()
   for(const id of [reorderedId,reorderedId,randomUUID()])await okay(await achEvent(h,reordered,'charge.dispute.created',id))
   const fees=observedProcessing?966:1449
   assert.deepEqual((await h.get('/api/coffer/payments/fees')).totals,{gross_cents:0,fee_cents:fees,net_cents:-fees},'Return-first reconciliation includes both original fees and bank return fees exactly once')
   const history=()=>h.get('/api/coffer/donors/'+reorderedDonor.id)
   const returned=await history()
   assert.deepEqual(returned.gifts.map(g=>g.amount_cents).sort((a,b)=>a-b),[-10000,10000],'The return itself records the original gift and reversal')
   const tasks=async()=>(await h.get('/api/coffer/tasks')).tasks.filter(t=>t.source_key==='bank-return:ch_ach_'+reordered.n)
   const followUp=(await tasks())[0]
   assert.equal((await tasks()).length,1);assert.equal(followUp.is_ask,0);assert.ok(followUp.owner_id);assert.equal(followUp.task_kind,'follow_up');assert.equal(followUp.gift_id,returned.gifts.find(g=>g.kind==='gift').id)
   for(const type of ['charge.succeeded','checkout.session.async_payment_succeeded','payment_intent.succeeded'])await okay(await achEvent(h,reordered,type))
   const reorderedHistory=await history()
   assert.deepEqual(reorderedHistory.gifts.map(g=>g.amount_cents).sort((a,b)=>a-b),[-10000,10000])
   assert.equal(reorderedHistory.gifts.find(g=>g.kind==='gift').method,'bank transfer')
   assert.equal(reorderedHistory.totals.lifetimeCents,0)
   assert.equal((await progress()).raisedCents,0)
   assert.match(await (await h.request('/giving/thanks?session_id='+reordered.session.id,{as:''})).text(),/Bank payment returned/)
   const reorderedTasks=await tasks()
   assert.equal(reorderedTasks.length,1);assert.equal(reorderedTasks[0].is_ask,0)
   assert.deepEqual((await h.get('/api/coffer/payments/fees')).totals,{gross_cents:0,fee_cents:fees,net_cents:-fees},'Delayed success cannot duplicate fees or restore returned money')
  }
  // Restore preserves the returned authorization, reversal, one task and frozen receipt.
  const saved=await archive(h)
  await run(async fresh=>{
   await restore(fresh,saved)
   const restored=await fresh.get('/api/coffer/donors/'+known.id)
   assert.equal(restored.gifts.length,2);assert.equal(restored.gifts.find(g=>g.kind==='gift').method,'bank transfer')
   await okay(await achEvent(fresh,item,'payment_intent.succeeded'))
   await okay(await achEvent(fresh,item,'charge.dispute.updated'))
   const tasks=(await fresh.get('/api/coffer/tasks')).tasks.filter(t=>t.source_key==='bank-return:ch_ach_'+item.n)
   assert.equal(tasks.length,1);assert.equal(tasks[0].is_ask,0);assert.equal(tasks[0].owner_status,'active')
   assert.equal((await fresh.get('/api/coffer/donors/'+known.id)).totals.lifetimeCents,0)
   assert.equal((await fresh.get('/api/coffer/donors/'+known.id)).letters.length,1)
   assert.equal((await fresh.get('/api/coffer/letters/'+paid.letters[0].batch_id)).letters[0].body,frozenReceipt)
  },{...options,givingProtection:false})
  const target=await donor(h,'Bank Survivor',{email:address('bank.survivor')})
  const comparison=await h.get('/api/coffer/duplicates/compare?source='+known.id+'&target='+target.id)
  await h.command('donor.merge',{sourceDonorId:known.id,donorId:target.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  await okay(await achEvent(h,item,'charge.dispute.updated'))
  assert.equal((await h.get('/api/coffer/donors/'+target.id)).totals.lifetimeCents,0)
  await h.command('donor.erase',{donorId:target.id,confirm:'ERASE'})
  const count=(await h.get('/api/coffer/donors')).total
  await okay(await achEvent(h,item,'charge.dispute.updated'))
  assert.equal((await h.get('/api/coffer/donors')).total,count)
  assert.equal((await start(v)).status,409,'Erased captures cannot be reopened')
  const erased=await donor(h,'Erased Pending',{email:address('erased.pending')})
  assert.equal((await start(values('Erased Pending'))).status,303)
  const pendingErased=[...edge.state.sessions.values()].at(-1)
  const erasedResult=await h.command('donor.erase',{donorId:erased.id,confirm:'ERASE'})
  pendingErased.status='succeeded'
  assert.equal((await achEvent(h,pendingErased,'payment_intent.succeeded')).status,409)
  assert.equal((await h.get('/api/coffer/donors/'+erasedResult.donorId)).gifts.length,0)
  const retained=JSON.stringify(await archive(h))
  for(const number of ['4242424242424242','110000000','000123456789'])assert.ok(!retained.includes(number))
  for(const name of ['Bank Giver','Erased Pending'])assert.ok(!retained.includes(name),'Erasure removes original donor details')
  assert.equal(edge.state.writes.filter(w=>!['/v1/customers','/v1/checkout/sessions'].includes(w.path)).length,0,'No debit, retry, refund or subscription is submitted by return handling')
 },options)
}
