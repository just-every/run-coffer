import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {run,reviewed} from './harness.mjs'
import {recurringStripeEdge} from './recurring-stripe-edge.mjs'

const secret='synthetic-coffer-7102'
export async function recurringPlansJourney(){
 const edge=recurringStripeEdge()
 await run(async h=>{
  const headers=()=>({'x-test-now':edge.state.now})
  const get=(path,options={})=>h.get(path,{...options,headers:headers()})
  const api=(path,body,options={})=>h.api(path,body,{...options,headers:headers()})
  const form=(data,as='')=>({method:'POST',as,headers:{...headers(),'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(data).toString()})
  const deliver=async(type,id,eventId=type+'-'+id)=>{
   const raw=JSON.stringify({id:eventId,type,data:{object:{id}}}),timestamp=Date.parse(edge.state.now)/1000,signature=createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex')
   const response=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw,headers:{...headers(),'stripe-signature':`t=${timestamp},v1=${signature}`}})
   assert.equal(response.status,200,await response.text())
  }
  await reviewed(h)
  const campaign=await api('/api/coffer/giving/campaigns',{name:'Year-round reading',slug:'recurring-reading',description:'Books and tutoring throughout the year.',fund:'Reading',goal:'10000'})
  const start=async(frequency,amount='25')=>{
   const requestId=randomUUID(),data={requestId,name:'Recurring Donor '+frequency,email:frequency+'@example.test',amount,frequency,'cf-turnstile-response':'synthetic-coffer-security-token'}
   const response=await h.request('/give/recurring-reading/checkout',form(data));assert.equal(response.status,303,await response.text())
   const sub=[...edge.state.plans.values()].at(-1)
   await deliver('customer.subscription.created',sub.id)
   const replay=await h.request('/give/recurring-reading/checkout',form({...data,frequency:frequency==='monthly'?'quarterly':'monthly'}));assert.equal(replay.status,409,'A saved checkout cannot change its billing cadence')
   return sub
  }
  const monthly=await start('monthly')
  for(const month of ['02','03','04']) {
   const tick=await edge.advance(`2026-${month}-10T12:00:00.000Z`)
   for(const id of tick.bills){await deliver('invoice.paid',id);await deliver('invoice.payment_succeeded',id)}
  }
  const person=(await get('/api/coffer/donors')).donors.find(d=>d.email==='monthly@example.test'),history=await get('/api/coffer/donors/'+person.id)
  assert.equal(history.gifts.length,3,'Three clock advances record three installments, each once')
  assert.deepEqual(history.gifts.map(g=>g.amount_cents),[2500,2500,2500])
  assert.ok(history.gifts.every(g=>g.fund==='Reading'))
  assert.equal(history.summary.recurring[0].id,monthly.id)
  assert.equal(history.letters.length,3,'Every installment has its own full-payment receipt')
  for(const letter of history.letters){assert.equal(letter.amount_cents,2500);const batch=await get('/api/coffer/letters/'+letter.batch_id);assert.match(batch.letters[0].body,/\$25\.00/)}
  await api('/api/coffer/payments/sync',{payoutId:'po_recurring'})
  const fees=await get('/api/coffer/payments/fees?payoutId=po_recurring')
  assert.deepEqual(fees.totals,{gross_cents:7500,fee_cents:309,net_cents:7191})
  assert.deepEqual(fees.byForm.map(r=>[r.id,r.gross_cents]),[[campaign.id,7500]])
  assert.deepEqual(fees.byCampaign.map(r=>[r.id,r.gross_cents]),[[campaign.id,7500]])
  const quarterly=await start('quarterly','75'),annual=await start('annually','300')
  assert.deepEqual([quarterly.items.data[0].price.recurring.interval,quarterly.items.data[0].price.recurring.interval_count],['month',3])
  assert.deepEqual([annual.items.data[0].price.recurring.interval,annual.items.data[0].price.recurring.interval_count],['year',1])
  const waitingInvoice={id:'in_quarterly_waiting',customer:quarterly.customer,currency:'usd',parent:{subscription_details:{subscription:quarterly.id}},status:'open',amount_paid:0,attempt_count:1,next_payment_attempt:null,status_transitions:{paid_at:null}}
  edge.state.invoices.set(waitingInvoice.id,waitingInvoice);quarterly.latest_invoice=waitingInvoice.id;quarterly.status='past_due'
  const messages=h.messages.length
  await deliver('invoice.payment_failed',waitingInvoice.id)
  assert.equal(h.messages.length,messages,'New cadences never inherit legacy automatic notice permission')
  assert.equal((await get('/api/coffer/agent')).recovery.rows.find(r=>r.subscription_id===quarterly.id).state,'waiting')
  const health=(await get('/api/coffer/reports/recurring?from=2026-04&through=2026-04')).rows[0]
  assert.equal(health.mrrCents,7500,'Quarterly and annual commitments normalize to monthly revenue')
  const call=await h.command('interaction.record',{donorId:person.id,kind:'call',occurredOn:'2026-04-10',notes:'Donor authorized the future amount, deferred date and collection changes during this call.'},{headers:headers()})
  const path='/api/coffer/giving/plans/'+monthly.id,sourceRef='interaction:'+call.id
  const member=await h.person('synthetic-coffer-7104@example.test')
  await get(path,{as:'',status:401});await get(path,{as:member.cookie,status:403})
  const original=await get(path)
  assert.deepEqual(original.gifts.map(g=>g.id).sort(),history.gifts.map(g=>g.id).sort(),'All three received installments link to this exact plan')
  const change=async(action,extra={},options={})=>{const current=await get(path);return api(path,{action,requestId:randomUUID(),version:current.version,sourceRef,reason:'Donor instruction recorded in the attached call.',confirm:'yes',...extra},options)}
  const before=edge.state.mutations.length
  await change('amount',{amount:'35',sourceRef:'interaction:someone-else'},{status:409})
  await change('amount',{amount:'35',confirm:'no'},{status:400})
  await change('amount',{amount:'35'},{as:member.cookie,status:403})
  assert.equal(edge.state.mutations.length,before,'Refused staff instructions never reach Stripe')
  const requested={action:'amount',amount:'30',requestId:randomUUID(),version:original.version,sourceRef,reason:'Confirmed the new amount on the call.',confirm:'yes'}
  await api(path,requested);await api(path,requested)
  assert.equal(edge.state.mutations.length,before+1,'Replaying a completed staff request does not mutate Stripe again')
  assert.equal((await get(path)).facts.amountCents,3000)
  await api(path,{...requested,requestId:randomUUID(),amount:'40'},{status:409})
  await change('date',{nextBillingOn:'2026-06-10'})
  assert.equal((await get(path)).facts.nextBillingAt,Date.parse('2026-06-10T00:00:00Z')/1000)
  await change('pause');assert.equal((await get(path)).facts.paused,true)
  const paused=await edge.advance('2026-05-10T12:00:00Z');assert.equal(paused.bills.length,0,'A paused monthly plan creates no installment')
  assert.equal((await get('/api/coffer/reports/recurring?from=2026-05&through=2026-05')).rows[0].mrrCents,5000,'Paused collections leave committed revenue')
  await change('resume');assert.equal((await get(path)).facts.paused,false)
  const changes=(await get(path)).history
  assert.ok(['amount','date','pause','resume'].every(action=>changes.some(h=>h.action==='staffPlan.'+action&&h.actor_role==='owner'&&JSON.parse(h.detail).sourceRef===sourceRef)))
  if(process.env.COFFER_PLANS_BROWSER){const {recurringPlansBrowser}=await import('./recurring-plans-browser.mjs');await recurringPlansBrowser(h,edge,{monthly,person,sourceRef,directory:process.env.COFFER_PLANS_BROWSER})}
  if(!monthly.cancel_at_period_end)await change('cancel');assert.equal((await get(path)).facts.cancelled,true)
  const stopped=await edge.advance('2026-06-10T12:00:00Z');assert.ok(!stopped.bills.some(id=>edge.state.invoices.get(id).parent.subscription_details.subscription===monthly.id))
  assert.equal((await get('/api/coffer/donors/'+person.id)).gifts.length,3,'Pause, resume and cancellation preserve received installments')
  const annualPath='/api/coffer/giving/plans/'+annual.id,annualPerson=(await get('/api/coffer/donors')).donors.find(d=>d.email==='annually@example.test')
  const annualCall=await h.command('interaction.record',{donorId:annualPerson.id,kind:'call',occurredOn:'2026-06-10',notes:'The donor authorized a pause.'},{headers:headers()})
  const annualState=await get(annualPath);edge.state.uncertain=true
  const uncertain={action:'pause',version:annualState.version,requestId:randomUUID(),sourceRef:'interaction:'+annualCall.id,reason:'Donor requested a pause.',confirm:'yes'}
  await api(annualPath,uncertain,{status:502});const requests=edge.state.mutations.length
  await api(annualPath,uncertain,{status:409});await api(annualPath,{...uncertain,requestId:randomUUID()},{status:409})
  assert.equal(edge.state.mutations.length,requests,'Unknown financial outcomes remain held without provider retries')
  assert.equal((await get(annualPath)).pending.state,'pending')
  if(process.env.COFFER_PLANS_BROWSER){const {recurringPlansBrowser}=await import('./recurring-plans-browser.mjs');await recurringPlansBrowser(h,edge,{monthly:annual,person:annualPerson,sourceRef:'interaction:'+annualCall.id,directory:process.env.COFFER_PLANS_BROWSER,phase:'pending'})}
 },{entry:'tests/advancing-clock-worker.ts',bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-7103',STRIPE_WEBHOOK_SECRET:secret},outbound:edge.outbound})
}
