import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {run,donor,reviewed} from './harness.mjs'
import {recurringStripeEdge} from './recurring-stripe-edge.mjs'

const events=['gift.created','gift.reversed','donor.created','donor.updated','plan.failed','plan.canceled','task.assigned','form.submitted']
const now='2026-10-27T12:00:00.000Z',secret='synthetic-coffer-1830'
const pair=(type,id)=>[type,id]
const tick=async(h,when)=>{
 const response=await h.request('/cdn-cgi/local/scheduled?cron=*+*+*+*+*&time='+Date.parse(when))
 assert.equal(response.status,200,await response.text())
}

// Only Stripe and the outbound receiver are faked; every source uses a public door.
function sourceEdges(){
 const recurring=recurringStripeEdge(),sessions=new Map(),objects=new Map(),received=[]
 recurring.state.now=now
 const outbound=async request=>{
  const url=new URL(request.url)
  if(url.hostname==='receiver.example.test'){
   const body=await request.text()
   received.push({body,event:JSON.parse(body),signature:request.headers.get('coffer-signature'),eventId:request.headers.get('coffer-event-id'),deliveryId:request.headers.get('coffer-delivery-id')})
   return new Response(null,{status:204})
  }
  assert.equal(url.hostname,'api.stripe.com')
  const params=new URLSearchParams(await request.clone().text())
  if(url.pathname==='/v1/checkout/sessions'&&params.get('mode')==='payment'){
   const n=1840+sessions.size,id='synthetic-coffer-'+n,pi='pi_syntheticcoffer'+n
   const session={id,url:'https://checkout.stripe.com/c/pay/'+id,metadata:{coffer_intent:params.get('metadata[coffer_intent]')},customer:params.get('customer'),currency:'usd',amount_total:Number(params.get('line_items[0][price_data][unit_amount]')),status:'complete',payment_status:'paid',payment_intent:pi}
   sessions.set(id,session)
   objects.set('/v1/payment_intents/'+pi,{id:pi,status:'succeeded',currency:'usd',amount_received:session.amount_total,created:Date.parse(now)/1000})
   return Response.json(session)
  }
  const object=objects.get(url.pathname)??sessions.get(url.pathname.startsWith('/v1/checkout/sessions/')?url.pathname.split('/').at(-1):'')
  return object?Response.json(object):recurring.outbound(request)
 }
 return {recurring,sessions,objects,received,outbound}
}

