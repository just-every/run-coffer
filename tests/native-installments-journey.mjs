import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {installation,reviewed,archive,restore} from './harness.mjs'
import {recurringStripeEdge} from './recurring-stripe-edge.mjs'
import {signInPortal} from './portal-journey.mjs'
import {nativeInstallmentsBrowser} from './native-installments-browser.mjs'

const secret='synthetic-coffer-8101'
const address=n=>'synthetic-coffer-'+n+String.fromCharCode(64)+'example.test'
/** Only Stripe and mail are substituted. Every schedule, approval, clock tick,
 * ledger read and custody operation uses Coffer's actual public doors. */
export async function nativeInstallmentsJourney(){
 return nativeFixture(async({h,edge,state,payments,transactions,headers,get,api,command,form,root,tick,deliver,prepare,instruction,secret,campaign,member,outbound})=>{
  const first=await prepare(),before=state.debits
  await api(root,first.body,{as:member.cookie,status:403});await api(root,{...first.body,confirm:'no'},{status:400})
  await api(root,{...first.body,sourceRef:'interaction:foreign'},{status:409})
  const created=await api(root,first.body),id=created.id
  assert.equal((await api(root,first.body)).id,id);assert.equal(state.debits,before,'Preparation and replay never submit a payment')
  await instruction(id,'approve',{}, {as:member.cookie,status:403})
  await nativeInstallmentsBrowser(h,edge,{id,person:first.person,directory:process.env.COFFER_NATIVE_INSTALLMENTS_BROWSER,phase:'review'})
  await instruction(id,'approve')
  assert.equal(state.debits,1)
  assert.equal((await get(root+'/'+id)).installments[0].state,'paid')
  const originalSub=structuredClone(first.sub)
  await Promise.all([tick('2026-02-10T12:00:00.000Z'),tick('2026-02-10T12:00:00.000Z')])
  // Restart the actual Worker with the same durable D1 storage.
  await h.replaceBindings({})
  await Promise.all([tick('2026-03-10T12:00:00.000Z'),tick('2026-03-10T12:00:00.000Z')])
  for(const p of payments.values()){await deliver('charge.succeeded',p.latest_charge);await deliver('payment_intent.succeeded',p.id)}
  const current=await get(root+'/'+id),history=await get('/api/coffer/donors/'+first.person.id),gifts=history.gifts.filter(g=>current.installments.some(i=>i.gift_id===g.id))
  assert.equal(state.debits,3);assert.equal(current.installments.length,3);assert.equal(gifts.length,3)
  assert.deepEqual(gifts.map(g=>g.amount_cents),[2500,2500,2500]);assert.equal(gifts.reduce((n,g)=>n+g.amount_cents,0),7500)
  assert.equal(history.letters.filter(l=>gifts.some(g=>g.id===l.gift_id)).length,3)
  for(const letter of history.letters){assert.equal(letter.amount_cents,2500);const batch=await get('/api/coffer/letters/'+letter.batch_id);assert.match(batch.letters[0].body,/\$25\.00/)}
  assert.deepEqual(first.sub,originalSub,'Native Cron never mutates an existing Stripe subscription')
  const fees=await get('/api/coffer/payments/fees')
  assert.deepEqual(fees.totals,{gross_cents:7500,fee_cents:309,net_cents:7191})
  assert.deepEqual(fees.byCampaign.map(r=>[r.id,r.gross_cents]),[[campaign.id,7500]])
  assert.deepEqual(fees.byForm.map(r=>[r.id,r.gross_cents]),[[null,7500]])
  const attributed=await get('/api/coffer/reports/attribution?from=2026-01-01&to=2026-12-31')
  assert.equal(attributed.channel.find(r=>r.key==='phone').amountCents,7500)
  assert.equal((await get('/api/coffer/reports/recurring?from=2026-03&through=2026-03')).rows[0].mrrCents,5000,'Hosted and native active plans both appear in recurring health')
  await instruction(id,'pause');await tick('2026-04-10T12:00:00.000Z');await tick('2026-05-10T12:00:00.000Z');assert.equal(state.debits,3)
  await instruction(id,'resume');assert.equal((await get(root+'/'+id)).plan.next_due_on,'2026-06-10')
  await tick('2026-05-20T12:00:00.000Z');assert.equal(state.debits,3,'Resume never charges missed months')
  if(process.env.COFFER_NATIVE_INSTALLMENTS_BROWSER)await mkdir(process.env.COFFER_NATIVE_INSTALLMENTS_BROWSER,{recursive:true})
  await nativeInstallmentsBrowser(h,edge,{id,person:first.person,directory:process.env.COFFER_NATIVE_INSTALLMENTS_BROWSER})
  await instruction(id,'cancel');await tick('2026-06-10T12:00:00.000Z');assert.equal(state.debits,3)
  // Current approver authority is rechecked after the durable claim and slow card read.
  const admin=await h.person(address(8104),'admin'),authority=await prepare(),authorityId=(await api(root,authority.body)).id
  await instruction(authorityId,'approve',{}, {as:admin.cookie})
  const authorityDebits=state.debits
  state.beforeRead=async()=>{state.beforeRead=()=>api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})}
  await tick('2026-07-10T12:00:00.000Z')
  assert.equal(state.debits,authorityDebits,'Revoking the approver during the final card read stops submission')
  assert.equal((await get(root+'/'+authorityId)).installments.at(-1).state,'blocked')
  // Failure and a lost create response each hold all subsequent ticks and fresh requests.
  const failed=await prepare(),failedId=(await api(root,failed.body)).id;state.mode='failed';await instruction(failedId,'approve')
  const bad=await get(root+'/'+failedId);assert.equal(bad.plan.status,'past_due');assert.equal(bad.installments[0].state,'failed')
  const failedDonor=await get('/api/coffer/donors/'+failed.person.id);assert.equal(failedDonor.gifts.length,0);assert.equal(failedDonor.letters.length,0)
  const task=(await get('/api/coffer/tasks')).tasks.filter(t=>t.source_key==='recovery:'+bad.installments[0].id);assert.equal(task.length,1);assert.ok(task[0].owner_id);assert.equal(task[0].is_ask,0)
  const freshFailed=await api(root,{...failed.body,requestId:randomUUID()})
  await instruction(freshFailed.id,'approve',{}, {status:409})
  const staffState=await get('/api/coffer/giving/plans/new?donorId='+failed.person.id)
  await api('/api/coffer/giving/plans',{...failed.body,requestId:randomUUID(),version:staffState.version},{status:409})
  const donorFile=await api('/api/coffer/donors/'+failed.person.id+'/data-request',{requestedOn:edge.state.now.slice(0,10),method:'phone'})
  assert.ok(donorFile.records.native_installments.some(i=>i.plan_id===failedId),'The donor file includes their own linked installment history')
  assert.equal(donorFile.records.native_plan_approvals,undefined)
  await instruction(failedId,'resume',{}, {status:409})
  const pending=await prepare(),pendingId=(await api(root,pending.body)).id;state.mode='paid';state.uncertain=true;await instruction(pendingId,'approve');state.uncertain=false
  assert.equal((await get(root+'/'+pendingId)).installments[0].state,'uncertain')
  const debitCount=state.debits
  await Promise.all([tick('2026-07-10T12:00:00.000Z'),tick('2026-07-10T12:00:00.000Z')]);assert.equal(state.debits,debitCount)
  const pi=[...payments.values()].at(-1)
  await instruction(pendingId,'reconcile',{paymentIntentId:pi.id});await instruction(pendingId,'reconcile',{paymentIntentId:pi.id});assert.equal(state.debits,debitCount)
  assert.equal((await get('/api/coffer/donors/'+pending.person.id)).gifts.length,1)
  await instruction(pendingId,'cancel')
  // Current permission, replacement, evidence and donor identity are rechecked.
  const withdrawn=await prepare(),withdrawnId=(await api(root,withdrawn.body)).id
  await withdrawn.card('withdrawn');await instruction(withdrawnId,'approve',{}, {status:409});assert.equal(state.debits,debitCount)
  const replaced=await prepare(),replacedId=(await api(root,replaced.body)).id
  edge.state.savedMethods.set(replaced.body.customerId,'synthetic-coffer-8999');await instruction(replacedId,'approve',{}, {status:409});assert.equal(state.debits,debitCount)
  const stale=await prepare(),staleId=(await api(root,stale.body)).id
  await command('donor.update',{donorId:stale.person.id,version:stale.person.version,name:'Synthetic updated identity',email:stale.person.email})
  await instruction(staleId,'approve',{}, {status:409});assert.equal(state.debits,debitCount)
  const mergeSource=await prepare(),mergeId=(await api(root,mergeSource.body)).id
  await instruction(mergeId,'approve')
  const mergeTarget=await command('donor.create',{name:'Synthetic surviving monthly donor',email:address(8400)})
  const comparison=await get('/api/coffer/duplicates/compare?source='+mergeSource.person.id+'&target='+mergeTarget.id)
  await command('donor.merge',{sourceDonorId:mergeSource.person.id,donorId:mergeTarget.id,sourceVersion:comparison.source.version,version:comparison.target.version,fields:{},reason:'duplicate_record'})
  assert.equal((await get(root+'/'+mergeId)).plan.status,'canceled','A merged billing identity loses charging approval')
  const mergeDebits=state.debits
  await tick('2026-08-10T12:00:00.000Z');assert.equal(state.debits,mergeDebits,'Merge cannot reactivate native billing')
  // Portable history excludes charging approval and cannot restart collections.
  const lines=await archive(h),restored=await installation({entry:'tests/advancing-clock-worker.ts',triggerHandlers:true,givingProtection:false,bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-8102',STRIPE_WEBHOOK_SECRET:secret},outbound})
  try{await restore(restored,lines);const r=await restored.get(root+'/'+id);assert.equal(r.approval,null);await restored.request('/cdn-cgi/local/scheduled?time='+Date.parse('2027-01-10T12:00:00Z'));assert.equal(state.debits,mergeDebits)}finally{await restored.close()}
  await command('donor.erase',{donorId:withdrawn.person.id,confirm:'ERASE'})
  await get(root+'/'+withdrawnId,{status:404})
  await tick('2026-09-10T12:00:00.000Z');assert.equal(state.debits,mergeDebits)
  await nativeInstallmentsBrowser(h,edge,{id:failedId,person:failed.person,directory:process.env.COFFER_NATIVE_INSTALLMENTS_BROWSER,phase:'held'})
  return {installments:3,gross:7500,fee:309,net:7191,debits:state.debits}
 })
}
export async function nativeFixture(fn){
 const edge=recurringStripeEdge(),payments=new Map(),transactions=new Map(),state={debits:0,mode:'paid',beforeRead:null,uncertain:false,mailUncertain:false}
 const outbound=async request=>{
  const url=new URL(request.url),path=url.pathname
  if(path==='/v1/payment_intents'&&request.method==='POST'){
   const p=new URLSearchParams(await request.text()),n=++state.debits,id='pi_native_'+n,chargeId='ch_native_'+n,txnId='txn_native_'+n
   assert.equal(p.get('confirm'),'true');assert.equal(p.get('off_session'),'true');assert.equal(p.get('currency'),'usd');assert.equal(p.get('amount'),'2500')
   assert.ok(request.headers.get('idempotency-key'));assert.ok(p.get('metadata[coffer_installment]'))
   const payment={id,amount:2500,amount_received:state.mode==='paid'?2500:0,currency:'usd',customer:p.get('customer'),payment_method:p.get('payment_method'),payment_method_types:['card'],metadata:{coffer_installment:p.get('metadata[coffer_installment]'),coffer_intent:p.get('metadata[coffer_intent]')},status:state.mode==='paid'?'succeeded':state.mode==='failed'?'requires_payment_method':'processing',latest_charge:chargeId,created:Date.parse(edge.state.now)/1000}
   payments.set(id,payment)
   const charge={id:chargeId,paid:true,status:'succeeded',amount:2500,currency:'usd',created:payment.created,customer:payment.customer,payment_method:payment.payment_method,payment_intent:id,metadata:payment.metadata,balance_transaction:txnId,amount_refunded:0}
   edge.state.charges.set(chargeId,charge);transactions.set(txnId,{id:txnId,type:'charge',source:chargeId,amount:2500,fee:103,net:2397,currency:'usd',created:payment.created})
   if(state.uncertain)throw Error('Synthetic lost provider response after submission')
   return Response.json(payment)
  }
  if(path.startsWith('/v1/payment_intents/'))return Response.json(payments.get(path.split('/').at(-1)))
  if(path.startsWith('/v1/balance_transactions/'))return Response.json(transactions.get(path.split('/').at(-1)))
  if(path.startsWith('/v1/payment_methods/')&&state.beforeRead){const fn=state.beforeRead;state.beforeRead=null;await fn()}
  return edge.outbound(request)
 }
 const h=await installation({entry:'tests/advancing-clock-worker.ts',triggerHandlers:true,bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-8102',STRIPE_WEBHOOK_SECRET:secret},outbound,mailOutcome:async()=>{if(state.mailUncertain)throw Error('Synthetic unknown mail submission');return Response.json({id:randomUUID()})}})
 try{
  const headers=()=>({'x-test-now':edge.state.now}),get=(p,o={})=>h.get(p,{...o,headers:headers()}),api=(p,b,o={})=>h.api(p,b,{...o,headers:headers()}),command=(cmd,b,o={})=>h.command(cmd,b,{...o,headers:headers()})
  const form=(b,as='')=>({method:'POST',as,headers:{...headers(),'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(b).toString()})
  const root='/api/coffer/giving/installments'
  const tick=async when=>{edge.state.now=when;const r=await h.request('/cdn-cgi/local/scheduled?time='+Date.parse(when)+'&format=json');assert.equal(r.status,200,await r.text())}
  const deliver=async(type,id)=>{
   const raw=JSON.stringify({id:randomUUID(),type,data:{object:{id}}}),stamp=Date.parse(edge.state.now)/1000,signature=createHmac('sha256',secret).update(stamp+'.'+raw).digest('hex')
   const r=await h.request('/api/coffer/giving/webhook',{...form({}),raw,headers:{...headers(),'stripe-signature':'t='+stamp+',v1='+signature}})
   assert.equal(r.status,200,await r.text())
  }
  await reviewed(h)
  const campaign=await api('/api/coffer/giving/campaigns',{name:'Native monthly reading',slug:'native-monthly',description:'Monthly library support',fund:'Reading',goal:'10000'})
  const member=await h.person(address(8103))
  let personNumber=0
  const prepare=async()=>{
   const email=address(8200+(++personNumber)),name='Synthetic monthly donor '+personNumber
   const checkout=await h.request('/give/native-monthly/checkout',form({name,email,amount:'25',frequency:'monthly',requestId:randomUUID(),'cf-turnstile-response':'synthetic-coffer-security-token'}))
   assert.equal(checkout.status,303,await checkout.text())
   const sub=[...edge.state.plans.values()].at(-1);await deliver('customer.subscription.created',sub.id)
   const person=(await get('/api/coffer/donors')).donors.find(d=>d.email===email)
   const call=await command('interaction.record',{donorId:person.id,kind:'call',occurredOn:edge.state.now.slice(0,10),notes:'Donor authorizes fixed monthly USD 25 on the current saved card, including the immediate first charge.'})
   const portal=await signInPortal(h,email)
   const card=async status=>{
    const r=await h.request('/giving/portal/saved-card',{as:portal.cookie,headers:headers()}),html=await r.text(),b={confirm:'yes'}
    for(const name of ['customerId','paymentMethodId','version','status'])b[name]=html.match(new RegExp('name="'+name+'" value="([^"]*)"'))?.[1]
    if(status)b.status=status
    const saved=await h.request('/giving/portal/saved-card',form(b,portal.cookie));assert.equal(saved.status,303,await saved.text())
   }
   await card()
   const createState=await get(root+'/new?donorId='+person.id),body={donorId:person.id,customerId:createState.customerId,paymentMethodId:createState.paymentMethodId,version:createState.version,requestId:randomUUID(),campaignId:campaign.id,amount:'25',frequency:'monthly',sourceRef:'interaction:'+call.id,givingChannel:'phone',confirm:'yes'}
   return {person,body,card,sub}
  }
  const instruction=async(id,action,extra={},o={})=>api(root+'/'+id,{version:(await get(root+'/'+id)).plan.version,action,confirm:'yes',...extra},o)

  return await fn({h,edge,state,payments,transactions,headers,get,api,command,form,root,tick,deliver,prepare,instruction,secret,campaign,member,outbound})
 }finally{await h.close()}
}
