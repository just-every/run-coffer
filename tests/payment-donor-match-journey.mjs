import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {run,donor,archive,restore,installation} from './harness.mjs'
import {fixedNow} from './fixed-clock.mjs'
import {paymentDonorMatchBrowser} from './payment-donor-match-browser.mjs'

const mail=n=>'synthetic-coffer-'+n+String.fromCharCode(64)+'example.test'
const secret='synthetic-coffer-2801',at=Date.parse(fixedNow)/1000-86400
export async function paymentDonorMatchJourney(){
 let account='acct_synthetic_coffer_2802',incomplete=false,swap=false,revoke=null
 const charges=new Map(),refunds=new Map(),transactions=new Map(),payouts=new Map()
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
  const u=new URL(request.url);assert.equal(u.hostname,'api.stripe.com');assert.equal(request.method,'GET','Review submits no provider writes')
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
  if(u.pathname.startsWith('/v1/refunds/'))return Response.json(refunds.get(u.pathname.split('/').at(-1)))
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
  assert.equal((await h.get('/api/coffer/payments/fees')).totals?.gross_cents??0,0)
  const member=await h.person(mail(2811)),admin=await h.person(mail(2812),'admin'),key=await h.command('agent.create',{label:'Synthetic payment reader'})
  for(const options of [{as:'',status:401},{as:member.cookie,status:403},{as:'',headers:{authorization:'Bearer '+key.token},status:403}]){
   await h.get(path(charge.id),options);await h.get('/api/coffer/payments/donor-matches',options)
   await h.api(path(charge.id)+'/approve',select(view,two),options)
  }
  incomplete=true;await h.api(path(charge.id)+'/approve',select(view,two),{status:502});incomplete=false
  assert.equal((await h.get('/api/coffer/donors/'+two.id)).gifts.length,0)
  swap=true;await h.api(path(charge.id)+'/approve',select(view,two),{status:409});swap=false;account='acct_synthetic_coffer_2802'
  // Provider changes and donor edits require a new versioned review.
  charge.amount_refunded=0
  await h.api(path(charge.id)+'/approve',select(view,two),{status:502});charge.amount_refunded=2500
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
  const responses=await Promise.all([h.request(path(charge.id)+'/approve',{method:'POST',body:input}),h.request(path(charge.id)+'/approve',{method:'POST',body:input})])
  assert.ok(responses.some(r=>r.status===200));for(const r of responses)assert.ok([200,409].includes(r.status),await r.text())
  view=await h.get(path(charge.id));assert.equal(view.state,'resolved');assert.equal(view.gift.donor_id,two.id)
  await h.api(path(charge.id)+'/approve',input)
  await deliver(h,2813,'charge.succeeded',charge.id);await deliver(h,2814,'refund.created',earlyRefund.id)
  const detail=await h.get('/api/coffer/donors/'+two.id)
  assert.equal(detail.gifts.filter(g=>g.kind==='gift').length,1);assert.equal(detail.gifts.filter(g=>g.kind==='reversal').length,1);assert.equal(detail.totals.lifetimeCents,7500)
  assert.equal((await h.get('/api/coffer/donors/'+one.id)).gifts.length,0)
  payout=await h.get('/api/coffer/payments/'+paid.id)
  assert.equal(payout.payout.complete,1);assert.equal(payout.payout.matched_cents,7180);assert.equal(payout.lines.length,2)
  assert.deepEqual(payout.splits.map(s=>[s.gross_cents,s.fee_cents,s.net_cents]),[[7500,320,7180]])
  assert.equal(h.messages.filter(m=>/receipt/i.test(m.subject??'')).length,0,'External source gifts never bypass receipt approval')
  // A restored installation preserves the queue, but cannot reuse its approval.
  const held=external(2815,4200);await deliver(h,2816,'charge.succeeded',held.id)
  const backup=await archive(h),fresh=await installation({entry:'tests/fixed-clock-worker.ts',bindings,outbound})
  try{
   await restore(fresh,backup)
   assert.equal((await fresh.get(path(charge.id))).state,'resolved')
   const restored=await fresh.get(path(held.id));assert.equal(restored.state,'held')
   await fresh.api(path(held.id)+'/approve',select(restored,two),{status:409})
   assert.equal((await fresh.get('/api/coffer/donors/'+two.id)).totals.lifetimeCents,7500)
  }finally{await fresh.close()}
  // Merge cannot make an old candidate selection current by following an alias.
  const beforeMerge=await h.get(path(held.id)),comparison=await h.get('/api/coffer/duplicates/compare?source='+one.id+'&target='+two.id)
  await h.command('donor.merge',{sourceDonorId:one.id,donorId:two.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  await h.api(path(held.id)+'/approve',select(beforeMerge,one),{status:409})
  assert.equal((await h.get(path(charge.id))).gift.donor_id,two.id)
  await h.command('donor.erase',{donorId:two.id,confirm:'ERASE'})
  const redacted=await h.get(path(held.id));assert.equal(redacted.state,'erased');assert.equal(redacted.email,null);assert.deepEqual(redacted.candidates,[]);assert.deepEqual(redacted.facts,{})
  await deliver(h,2817,'charge.succeeded',held.id)
  await h.api(path(held.id)+'/approve',select(beforeMerge,two),{status:409})
  assert.equal((await h.get('/api/coffer/donors')).donors.filter(d=>!d.erased_at).length,0,'Replay cannot recreate erased source identities')
 },{entry:'tests/fixed-clock-worker.ts',bindings,outbound})
}