export async function webhookSourcesJourney(inspectCaptures){
 const edge=sourceEdges()
 await run(async h=>{
  await reviewed(h)
  const signed=await h.command('webhook.subscribe',{name:'synthetic-coffer-1831',endpoint:'https://receiver.example.test/events',events,reviewed:'yes'})
  const log=async()=>(await h.get('/api/coffer/webhooks')).deliveries.filter(d=>d.subscription_id===signed.id)
  const command=(name,input,options={})=>h.command(name,input,{...options,headers:{'x-test-now':now}})
  const checked=async(label,operation,expected=[])=>{
   const before=new Set((await log()).map(d=>d.id)),result=await operation()
   const added=(await log()).filter(d=>!before.has(d.id))
   assert.deepEqual(added.map(d=>pair(d.event_type,d.subject_id)).sort(),(typeof expected==='function'?await expected(result):expected).sort(),label)
   return result
  }
  const send=async(type,id,eventId)=>{
   const raw=JSON.stringify({id:eventId,type,data:{object:{id}}}),timestamp=Date.parse(now)/1000
   const signature=createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex')
   const response=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw,headers:{'x-test-now':now,'stripe-signature':`t=${timestamp},v1=${signature}`}})
   assert.equal(response.status,200,await response.text())
  }
  const native=await checked('Native donor creation',()=>donor(h,'synthetic-coffer-1832',{email:'synthetic-coffer-1832@example.test',addressLine1:null}),d=>[pair('donor.created',d.id)])
  const update={donorId:native.id,version:1,name:'synthetic-coffer-1833',email:'synthetic-coffer-1832@example.test'}
  await checked('Versioned native donor update',()=>command('donor.update',update),[pair('donor.updated',native.id)])
  await checked('Stale donor update emits nothing',()=>command('donor.update',update,{status:409}))
  const gift=await checked('Ledger gift creation',()=>command('gift.record',{donorId:native.id,amount:'25',receivedOn:'2026-10-26',method:'check',goods:'none'}),g=>[pair('gift.created',g.id)])
  const reverse={giftId:gift.id,reason:'synthetic-coffer-1834'}
  await checked('Ledger reversal',()=>command('gift.reverse',reverse),g=>[pair('gift.reversed',g.id)])
  await checked('Repeated reversal emits nothing',()=>command('gift.reverse',reverse,{status:409}))
  await importSources(h,checked,command)
  await taskSources(h,checked,command,native.id)

  const campaign=await h.api('/api/coffer/giving/campaigns',{name:'synthetic-coffer-1835',slug:'synthetic-coffer-1835',description:'Synthetic giving source.',fund:'Reading',goal:'10000'})
  const post=async(path,data)=>{
   const response=await h.request(path,{method:'POST',as:'',headers:{'content-type':'application/x-www-form-urlencoded','x-test-now':now},raw:new URLSearchParams(data).toString()})
   assert.equal(response.status,303,await response.text())
  }
  const checkout=async(path,data,session)=>{
   await checked('First provider session submits the form',()=>post(path,data),()=>[pair('form.submitted',session().metadata.coffer_intent)])
   await checked('Repeated checkout retains its first session',()=>post(path,data))
  }
  const values=n=>({requestId:randomUUID(),name:'synthetic-coffer-'+n,email:'synthetic-coffer-'+n+'@example.test',amount:'25',frequency:'once','cf-turnstile-response':'synthetic-coffer-security-token'})
  const giving=values(1836)
  await checkout('/give/'+campaign.slug+'/checkout',giving,()=>[...edge.sessions.values()].at(-1))
  const session=[...edge.sessions.values()].at(-1)
  const complete=()=>send('checkout.session.completed',session.id,'synthetic-coffer-1837')
  await checked('Hosted payment creates its donor and gift',complete,[pair('donor.created','giving-donor-'+session.metadata.coffer_intent),pair('gift.created','giving-'+session.payment_intent)])
  await checked('Repeated provider completion emits nothing',complete)
  await checked('A fresh provider event for the same completed session emits nothing',()=>send('checkout.session.completed',session.id,'synthetic-coffer-1838'))
  await hostedReversal(h,edge,send,checked,session)

  await command('appealCode.define',{code:'SYNTHETIC1850',name:'synthetic-coffer-1850'})
  const event=await command('event.create',{name:'synthetic-coffer-1851',slug:'synthetic-coffer-1851',campaignId:campaign.id,appeal:'SYNTHETIC1850',startsOn:'2026-10-28'})
  const ticket=await command('event.ticket',{eventId:event.id,name:'synthetic-coffer-1852',price:'25',benefit:'5',benefitDescription:'Synthetic admission.'})
  const guest={...values(1853),ticketId:ticket.id}
  await checkout('/giving/events/'+event.slug+'/checkout',guest,()=>[...edge.sessions.values()].at(-1))
  await planSources(edge,send,checked,checkout,campaign,values)

  // Flush all due work, including the successor generated by the real scheduler.
  for(let pass=0;pass<3;pass++){
   const queued=(await log()).filter(d=>d.status==='pending')
   if(!queued.length)break
   await tick(h,new Date(Math.max(...queued.map(d=>Date.parse(d.next_at)),Date.parse(now))+1000).toISOString())
  }
  const deliveries=await log()
  assert.ok(deliveries.every(d=>d.status==='delivered'),'Every native source reaches the receiver')
  assert.equal(edge.received.length,deliveries.length,'Successful source deliveries do not duplicate')
  for(const delivery of deliveries){
   const captured=edge.received.filter(r=>r.deliveryId===delivery.id)
   assert.equal(captured.length,1,'One receiver request for each native event')
   const [message]=captured,signature=Object.fromEntries(message.signature.split(',').map(p=>p.split('=')))
   assert.equal(signature.v1,createHmac('sha256',signed.secret).update(signature.t+'.'+message.body).digest('hex'),'Every source signs the exact bytes with its endpoint key')
   assert.equal(message.eventId,delivery.event_id)
   assert.deepEqual(message.event,{id:delivery.event_id,type:delivery.event_type,occurredAt:delivery.occurred_at,data:{id:delivery.subject_id}})
  }
  if(inspectCaptures)await inspectCaptures({phase:'captured',h,signed,messages:edge.received})
  const hostedDonor=(await h.get('/api/coffer/donors')).donors.find(d=>d.email===giving.email)
  await command('donor.erase',{donorId:hostedDonor.id,confirm:'ERASE'})
  const privateIds=[hostedDonor.id,session.metadata.coffer_intent,'giving-'+session.payment_intent,'txn_syntheticcoffer1884','txn_syntheticcoffer1887']
  assert.ok((await log()).every(d=>!privateIds.includes(d.subject_id)),'Erasure removes hosted gifts and processor adjustment webhook identifiers')
  if(inspectCaptures)await inspectCaptures({phase:'erased',h,signed,messages:edge.received,erasedIds:privateIds})
 },{entry:'tests/advancing-clock-worker.ts',triggerHandlers:true,bindings:{COFFER_TEST_NOW:now,STRIPE_SECRET_KEY:'synthetic-coffer-1839',STRIPE_WEBHOOK_SECRET:secret},outbound:edge.outbound})
}

