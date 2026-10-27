import {journeyMailEdge} from './journey-mail-edge.mjs'
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {run,donor,reviewed,archive,restore} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

export async function stewardshipJourneys(){
 const {handoffs,outbound}=journeyMailEdge()
 let saved
 await run(async h=>{
  await reviewed(h)
  let at='2025-12-29T12:00:00Z'
  const options=(extra={})=>({headers:{'x-test-now':at},...extra}),command=(name,input={},extra={})=>h.command(name,input,options(extra)),get=path=>h.get(path,options())
  await command('marketing.connectMango',{origin:'https://mango.example.test',credential:'synthetic-coffer-2302'})
  const member=await h.person('synthetic-coffer-2303@example.test')
  const input={name:'Library stewardship',trigger:'gift_amount',amount:'1000',thankSubject:'Thank you {{donor_name}}',thankBody:'Your support makes reading possible.',impactSubject:'Reading update',impactBody:'Readers are growing.',askSubject:'Support another reader',askBody:'Please give again.',impactDays:1,askDays:2,confirm:'yes'}
  await command('journey.publish',input,{as:member.cookie,status:403})
  await command('journey.publish',{...input,confirm:'no'},{status:400})
  assert.equal((await get('/api/coffer/journeys')).journeys.length,0)
  await h.get('/api/coffer/journeys',options({as:member.cookie,status:403}));await h.get('/api/coffer/journeys',options({as:'',status:401}))
  for(const name of ['journey.publish','journey.run','journey.stop','journey.cap']){await command(name,input,{as:'',status:401});await command(name,input,{as:member.cookie,status:403})}
  const create=async(n)=>{const d=await donor(h,n,{email:'synthetic-coffer-'+(++index)+'@example.test'},options());await command('consent.record',{donorId:d.id,channel:'email',status:'granted',method:'paper form',evidence:'Synthetic explicit permission',capturedOn:at.slice(0,10)});return d}
  let index=2310
  const gift=async(d,value,date=at.slice(0,10))=>command('gift.record',{donorId:d.id,amount:value,receivedOn:date,method:'check',goods:'none'})
  const historic=await create('Historical Reader');await gift(historic,'1500','2024-02-01')
  const high=await command('journey.publish',input)
  const second=await command('journey.publish',{...input,name:'Library follow-up'})
  assert.equal(new Set([...high.steps,...second.steps].map(s=>s.code)).size,6)
  at='2025-12-30T12:00:00Z'
  const large=await create('Morgan Library'),equal=await create('Robin Library'),restricted=await create('Casey Library')
  await gift(large,'1500');await gift(equal,'1000');await gift(restricted,'1500')
  await command('solicitation.set',{donorId:restricted.id,version:0,type:'stop',startsOn:'2025-12-30'})
  const ran=await command('journey.run');assert.equal(ran.submitted,2);assert.equal(ran.held,2)
  let state=await get('/api/coffer/journeys')
  const enrolled=id=>state.enrollments.filter(e=>e.journey_id===id).map(e=>e.donor_id).sort()
  assert.deepEqual(enrolled(high.id),[large.id,restricted.id].sort())
  assert.deepEqual(enrolled(second.id),[large.id,restricted.id].sort())
  assert.deepEqual((await h.get('/api/coffer/donors/'+large.id,options({as:member.cookie}))).journeys,[])
  assert.equal(state.enrollments.filter(e=>e.steps.some(s=>s.status==='pending'&&s.note?.includes('frequency cap'))).length,2)
  assert.equal(handoffs.length,2)
  assert.equal((await command('journey.run')).submitted,0);assert.equal(handoffs.length,2)
  await command('journey.cap',{capDays:2,confirm:'yes'},{as:member.cookie,status:403})
  at='2025-12-31T12:00:00Z'
  await command('journey.run')
  const largeEmail=(await get('/api/coffer/donors/'+large.id)).donor.email;assert.equal(handoffs.filter(m=>m.email===largeEmail).length,2)
  at='2026-01-01T12:00:00Z';await gift(large,'25');await command('journey.run')
  at='2026-01-02T12:00:00Z';await command('journey.run')
  state=await get('/api/coffer/journeys')
  const restrictedRows=state.enrollments.filter(e=>e.donor_id===restricted.id)
  assert.equal(restrictedRows.length,2)
  for(const row of restrictedRows)assert.equal(row.steps.find(s=>s.step==='ask').note,'do not solicit')
  assert.ok((await get('/api/coffer/donors/'+restricted.id)).communications.some(m=>m.subject.startsWith('Thank you')))
  await command('journey.run');state=await get('/api/coffer/journeys')
  assert.deepEqual(state.enrollments.filter(e=>e.donor_id===large.id).map(e=>e.status),['gave','gave'])
  // Calendar lapse and annual cohorts are independent public report selections.
  at='2026-01-02T13:00:00Z'
  const lapsed=await create('Taylor Earlier'),recent=await create('Jamie Recent'),prior=await create('Avery Prior'),current=await create('Drew Current')
  await gift(lapsed,'40','2024-08-05');await gift(recent,'40','2025-01-03');await gift(prior,'60','2025-04-01');await gift(current,'70','2025-04-01');await gift(current,'20','2026-01-02')
  const lapse=await command('journey.publish',{...input,name:'Twelve-month return',trigger:'lapse'})
  const ly=await command('journey.publish',{...input,name:'Last-year readers',trigger:'lybunt'})
  const sy=await command('journey.publish',{...input,name:'Earlier readers',trigger:'sybunt'})
  const cohorts=await get('/api/coffer/reports/annual-lapses')
  assert.deepEqual(cohorts.groups.find(g=>g.kind==='lybunt').rows.map(d=>d.donorId).sort(),[equal.id,restricted.id,recent.id,prior.id].sort())
  assert.deepEqual(cohorts.groups.find(g=>g.kind==='sybunt').rows.map(d=>d.donorId).sort(),[historic.id,equal.id,restricted.id,recent.id,prior.id,lapsed.id].sort())
  await command('journey.run');state=await get('/api/coffer/journeys')
  assert.deepEqual(enrolled(lapse.id),[historic.id,lapsed.id].sort())
  assert.deepEqual(enrolled(ly.id),[equal.id,restricted.id,recent.id,prior.id].sort())
  assert.deepEqual(enrolled(sy.id),[historic.id,equal.id,restricted.id,recent.id,prior.id,lapsed.id].sort())
  at='2026-01-03T13:00:00Z';await command('journey.run');state=await get('/api/coffer/journeys')
  assert.ok(enrolled(lapse.id).includes(recent.id),'The donor enrolls exactly after twelve calendar months')
  await gift(prior,'30');const before=handoffs.length;await command('journey.run');state=await get('/api/coffer/journeys')
  assert.equal(state.enrollments.find(e=>e.journey_id===ly.id&&e.donor_id===prior.id).status,'gave')
  assert.equal(state.enrollments.find(e=>e.journey_id===sy.id&&e.donor_id===prior.id).status,'gave')
  assert.equal(handoffs.slice(before).filter(m=>m.email==='synthetic-coffer-2317@example.test').length,0)
  const unsubscribe=state.enrollments.find(e=>e.journey_id===sy.id&&e.donor_id===lapsed.id)
  await command('consent.record',{donorId:lapsed.id,channel:'email',status:'withdrawn',method:'email reply',evidence:'Synthetic withdrawal',capturedOn:'2026-01-03'})
  await command('journey.run');state=await get('/api/coffer/journeys');assert.equal(state.enrollments.find(e=>e.id===unsubscribe.id).status,'unsubscribed')
  await command('journey.stop',{journeyId:high.id,confirm:'yes'});state=await get('/api/coffer/journeys');assert.ok(state.journeys.find(j=>j.id===high.id).stopped_at)
  await command('journey.stop',{journeyId:high.id,confirm:'yes'},{status:409})
  await journeyBrowser(h,at,prior.id)
  saved=await archive(h)
  assert.ok(saved.some(r=>JSON.stringify(r).includes('cf_journey_enrollments')))
  await command('donor.erase',{donorId:lapsed.id,confirm:'ERASE'})
  state=await get('/api/coffer/journeys');assert.ok(!state.enrollments.some(e=>e.donor_id===lapsed.id))
 },{entry:'tests/engagement-worker.ts',outbound})
 await run(async h=>{await restore(h,saved);const state=await h.get('/api/coffer/journeys');assert.equal(state.journeys.length,6);assert.equal(state.enrollments.length,17)},{entry:'tests/engagement-worker.ts',outbound})
}
async function journeyBrowser(h,at,donorId){
 const directory=process.env.COFFER_JOURNEYS_BROWSER??'.cache/stewardship-journeys';await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  await context.setExtraHTTPHeaders({'x-test-now':at});const page=await context.newPage()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/appeals');await page.getByRole('heading',{name:'Stewardship journeys',exact:true}).waitFor()
   const builder=page.locator('details.edit').filter({has:page.getByText('Build a three-stage journey',{exact:true})});await builder.locator(':scope > summary').click()
   assert.equal(await builder.locator('select[name=trigger]').inputValue(),'gift_amount')
   await builder.locator('input[name=name]').fill('Community supporter care');await builder.locator('details > summary').filter({hasText:'Trigger settings'}).click();await builder.locator('input[name=amount]').fill('2000')
   for(const [key,value] of Object.entries({thankSubject:'Thank you for the reading room',thankBody:'Your support helps our readers.',impactSubject:'An update from the library',impactBody:'Families are borrowing more books.',askSubject:'Keep the library growing',askBody:'Please consider supporting another reader.'}))await builder.locator('[name='+key+']').fill(value)
   await builder.locator('input[name=confirm]').check()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:directory+'/journeys-'+width+'.png',fullPage:true})
   await page.locator('#stewardship-journeys').screenshot({path:directory+'/controls-'+width+'.png'})
   await builder.screenshot({path:directory+'/builder-'+width+'.png'})
   if(width===1440){await builder.getByRole('button',{name:'Publish reviewed journey',exact:true}).click();await page.waitForURL('**/app/appeals');assert.equal((await h.get('/api/coffer/journeys')).journeys.filter(j=>j.name==='Community supporter care').length,1)}
   const published=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Community supporter care'})}).last();if(!(await published.evaluate(e=>e.open)))await published.locator(':scope > summary').click();await published.screenshot({path:directory+'/published-'+width+'.png'})
   await page.goto(origin+'/app/donors/'+donorId);await page.getByRole('heading',{name:'Stewardship journeys',exact:true}).waitFor();assert.ok((await page.locator('main').innerText()).includes('Last-year readers'));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:directory+'/donor-'+width+'.png',fullPage:true});await page.getByRole('heading',{name:'Stewardship journeys',exact:true}).locator('..').screenshot({path:directory+'/donor-journeys-'+width+'.png'})
   await page.goto(origin+'/app/settings#journey-frequency');const cap=page.locator('#journey-frequency');await cap.getByRole('heading',{name:'Journey email frequency',exact:true}).waitFor();assert.equal(await cap.locator('input[name=capDays]').inputValue(),'1');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await cap.locator('input[name=confirm]').check();await cap.getByRole('button',{name:'Save journey frequency',exact:true}).click();await page.waitForURL('**/app/settings#journey-frequency');await cap.screenshot({path:directory+'/settings-'+width+'.png'})
  }
  await page.close()
 })
}
