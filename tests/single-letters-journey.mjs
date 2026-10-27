import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {PDFDocument} from 'pdf-lib'
import {unzipSync} from 'fflate'
import {run,donor,reviewed,settings,archive,restore} from './harness.mjs'
import {singleLetterSnapshots} from './single-letter-snapshots.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

export async function singleLettersJourney(){
 await singleLetterSnapshots()
 await run(async h=>{
  await reviewed(h)
  const d=await donor(h,'Robert Smith'),other=await donor(h,'Ana Diaz')
  await h.command('donor.profile',{donorId:d.id,version:1,prefix:'Dr.',firstName:'Robert',lastName:'Smith',nickname:'Bob',envelopeName:'The Smith Family'})
  const gift=await h.command('gift.record',{donorId:d.id,amount:'350',receivedOn:'2025-08-10',method:'check',goods:'none'})
  const foreign=await h.command('gift.record',{donorId:other.id,amount:'400',receivedOn:'2025-08-10',method:'check',goods:'none'})
  const template=await h.command('letterTemplate.save',{kind:'first_gift',name:'Personal thanks',subject:'Thanks, {{informal_salutation}}',body:settings.letterTemplate+'\nEnvelope {{envelope_name}}. Warm regards'})
  const member=await h.person('synthetic-coffer-930@example.test'),admin=await h.person('synthetic-coffer-931@example.test','admin')
  const agent=await h.command('agent.create',{label:'Letter reader'}),agentAccess={as:'',headers:{authorization:'Bearer '+agent.token}}
  await h.command('singleLetter.prepare',{donorId:d.id,contextId:gift.id},{as:'',headers:{authorization:'Bearer '+agent.token},status:403})
  await h.command('singleLetter.prepare',{donorId:d.id,contextId:foreign.id},{status:400})
  const directory=process.env.COFFER_PRINT_BROWSER??'.cache/print-letters'
  await mkdir(directory,{recursive:true})
  const issued=await h.command('ack.prepare',{giftIds:[gift.id]})
  await h.command('ack.approve',{batchId:issued.id,version:1})
  await h.command('ack.export',{batchId:issued.id,version:2})
  await h.command('ack.markSent',{batchId:issued.id,version:3,sentOn:'2026-10-17',method:'mail'})
  const issuedBefore=await h.get('/api/coffer/letters/'+issued.id),giftBefore=(await h.get('/api/coffer/donors/'+d.id)).gifts.find(g=>g.id===gift.id),messagesBefore=h.messages.length
  let letterId
  await withBrowserWorker(h,async(context,origin)=>{
   const page=await context.newPage();page.setDefaultTimeout(15000)
   const shot=async name=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Single letter page fits');await page.screenshot({path:`${directory}/single-${name}-${width}.png`,fullPage:true})}}
   await page.goto(origin+'/app/donors/'+d.id)
   await page.getByText('Produce one letter',{exact:true}).click()
   await page.locator('#single-letter select[name=templateId]').selectOption(template.id)
   await page.locator('#single-letter select[name=contextId]').selectOption(gift.id)
   await page.locator('#single-letter').screenshot({path:`${directory}/single-donor-1440.png`})
   await page.setViewportSize({width:390,height:1000});await page.locator('#single-letter').screenshot({path:`${directory}/single-donor-390.png`})
   await page.getByRole('button',{name:'Prepare single letter',exact:true}).click()
   await page.getByRole('button',{name:'Approve this letter',exact:true}).waitFor()
   letterId=new URL(page.url()).pathname.split('/').at(-1)
   const body=await page.locator('.body').innerText();assert.match(body,/Dear Bob,/);assert.match(body,/\$350\.00/);assert.match(body,/Envelope The Smith Family/)
   await shot('prepared')
   for(const suffix of ['/letters.pdf','/letters.pdf?labels=1','/letters.pdf?envelopes=1','/print','/print?labels=1','/print?envelopes=1','/merge.zip','/merge.docx'])assert.equal((await h.request('/app/single-letters/'+letterId+suffix)).status,409,'Every local output requires approval of the prepared copy')
   const approval={letterId,version:1,contentHash:await page.locator('input[name=contentHash]').inputValue()}
   await h.command('singleLetter.approve',{...approval,contentHash:'synthetic-coffer-932'},{status:409})
   await h.command('singleLetter.approve',{...approval,version:2},{status:409})
   for(const access of [{as:member.cookie},agentAccess])await h.command('singleLetter.approve',approval,{...access,status:403})
   await page.getByRole('button',{name:'Approve this letter',exact:true}).click()
   await page.getByRole('link',{name:'Download letter PDF',exact:true}).waitFor();await shot('approved')
   for(const [suffix,name] of [['/print','letter'],['/print?labels=1','label'],['/print?envelopes=1','envelope']]){
    await page.goto(origin+'/app/single-letters/'+letterId+suffix);assert.match(await page.locator('main').innerText(),/The Smith Family/);await shot(name)
   }
   await page.goto(origin+'/app/donors/'+d.id+'?timelineKind=receipt')
   assert.match(await page.locator('#timeline').innerText(),/Single letter produced/)
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.match(await page.locator('#timeline').innerText(),/Single letter produced/);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#timeline').screenshot({path:`${directory}/single-timeline-${width}.png`})}
  })
  const pdf=await h.request(`/app/single-letters/${letterId}/letters.pdf`);assert.equal(pdf.status,200);assert.match(pdf.headers.get('content-type'),/application\/pdf/)
  assert.equal((await PDFDocument.load(await pdf.arrayBuffer())).getPageCount(),1)
  for(const query of ['labels','envelopes']){const r=await h.request(`/app/single-letters/${letterId}/letters.pdf?${query}=1`);assert.equal(r.status,200);assert.equal((await PDFDocument.load(await r.arrayBuffer())).getPageCount(),1)}
  const word=await h.request(`/app/single-letters/${letterId}/merge.zip`);assert.equal(word.status,200)
  const zip=unzipSync(new Uint8Array(await word.arrayBuffer()));assert.ok(Object.keys(zip).some(name=>name.endsWith('.docx')))
  for(const suffix of ['','/letters.pdf','/letters.pdf?labels=1','/letters.pdf?envelopes=1','/print','/print?labels=1','/print?envelopes=1','/merge.zip','/merge.docx']){
   assert.equal((await h.request('/app/single-letters/'+letterId+suffix,{as:member.cookie})).status,403)
   const denied=await h.request('/app/single-letters/'+letterId+suffix,agentAccess);assert.ok([401,403].includes(denied.status),'An agent cannot open or output a reviewed copy')
   assert.equal((await h.request('/app/single-letters/'+letterId+suffix,{as:admin.cookie})).status,200,'An admin may use every approved output')
  }
  assert.deepEqual(await h.get('/api/coffer/letters/'+issued.id),issuedBefore,'Producing and outputting a copy never changes the issued receipt, its identity or delivery facts')
  assert.deepEqual((await h.get('/api/coffer/donors/'+d.id)).gifts.find(g=>g.id===gift.id),giftBefore,'A copy does not record sending or change gift acknowledgment')
  assert.equal(h.messages.length,messagesBefore,'Preparation, approval and local output hand no message to the provider')
  const localArchive=await archive(h),rows=localArchive.filter(p=>p.kind==='part').flatMap(p=>p.items).filter(i=>i.kind==='row')
  assert.deepEqual(rows.filter(i=>['cf_postal_deliveries','cf_postal_documents','cf_letter_events'].includes(i.table)),[],'Local production creates no durable sending attempt or provider delivery event')
  const annual=await h.command('letterTemplate.save',{kind:'year_end',name:'Annual thanks',subject:'{{year}} statement',body:'Dear {{donor_name}}\n{{year}}\n{{gift_list}}\n{{total}} {{goods_total}} {{deductible_total}}\n{{goods_statement}}\n{{organization}} {{ein}}'})
  const a=await h.command('singleLetter.prepare',{donorId:d.id,templateId:annual.id,year:2025})
  assert.match(await (await h.request('/app/single-letters/'+a.id)).text(),/350\.00/)
  await h.command('singleLetter.approve',{letterId:a.id,version:1,contentHash:a.contentHash})
  const property=await h.command('inKind.save',{donorId:d.id,description:'Library shelves',quantity:'2',statedValue:'700',receivedOn:'2025-08-10',goods:'none'})
  const pt=await h.command('letterTemplate.save',{kind:'in_kind',name:'Property thanks',subject:'Thank you {{donor_name}}',body:'{{donor_name}} {{gift_date}} {{description}} {{goods_statement}} {{organization}} {{ein}}'})
  const p=await h.command('singleLetter.prepare',{donorId:d.id,templateId:pt.id,contextId:property.id})
  const propertyPage=await (await h.request('/app/single-letters/'+p.id)).text();assert.match(propertyPage,/Library shelves/);assert.doesNotMatch(propertyPage,/\$700/)
  const campaign=await h.api('/api/coffer/giving/campaigns',{name:'Summer library',slug:'summer-library-copies',description:'Summer reading with our library.',fund:'Library',goal:'5000'})
  for(const kind of ['campaign','tribute','major_gift','recurring_start']){
   const chosen=await h.command('letterTemplate.save',{kind,name:'Reviewed '+kind,subject:kind+' copy for {{donor_name}}',body:settings.letterTemplate,...(kind==='major_gift'?{minAmount:'1000'}:{}),...(kind==='campaign'?{campaignId:campaign.id}:{})})
   const copy=await h.command('singleLetter.prepare',{donorId:d.id,contextId:gift.id,templateId:chosen.id})
   const text=await(await h.request('/app/single-letters/'+copy.id)).text()
   assert.ok(text.includes(kind+' copy for Bob'));assert.match(text,/350\.00/)
  }
  const sponsor=await donor(h,'Riverbend Community Foundation',{constituentKind:'organization',organizationType:'donor-advised fund sponsor'})
  const types=await h.get('/api/coffer/template-fields')
  for(const kind of ['stock','daf','qcd']){
   const definition=types.templates.find(t=>t.kind===kind)
   const chosen=await h.command('letterTemplate.save',{kind,name:'Reviewed '+kind,subject:kind+' copy',body:definition.required.map(field=>'{{'+field+'}}').join('\n')})
   const target=kind==='daf'?sponsor:d
   const typed=await h.command('contribution.record',{donorId:target.id,kind,receivedOn:'2025-06-01',goods:'none',fund:'Library',...(kind==='stock'?{symbol:'SYN',shares:'4',highPrice:'30',lowPrice:'20'}:{amount:'100',method:'check',...(kind==='daf'?{advisorDonorId:other.id}:{custodian:'Riverbend Retirement Custodian'})})})
   const copy=await h.command('singleLetter.prepare',{donorId:target.id,contextId:typed.id,templateId:chosen.id})
   const text=await(await h.request('/app/single-letters/'+copy.id)).text();assert.ok(text.includes(kind+' copy'));assert.doesNotMatch(text,/may be deductible/)
   await h.command('singleLetter.approve',{letterId:copy.id,version:1,contentHash:copy.contentHash})
   assert.equal((await h.request('/app/single-letters/'+copy.id+'/letters.pdf')).status,200)
  }
  assert.equal((await h.request('/app/single-letters/'+a.id+'/letters.pdf')).status,409,'A later gift requires a complete current statement copy')
  const defaults=await h.command('singleLetter.prepare',{donorId:d.id,contextId:gift.id})
  assert.match(await(await h.request('/app/single-letters/'+defaults.id)).text(),/350\.00/)
  const profile=(await h.get('/api/coffer/donors/'+d.id)).donor
  await h.command('donor.profile',{donorId:d.id,version:profile.version,nickname:'Rob'})
  assert.match(await(await h.request('/app/single-letters/'+letterId)).text(),/Dear Bob,/)
  const lines=await archive(h)
  assert.ok(lines.some(row=>JSON.stringify(row).includes(letterId)))
  await run(async restored=>{await restore(restored,lines);assert.match(await(await restored.request('/app/single-letters/'+letterId)).text(),/Dear Bob,/);assert.equal((await restored.request('/app/single-letters/'+letterId+'/letters.pdf')).status,200)})
  await h.command('gift.reverse',{giftId:gift.id,reason:'Returned check'})
  assert.equal((await h.request(`/app/single-letters/${letterId}/letters.pdf`)).status,409,'Changed money refuses an obsolete copy')
  const erased=await h.request('/app/actions',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams({command:'donor.erase',donorId:d.id,confirm:'ERASE',reason:'donor_request'}).toString()});assert.equal(erased.status,303)
  assert.equal((await h.request('/app/single-letters/'+letterId)).status,404)
 },{entry:'tests/fixed-clock-worker.ts'})
}