async function importSources(h,checked,command){
 // Stripe source IDs must retain Stripe's identifier grammar.
 const input={customers:[{object:'list',data:[{id:'cus_syntheticcoffer1860',name:'synthetic-coffer-1860',email:'synthetic-coffer-1860@example.test',created:Date.parse(now)/1000}]}],charges:[{object:'list',data:[{id:'ch_syntheticcoffer1861',customer:'cus_syntheticcoffer1860',status:'succeeded',paid:true,currency:'usd',amount:5000,amount_refunded:5000,created:Date.parse(now)/1000}]}],noGoodsOrServices:true}
 const preview=await h.api('/api/coffer/imports/preview',input)
 let imported
 await checked('Stripe move-in inserts the donor, gift and full refund',async()=>{
  let job=await h.api('/api/coffer/imports/apply',{...input,fingerprint:preview.fingerprint})
  while(job.state!=='completed')job=await h.api('/api/coffer/imports/resume',{id:job.id})
  imported=(await h.get('/api/coffer/donors')).donors.find(d=>d.email==='synthetic-coffer-1860@example.test')
  return (await h.get('/api/coffer/donors/'+imported.id)).gifts
 },gifts=>[pair('donor.created',imported.id),...gifts.map(g=>pair(g.kind==='gift'?'gift.created':'gift.reversed',g.id))])
 await checked('Already imported source refuses duplicate records',()=>h.api('/api/coffer/imports/preview',input,{status:409}))
 await checked('Imported donors retain native versioned updates',()=>command('donor.update',{donorId:imported.id,version:imported.version,name:'synthetic-coffer-1862',email:imported.email}),[pair('donor.updated',imported.id)])
 const file=(name,csv)=>({name,base64:Buffer.from(csv).toString('base64')})
 for(const [index,[source,donorColumn,giftColumn,giftType]] of [['lgl','LGL Constituent ID','LGL Gift ID','Gift'],['bloomerang','Account Number','Transaction Number','Donation'],['re-nxt','Constituent ID','Gift ID','Cash']].entries()){
  const name='synthetic-coffer-'+(1863+index)
  const crm={source,files:[file('constituents.csv',donorColumn+',Name,Custom source\r\nsynthetic-coffer-1863,'+name+',synthetic-coffer-1864\r\n'),file('gifts.csv',giftColumn+','+donorColumn+',Gift Type,Gift Date,Amount,Payment Method,Non-Deductible Amount\r\nsynthetic-coffer-1865,synthetic-coffer-1863,'+giftType+',2026-10-26,25,Check,0\r\n')],customFields:[{source,column:'Custom source',key:'synthetic_source_'+index,label:'Custom source',kind:'constituent',type:'text',entry:'free-form',choices:[]}]}
  const review=await h.api('/api/coffer/move-in/preview',crm)
  assert.equal(review.canApply,true,JSON.stringify(review.diagnostics))
  const apply=async()=>{
   let job=await h.api('/api/coffer/move-in/apply',{id:review.id,fingerprint:review.fingerprint})
   while(job.state==='applying')job=await h.api('/api/coffer/move-in/continue',{id:review.id})
   const person=(await h.get('/api/coffer/donors')).donors.find(d=>d.name===name)
   return h.get('/api/coffer/donors/'+person.id)
  }
  await checked(source+' imports its gift and creates and versions its donor',apply,d=>[pair('donor.created',d.donor.id),pair('donor.updated',d.donor.id),...d.gifts.map(g=>pair('gift.created',g.id))])
  await checked(source+' repeated apply does not repeat donor or gift events',apply)
 }
}

