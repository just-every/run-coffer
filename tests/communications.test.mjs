import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {run,donor,archive,restore,installation} from './harness.mjs'
const recorded=JSON.parse(await readFile(new URL('./fixtures/mango/audience.json',import.meta.url),'utf8'))
const chimp=JSON.parse(await readFile(new URL('./fixtures/mailchimp/responses.json',import.meta.url),'utf8'))
const form=(h,fields)=>h.request('/app/actions',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(fields).toString()})

test('COMM-005: routed replies reach managers, withdraw explicit stops once and review ambiguous requests with custody',async()=>{
 const {replyStopJourney}=await import('./reply-stop-journey.mjs')
 await replyStopJourney()
 const {transactionalRepliesJourney}=await import('./transactional-replies-journey.mjs')
 await transactionalRepliesJourney()
})

async function consenting(h,names){
 const rows=[]
 for(const [i,name] of names.entries()){
  const row=await donor(h,name,{email:recorded.contacts[i].email})
  await h.command('consent.record',{donorIds:[row.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic explicit opt-in',capturedOn:'2025-01-01'})
  await h.command('consent.record',{donorIds:[row.id],channel:'mail',status:'granted',method:'paper form',evidence:'Synthetic postal opt-in',capturedOn:'2025-01-01'})
  await h.command('gift.record',{donorId:row.id,amount:'250',receivedOn:'2025-03-02',method:'check',goods:'none',fund:'Library'})
  rows.push(row)
 }
 return rows
}
const appeal=async h=>{
 const frozen=await h.command('appeal.prepare',{name:'Library renewal',channel:'email',fund:'Library',subject:'Thank you, {{donor_name}}',body:'Your {{gift_count}} gift totals {{total_given}}.'})
 await h.command('appeal.approve',{appealId:frozen.id,version:1})
 return frozen
}

// Faked only at Mango's network edge, with its scoped integration API; Coffer runs its real Worker and D1.
test('Connect Mango from the page, send an approved appeal to a Mango list, and keep opt-outs in step',()=>{
 // A synthetic credential: Mango is faked at its network edge.
 const contacts=new Map(),lists=new Map(),suppressions=[],credential=`coffer-test-${process.pid}`
 return run(async h=>{
  const [avery,jordan]=await consenting(h,['Avery Chen','Jordan Brooks'])
  const frozen=await appeal(h)
  // Not connected: the page leads to the connect page, never a 503.
  const before=await (await h.request(`/app/appeals/${frozen.id}`)).text()
  assert.match(before,/href="\/app\/appeals\/connect"/)
  assert.doesNotMatch(before,/name="command" value="appeal.send"/)
  assert.equal((await h.command('appeal.send',{appealId:frozen.id,version:2},{status:409})).error,'EMAIL_NOT_CONNECTED')
  const guide=await (await h.request('/app/appeals/connect')).text()
  assert.match(guide,/Integration credentials/)
  assert.match(guide,/rer dev just-every\/run-mango|run-mango\.com\/run/)
  // A wrong credential is refused on the page with Mango's reason.
  const refused=await form(h,{command:'marketing.connectMango',origin:'https://mango.example.test',credential:'wrong'})
  assert.equal(refused.status,502);assert.match(await refused.text(),/no longer accepts this credential/)
  const connected=await form(h,{command:'marketing.connectMango',origin:'https://mango.example.test/settings',credential})
  assert.equal(connected.status,303)
  assert.match(await (await h.request('/app/appeals/connect')).text(),/all four permissions/)
  const page=await (await h.request(`/app/appeals/${frozen.id}`)).text()
  assert.match(page,/all 2 approved recipients/)
  const sent=await h.command('appeal.send',{appealId:frozen.id,version:2})
  assert.deepEqual([sent.listed,sent.remaining],[2,0])
  const list=lists.get('Coffer appeal · Library renewal · '+(await h.get(`/api/coffer/appeals/${frozen.id}`)).appeal.prepared_at.slice(0,10))
  assert.deepEqual([...list].sort(),[recorded.contacts[0].email,recorded.contacts[1].email].sort())
  const finish=await (await h.request(`/app/appeals/${frozen.id}`)).text()
  assert.match(finish,/Finish in Mango/);assert.match(finish,/displayName \| fallback/)
  assert.equal((await h.command('appeal.send',{appealId:frozen.id,version:2})).listed,0,'Pressing again lists nobody twice')
  // A Mango unsubscribe becomes a Coffer withdrawal; a Coffer withdrawal becomes a Mango suppression.
  contacts.get(recorded.contacts[0].email).emailStatus='unsubscribed'
  await h.command('marketing.sync')
  assert.equal((await h.get(`/api/coffer/donors/${avery.id}`)).current.email.status,'withdrawn')
  await h.command('consent.record',{donorIds:[jordan.id],channel:'email',status:'withdrawn',method:'email reply',evidence:'Synthetic donor asked to stop',capturedOn:'2025-03-04'})
  assert.deepEqual(suppressions.map(s=>s.email),[recorded.contacts[1].email])
  assert.equal((await h.get(`/api/coffer/donors/${jordan.id}`)).marketingPreference.state,'suppressed')
 },{outbound:async request=>{
  const u=new URL(request.url)
  assert.equal(u.origin,'https://mango.example.test')
  assert.ok(u.pathname.startsWith('/api/integrations/v1/'),u.pathname)
  if(request.headers.get('authorization')!==`Bearer ${credential}`)return Response.json({error:'invalid_credential'},{status:401})
  const path=u.pathname.slice('/api/integrations/v1'.length),body=request.method==='GET'?null:await request.json()
  if(path==='/segments')return Response.json({segments:[...lists.keys()].map(name=>({id:name,name}))})
  if(path==='/events')return Response.json({events:[],nextCursor:'0'})
  if(path.endsWith('/send'))return Response.json({error:'invalid_request'},{status:400})
  if(path==='/contacts'&&request.method==='PUT'){
   if(!body.email)return Response.json({error:'invalid_request'},{status:400})
   assert.equal(body.subscribe,true);assert.match(body.consent.evidence,/Synthetic explicit opt-in/)
   const fixture=recorded.contacts.find(c=>c.email===body.email),contact=contacts.get(body.email)??{...fixture,emailStatus:'subscribed'}
   contacts.set(body.email,contact)
   if(!lists.has(body.segmentName))lists.set(body.segmentName,new Set())
   lists.get(body.segmentName).add(body.email)
   return Response.json({contact:{...contact,segmentIds:[body.segmentName]}})
  }
  if(path==='/contacts')return Response.json({contacts:[...contacts.values()].filter(c=>c.email===u.searchParams.get('email')),nextCursor:''})
  if(path==='/suppressions'){suppressions.push(body);contacts.set(body.email,{...(contacts.get(body.email)??{email:body.email}),emailStatus:'suppressed'});return Response.json({ok:true})}
  assert.fail(`Unexpected Mango request ${request.method} ${path}`)
 }})
})

// Documentation-derived Mailchimp responses at the network edge (no Mailchimp account was available).
test('COMM-008: email appeal results match signed ledger and sender outcomes with tracking off',()=>{
 // A synthetic key: its -us21 suffix only picks the faked datacenter host.
 const calls=[],apiKey=[`coffer${process.pid}`,'us21'].join('-')
 return run(async h=>{
  await consenting(h,['Avery Chen'])
  const frozen=await appeal(h)
  const code=frozen.code
  assert.match(code,/^RUN-/)
  const d=(await h.get('/api/coffer/donors')).donors[0]
  await h.command('gift.record',{donorId:d.id,amount:'100',receivedOn:'2026-09-01',method:'check',goods:'none',fund:'Library',appeal:code})
  const refund=await h.command('gift.record',{donorId:d.id,amount:'20',receivedOn:'2026-09-01',method:'check',goods:'none',fund:'Library',appeal:code})
  await h.command('gift.reverse',{giftId:refund.id,reason:'Returned check'})
  const saved=await form(h,{command:'marketing.connectMailchimp',apiKey});assert.equal(saved.status,303,(await saved.text()).match(/role="alert">[^<]*/)?.[0])
  const picker=await (await h.request('/app/appeals/connect')).text()
  assert.match(picker,/Fixture audience \(1 contacts\)/)
  assert.equal((await form(h,{command:'marketing.chooseAudience',listId:'fixture-list',fromName:'Fixture organisation',fromEmail:'replies@example.test'})).status,303)
  const sent=await h.command('appeal.send',{appealId:frozen.id,version:2})
  assert.equal(sent.submitted,1)
  assert.ok(calls.includes('POST /3.0/campaigns/fixture-campaign/actions/send'))
  await h.command('marketing.refresh')
  const detail=await h.get(`/api/coffer/appeals/${frozen.id}`)
  assert.equal(detail.messages[0].remote_status,'sent')
  assert.deepEqual([detail.results.recipients,detail.results.responded,detail.results.gifts,detail.results.dollarsCents,detail.results.averageGiftCents,detail.results.costCents,detail.results.returnCents],[1,1,1,10000,10000,0,10000])
  assert.deepEqual([detail.results.delivered,detail.results.deliveryUnknown,detail.results.opened,detail.results.clicked,detail.results.returnRatio],[0,1,null,null,null])
  assert.equal(detail.results.responseRate,1)
  const empty=await h.get('/api/coffer/appeals/'+frozen.id)
  assert.equal(empty.results.code,code)
  const mail=await h.command('appeal.prepare',{name:'COMM-008 postal appeal',channel:'mail',cost:'25.50'})
  assert.notEqual(mail.code,code)
  const zero=(await h.get('/api/coffer/appeals/'+mail.id)).results
  assert.deepEqual([zero.responded,zero.gifts,zero.dollarsCents,zero.averageGiftCents,zero.returnCents],[0,0,0,null,-2550])
  await h.command('appeal.approve',{appealId:mail.id,version:1})
  await h.command('appeal.export',{appealId:mail.id,version:2})
  const exported=(await h.get('/api/coffer/appeals/'+mail.id)).appeal.exported_at.slice(0,10)
  await h.command('appeal.markSent',{appealId:mail.id,version:3,sentOn:exported})
  await h.command('gift.record',{donorId:d.id,amount:'60.01',allocations:[{fund:'Library',amountCents:3000},{fund:'Meals',amountCents:3001}],receivedOn:'2026-09-01',method:'check',goods:'none',appeal:mail.code})
  await h.command('gift.record',{donorId:d.id,amount:'40',receivedOn:'2026-09-01',method:'check',goods:'none',fund:'Library',appeal:mail.code})
  const results=(await h.get('/api/coffer/appeals/'+mail.id)).results
  assert.deepEqual([results.recipients,results.responded,results.gifts,results.dollarsCents,results.averageGiftCents,results.costCents,results.returnCents],[1,1,2,10001,5001,2550,7451])
  assert.equal(results.returnRatio,7451/2550)
  assert.deepEqual([results.delivered,results.deliveryUnknown,results.opened,results.clicked],[null,1,null,null])
  assert.equal(results.comparison.find(r=>r.id===frozen.id).dollarsCents,10000)
  await h.command('appeal.prepare',{name:'Invalid cost',channel:'mail',cost:'0.001'},{status:400})
  const lines=await archive(h),fresh=await installation()
  try{
   await restore(fresh,lines)
   assert.deepEqual((await fresh.get('/api/coffer/appeals/'+mail.id)).results,results,'COMM-008 code, cost, signed ledger and comparison survive public archive/restore')
  }finally{await fresh.close()}
  // A valid portable fixture with an unbound historical run, as produced before
  // this additive feature. No SQL or private domain function is used.
  const {makePart,ArchiveVerifier,ContentVerifier}=await import('@runeditrun/rer/modules/portability/format')
  const manifest=structuredClone(lines[0])
  const items=lines.filter(r=>r.kind==='part').flatMap(p=>p.items).filter(i=>!(i.kind==='row'&&i.table==='cf_appeal_runs'&&i.row.appeal_id===frozen.id))
  const counts=new Map()
  for(const item of items)if(item.kind==='row'){const index=counts.get(item.table)??0;item.index=index;counts.set(item.table,index+1)}
  for(const table of manifest.tables)table.count=counts.get(table.name)??0
  const parts=[]
  for(let i=0;i<items.length;i+=200)parts.push(await makePart(parts.length,items.slice(i,i+200)))
  manifest.partCount=parts.length
  const integrity=new ArchiveVerifier(manifest),content=new ContentVerifier(manifest)
  for(const part of parts){integrity.add(part);for(const item of part.items)content.add(item)}
  const historical=await installation()
  try{
   await restore(historical,[manifest,...parts,{kind:'closing',partCount:parts.length,archiveHash:integrity.digest(),contentHash:content.digest()}])
   const legacy=(await historical.get('/api/coffer/appeals/'+frozen.id)).results
   assert.equal(legacy.bound,false);assert.equal(legacy.code,null);assert.match(legacy.note,/Historical run/)
   assert.match(await (await historical.request('/app/appeals/'+frozen.id)).text(),/no response code binding/)
  }finally{await historical.close()}
  if(process.env.COFFER_PROOF_DIR){
   const {withBrowserWorker}=await import('./browser-worker.mjs')
   const {mkdir}=await import('node:fs/promises')
   await mkdir(process.env.COFFER_PROOF_DIR,{recursive:true})
   await withBrowserWorker(h,async(context,origin)=>{
    const page=await context.newPage()
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:1000})
     for(const id of [frozen.id,mail.id]){
      await page.goto(origin+'/app/appeals/'+id)
      await page.getByText('Results',{exact:true}).waitFor()
      assert.match(await page.locator('body').innerText(),/Unknown is not zero/)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
      await page.screenshot({path:process.env.COFFER_PROOF_DIR+'/COMM-008-'+(id===mail.id?'mail':'email')+'-'+width+'.png',fullPage:true})
     }
     await page.goto(origin+'/app/appeals')
     await page.getByLabel('Appeal cost (USD, optional)').fill('12.50')
     await page.getByLabel('Appeal name',{exact:true}).fill('COMM-008 browser '+width)
     await page.screenshot({path:process.env.COFFER_PROOF_DIR+'/COMM-008-form-'+width+'.png',fullPage:true})
     await page.getByRole('button',{name:'Prepare audience',exact:true}).click()
     await page.getByText('Results',{exact:true}).waitFor()
     assert.match(await page.locator('body').innerText(),/12.50/)
     await page.screenshot({path:process.env.COFFER_PROOF_DIR+'/COMM-008-prepare-'+width+'.png',fullPage:true})
    }
   })
  }
 },{outbound:async request=>{
  const u=new URL(request.url),key=`${request.method} ${u.pathname}`;calls.push(key)
  assert.equal(u.origin,'https://us21.api.mailchimp.com')
  assert.equal(request.headers.get('authorization'),`Bearer ${apiKey}`)
  if(key==='GET /3.0/lists')return Response.json({lists:[{id:'fixture-list',name:'Fixture audience',stats:{member_count:1}}]})
  if(/^GET \/3.0\/lists\/fixture-list\/members\//.test(key))return Response.json(chimp.member_subscribed)
  if(key==='POST /3.0/lists/fixture-list/segments')return Response.json(chimp.static_segment)
  if(key==='GET /3.0/lists/fixture-list/segments/101/members')return Response.json(chimp.segment_members)
  if(key==='POST /3.0/campaigns'){assert.deepEqual((await request.json()).tracking,{opens:false,html_clicks:false,text_clicks:false});return Response.json(chimp.campaign_saved)}
  if(key==='GET /3.0/campaigns/fixture-campaign')return Response.json(calls.includes('POST /3.0/campaigns/fixture-campaign/actions/send')?chimp.campaign_sent:chimp.campaign_saved)
  if(key==='PATCH /3.0/campaigns/fixture-campaign')return Response.json(chimp.campaign_saved)
  if(key==='PUT /3.0/campaigns/fixture-campaign/content')return Response.json(chimp.content_saved)
  if(key==='POST /3.0/campaigns/fixture-campaign/actions/send')return new Response(null,{status:204})
  if(key==='GET /3.0/reports/fixture-campaign/sent-to')return Response.json(chimp.sent_to)
  assert.fail(`Unexpected Mailchimp request ${key}`)
 }})
})
