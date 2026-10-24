import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {mkdir} from 'node:fs/promises'
import {run} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

const secret='synthetic-coffer-6000'
export async function recurringHealthJourney(){
 let now='2026-01-10T12:00:00.000Z',selected='a',customer=0
 const plans=new Map(),invoices=new Map()
 const outbound=async request=>{
  const u=new URL(request.url),p=new URLSearchParams(await request.text())
  if(u.pathname==='/v1/customers')return Response.json({id:'cus_health'+(++customer)})
  if(u.pathname==='/v1/checkout/sessions'){
   plans.set(selected,{id:'sub_health'+selected,customer:p.get('customer'),metadata:{coffer_intent:p.get('metadata[coffer_intent]')},created:Date.parse(now)/1000,status:'active',cancel_at_period_end:false,items:{data:[{quantity:1,price:{unit_amount:Number(p.get('line_items[0][price_data][unit_amount]'))}}]}})
   return Response.json({id:'cs_health'+selected,url:'https://checkout.stripe.com/c/pay/health'+selected})
  }
  if(u.pathname.startsWith('/v1/subscriptions/'))return Response.json(plans.get(u.pathname.split('/').at(-1).replace('sub_health','')))
  if(u.pathname.startsWith('/v1/invoices/'))return Response.json(invoices.get(u.pathname.split('/').at(-1)))
  assert.fail(`Unexpected Stripe request ${u.pathname}`)
 }
 await run(async h=>{
  const opts=()=>({headers:{'x-test-now':now}})
  const get=(path,extra={})=>h.get(path,{...opts(),...extra})
  const deliver=async(id,type,objectId)=>{
   const raw=JSON.stringify({id,type,data:{object:{id:objectId}}}),timestamp=Math.floor(Date.parse(now)/1000)
   const sig=createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex')
   const response=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw,headers:{'x-test-now':now,'stripe-signature':`t=${timestamp},v1=${sig}`}})
   assert.equal(response.status,200,await response.text())
  }
  await h.api('/api/coffer/giving/campaigns',{name:'Year-round literacy',slug:'year-round',description:'Monthly books and tutoring.',fund:'Reading',goal:'10000'})
  for(const [key,day,email,amount]of [['a','10','ana@example.test','25'],['b','11','ana@example.test','25'],['c','12','ben@example.test','50']]){
   selected=key;now=`2026-01-${day}T12:00:00.000Z`
   const response=await h.request('/give/year-round/checkout',{method:'POST',as:'',headers:{'content-type':'application/x-www-form-urlencoded','x-test-now':now},raw:new URLSearchParams({name:key==='c'?'Ben Wells':'Ana Diaz',email,amount,frequency:'monthly','cf-turnstile-response':'synthetic-coffer-security-token',requestId:randomUUID()}).toString()})
   assert.equal(response.status,303,await response.text())
   await deliver('evt_start'+key,'customer.subscription.created','sub_health'+key)
  }
  now='2026-01-31T20:00:00.000Z'
  const jan=(await get('/api/coffer/reports/recurring?from=2026-01&through=2026-01')).rows[0]
  assert.deepEqual([jan.activeDonors,jan.mrrCents,jan.newPlans,jan.canceledPlans,jan.averagePlanDays],[2,10000,3,0,20])
  const sub=plans.get('a'),id='in_health_failure'
  now='2026-02-20T12:00:00.000Z';sub.status='past_due';sub.latest_invoice=id
  const bill={id,customer:sub.customer,currency:'usd',parent:{subscription_details:{subscription:sub.id}},status:'open',amount_paid:0,attempt_count:1,next_payment_attempt:null,status_transitions:{paid_at:null}}
  invoices.set(id,bill)
  await deliver('evt_failure1','invoice.payment_failed',id)
  bill.attempt_count=2;await deliver('evt_failure2','invoice.payment_failed',id)
  plans.get('b').cancel_at_period_end=true
  await deliver('evt_schedule_cancel','customer.subscription.updated','sub_healthb')
  plans.get('c').items.data[0].price.unit_amount=7500
  await deliver('evt_amount','customer.subscription.updated','sub_healthc')
  now='2026-02-28T20:00:00.000Z'
  const feb=(await get('/api/coffer/reports/recurring?from=2026-01&through=2026-02')).rows[1]
  assert.deepEqual([feb.activeDonors,feb.mrrCents,feb.newPlans,feb.canceledPlans,feb.failedPayments,feb.recoveredPayments,feb.averagePlanDays],[2,12500,0,0,1,0,48])
  now='2026-03-03T12:00:00.000Z';sub.status='active';bill.status='paid';bill.amount_paid=2500;bill.attempt_count=3;bill.status_transitions.paid_at=Date.parse(now)/1000
  await deliver('evt_recovered','invoice.paid',id)
  await deliver('evt_stale_failure','invoice.payment_failed',id)
  await deliver('evt_recovered','invoice.paid',id)
  now='2026-03-10T12:00:00.000Z';plans.get('b').status='canceled'
  await deliver('evt_cancel','customer.subscription.deleted','sub_healthb')
  now='2026-03-31T20:00:00.000Z'
  const report=await get('/api/coffer/reports/recurring?from=2026-01&through=2026-03'),mar=report.rows[2]
  assert.deepEqual(report.rows[0],jan,'Later changes preserve the January snapshot')
  assert.deepEqual(report.rows[1],feb,'Recovery next month does not rewrite February')
  assert.deepEqual([mar.activeDonors,mar.mrrCents,mar.newPlans,mar.canceledPlans,mar.failedPayments,mar.recoveredPayments,mar.averagePlanDays],[2,10000,0,1,0,1,72])
  assert.ok(report.rows.every(r=>r.unknownStartPlans===0&&r.unknownStatePlans===0))
  const ana=(await h.get('/api/coffer/donors')).donors.find(d=>d.email==='ana@example.test')
  assert.equal((await h.get('/api/coffer/donors/'+ana.id)).totals.lifetimeCents,2500)
  await get('/api/coffer/reports/recurring',{as:'',status:401})
  await get('/api/coffer/reports/recurring?from=2026-99',{status:400})
  await get('/api/coffer/reports/recurring?from=2026-03&through=2026-02',{status:400})
  await get('/api/coffer/reports/recurring?through=2026-04',{status:400})
  if(process.env.COFFER_HEALTH_BROWSER){
   const directory=process.env.COFFER_HEALTH_BROWSER;await mkdir(directory,{recursive:true})
   // Browser requests carry the same test clock through the real Worker.
   await withBrowserWorker(h,async(context,origin)=>{
    await context.setExtraHTTPHeaders({cookie:h.owner,'x-test-now':now})
    const page=await context.newPage()
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/giving')
     await page.screenshot({path:`${directory}/REPORT-006-giving-${width}.png`,fullPage:true})
     await page.getByRole('link',{name:'Recurring giving health by month'}).click()
     await page.getByLabel('From month',{exact:true}).fill('2026-01');await page.getByLabel('Through month',{exact:true}).fill('2026-03')
     await page.getByRole('button',{name:'Read monthly report'}).click()
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
     await page.screenshot({path:`${directory}/REPORT-006-health-${width}.png`,fullPage:true})
    }
   })
  }
  // Existing Stripe plans have no local checkout metadata. Their live updates still join the report.
  now=new Date().toISOString()
  const importedPlan={id:'sub_healthimport',customer:'cus_healthimport',created:Date.parse('2026-01-02T12:00:00Z')/1000,status:'active',currency:'usd',metadata:{},cancel_at_period_end:false,items:{data:[{quantity:1,price:{type:'recurring',currency:'usd',unit_amount:4000,billing_scheme:'per_unit',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}}]}}
  plans.set('import',importedPlan)
  const input={customers:[{object:'list',data:[{id:importedPlan.customer,name:'Celia Grant',email:'celia@example.test',created:importedPlan.created}]}],charges:[{object:'list',data:[]}],subscriptions:[{object:'list',data:[importedPlan]}],noGoodsOrServices:true}
  const preview=await h.api('/api/coffer/imports/preview',input)
  let job=await h.api('/api/coffer/imports/apply',{...input,fingerprint:preview.fingerprint})
  while(job.state!=='completed')job=await h.api('/api/coffer/imports/resume',{id:job.id})
  importedPlan.status='canceled';importedPlan.items.data[0].price.unit_amount=3000
  await deliver('evt_imported_cancel','customer.subscription.deleted',importedPlan.id)
  const celia=(await h.get('/api/coffer/donors')).donors.find(d=>d.email==='celia@example.test')
  const importedState=(await h.get('/api/coffer/donors/'+celia.id)).subscriptions[0]
  assert.deepEqual([importedState.status,importedState.amount_cents],['canceled',3000])
  const current=(await get('/api/coffer/reports/recurring')).rows.at(-1)
  assert.equal(current.canceledPlans,1)
 },{entry:'tests/advancing-clock-worker.ts',bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-6001',STRIPE_WEBHOOK_SECRET:secret},outbound})
}