async function taskSources(h,checked,command,donorId){
 const owner=(await h.get('/auth/session')).operator,other=await h.person('synthetic-coffer-1870@example.test')
 const call=await checked('Initial call assignment',()=>command('task.create',{donorId,ownerId:owner.id,kind:'call',title:'synthetic-coffer-1871',dueOn:'2026-10-28',isAsk:false}),t=>[pair('task.assigned',t.id)])
 const assign={taskId:call.id,version:call.version,ownerId:other.id,dueOn:'2026-10-28'}
 await checked('Changed call owner',()=>command('task.assign',assign),[pair('task.assigned',call.id)])
 await checked('Repeated stale call assignment',()=>command('task.assign',assign,{status:409}))
 await checked('Unchanged call owner',()=>command('task.assign',{...assign,version:call.version+1}))
 const repeat=await checked('Initial recurring assignment',()=>command('task.repeatCreate',{donorId,ownerId:owner.id,title:'synthetic-coffer-1872',dueOn:'2026-10-26',intervalMonths:1,isAsk:false}),t=>[pair('task.assigned',t.id)])
 await checked('Scheduler assigns exactly one next recurring task',()=>tick(h,now),async()=>{
  const next=(await h.get('/api/coffer/recurring-tasks')).filter(t=>t.previous_id===repeat.id)
  assert.equal(next.length,1);assert.equal(next[0].owner_id,owner.id)
  return [pair('task.assigned',next[0].id)]
 })
 await checked('Repeated scheduler tick keeps the same successor',()=>tick(h,now))
 await checked('Completion after scheduled advancement retains its successor',()=>command('task.repeatComplete',{taskId:repeat.id,version:repeat.version,notes:'synthetic-coffer-1873'}))
 await checked('Repeated recurring completion is refused',()=>command('task.repeatComplete',{taskId:repeat.id,version:repeat.version,notes:'synthetic-coffer-1873'},{status:409}))
 await command('fund.define',{name:'synthetic-coffer-1874',restriction:'purpose',detail:'Synthetic grant purpose.'})
 let grant=await command('grant.save',{donorId,program:'synthetic-coffer-1875',requestedAmount:'100',loiDueOn:'2026-10-01',proposalDueOn:'2026-10-02',reportDueOn:'2026-11-01'})
 for(const [status,recordedOn] of [['loi_submitted','2026-10-01'],['proposal_submitted','2026-10-02']])grant=await command('grant.status',{grantId:grant.id,version:grant.version,status,recordedOn,evidence:'synthetic-coffer-1876'})
 const award={grantId:grant.id,version:grant.version,awardAmount:'100',awardedOn:'2026-10-03',fund:'synthetic-coffer-1874',ownerId:owner.id,evidence:'synthetic-coffer-1877',installments:[{dueOn:'2026-10-30',amount:'100'}]}
 let task
 await checked('Initial grant report assignment',()=>command('grant.award',award),async()=>{
  grant=(await h.get('/api/coffer/grants')).grants.find(g=>g.id===grant.id);[task]=grant.tasks
  return [pair('task.assigned',task.id)]
 })
 await checked('Repeated grant award is refused',()=>command('grant.award',award,{status:409}))
 const reassign={grantId:grant.id,version:grant.version,taskId:task.id,taskVersion:task.version,ownerId:other.id}
 await checked('Changed grant report owner',()=>command('grant.assignReport',reassign),[pair('task.assigned',task.id)])
 await checked('Repeated stale grant assignment',()=>command('grant.assignReport',reassign,{status:409}))
 await checked('Unchanged grant report owner',()=>command('grant.assignReport',{...reassign,taskVersion:task.version+1}))
}

