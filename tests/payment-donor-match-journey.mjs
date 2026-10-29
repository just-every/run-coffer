import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {run,donor,archive,restore,installation} from './harness.mjs'
import {fixedNow} from './fixed-clock.mjs'
import {paymentDonorMatchBrowser} from './payment-donor-match-browser.mjs'

const mail=n=>'synthetic-coffer-'+n+String.fromCharCode(64)+'example.test'
const secret='synthetic-coffer-2801',at=Date.parse(fixedNow)/1000-86400
export async function paymentDonorMatchJourney(){
 let account='acct_synthetic_coffer_2802',incomplete=false,swap=false,revoke=null,refundReadOutage=false
 const charges=new Map(),refunds=new Map(),transactions=new Map(),payouts=new Map();let checkout=null,providerWrites=0
 const external=(n,amount=10000)=>{
  const id='ch_synthetic_coffer_'+n,tx='txn_synthetic_coffer_'+n
  const charge={id,customer:'cus_synthetic_coffer_'+n,payment_intent:null,invoice:null,status:'succeeded',paid:true,currency:'usd',amount,amount_refunded:0,created:at,balance_transaction:tx,billing_details:{name:'Unclear supporter',email:mail(2803)},metadata:{fund:'Reading'}}
  charges.set(id,charge);transactions.set(tx,{id:tx,type:'charge',source:id,currency:'usd',amount,fee:320,net:amount-320,created:at,status:'available',available_on:at})
  return charge
 }
 const refund=(charge,n,amount)=>{
  const id='re_synthetic_coffer_'+n,tx='txn_refund_synthetic_coffer_'+n
  charge.amount_refunded+=amount
  const row={id,charge:charge.id,currency:'usd',amount,status:'succeeded',balance_transaction:tx,created:at+1};refunds.set(id,row)
  transactions.set(tx,{id:tx,type:'refund',source:id,currency:'usd',amount:-amount,fee:0,net:-amount,created:at+1,status:'available',available_on:at+1})
  return row
 }
 const charge=external(2804),earlyRefund=refund(charge,2805,2500),paid={id:'po_synthetic_coffer_2806',status:'paid',currency:'usd',amount:7180,automatic:true,created:at+2,arrival_date:at+2};payouts.set(paid.id,[charge.balance_transaction,earlyRefund.balance_transaction])
 const bindings={STRIPE_SECRET_KEY:'synthetic-coffer-2807',STRIPE_WEBHOOK_SECRET:secret}
 const outbound=async request=>{
  const u=new URL(request.url);assert.equal(u.hostname,'api.stripe.com')
  if(request.method==='POST'&&u.pathname==='/v1/customers'){providerWrites++;return Response.json({id:'cus_synthetic_coffer_2825'})}
  if(request.method==='POST'&&u.pathname==='/v1/checkout/sessions'){
   providerWrites++;const p=new URLSearchParams(await request.text()),known=external(2825,1200)
   known.metadata={coffer_intent:p.get('metadata[coffer_intent]')};known.payment_intent='pi_synthetic_coffer_2825'
   checkout={id:'cs_synthetic_coffer_2825',url:'https://checkout.stripe.com/c/pay/cs_synthetic_coffer_2825',customer:p.get('customer'),currency:'usd',amount_total:1200,status:'complete',payment_status:'paid',metadata:known.metadata,payment_intent:known.payment_intent}
   return Response.json(checkout)
  }
  assert.equal(request.method,'GET','Review submits no provider writes')
  if(u.pathname==='/v1/invoice_payments')return Response.json({data:[],has_more:false})
  if(u.pathname==='/v1/payment_intents/pi_synthetic_coffer_2825')return Response.json({id:'pi_synthetic_coffer_2825',metadata:checkout.metadata,status:'succeeded',currency:'usd',amount_received:1200,created:at})
  if(u.pathname==='/v1/account')return Response.json({id:account})
  if(u.pathname.startsWith('/v1/customers/'))return Response.json({id:u.pathname.split('/').at(-1),email:mail(2803),name:'Unclear supporter'})
  if(u.pathname.startsWith('/v1/charges/')){
   if(revoke){const f=revoke;revoke=null;await f()}
   return Response.json(charges.get(u.pathname.split('/').at(-1)))
  }
  if(u.pathname==='/v1/refunds'){
   const data=[...refunds.values()].filter(r=>r.charge===u.searchParams.get('charge'))
   if(swap)account='acct_synthetic_coffer_2899'
   return Response.json({data:incomplete?[]:data,has_more:false})
  }
  if(u.pathname.startsWith('/v1/refunds/'))return refundReadOutage?Response.json({error:{}},{status:503}):Response.json(refunds.get(u.pathname.split('/').at(-1)))
  if(u.pathname.startsWith('/v1/balance_transactions/'))return Response.json(transactions.get(u.pathname.split('/').at(-1)))
  if(u.pathname==='/v1/balance_transactions')return Response.json({data:payouts.get(u.searchParams.get('payout')).map(id=>transactions.get(id)),has_more:false})
  if(u.pathname==='/v1/payouts/'+paid.id)return Response.json(paid)
  assert.fail('Unexpected Stripe edge '+u.pathname)
 }
 const deliver=async(h,n,type,id)=>{
  const raw=JSON.stringify({id:'synthetic-coffer-event-'+n,type,data:{object:{id}}}),timestamp=Date.parse(fixedNow)/1000
  const sig=createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex')
  const response=await h.request('/api/coffer/giving/webhook',{method:'POST',raw,headers:{'stripe-signature':`t=${timestamp},v1=${sig}`},as:''})
  assert.equal(response.status,200,await response.text())
 }
 const path=id=>'/api/coffer/payments/donor-matches/'+id
 const select=(view,d)=>({version:view.approved_version??view.version,donorId:d.id,donorVersion:view.candidates.find(c=>c.id===d.id)?.version??1,confirm:'yes'})
 await run(async h=>{
  const one=await donor(h,'Synthetic First',{email:mail(2803),household:'Synthetic shared household'}),two=await donor(h,'Synthetic Second',{email:mail(2803),household:'Synthetic shared household'})
  // A refund observed first holds its original charge, rather than inventing money.
  await deliver(h,2808,'refund.created',earlyRefund.id)
  await deliver(h,2809,'charge.succeeded',charge.id);await deliver(h,2809,'charge.succeeded',charge.id)
  await deliver(h,2810,'payout.paid',paid.id)
  let view=await h.get(path(charge.id));assert.equal(view.state,'held');assert.deepEqual(view.candidates.map(d=>d.id).sort(),[one.id,two.id].sort())
  for(const d of [one,two]){const detail=await h.get('/api/coffer/donors/'+d.id);assert.equal(detail.gifts.length,0);assert.equal(detail.totals.lifetimeCents,0)}
  let payout=await h.get('/api/coffer/payments/'+paid.id);assert.equal(payout.payout.complete,0);assert.equal(payout.lines.length,0);assert.equal(payout.payout.matched_cents,0)
  assert.deepEqual((await h.get('/api/coffer/payments/fees')).totals,{gross_cents:0,fee_cents:0,net_cents:0})
  assert.equal((await h.request('/api/coffer/payments/'+paid.id+'/journal.iif')).status,409,'A held payment cannot complete or export a payout journal')
  const member=await h.person(mail(2811)),admin=await h.person(mail(2812),'admin'),key=await h.command('agent.create',{label:'Synthetic payment reader'})
  for(const options of [{as:'',status:401},{as:member.cookie,status:403},{as:'',headers:{authorization:'Bearer '+key.token},status:403}]){
   await h.get(path(charge.id),options);await h.get('/api/coffer/payments/donor-matches',options)
   await h.api(path(charge.id)+'/approve',select(view,two),options)
  }
  const unchanged=providerWrites
  incomplete=true;await h.api(path(charge.id)+'/approve',select(view,two),{status:502});incomplete=false
  assert.equal((await h.get('/api/coffer/donors/'+two.id)).gifts.length,0)
  swap=true;await h.api(path(charge.id)+'/approve',select(view,two),{status:409});swap=false;account='acct_synthetic_coffer_2802'
  // Provider changes and donor edits require a new versioned review.
  charge.amount_refunded=0
  await h.api(path(charge.id)+'/approve',select(view,two),{status:502});charge.amount_refunded=2500
  charge.metadata.fund='Meals';await h.api(path(charge.id)+'/approve',select(view,two),{status:409});charge.metadata.fund='Reading'
  const current=await h.get('/api/coffer/donors/'+two.id)
  await h.command('donor.update',{donorId:two.id,version:current.donor.version,name:'Synthetic Second Reviewed',email:mail(2803),household:'Synthetic shared household'})
  await h.api(path(charge.id)+'/approve',select(view,two),{status:409})
  view=await h.api(path(charge.id)+'/refresh',{});assert.ok(view.version>1)
  await h.api(path(charge.id)+'/approve',{...select(view,two),donorId:'missing'},{status:409})
  // A revoked approver is rechecked after a slow provider read, before release.
  revoke=async()=>{await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})}
  await h.api(path(charge.id)+'/approve',select(view,two),{as:admin.cookie,status:401})
  assert.equal((await h.get('/api/coffer/donors/'+two.id)).gifts.length,0)
  await paymentDonorMatchBrowser(h,charge.id,{...two,name:'Synthetic Second Reviewed'})
  const input=select(view,two)
  await h.api(path(charge.id)+'/approve',input)
  view=await h.get(path(charge.id));assert.equal(view.state,'resolved');assert.equal(view.gift.donor_id,two.id)
  await h.api(path(charge.id)+'/approve',input)
  await h.api(path(charge.id)+'/approve',{...input,donorId:one.id},{status:409})
  await deliver(h,2813,'charge.succeeded',charge.id);await deliver(h,2814,'refund.created',earlyRefund.id)
  const detail=await h.get('/api/coffer/donors/'+two.id)
  assert.equal(detail.gifts.filter(g=>g.kind==='gift').length,1);assert.equal(detail.gifts.filter(g=>g.kind==='reversal').length,1);assert.equal(detail.totals.lifetimeCents,7500);assert.equal(detail.consents.length,0,'Review grants no consent')
  assert.equal((await h.get('/api/coffer/donors/'+one.id)).gifts.length,0)
  payout=await h.get('/api/coffer/payments/'+paid.id)
  assert.equal(payout.payout.complete,1);assert.equal(payout.payout.matched_cents,7180);assert.equal(payout.lines.length,2)
  assert.deepEqual(payout.splits.map(s=>[s.gross_cents,s.fee_cents,s.net_cents]),[[7500,320,7180]])
  assert.equal(h.messages.filter(m=>/receipt/i.test(m.subject??'')).length,0,'External source gifts never bypass receipt approval')
  assert.equal(providerWrites,unchanged,'Donor review sends no payment or customer mutation')
  // A restored installation preserves the queue, but cannot reuse its approval.
  const held=external(2815,4200);await deliver(h,2816,'charge.succeeded',held.id)
  const backup=await archive(h),fresh=await installation({entry:'tests/fixed-clock-worker.ts',bindings,outbound,givingProtection:false})
  try{
   await restore(fresh,backup)
   assert.equal((await fresh.get(path(charge.id))).state,'resolved')
   const restored=await fresh.get(path(held.id));assert.equal(restored.state,'held')
   await fresh.api(path(held.id)+'/approve',select(restored,two),{status:409})
   assert.equal((await fresh.get('/api/coffer/donors/'+two.id)).totals.lifetimeCents,7500)
  }finally{await fresh.close()}
  const activeAdmin=await h.person(mail(2822),'admin')
  const heldView=await h.get(path(held.id)),decision=select(heldView,two)
  const responses=await Promise.all([h.request(path(held.id)+'/approve',{method:'POST',body:decision}),h.request(path(held.id)+'/approve',{method:'POST',body:decision,as:activeAdmin.cookie})])
  assert.ok(responses.some(r=>r.status===200));for(const r of responses)assert.ok([200,409].includes(r.status),await r.text())
  await deliver(h,2818,'charge.succeeded',held.id)
  assert.equal((await h.get('/api/coffer/donors/'+two.id)).gifts.filter(g=>g.kind==='gift').length,2)
  const unresolved=external(2820,3000);await deliver(h,2821,'charge.succeeded',unresolved.id)
  // An exact Coffer checkout retains its known donor even at a shared address.
  const campaign=await h.api('/api/coffer/giving/campaigns',{name:'Synthetic checkout',slug:'synthetic-checkout',description:'Community support.',fund:'Reading',goal:'1000'})
  const form=new URLSearchParams({requestId:randomUUID(),name:'Synthetic First',email:mail(2803),frequency:'once',amount:'12.00','cf-turnstile-response':'synthetic-coffer-security-token'})
  const started=await h.request('/give/synthetic-checkout/checkout',{method:'POST',as:'',raw:form.toString(),headers:{'content-type':'application/x-www-form-urlencoded'}})
  assert.equal(started.status,303,await started.text())
  await deliver(h,2826,'charge.succeeded','ch_synthetic_coffer_2825')
  const known=await h.get('/api/coffer/donors/'+one.id)
  assert.equal(known.gifts.length,1);assert.equal(known.gifts[0].amount_cents,1200);assert.equal(known.totals.lifetimeCents,1200)
  assert.ok(!(await h.get('/api/coffer/payments/donor-matches')).matches.some(r=>r.charge_id==='ch_synthetic_coffer_2825'))
  assert.equal((await h.get('/api/coffer/giving/campaigns')).campaigns.find(c=>c.id===campaign.id).raised_cents,1200)
  // Recording can be interrupted after the donor's gift has committed. A
  // candidate edit and refresh cannot give that recorded payment a new owner.
  const interrupted=external(2831),interruptedRefund=refund(interrupted,2832,2500)
  await deliver(h,2833,'charge.succeeded',interrupted.id)
  let pending=await h.get(path(interrupted.id))
  refundReadOutage=true
  await h.api(path(interrupted.id)+'/approve',select(pending,two),{status:502})
  refundReadOutage=false
  const first=await h.get('/api/coffer/donors/'+one.id)
  await h.command('donor.update',{donorId:one.id,version:first.donor.version,name:'Synthetic First Updated',email:mail(2803),household:'Synthetic shared household'})
  pending=await h.api(path(interrupted.id)+'/refresh',{})
  assert.equal(pending.state,'approved');assert.equal(pending.donor_id,two.id)
  await h.api(path(interrupted.id)+'/approve',select(pending,one),{status:409})
  const completed=await h.api(path(interrupted.id)+'/approve',select(pending,two))
  assert.equal(completed.state,'resolved');assert.equal(completed.donor_id,two.id);assert.equal(completed.gift.donor_id,two.id)
  await h.api(path(interrupted.id)+'/approve',select(pending,two))
  await deliver(h,2834,'refund.created',interruptedRefund.id)
  const resumed=await h.get('/api/coffer/donors/'+two.id)
  assert.equal(resumed.totals.lifetimeCents,19200)
  assert.equal(resumed.gifts.filter(g=>g.reference===interrupted.id&&g.kind==='gift').length,1)
  assert.equal((await h.get('/api/coffer/donors/'+one.id)).totals.lifetimeCents,1200)
  const actualFees=await h.get('/api/coffer/payments/fees')
  assert.equal(actualFees.lines.filter(l=>l.id===interrupted.balance_transaction).length,1)
  assert.equal(actualFees.lines.find(l=>l.id===interrupted.balance_transaction).fee_cents,320)
  {
  // An interrupted recording pins its money to the selected donor. A fresh
  // candidate review cannot transfer the gift while completing its refund.
  const interrupted=external(2836),interruptedRefund=refund(interrupted,2837,2500)
  await deliver(h,2838,'charge.succeeded',interrupted.id)
  let pending=await h.get(path(interrupted.id))
  const beforeFees=(await h.get('/api/coffer/payments/fees')).totals
  const feeDelta=async()=>Object.fromEntries(Object.entries((await h.get('/api/coffer/payments/fees')).totals).map(([k,v])=>[k,v-beforeFees[k]]))
  refundReadOutage=true
  await h.api(path(interrupted.id)+'/approve',select(pending,one),{status:502})
  refundReadOutage=false
  pending=await h.get(path(interrupted.id))
  assert.equal(pending.state,'approved');assert.equal(pending.donor_id,one.id);assert.equal(pending.gift.donor_id,one.id)
  assert.equal((await h.get('/api/coffer/donors/'+one.id)).totals.lifetimeCents,11200)
  assert.deepEqual(await feeDelta(),{gross_cents:10000,fee_cents:320,net_cents:9680})
  const edited=await h.get('/api/coffer/donors/'+two.id)
  await h.command('donor.update',{donorId:two.id,version:edited.donor.version,name:edited.donor.name,email:mail(2803),household:'Synthetic shared household'})
  pending=await h.api(path(interrupted.id)+'/refresh',{})
  const unchangedDonors=await Promise.all([one,two].map(d=>h.get('/api/coffer/donors/'+d.id)))
  await h.api(path(interrupted.id)+'/approve',select(pending,two),{status:409})
  const pinned=await h.get(path(interrupted.id));assert.equal(pinned.state,'approved');assert.equal(pinned.donor_id,one.id);assert.equal(pinned.gift.donor_id,one.id)
  assert.deepEqual(await Promise.all([one,two].map(d=>h.get('/api/coffer/donors/'+d.id))),unchangedDonors,'Refused reassignment changes no donor or gift')
  assert.deepEqual(await feeDelta(),{gross_cents:10000,fee_cents:320,net_cents:9680})
  const resume=select(pending,one)
  await h.api(path(interrupted.id)+'/approve',resume)
  await h.api(path(interrupted.id)+'/approve',resume)
  await deliver(h,2839,'charge.succeeded',interrupted.id);await deliver(h,2840,'refund.created',interruptedRefund.id)
  const completed=await h.get(path(interrupted.id)),originalDonor=await h.get('/api/coffer/donors/'+one.id)
  assert.equal(completed.state,'resolved');assert.equal(completed.donor_id,one.id);assert.equal(completed.gift.donor_id,one.id)
  assert.equal(originalDonor.gifts.filter(g=>g.kind==='gift'&&g.reference===interrupted.id).length,1)
  assert.equal(originalDonor.gifts.filter(g=>g.kind==='reversal').length,1)
  assert.equal(originalDonor.totals.lifetimeCents,8700)
  const otherDonor=await h.get('/api/coffer/donors/'+two.id)
  assert.deepEqual(otherDonor.gifts,unchangedDonors[1].gifts);assert.equal(otherDonor.totals.lifetimeCents,unchangedDonors[1].totals.lifetimeCents)
  assert.deepEqual(await feeDelta(),{gross_cents:7500,fee_cents:320,net_cents:7180})
  }
  // Merge cannot make an old candidate selection current by following an alias.
  const beforeMerge=await h.api(path(unresolved.id)+'/refresh',{}),comparison=await h.get('/api/coffer/duplicates/compare?source='+one.id+'&target='+two.id)
  await h.command('donor.merge',{sourceDonorId:one.id,donorId:two.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  await h.api(path(unresolved.id)+'/approve',select(beforeMerge,one),{status:409})
  assert.equal((await h.get(path(charge.id))).gift.donor_id,two.id)
  await h.command('donor.erase',{donorId:two.id,confirm:'ERASE'})
  const redacted=await h.get(path(unresolved.id));assert.equal(redacted.state,'erased');assert.equal(redacted.email,null);assert.deepEqual(redacted.candidates,[]);assert.deepEqual(redacted.facts,{})
  await deliver(h,2817,'charge.succeeded',unresolved.id)
  await h.api(path(unresolved.id)+'/approve',select(beforeMerge,two),{status:409})
  const later=external(2827,2000);later.customer=unresolved.customer
  await deliver(h,2828,'charge.succeeded',later.id)
  const newCustomer=external(2829,1500);await deliver(h,2830,'charge.succeeded',newCustomer.id)
  assert.equal((await h.get(path(newCustomer.id))).state,'erased')
  assert.equal((await h.get('/api/coffer/donors')).donors.filter(d=>!d.erased_at).length,0,'Replay cannot recreate erased source identities')
 },{entry:'tests/fixed-clock-worker.ts',bindings,outbound})
}
