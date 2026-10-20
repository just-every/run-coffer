import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {run,donor,reviewed,archive,restore} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

export async function timelineJourney(){
 await run(async h=>{
  await reviewed(h)
  const ada=await donor(h,'Ada Rivera'),other=await donor(h,'Ben Wells'),staff=await h.person('data-entry@example.test')
  const owner=(await h.get('/auth/session')).operator,day=new Intl.DateTimeFormat('en-CA',{timeZone:(await h.get('/api/coffer/settings')).timezone}).format(new Date())
  const gift=await h.command('gift.record',{donorId:ada.id,amount:'275',receivedOn:'2026-09-01',method:'check',goods:'none',fund:'Reading room'})
  const batch=await h.command('ack.prepare');await h.command('ack.approve',{batchId:batch.id,version:1})
  const exported=await h.command('ack.export',{batchId:batch.id,version:2})
  await h.command('ack.markSent',{batchId:batch.id,version:exported.version,sentOn:day,method:'mail'})
  await h.command('pledge.create',{donorId:ada.id,amount:'120',pledgedOn:'2026-09-02',fund:'Reading room',installments:[{dueOn:'2026-12-01',amount:'120'}]})
  await h.command('volunteer.record',{donorId:ada.id,role:'Reading tutor',occurredOn:'2026-09-04',hours:'2.5',sourceActivityId:'timeline-volunteer'})
  await h.command('task.repeatCreate',{title:'Quarterly reading-room visit',ownerId:owner.id,dueOn:day,intervalMonths:3,donorId:ada.id})
  await h.command('interaction.record',{donorId:ada.id,kind:'meeting',occurredOn:'2026-09-05',notes:'Reviewed the reading-room plan.',who:'Ada and Morgan'})
  await h.command('interaction.record',{donorId:ada.id,kind:'visit',occurredOn:'2026-09-06',notes:'Visited the community library.'})
  const call=await h.command('interaction.record',{donorId:ada.id,kind:'call',occurredOn:'2026-09-07',notes:'Ada asked for an autumn update.'},{as:staff.cookie})
  const confidential=await h.command('interaction.record',{donorId:ada.id,kind:'note',confidential:true,notes:'Private estate discussion: restricted to managers.'})
  await h.command('interaction.record',{donorId:ada.id,kind:'note',confidential:true,notes:'Unauthorized private note.'},{as:staff.cookie,status:403})
  await h.get(`/api/coffer/notes/${confidential.id}`,{as:staff.cookie,status:403})
  await h.get(`/api/coffer/notes/${confidential.id}`,{as:'',status:401})
  assert.match((await h.get(`/api/coffer/notes/${confidential.id}`)).body,/Private estate discussion/)
  const key=await h.command('agent.create',{label:'Context reader'}),agent={as:'',headers:{authorization:`Bearer ${key.token}`}}
  await h.get(`/api/coffer/notes/${confidential.id}`,{...agent,status:403})
  for(const options of [{as:staff.cookie},agent]){
   const state=await h.get(`/api/coffer/donors/${ada.id}`,options)
   assert.ok(!JSON.stringify(state).includes('Private estate discussion'))
   assert.ok(!state.notes.some(n=>n.id===confidential.id))
  }
  const memberPage=await h.request(`/app/donors/${ada.id}`,{as:staff.cookie})
  assert.ok(!(await memberPage.text()).includes('Private estate discussion'))
  const page=await h.request(`/app/donors/${ada.id}`),html=await page.text();assert.equal(page.status,200)
  for(const kind of ['call','meeting','visit','note','gift','pledge','receipt','task','volunteering'])assert.ok(html.includes(`data-timeline-kind="${kind}"`),kind)
  const filtered=await (await h.request(`/app/donors/${ada.id}?timelineKind=call`)).text()
  assert.ok(filtered.includes('data-timeline-kind="call"'));assert.ok(!filtered.includes('data-timeline-kind="gift"'))
  const bounds=await (await h.request(`/app/donors/${ada.id}?timelineFrom=2026-09-05&timelineTo=2026-09-06`)).text()
  assert.ok(bounds.includes('data-timeline-kind="visit"'));assert.ok(bounds.includes('data-timeline-kind="meeting"'));assert.ok(!bounds.includes('data-timeline-kind="call"'))
  assert.equal((await h.request(`/app/donors/${ada.id}?timelineFrom=2026-09-08&timelineTo=2026-09-01`)).status,400)
  if(process.env.COFFER_TIMELINE_BROWSER)await timelineBrowser(h,ada.id,process.env.COFFER_TIMELINE_BROWSER)
  const saved=await archive(h)
  await run(async fresh=>{await restore(fresh,saved);assert.match((await fresh.get(`/api/coffer/notes/${confidential.id}`)).body,/Private estate discussion/)})
  const comparison=await h.get(`/api/coffer/duplicates/compare?source=${ada.id}&target=${other.id}`)
  const merged=await h.command('donor.merge',{sourceDonorId:ada.id,donorId:other.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  assert.ok((await h.get(`/api/coffer/donors/${other.id}`)).notes.some(n=>n.id===confidential.id))
  await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
  assert.ok((await h.get(`/api/coffer/donors/${ada.id}`)).depth.interactions.some(i=>i.id===call.id))
  await h.command('donor.erase',{donorId:ada.id,confirm:'ERASE'})
  await h.get(`/api/coffer/notes/${confidential.id}`,{status:404})
  assert.ok(!JSON.stringify(await archive(h)).includes('Private estate discussion'))
 })
}

async function timelineBrowser(h,donorId,directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/donors/'+donorId)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.getByRole('heading',{name:'Conversations',exact:true}).locator('..').screenshot({path:`${directory}/DONOR-004-actions-${width}.png`})
   for(const [label,button,selector,originalNote] of [
    ['Log a call','Save call','call','Called Ada about autumn plans.'],
    ['Add confidential note','Save confidential note','note','Private plans for next autumn.']]){
    const note=width===390?originalNote.replace('autumn','winter'):originalNote
    assert.equal(note.length,30)
    const started=performance.now();let clicks=0
    await page.getByText(label,{exact:true}).click();clicks++
    const composer=page.getByText(label,{exact:true}).locator('..')
    await composer.locator('textarea').pressSequentially(note,{delay:200})
    await composer.getByRole('button',{name:button,exact:true}).click();clicks++
    const timeline=page.locator('#timeline');await timeline.getByText(note,{exact:true}).waitFor()
    const duration=performance.now()-started
    assert.equal(clicks,2);assert.ok(duration<10000,`${label} at ${width}: ${duration}ms`)
    console.log(`DONOR-004 ${width} ${label}: ${duration.toFixed(0)}ms, ${clicks} clicks`)
    await timeline.screenshot({path:`${directory}/DONOR-004-${selector}-${width}.png`})
   }
   await page.locator('#timeline select[name=timelineKind]').selectOption('call');await page.getByRole('button',{name:'Filter timeline',exact:true}).click()
   const calls=page.locator('#timeline [data-timeline-kind]');assert.ok(await calls.count()>0)
   assert.ok((await calls.evaluateAll(rows=>rows.map(r=>r.dataset.timelineKind))).every(k=>k==='call'))
   await page.locator('#timeline').screenshot({path:`${directory}/DONOR-004-filter-${width}.png`})
   await page.locator('#timeline select[name=timelineKind]').selectOption('');await page.getByLabel('Timeline from',{exact:true}).fill('2026-09-05');await page.getByLabel('Timeline to',{exact:true}).fill('2026-09-06');await page.getByRole('button',{name:'Filter timeline',exact:true}).click()
   assert.deepEqual((await page.locator('#timeline [data-timeline-kind]').evaluateAll(rows=>rows.map(r=>r.dataset.timelineKind))).sort(),['meeting','visit'])
   await page.locator('#timeline').screenshot({path:`${directory}/DONOR-004-dates-${width}.png`})
   await page.getByLabel('Timeline from',{exact:true}).fill('2020-01-01');await page.getByLabel('Timeline to',{exact:true}).fill('2020-01-02');await page.getByRole('button',{name:'Filter timeline',exact:true}).click()
   await page.getByText('No activity matches these timeline filters.',{exact:true}).waitFor()
   await page.locator('#timeline').screenshot({path:`${directory}/DONOR-004-empty-${width}.png`})
  }
 })
}