async function hostedReversal(h,edge,send,checked,session){
 const charge={id:'ch_syntheticcoffer1880',status:'succeeded',paid:true,currency:'usd',amount:session.amount_total,created:Date.parse(now)/1000,customer:session.customer,payment_intent:session.payment_intent,balance_transaction:'txn_syntheticcoffer1881',amount_refunded:0}
 edge.objects.set('/v1/charges/'+charge.id,charge)
 edge.objects.set('/v1/balance_transactions/'+charge.balance_transaction,{id:charge.balance_transaction,type:'charge',source:charge.id,amount:charge.amount,fee:0,net:charge.amount,currency:'usd',created:charge.created})
 await checked('Charge observation joins the completed hosted gift',()=>send('charge.succeeded',charge.id,'synthetic-coffer-1882'))
 const refund={id:'re_syntheticcoffer1883',status:'succeeded',charge:charge.id,balance_transaction:'txn_syntheticcoffer1884'}
 edge.objects.set('/v1/refunds/'+refund.id,refund)
 edge.objects.set('/v1/balance_transactions/'+refund.balance_transaction,{id:refund.balance_transaction,type:'refund',source:refund,amount:-charge.amount,fee:0,net:-charge.amount,currency:'usd',created:charge.created})
 await checked('Hosted refund inserts one reversal',()=>send('refund.created',refund.id,'synthetic-coffer-1885'),async()=>{
  const person=(await h.get('/api/coffer/donors')).donors.find(d=>d.email==='synthetic-coffer-1836@example.test')
  const gifts=(await h.get('/api/coffer/donors/'+person.id)).gifts,reversals=gifts.filter(g=>g.kind==='reversal')
  assert.equal(reversals.length,1);assert.equal(reversals[0].reverses,'giving-'+session.payment_intent)
  return [pair('gift.reversed',reversals[0].id)]
 })
 await checked('Repeated refund provider event',()=>send('refund.created',refund.id,'synthetic-coffer-1885'))
 await checked('Fresh refund event retains the same financial reversal',()=>send('refund.updated',refund.id,'synthetic-coffer-1886'))
 refund.status='failed';refund.failure_balance_transaction='txn_syntheticcoffer1887'
 edge.objects.set('/v1/balance_transactions/'+refund.failure_balance_transaction,{id:refund.failure_balance_transaction,type:'refund',source:refund,amount:charge.amount,fee:0,net:charge.amount,currency:'usd',created:charge.created})
 await checked('A failed refund restores the monetary contribution once',()=>send('refund.failed',refund.id,'synthetic-coffer-1888'),[pair('gift.created',refund.failure_balance_transaction)])
 await checked('Repeated failed refund observation retains the restored contribution',()=>send('refund.failed',refund.id,'synthetic-coffer-1889'))
}

async function planSources(edge,send,checked,checkout,campaign,values){
 for(const [n,scheduled] of [[1890,true],[1891,false]]){
  const data={...values(n),frequency:'monthly'}
  await checkout('/give/'+campaign.slug+'/checkout',data,()=>[...edge.recurring.state.sessions.values()].at(-1))
  const plan=[...edge.recurring.state.plans.values()].at(-1)
  await checked('Recurring checkout identifies its donor',()=>send('customer.subscription.created',plan.id,'synthetic-coffer-'+(n+10)),[pair('donor.created','giving-donor-'+plan.metadata.coffer_intent)])
  const bill={id:'in_syntheticcoffer'+n,customer:plan.customer,currency:'usd',parent:{subscription_details:{subscription:plan.id}},status:'open',amount_paid:0,attempt_count:1,next_payment_attempt:null,status_transitions:{paid_at:null}}
  plan.status='past_due';plan.latest_invoice=bill.id;edge.recurring.state.invoices.set(bill.id,bill)
  await checked('First failed observation of an invoice',()=>send('invoice.payment_failed',bill.id,'synthetic-coffer-'+(n+20)),[pair('plan.failed',plan.id)])
  await checked('Repeated failure provider event',()=>send('invoice.payment_failed',bill.id,'synthetic-coffer-'+(n+20)))
  bill.attempt_count=2
  await checked('A later failure attempt does not repeat the invoice failure',()=>send('invoice.payment_failed',bill.id,'synthetic-coffer-'+(n+30)))
  if(scheduled)plan.cancel_at_period_end=true
  else plan.status='canceled'
  const kind=scheduled?'customer.subscription.updated':'customer.subscription.deleted'
  await checked(scheduled?'First scheduled cancellation':'Immediate cancellation',()=>send(kind,plan.id,'synthetic-coffer-'+(n+40)),[pair('plan.canceled',plan.id)])
  await checked('Repeated cancellation provider event',()=>send(kind,plan.id,'synthetic-coffer-'+(n+40)))
  plan.status='canceled'
  await checked('Later canceled observation retains the first cancellation',()=>send('customer.subscription.deleted',plan.id,'synthetic-coffer-'+(n+50)))
 }
}
