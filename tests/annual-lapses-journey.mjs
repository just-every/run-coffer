import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import { mkdir,readFile } from 'node:fs/promises'
import { run,donor,archive,restore,installation } from './harness.mjs'
import { withBrowserWorker } from './browser-worker.mjs'

export async function annualLapsesJourney() {
 const chimp=JSON.parse(await readFile('tests/fixtures/mailchimp/responses.json','utf8'))
 const secret='whsec_annual_lapses_edge',plan={id:'sub_annual',customer:'cus_annual',created:Date.parse('2025-01-01T12:00:00Z')/1000,status:'active',currency:'usd',metadata:{},cancel_at_period_end:false,items:{data:[{quantity:1,price:{type:'recurring',currency:'usd',unit_amount:2500,billing_scheme:'per_unit',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}}]}}
 let email='',sent=false
 const member=()=>({id:'fixture-contact',email_address:email,status:'subscribed'})
 const outbound=async request=>{
  const u=new URL(request.url),key=`${request.method} ${u.pathname}`
  if(u.origin==='https://api.stripe.com'&&u.pathname==='/v1/subscriptions/sub_annual')return Response.json(plan)
  assert.equal(u.origin,'https://us21.api.mailchimp.com')
  if(key==='GET /3.0/lists')return Response.json({lists:[{id:'fixture-list',name:'Annual supporters',stats:{member_count:1}}]})
  if(key==='GET /3.0/lists/fixture-list/merge-fields')return Response.json({merge_fields:['CF_INFORM','CF_FORMAL','CF_ENVELOP'].map(tag=>({tag,type:'text'})),total_items:3})
  if(/^PATCH \/3.0\/lists\/fixture-list\/members\//.test(key))return Response.json({...member(),merge_fields:(await request.json()).merge_fields})
  if(/^GET \/3.0\/lists\/fixture-list\/members\//.test(key))return Response.json(member())
  if(key==='POST /3.0/lists/fixture-list/segments')return Response.json(chimp.static_segment)
  if(key==='GET /3.0/lists/fixture-list/segments/101/members')return Response.json({total_items:1,members:[member()]})
  if(key==='POST /3.0/campaigns')return Response.json(chimp.campaign_saved)
  if(key==='GET /3.0/campaigns/fixture-campaign')return Response.json(sent?chimp.campaign_sent:chimp.campaign_saved)
  if(key==='PATCH /3.0/campaigns/fixture-campaign'||key==='PUT /3.0/campaigns/fixture-campaign/content')return Response.json({})
  if(key==='POST /3.0/campaigns/fixture-campaign/actions/send'){sent=true;return new Response(null,{status:204})}
  assert.fail(`Unexpected Mailchimp edge ${key}`)
 }
 await run(async h=>{
  const headers={'x-test-now':'2026-10-15T16:00:00Z'},opts={headers}
  const get=(p,o={})=>h.get(p,{...o,headers}),command=(n,p,o={})=>h.command(n,p,{...o,headers})
  const ada=await donor(h,'Ada Last Year'),ben=await donor(h,'Ben Earlier'),current=await donor(h,'Celia Current'),refunded=await donor(h,'Drew Refunded'),never=await donor(h,'Elliot Never')
  const gift=(d,amount,receivedOn)=>command('gift.record',{donorId:d.id,amount,receivedOn,method:'check',fund:'Reading',goods:'none'})
  await gift(ada,'100','2025-01-01');await gift(ada,'150','2025-12-31')
  await gift(ben,'200','2024-06-01');await gift(current,'300','2025-02-01');await gift(current,'50','2026-01-01')
  const old=await gift(refunded,'90','2025-01-01');await command('gift.reverse',{giftId:old.id,reason:'duplicate_entry',reversedOn:'2025-01-02'})
  const adaEmail=(await get('/api/coffer/donors/'+ada.id)).donor.email
  const input={customers:[{object:'list',data:[{id:plan.customer,name:'Ada Last Year',email:adaEmail,created:plan.created}]}],charges:[{object:'list',data:[]}],subscriptions:[{object:'list',data:[plan]}],noGoodsOrServices:true}
  const preview=await h.api('/api/coffer/imports/preview',input,opts)
  let job=await h.api('/api/coffer/imports/apply',{...input,fingerprint:preview.fingerprint},opts)
  while(job.state!=='completed')job=await h.api('/api/coffer/imports/resume',{id:job.id},opts)
  plan.status='canceled'
  const raw=JSON.stringify({id:'evt_annual_cancel',type:'customer.subscription.deleted',data:{object:{id:plan.id}}}),timestamp=Math.floor(Date.parse(headers['x-test-now'])/1000)
  const sig=createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex')
  const canceled=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw,headers:{...headers,'stripe-signature':`t=${timestamp},v1=${sig}`}})
  assert.equal(canceled.status,200,await canceled.text())
  assert.ok(!(await get('/api/coffer/lapses')).groups.find(g=>g.kind==='lybunt').rows.some(r=>r.donorId===ada.id),'Call-risk overview suppresses annual duplication for a stopped monthly plan')
  const read=()=>get('/api/coffer/reports/annual-lapses'),report=await read(),group=k=>report.groups.find(g=>g.kind===k)
  assert.deepEqual(group('lybunt').rows.map(r=>r.donorId),[ada.id])
  assert.deepEqual(group('sybunt').rows.map(r=>r.donorId),[ada.id,ben.id])
  assert.deepEqual([group('lybunt').rows[0].amountCents,group('lybunt').rows[0].lastGiftCents,group('lybunt').rows[0].lastGift],[25000,15000,'2025-12-31'])
  assert.ok(!report.groups.some(g=>g.rows.some(r=>[current.id,refunded.id,never.id].includes(r.donorId))))
  const historical=await get('/api/coffer/reports/annual-lapses?year=2025')
  assert.deepEqual(historical.groups.find(g=>g.kind==='lybunt').rows.map(r=>r.donorId),[ben.id])
  await get('/api/coffer/reports/annual-lapses',{as:'',status:401})
  await get('/api/coffer/reports/annual-lapses?year=2027',{status:400})
  await command('appeal.prepare',{name:'Invalid list',channel:'mail',annualList:'other'},{status:400})
  const owner=(await get('/auth/session')).operator,source=group('lybunt').rows[0]
  const task=await command('task.generate',{sourceKey:source.sourceKey,ownerId:owner.id,dueOn:'2026-10-16'})
  assert.equal(task.donor_id,ada.id);assert.equal(task.amount_cents,25000)
  assert.equal((await command('task.generate',{sourceKey:source.sourceKey,ownerId:owner.id,dueOn:'2026-10-16'})).id,task.id)
  email=(await get('/api/coffer/donors/'+ada.id)).donor.email
  await command('consent.record',{donorIds:[ada.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic annual newsletter opt-in.',capturedOn:'2025-01-01'})
  await command('marketing.connectMailchimp',{apiKey:'test-us21'})
  await command('marketing.chooseAudience',{listId:'fixture-list',fromName:'Reading team',fromEmail:'reading@example.test'})
  const appeal=await command('appeal.prepare',{name:'Annual reading renewal',channel:'email',annualList:'lybunt',listYear:2026,subject:'Reading renewal',body:'Dear {{donor_name}}, thank you for your support.'})
  let detail=await get('/api/coffer/appeals/'+appeal.id)
  assert.deepEqual(detail.recipients.map(r=>r.donor_id),[ada.id]);assert.equal(JSON.parse(detail.appeal.segment).annualList,'lybunt')
  await command('appeal.approve',{appealId:appeal.id,version:1})
  assert.equal((await command('appeal.send',{appealId:appeal.id,version:2})).submitted,1)
  assert.ok(sent,'The approved annual audience reaches the real sender boundary')
  detail=await get('/api/coffer/appeals/'+appeal.id)
  assert.equal(detail.messages.length,1);assert.equal(detail.messages[0].donor_id,ada.id)
  if(process.env.COFFER_ANNUAL_BROWSER) await annualBrowser(h,headers,report,process.env.COFFER_ANNUAL_BROWSER)
  await gift(ada,'40','2026-10-15')
  assert.ok(!(await read()).groups.some(g=>g.rows.some(r=>r.donorId===ada.id)),'Lists grow and shrink from current ledger facts')
  assert.deepEqual((await get('/api/coffer/appeals/'+appeal.id)).recipients.map(r=>r.donor_id),[ada.id],'An approved audience remains frozen')
  const saved=await archive(h),fresh=await installation({entry:'tests/advancing-clock-worker.ts'})
  try {await restore(fresh,saved);assert.deepEqual(await fresh.get('/api/coffer/reports/annual-lapses',opts),await read())}finally{await fresh.close()}
  const a=await get('/api/coffer/donors/'+ben.id),b=await get('/api/coffer/donors/'+never.id)
  const merge=await command('donor.merge',{sourceDonorId:ben.id,sourceVersion:a.donor.version,donorId:never.id,version:b.donor.version,reason:'duplicate_record'})
  assert.deepEqual((await read()).groups.find(g=>g.kind==='sybunt').rows.map(r=>r.donorId),[never.id])
  await command('donor.unmerge',{mergeId:merge.mergeId,reason:'incorrect_match'})
  assert.deepEqual((await read()).groups.find(g=>g.kind==='sybunt').rows.map(r=>r.donorId),[ben.id])
  await command('donor.erase',{donorId:ben.id,confirm:'ERASE'})
  assert.equal((await read()).groups.find(g=>g.kind==='sybunt').count,0)
 },{entry:'tests/advancing-clock-worker.ts',bindings:{STRIPE_SECRET_KEY:'sk_test_annual_edge',STRIPE_WEBHOOK_SECRET:secret},outbound})
}

async function annualBrowser(h,headers,report,directory) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  await context.setExtraHTTPHeaders({cookie:h.owner,...headers})
  const page=await context.newPage()
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/lapses')
   await page.screenshot({path:`${directory}/REPORT-002-overview-${width}.png`,fullPage:true})
   await page.getByRole('link',{name:'LYBUNT and SYBUNT annual lists',exact:true}).click()
   await page.getByRole('button',{name:'View annual lists',exact:true}).click()
   for(const g of report.groups)for(const r of g.rows)assert.ok(await page.locator('#'+g.kind).getByRole('link',{name:r.name,exact:true}).isVisible())
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/REPORT-002-lists-${width}.png`,fullPage:true})
   await page.getByRole('link',{name:'Prepare LYBUNT appeal',exact:true}).click()
   await page.screenshot({path:`${directory}/REPORT-002-prepare-${width}.png`,fullPage:true})
   assert.equal(await page.locator('select[name=annualList]').inputValue(),'lybunt')
   await page.getByLabel('Appeal name',{exact:true}).fill(`Annual postal renewal ${width}`)
   await page.locator('select[name=channel]').selectOption('email')
   await page.getByRole('button',{name:'Prepare audience',exact:true}).click()
   await page.getByRole('button',{name:'Approve this audience',exact:true}).click()
   assert.ok(await page.getByRole('link',{name:'Ada Last Year',exact:true}).isVisible())
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/REPORT-002-approved-${width}.png`,fullPage:true})
  }
 })
}
