import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {run,donor,archive,restore,installation} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

export async function volunteeringJourney(){
 await run(async h=>{
  const ada=await donor(h,'Ada Volunteer'),ben=await donor(h,'Ben Volunteer Giver'),other=await donor(h,'Cora Unrelated'),survivor=await donor(h,'Ada Second Record')
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:(await h.get('/api/coffer/settings')).timezone}).format(new Date()),year=day.slice(0,4),prior=`${Number(year)-1}-09-01`
  const member=await h.person('volunteer-staff@example.test')
  const csv=`donor_id,role,date,hours,source_id\r\n${ada.id},Reading tutor,${day},1.5,one\r\n${ada.id},Book sorting,${prior},2.25,two\r\n${ben.id},Food pantry,${day},3,three\r\n`
  await h.command('volunteer.import',{source:'VolunteerHub',csv},{as:'',status:401})
  const imported=await h.command('volunteer.import',{source:'VolunteerHub',csv},{as:member.cookie});assert.equal(imported.recorded,3)
  await h.command('volunteer.import',{source:'VolunteerHub',csv},{status:409})
  await h.command('volunteer.import',{source:'Galaxy Digital',csv:`donor_id,role,date,hours,source_id\n${other.id},Guide,${day},1,valid\nmissing,Tutor,${day},1,invalid`},{status:409})
  assert.equal((await h.get('/api/coffer/volunteering')).rows.length,3,'DONOR-010 imports are atomic and replay cannot duplicate hours')
  await h.command('volunteer.import',{source:'Galaxy Digital',csv:`donor_id,role,date,hours,source_id\n${ada.id},Community garden,${day},0.5,four`})
  for(const hours of ['0','-1','1.001','25','word'])await h.command('volunteer.record',{donorId:ada.id,role:'Tutor',occurredOn:day,hours},{status:400})
  await h.command('volunteer.record',{donorId:ada.id,role:'Tutor',occurredOn:'2099-01-01',hours:'1'},{status:400})
  await h.command('volunteer.record',{donorId:ben.id,role:'Program setup',occurredOn:day,hours:'0.25'})
  await h.command('gift.record',{donorId:ben.id,amount:'10',receivedOn:day,method:'check',goods:'none'})
  for(const basis of ['calendar','fiscal'])for(const volunteer of ['all','never-given']){
   const report=await h.get(`/api/coffer/retention?year=${year}&basis=${basis}&volunteer=${volunteer}`);assert.equal(report.totals.currentCents,volunteer==='all'?1000:0);assert.deepEqual(report.groups.new.rows.map(r=>r.donorId),volunteer==='all'?[ben.id]:[])
  }
  const state=await h.get('/api/coffer/volunteering?donorId='+ada.id)
  assert.deepEqual(state.years.map(y=>[y.year,y.minutes,y.hours]).sort(),[[String(Number(year)-1),135,2.25],[year,120,2]].sort())
  const history=await h.get('/api/coffer/donors/'+ada.id);assert.deepEqual(history.volunteering,state)
  const html=await (await h.request('/app/donors/'+ada.id)).text();assert.match(html,/Reading tutor/);assert.match(html,/Book sorting/);assert.match(html,/2.25 hours/)
  assert.deepEqual((await h.get('/api/coffer/donors?volunteer=never-given')).donors.map(d=>d.id),[ada.id])
  assert.deepEqual((await h.get('/api/coffer/donors?volunteer=all')).donors.map(d=>d.id),[ada.id,ben.id])
  const all=await h.get('/api/coffer/volunteering?year='+year);assert.equal(all.minutes,315)
  const csvResponse=await h.request('/api/coffer/volunteering.csv?year='+year);assert.equal(csvResponse.status,200);assert.match(await csvResponse.text(),new RegExp(`${ada.id},Ada Volunteer,${year},120,2`))
  await h.get('/api/coffer/volunteering?year=oops',{status:400})
  let policy=await h.get('/api/coffer/engagement/settings');assert.equal(policy.weights.volunteering,0)
  await h.command('engagement.settings',{version:policy.version,recency:20,frequency:20,amount:20,conversations:20,volunteering:20})
  const score=(await h.get('/api/coffer/donors/'+ada.id)).engagement
  assert.deepEqual([score.volunteering.minutes,score.volunteering.hours,score.volunteering.activities,score.volunteering.basePoints,score.volunteering.weight,score.volunteering.points],[120,2,2,10,20,8]);assert.equal(score.recency.lastOn,day);assert.equal(score.score,28)
  assert.match(await (await h.request('/app/donors/'+ada.id)).text(),/2 hours in 2 activities/)
  const key=await h.command('agent.create',{label:'Volunteer read journey'})
  await h.command('volunteer.record',{donorId:ada.id,role:'Agent write',occurredOn:day,hours:'1'},{as:'',headers:{authorization:'Bearer '+key.token},status:403})
  assert.equal((await h.get('/api/coffer/volunteering',{as:'',headers:{authorization:'Bearer '+key.token}})).rows.length,5)
  const saved=await archive(h),fresh=await installation()
  try{await restore(fresh,saved);assert.deepEqual(await fresh.get('/api/coffer/volunteering'),await h.get('/api/coffer/volunteering'))}finally{await fresh.close()}
  const comparison=await h.get(`/api/coffer/duplicates/compare?source=${ada.id}&target=${survivor.id}`)
  const merge=await h.command('donor.merge',{sourceDonorId:ada.id,donorId:survivor.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  assert.equal((await h.get('/api/coffer/donors/'+survivor.id)).volunteering.rows.length,3)
  await h.command('donor.unmerge',{mergeId:merge.mergeId,reason:'incorrect_match'});assert.equal((await h.get('/api/coffer/donors/'+ada.id)).volunteering.rows.length,3)
  if(process.env.COFFER_VOLUNTEER_BROWSER)await volunteerBrowser(h,ada.id,process.env.COFFER_VOLUNTEER_BROWSER,day)
  await h.command('donor.erase',{donorId:ada.id,confirm:'ERASE'})
  assert.equal((await h.get('/api/coffer/volunteering')).rows.some(v=>v.donor_id===ada.id),false)
  const erased=JSON.stringify(await archive(h));assert.ok(!erased.includes('Reading tutor'));assert.ok(!erased.includes('Community garden'))
 })
}
async function volunteerBrowser(h,donorId,directory,day){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/donors/'+donorId+'#volunteering')
   await page.locator('#volunteering').evaluate(el=>el.scrollIntoView({block:'center'}));await page.locator('#volunteering').screenshot({path:`${directory}/DONOR-010-donor-${width}.png`})
   await page.locator('#volunteering summary').click();await page.locator('#volunteering').getByLabel('Volunteer role',{exact:true}).fill(width===1440?'Library story hour':'Reading room setup')
   await page.locator('#volunteering').getByLabel('Hours',{exact:true}).fill('0.5');await page.locator('#volunteering').getByRole('button',{name:'Record volunteer activity',exact:true}).click()
   await page.locator('#timeline').getByText(width===1440?'Volunteering · Library story hour':'Volunteering · Reading room setup',{exact:true}).waitFor()
   await page.locator('#timeline').evaluate(el=>el.scrollIntoView({block:'center'}));await page.locator('#timeline').screenshot({path:`${directory}/DONOR-010-timeline-${width}.png`})
   await page.locator('#engagement').screenshot({path:`${directory}/DONOR-010-score-${width}.png`})
   await page.goto(origin+'/app/volunteering');await page.getByLabel('Source system',{exact:true}).fill('Community shifts');await page.getByLabel('Volunteer CSV',{exact:true}).fill(`donor_id,role,date,hours,source_id\n${donorId},Tour guide,${day},0.25,${width}`);await page.getByRole('button',{name:'Import volunteer CSV',exact:true}).click();await page.getByText(/Tour guide/).first().waitFor();await page.getByLabel('Calendar year',{exact:true}).fill(day.slice(0,4));await page.getByRole('button',{name:'View hours',exact:true}).click()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${directory}/DONOR-010-report-${width}.png`,fullPage:true})
   await page.getByRole('link',{name:'Volunteers who have never given',exact:true}).click();await page.getByRole('link',{name:'Ada Volunteer',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Ben Volunteer Giver',exact:true}).count(),0)
   await page.screenshot({path:`${directory}/DONOR-010-segment-${width}.png`})
   await page.goto(origin+'/app/engagement');await page.getByLabel('Volunteering weight',{exact:true}).fill('20');await page.getByRole('button',{name:'Save score weights',exact:true}).click();await page.getByRole('heading',{name:/Current weights/}).waitFor();await page.screenshot({path:`${directory}/DONOR-010-weights-${width}.png`,fullPage:true})
   await page.goto(origin+'/app/retention?volunteer=all');await page.getByRole('button',{name:'View year',exact:true}).click();await page.locator('#all-donors').getByRole('link',{name:'Ben Volunteer Giver',exact:true}).waitFor();await page.screenshot({path:`${directory}/DONOR-010-retention-${width}.png`,fullPage:true})
   await page.goto(origin+'/app/volunteering?year=1900');await page.getByText('No volunteer hours in this period.',{exact:true}).waitFor();await page.screenshot({path:`${directory}/DONOR-010-empty-${width}.png`})
  }
 })
}


// Configured report columns are documented in ./docs/MOVE-IN-SOURCES.md.
export async function lglVolunteeringJourney(reportFiles){
 const post=(h,action,input,options)=>h.api('/api/coffer/move-in/'+action,input,options)
 const apply=async(h,p)=>{let job=await post(h,'apply',{id:p.id,fingerprint:p.fingerprint});while(job.state==='applying')job=await post(h,'continue',{id:p.id});return job}
 const ids=['synthetic-coffer-1601','synthetic-coffer-1602','synthetic-coffer-1603']
 const constituents=[['LGL Constituent ID','Name'],[ids[0],'Synthetic Volunteer Reader'],[ids[1],'Synthetic Volunteer Giver'],[ids[2],'Synthetic Volunteer Crew']]
 const header=['LGL Volunteer ID','LGL Constituent ID','Volunteer Date','Volunteer Category','Volunteer Hours','Volunteer Minutes','Type']
 const activities=[['synthetic-coffer-1611',ids[0],'2026-09-01','Reading tutor','1.5','','Volunteer'],['synthetic-coffer-1612',ids[0],'2026-09-02','Library setup','','30','Volunteer'],['synthetic-coffer-1613',ids[0],'2025-09-01','Book sorting','2.25','','Volunteer'],['synthetic-coffer-1614',ids[1],'2026-09-01','Food pantry','3','','Volunteer'],...Array.from({length:801},(_,i)=>['synthetic-coffer-'+(1700+i),ids[2],'2024-09-01','Community service','','1','Volunteer'])]
 for(const format of ['csv','xlsx'])await run(async h=>{
  const initial={source:'lgl',files:await reportFiles([['constituents',constituents.slice(0,3)]],format)}
  await apply(h,await post(h,'preview',initial))
  const people=(await h.get('/api/coffer/donors')).donors,reader=people.find(d=>d.name==='Synthetic Volunteer Reader'),giver=people.find(d=>d.name==='Synthetic Volunteer Giver')
  await h.command('volunteer.record',{donorId:reader.id,role:'Pre-existing service',occurredOn:'2026-09-01',hours:'0.25'})
  await h.command('gift.record',{donorId:giver.id,receivedOn:'2026-09-01',amount:'10',method:'check',goods:'none'})
  const before=await h.get('/api/coffer/volunteering'),money=await h.get('/api/coffer/donors/'+giver.id)
  const input={source:'lgl',files:await reportFiles([['constituents',constituents],['volunteer-time',[header,...activities]]],format)}
  await post(h,'preview',input,{as:'',status:401})
  const member=await h.person(['synthetic-coffer-1600','example.test'].join('@'))
  await post(h,'preview',input,{as:member.cookie,status:403})
  const key=await h.command('agent.create',{label:'Synthetic volunteer reader'})
  await post(h,'preview',input,{as:'',headers:{authorization:'Bearer '+key.token},status:403})
  // Independently malformed reports must refuse, even with an acceptance reason.
  const invalidRows=[...activities.slice(0,1),activities[0],['synthetic-coffer-1620','missing','2026-09-01','Unknown constituent','1','','Volunteer'],...['0','-1','1.001','25','word'].map((hours,i)=>['synthetic-coffer-'+(1621+i),ids[0],'2026-09-01','Invalid time',hours,'','Volunteer']),['synthetic-coffer-1628',ids[0],'2026-02-30','Invalid date','1','','Volunteer'],['synthetic-coffer-1629',ids[0],'2099-01-01','Future service','1','','Volunteer'],['synthetic-coffer-1630',ids[0],'2026-09-01','Paid work','1','','Gift'],['synthetic-coffer-1631',ids[0],'2026-09-01','Conflicting duration','1','30','Volunteer']]
  const bad=await post(h,'preview',{source:'lgl',files:await reportFiles([['constituents',constituents],['volunteer-time',[header,...invalidRows]]],format)})
  assert.equal(bad.canApply,false)
  for(const code of ['DUPLICATE_ID','MISSING_REFERENCE','VOLUNTEER_DURATION','DATE','VOLUNTEER_ACTIVITY','VOLUNTEER_CLASSIFICATION'])assert.ok(bad.diagnostics.some(d=>d.code===code),code+': '+JSON.stringify(bad.diagnostics))
  await post(h,'apply',{id:bad.id,fingerprint:bad.fingerprint,acceptedReason:'Cannot waive invalid volunteer history'},{status:409})
  assert.deepEqual(await h.get('/api/coffer/volunteering'),before)
  const p=await post(h,'preview',input);assert.equal(p.canApply,true,JSON.stringify(p.diagnostics));assert.equal(p.needsAcceptance,false,JSON.stringify(p.unmapped));assert.equal(p.counts.volunteering,805);assert.equal(p.sourceTotals.amountCents,0);assert.equal(p.sourceTotals.giftCount,0);assert.equal(p.parts,3)
  assert.deepEqual(await h.get('/api/coffer/volunteering'),before,'Preview records no service')
  assert.deepEqual(p.volunteerTotals.map(v=>[v.donorExternalId,v.year,v.minutes,v.activities]),[[ids[0],'2025',135,1],[ids[0],'2026',120,2],[ids[1],'2026',180,1],[ids[2],'2024',801,801]])
  const all=[]
  for(let page=1;page<=17;page++){const result=await h.get('/api/coffer/move-in/volunteering?id='+p.id+'&volunteerPage='+page);all.push(...result.rows);assert.equal(result.pages,17)}
  assert.equal(new Set(all.map(v=>v.externalId)).size,805);assert.equal(all.at(-1).externalId,'synthetic-coffer-2500')
  await post(h,'apply',{id:p.id,fingerprint:p.fingerprint},{as:member.cookie,status:403})
  await post(h,'continue',{id:p.id},{as:member.cookie,status:403})
  await post(h,'undo',{id:p.id},{as:member.cookie,status:403})
  if(format==='csv'){const {lglVolunteeringBrowser}=await import('./lgl-volunteering-browser.mjs');await lglVolunteeringBrowser(h,input,p,reader.id,'review')}
  if(format==='csv'){
   const collision=await donor(h,'Synthetic Conflicting Volunteer',{email:''})
   await h.command('volunteer.import',{source:'Little Green Light',csv:`donor_id,role,date,hours,source_id\n${collision.id},Conflicting native entry,2024-09-01,1,synthetic-coffer-2500`})
   const refused=await post(h,'apply',{id:p.id,fingerprint:p.fingerprint},{status:409});assert.match(refused.message,/Part 3 of 3/)
   const partial=await h.get('/api/coffer/move-in/journal?id='+p.id);assert.equal(partial.job.applied_parts,2);assert.equal(partial.job.state,'applying')
   assert.equal((await h.get('/api/coffer/volunteering')).rows.filter(v=>v.source==='Little Green Light'&&v.donor_id!==collision.id).length,800,'The rejected last part adds none of its five rows')
   const freshAdmin=await h.person(['synthetic-coffer-1690','example.test'].join('@'),'admin')
   const revoked=await h.request('/auth/session/revoke',{method:'POST',body:{sessionId:freshAdmin.session.id}});assert.equal(revoked.status,204)
   await post(h,'continue',{id:p.id},{as:freshAdmin.cookie,status:401});assert.equal((await h.get('/api/coffer/move-in/journal?id='+p.id)).job.applied_parts,2)
   // Explicit erasure of the unrelated mistaken native entry resolves the conflict.
   await h.command('donor.erase',{donorId:collision.id,confirm:'ERASE'})
   let resumed=await post(h,'continue',{id:p.id});while(resumed.state==='applying')resumed=await post(h,'continue',{id:p.id});assert.equal(resumed.state,'completed')
  }else await apply(h,p)
  assert.equal((await post(h,'apply',{id:p.id,fingerprint:p.fingerprint})).unchanged,true)
  const renamed={...input,files:input.files.map(f=>({...f,name:'copy-'+f.name}))},repeat=await post(h,'preview',renamed)
  assert.equal((await apply(h,repeat)).unchanged,true)
  const state=await h.get('/api/coffer/volunteering'),crew=(await h.get('/api/coffer/donors')).donors.find(d=>d.name==='Synthetic Volunteer Crew')
  assert.equal(state.rows.length,806);assert.equal(state.minutes,1251)
  assert.deepEqual(state.years.map(y=>[y.donorId,y.year,y.minutes]).sort(),[[reader.id,'2026',135],[reader.id,'2025',135],[giver.id,'2026',180],[crew.id,'2024',801]].sort())
  const native=await h.get('/api/coffer/donors/'+reader.id)
  assert.equal(native.volunteering.rows.length,4);assert.ok(native.volunteering.rows.filter(v=>v.source==='Little Green Light').every(v=>v.source_key.startsWith('synthetic-coffer-')&&v.recorded_at&&v.recorded_by))
  assert.match(await (await h.request('/app/donors/'+reader.id+'?timelineKind=volunteering')).text(),/Volunteering · Reading tutor/)
  assert.deepEqual((await h.get('/api/coffer/donors?volunteer=never-given')).donors.map(d=>d.id).sort(),[reader.id,crew.id].sort())
  const policy=await h.get('/api/coffer/engagement/settings')
  await h.command('engagement.settings',{version:policy.version,recency:20,frequency:20,amount:20,conversations:20,volunteering:20})
  const score=(await h.get('/api/coffer/donors/'+reader.id)).engagement.volunteering
  assert.deepEqual([score.minutes,score.hours,score.activities,score.weight,score.points],[135,2.25,3,20,8])
  const currentMoney=await h.get('/api/coffer/donors/'+giver.id)
  assert.deepEqual(currentMoney.gifts,money.gifts);assert.deepEqual(currentMoney.totals,money.totals)
  const check=await post(h,'check',{id:p.id});assert.equal(check.matches,true,JSON.stringify(check));assert.equal(check.rows.filter(r=>r.scope==='volunteering').length,4)
  const journal=await h.get('/api/coffer/move-in/journal?id='+p.id);assert.equal(journal.records.find(r=>r.kind==='volunteering').n,805)
  if(format==='csv'){const {lglVolunteeringBrowser}=await import('./lgl-volunteering-browser.mjs');await lglVolunteeringBrowser(h,input,p,reader.id,'native')}
  const saved=await archive(h)
  await run(async fresh=>{await restore(fresh,saved);assert.deepEqual(await fresh.get('/api/coffer/volunteering'),state);assert.equal((await post(fresh,'check',{id:p.id})).matches,true);await post(fresh,'undo',{id:p.id});assert.deepEqual(await fresh.get('/api/coffer/volunteering'),before);assert.deepEqual((await fresh.get('/api/coffer/donors/'+giver.id)).gifts,money.gifts)},{entry:'tests/fixed-clock-worker.ts'})
  // A new file set reuses activities once and fences the first job's undo.
  const next=await post(h,'preview',{...input,files:[...input.files,...(await reportFiles([['additional-note',[['LGL Constituent ID','Note ID','Note'],[ids[0],'synthetic-coffer-1632','Retained source note']]]],format)).map(f=>({...f,name:'extra-'+f.name}))]})
  assert.equal(next.canApply,true,JSON.stringify(next.diagnostics));await apply(h,next);assert.equal((await h.get('/api/coffer/volunteering')).rows.length,806)
  await post(h,'undo',{id:p.id},{status:409});await post(h,'undo',{id:next.id})
  const target=await donor(h,'Synthetic Volunteer Survivor',{email:''})
  const comparison=await h.get(`/api/coffer/duplicates/compare?source=${reader.id}&target=${target.id}`)
  const merge=await h.command('donor.merge',{sourceDonorId:reader.id,donorId:target.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  assert.equal((await h.get('/api/coffer/donors/'+target.id)).volunteering.minutes,270)
  await post(h,'undo',{id:p.id},{status:409})
  await h.command('donor.unmerge',{mergeId:merge.mergeId,reason:'incorrect_match'})
  assert.equal((await h.get('/api/coffer/donors/'+reader.id)).volunteering.minutes,270)
  await h.command('volunteer.record',{donorId:crew.id,role:'Later native dependency',occurredOn:'2026-09-01',hours:'1'})
  await post(h,'undo',{id:p.id},{status:409});assert.equal((await h.get('/api/coffer/volunteering')).rows.length,807)
  await h.command('donor.erase',{donorId:reader.id,confirm:'ERASE'})
  assert.equal((await h.get('/api/coffer/volunteering')).rows.some(v=>v.donor_id===reader.id),false)
  const erased=await post(h,'preview',input);assert.equal(erased.canApply,false);await post(h,'apply',{id:erased.id,fingerprint:erased.fingerprint},{status:409})
  const redacted=JSON.stringify(await archive(h));assert.ok(!redacted.includes('Reading tutor'));assert.ok(!redacted.includes('Book sorting'))
 },{entry:'tests/fixed-clock-worker.ts'})
}
