import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {archive,donor,installation,reviewed,restore} from './harness.mjs'
import {recurringStripeEdge} from './recurring-stripe-edge.mjs'
import {signInPortal} from './portal-journey.mjs'
import {agreement} from './document-fixtures.mjs'
import {staffPaymentBrowser} from './staff-payment-browser.mjs'

const secret='synthetic-coffer-9000'
// Documented Stripe PaymentIntent confirmation, Charge and BalanceTransaction edges.
function staffStripeEdge(){
 const recurring=recurringStripeEdge(),payments=new Map(),charges=new Map(),entries=new Map(),writes=[]
 const state={uncertain:false,badResult:false,onMethod:null}
 return {recurring,payments,charges,entries,writes,state,outbound:async request=>{
  const u=new URL(request.url),path=u.pathname
  if(path.startsWith('/v1/payment_methods/')&&state.onMethod){const callback=state.onMethod;state.onMethod=null;await callback()}
  if(path==='/v1/payment_intents'&&request.method==='POST'){
   const p=new URLSearchParams(await request.text());writes.push({key:request.headers.get('idempotency-key'),...Object.fromEntries(p)})
   assert.ok(writes.at(-1).key);assert.equal(p.get('confirm'),'true');assert.equal(p.get('off_session'),'true');assert.equal(p.get('payment_method_types[0]'),'card')
   const n=payments.size+1,id='pi_staff_payment_'+n,chargeId='ch_staff_payment_'+n,txn='txn_staff_payment_'+n,cents=Number(p.get('amount'))
   const payment={id,status:'succeeded',currency:'usd',amount:cents,amount_received:cents,customer:p.get('customer'),payment_method:p.get('payment_method'),payment_method_types:['card'],metadata:{coffer_intent:p.get('metadata[coffer_intent]')},latest_charge:chargeId,created:Date.parse(recurring.state.now)/1000}
   payments.set(id,payment)
   charges.set(chargeId,{id:chargeId,status:'succeeded',paid:true,amount:cents,currency:'usd',customer:payment.customer,payment_intent:id,created:payment.created,amount_refunded:0,payment_method_details:{type:'card'},balance_transaction:txn})
   entries.set(txn,{id:txn,source:chargeId,type:'charge',currency:'usd',amount:cents,fee:247,net:cents-247,created:payment.created})
   if(state.uncertain)throw Error('Synthetic uncertain staff charge after provider acceptance')
   return Response.json(state.badResult?{...payment,amount:cents+100}:payment)
  }
  if(path.startsWith('/v1/payment_intents/'))return Response.json(payments.get(path.split('/').at(-1)))
  if(path.startsWith('/v1/charges/')&&charges.has(path.split('/').at(-1)))return Response.json(charges.get(path.split('/').at(-1)))
  if(path.startsWith('/v1/balance_transactions/'))return Response.json(entries.get(path.split('/').at(-1)))
  if(path==='/v1/payouts/po_staff_payment')return Response.json({id:'po_staff_payment',status:'paid',arrival_date:Date.parse(recurring.state.now)/1000,amount:[...entries.values()].reduce((sum,r)=>sum+r.net,0),currency:'usd',automatic:true,reconciliation_status:'completed'})
  if(path==='/v1/balance_transactions'&&u.searchParams.get('payout')==='po_staff_payment')return Response.json({data:[...entries.values()],has_more:false})
  return recurring.outbound(request)
 }}
}
export async function staffPaymentJourney(){
 const edge=staffStripeEdge(),options={entry:'tests/advancing-clock-worker.ts',bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-9001',STRIPE_WEBHOOK_SECRET:secret},outbound:edge.outbound}
 const h=await installation(options),headers={'x-test-now':edge.recurring.state.now},endpoint='/api/coffer/giving/payments'
 const form=(data,as='')=>({method:'POST',as,headers:{...headers,'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(data).toString()})
 const get=(path,opts={})=>h.get(path,{...opts,headers:{...headers,...opts.headers}})
 const api=(path,body,opts={})=>h.api(path,body,{...opts,headers:{...headers,...opts.headers}})
 const deliver=async(type,id,eventId=type+'-'+id,status=200,installation=h)=>{
  const raw=JSON.stringify({id:eventId,type,data:{object:{id}}}),timestamp=Date.parse(edge.recurring.state.now)/1000,signature=createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex')
  const response=await installation.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw,headers:{...headers,'stripe-signature':`t=${timestamp},v1=${signature}`}})
  assert.equal(response.status,status,await response.text())
 }
 const portals=new Map()
 const consent=async(person,scope,status='granted',stale)=>{
  if(!portals.has(person.id))portals.set(person.id,await signInPortal(h,person.email))
  const portal=portals.get(person.id)
  const response=await h.request('/giving/portal/saved-card?scope='+scope,{as:portal.cookie,headers});assert.equal(response.status,200)
  const html=await response.text(),values={scope,status,confirm:'yes'}
  for(const name of ['customerId','paymentMethodId','version'])values[name]=html.match(new RegExp(`name="${name}" value="([^"]*)"`))[1]
  const saved=await h.request('/giving/portal/saved-card',form(stale??values,portal.cookie))
  assert.equal(saved.status,stale?409:303,await saved.text());return values
 }
 let saved
 try{
  await reviewed(h)
  const campaign=await api('/api/coffer/giving/campaigns',{name:'Authorized reading gifts',slug:'staff-payment-reading',description:'Books and tutoring',fund:'Reading',goal:'20000'})
  const appeal='synthetic-coffer-9002';await h.command('appealCode.define',{code:appeal,name:'Reading reply cards'},{headers})
  const setup=async(name)=>{
   const created=await donor(h,name),person=(await get('/api/coffer/donors/'+created.id)).donor
   const checkout=await h.request('/give/staff-payment-reading/checkout',form({requestId:randomUUID(),name:person.name,email:person.email,amount:'20',frequency:'monthly','cf-turnstile-response':'synthetic-coffer-security-token'}));assert.equal(checkout.status,303,await checkout.text())
   const sub=[...edge.recurring.state.plans.values()].at(-1);await deliver('customer.subscription.created',sub.id)
   const call=await h.command('interaction.record',{donorId:person.id,kind:'call',occurredOn:'2026-01-10',notes:'Synthetic donor authorization for one immediate gift of 100 USD to Reading and the reading reply-card appeal.'},{headers})
   return {person,sourceRef:'interaction:'+call.id}
  }
  const {person,sourceRef}=await setup('Synthetic Coffer Avery'),other=await setup('Synthetic Coffer Blair'),revoked=await setup('Synthetic Coffer Drew')
  const member=await h.person((await get('/api/coffer/donors/'+other.person.id)).donor.email),agent=await h.command('agent.create',{label:'No staff payment authority'})
  const draft=async(p=person,source=sourceRef)=>{const s=await get(endpoint+'/new?donorId='+p.id);return {donorId:p.id,customerId:s.customerId,paymentMethodId:s.paymentMethodId,version:s.version,requestId:randomUUID(),campaignId:campaign.id,amount:'100',appeal,sourceRef:source,givingChannel:'phone'}}
  const review=async(input,opts={})=>({...input,...await api(endpoint+'/review',input,opts),confirm:'yes'})
  let input=await draft()
  await get(endpoint+'/new?donorId='+person.id,{as:'',status:401})
  await api(endpoint+'/review',input,{as:member.cookie,status:403})
  await api(endpoint+'/new',{...input,confirm:'yes'},{as:'',headers:{authorization:'Bearer '+agent.token},status:403})
  await api(endpoint+'/review',input,{status:409})
  await consent(person,'recurring');input=await draft()
  assert.equal((await api(endpoint+'/review',input,{status:409})).error,'SAVED_CARD_CONSENT_REQUIRED','Recurring permission cannot authorize one-time gifts')
  const granted=await consent(person,'once');input=await draft()
  await api(endpoint+'/review',{...input,sourceRef:other.sourceRef},{status:409})
  await api(endpoint+'/review',{...input,appeal:'undefined-appeal'},{status:400})
  await api(endpoint+'/review',{...input,givingChannel:'mail'},{status:400})
  let ready=await review(input)
  await api(endpoint+'/new',{...ready,confirm:'no'},{status:400})
  await api(endpoint+'/new',{...ready,amount:'101'},{status:409})
  await consent(person,'once','withdrawn');await api(endpoint+'/new',ready,{status:409})
  await consent(person,'once');ready=await review(await draft())
  edge.recurring.state.savedMethods.set(ready.customerId,'synthetic-coffer-9010')
  await api(endpoint+'/new',ready,{status:409})
  await consent(person,'once','granted',granted)
  assert.equal((await get(endpoint+'/new?donorId='+person.id)).cardConsent,null)
  await consent(person,'once')
  const doc=await api('/api/coffer/documents',{donorId:person.id,recordRef:'donor:'+person.id,title:'Synthetic mailed gift authorization',fileName:'authorization.pdf',mediaType:'application/pdf',contentBase64:agreement().toString('base64')})
  const mailInput={...await draft(person,'document:'+doc.id),givingChannel:'mail'}
  ready=await review(mailInput)
  await h.command('interaction.record',{donorId:person.id,kind:'call',occurredOn:'2026-01-10',notes:'Supplemental authorization evidence requires fresh review.'},{headers})
  await api(endpoint+'/new',ready,{status:409})
  assert.equal(edge.writes.length,0,'Unsafe authority, consent, card, evidence and exact-amount attempts submit no charge')
  for(let n=0;n<10;n++){const blocked=await h.request('/give/staff-payment-reading/checkout',form({requestId:randomUUID(),name:person.name,email:person.email,amount:'1',frequency:'once'}));assert.ok([403,429].includes(blocked.status))}
  const protection=await get('/api/coffer/giving/protection');assert.ok(protection.forms.some(r=>r.paused===1),'The public form is paused before staff entry')
  await staffPaymentBrowser(h,{person,campaign,appeal,sourceRef,headers,portal:portals.get(person.id),directory:process.env.COFFER_STAFF_PAYMENT_BROWSER})
  assert.equal(edge.writes.length,1,'Native confirmation submits one saved-card charge')
  const payment=[...edge.payments.values()][0],requestId=payment.metadata.coffer_intent
  const result=await get(endpoint+'/'+requestId);assert.equal(result.state,'complete')
  const history=await get('/api/coffer/donors/'+person.id)
  assert.equal(history.gifts.length,1);assert.equal(history.gifts[0].amount_cents,10000);assert.equal(history.gifts[0].fund,'Reading');assert.equal(history.gifts[0].created_by,'Morgan Lee')
  assert.equal(history.letters.length,1);assert.equal(history.letters[0].amount_cents,10000)
  assert.match((await get('/api/coffer/letters/'+history.letters[0].batch_id)).letters[0].body,/\$100\.00/)
  await deliver('charge.succeeded',payment.latest_charge);await deliver('payment_intent.succeeded',payment.id);await deliver('charge.succeeded',payment.latest_charge,'synthetic-coffer-9011')
  assert.equal((await get('/api/coffer/donors/'+person.id)).gifts.length,1)
  await api('/api/coffer/payments/sync',{payoutId:'po_staff_payment'})
  const fees=await get('/api/coffer/payments/fees?payoutId=po_staff_payment')
  assert.deepEqual(fees.totals,{gross_cents:10000,fee_cents:247,net_cents:9753})
  assert.deepEqual(fees.byForm.map(r=>[r.id,r.gross_cents]),[[null,10000]])
  assert.deepEqual(fees.byCampaign.map(r=>[r.id,r.gross_cents]),[[campaign.id,10000]])
  const report=await get('/api/coffer/reports/attribution?from=2026-01-01&to=2026-12-31')
  assert.equal(report.ledgerCents,10000);assert.deepEqual(report.appeal.map(r=>[r.key,r.amountCents]),[[appeal,10000]]);assert.deepEqual(report.channel.map(r=>[r.key,r.amountCents]),[['phone',10000]])
  assert.deepEqual(await get('/api/coffer/giving/protection'),protection)
  const audit=(await get('/api/coffer/audit?action=staffPayment.requested')).rows
  assert.equal(audit.length,1);assert.equal(audit[0].actor_role,'owner');assert.equal(JSON.parse(audit[0].detail).sourceRef,sourceRef)
  // Completed request replay has the same durable input and returns without provider submission.
  const own=await api('/api/coffer/donors/'+person.id+'/data-request',{requestedOn:'2026-01-10',method:'email'})
  const stored=own.records.portal_changes.find(r=>r.id===requestId),original=JSON.parse(JSON.parse(stored.request).input)
  await api(endpoint+'/new',{...original,requestId,confirm:'yes'})
  assert.equal(edge.writes.length,1)
  assert.ok(!JSON.stringify(own).includes('synthetic-coffer-card-metadata'),'Provider card metadata and card numbers never enter Coffer storage')
  const admin=await h.person(['synthetic-coffer-9012','example.test'].join('@'),'admin')
  const mailed=await review({...await draft(person,'document:'+doc.id),amount:'37.25',givingChannel:'mail'},{as:admin.cookie})
  const attempts=await Promise.all([1,2].map(()=>h.request(endpoint+'/new',{method:'POST',body:mailed,as:admin.cookie,headers})))
  assert.ok(attempts.every(r=>[200,409].includes(r.status)));assert.ok(attempts.some(r=>r.status===200))
  assert.equal(edge.writes.length,2,'Concurrent native request retries submit one additional charge')
  const mailedGift=(await get('/api/coffer/donors/'+person.id)).gifts.find(g=>g.amount_cents===3725)
  assert.ok(mailedGift);assert.equal(mailedGift.created_by,'synthetic-coffer-9012')
  assert.equal((await get('/api/coffer/donors/'+person.id)).letters.find(l=>l.gift_id===mailedGift.id).amount_cents,3725)
  const attributed=await get('/api/coffer/reports/attribution?from=2026-01-01&to=2026-12-31')
  assert.deepEqual((await get('/api/coffer/payments/fees')).totals,{gross_cents:13725,fee_cents:494,net_cents:13231})
  assert.equal(attributed.ledgerCents,13725);assert.equal(attributed.channel.find(r=>r.key==='mail').amountCents,3725)
  await consent(other.person,'recurring');await consent(other.person,'once');const uncertain=await review(await draft(other.person,other.sourceRef))
  edge.state.uncertain=true
  await api(endpoint+'/new',uncertain,{status:502})
  const attempted=edge.writes.length
  await api(endpoint+'/new',uncertain,{status:409});await api(endpoint+'/new',{...uncertain,requestId:randomUUID()},{status:409})
  const planState=await get('/api/coffer/giving/plans/new?donorId='+other.person.id)
  const planRefusal=await api('/api/coffer/giving/plans',{...uncertain,version:planState.version,frequency:'monthly',requestId:randomUUID()},{status:409})
  assert.equal(planRefusal.error,'CREATE_PENDING')
  assert.equal(edge.writes.length,attempted,'Uncertain results hold both staff doors across new request IDs')
  saved=await archive(h)
  const restored=await installation({...options,givingProtection:false})
  try{
   await restore(restored,saved)
   const retained=await restored.get(endpoint+'/'+uncertain.requestId,{headers});assert.equal(retained.state,'pending')
   await restored.api(endpoint+'/new',{...uncertain,requestId:randomUUID()},{headers,status:409})
   assert.equal(edge.writes.length,attempted,'Restoring never clears an unresolved charge')
   const captured=[...edge.payments.values()].at(-1)
   await deliver('charge.succeeded',captured.latest_charge,'synthetic-coffer-9015',200,restored)
   await deliver('payment_intent.succeeded',captured.id,'synthetic-coffer-9016',200,restored)
   assert.equal((await restored.get(endpoint+'/'+uncertain.requestId,{headers})).state,'complete')
   const recovered=await restored.get('/api/coffer/donors/'+other.person.id,{headers})
   assert.deepEqual(recovered.gifts.map(g=>g.amount_cents),[10000]);assert.equal(recovered.letters[0].amount_cents,10000)
   assert.equal(edge.writes.length,attempted,'Charge-first and repeated provider results resolve the original payment without another charge')
   assert.deepEqual((await restored.get('/api/coffer/donors/'+person.id,{headers})).gifts.map(g=>g.amount_cents).sort((a,b)=>a-b),[3725,10000])
  }finally{await restored.close()}
  await consent(revoked.person,'once')
  const staleAuthority=await review(await draft(revoked.person,revoked.sourceRef),{as:admin.cookie})
  edge.state.onMethod=async()=>{edge.state.onMethod=async()=>{const r=await h.request('/auth/signout',{method:'POST',body:{},as:admin.cookie,headers});assert.equal(r.status,204)}}
  await api(endpoint+'/new',staleAuthority,{as:admin.cookie,status:401})
  assert.equal(edge.writes.length,attempted,'Revocation during provider verification refuses the charge before submission')
  // The uncertain hold follows canonical identity; merging cannot release it.
  const target=await donor(h,'Synthetic Coffer Casey'),comparison=await get('/api/coffer/duplicates/compare?source='+other.person.id+'&target='+target.id)
  await h.command('donor.merge',{sourceDonorId:other.person.id,donorId:target.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'},{headers})
  assert.ok((await get(endpoint+'/new?donorId='+target.id)).pending)
  await api(endpoint+'/new',{...uncertain,donorId:target.id,requestId:randomUUID()},{status:409})
  await h.command('donor.erase',{donorId:target.id,confirm:'ERASE'},{headers})
  const captured=[...edge.payments.values()].at(-1)
  await deliver('payment_intent.succeeded',captured.id)
  await deliver('charge.succeeded',captured.latest_charge,'synthetic-coffer-9013',409)
  await deliver('charge.succeeded',captured.latest_charge,'synthetic-coffer-9014',409)
  await get(endpoint+'/'+uncertain.requestId,{status:404})
  assert.equal(edge.writes.length,attempted,'Merge, erasure and provider replay cannot charge again')
  assert.equal((await get('/api/coffer/donors')).donors.some(d=>d.id===target.id),false)
  const paidHistory=await get('/api/coffer/donors/'+person.id)
  for(const letter of paidHistory.letters){
   if(!letter.printed_at&&!['submitted','delivered','bounced','complained'].includes(letter.delivery_status)){const batch=await get('/api/coffer/letters/'+letter.batch_id);await h.command('ack.discard',{batchId:batch.id,version:batch.version},{headers})}
  }
  const survivor=await donor(h,'Synthetic Coffer Emery'),paidComparison=await get('/api/coffer/duplicates/compare?source='+person.id+'&target='+survivor.id)
  await h.command('donor.merge',{sourceDonorId:person.id,donorId:survivor.id,sourceVersion:paidComparison.source.version,version:paidComparison.target.version,reason:'duplicate_record'},{headers})
  assert.deepEqual((await get('/api/coffer/donors/'+survivor.id)).gifts.map(g=>g.amount_cents).sort((a,b)=>a-b),[3725,10000])
  assert.equal((await get(endpoint+'/'+requestId)).donor_id,survivor.id)
  await deliver('charge.succeeded',payment.latest_charge,'synthetic-coffer-9017')
  assert.equal((await get('/api/coffer/donors/'+survivor.id)).gifts.length,2,'Replaying a paid charge after merge preserves the original two gifts')
  await h.command('donor.erase',{donorId:survivor.id,confirm:'ERASE'},{headers})
  await deliver('payment_intent.succeeded',payment.id,'synthetic-coffer-9018')
  await deliver('charge.succeeded',payment.latest_charge,'synthetic-coffer-9019')
  await get(endpoint+'/'+requestId,{status:404})
  assert.equal((await get('/api/coffer/reports/attribution?from=2026-01-01&to=2026-12-31')).ledgerCents,13725,'Erasure and replay retain anonymous money without resurrecting the donor')
  assert.ok(!(await get('/api/coffer/donors')).donors.some(d=>d.name===person.name||d.name==='Synthetic Coffer Emery'))
  assert.deepEqual(await get('/api/coffer/giving/protection'),protection)
  assert.equal(edge.writes.length,attempted)
 }finally{await h.close()}
}
