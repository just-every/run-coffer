import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {run,donor,archive,restore,installation} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

export async function volunteeringJourney(){
 await run(async h=>{
  const ada=await donor(h,'Ada Volunteer'),ben=await donor(h,'Ben Volunteer Giver'),other=await donor(h,'Cora Unrelated'),survivor=await donor(h,'Ada Second Record')
  const day=new Date().toISOString().slice(0,10),year=day.slice(0,4),prior=`${Number(year)-1}-09-01`
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
  if(process.env.COFFER_VOLUNTEER_BROWSER)await volunteerBrowser(h,ada.id,process.env.COFFER_VOLUNTEER_BROWSER)
  await h.command('donor.erase',{donorId:ada.id,confirm:'ERASE'})
  assert.equal((await h.get('/api/coffer/volunteering')).rows.some(v=>v.donor_id===ada.id),false)
  const erased=JSON.stringify(await archive(h));assert.ok(!erased.includes('Reading tutor'));assert.ok(!erased.includes('Community garden'))
 })
}
async function volunteerBrowser(h,donorId,directory){
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
   await page.goto(origin+'/app/volunteering');await page.getByLabel('Source system',{exact:true}).fill('Community shifts');await page.getByLabel('Volunteer CSV',{exact:true}).fill(`donor_id,role,date,hours,source_id\n${donorId},Tour guide,${new Date().toISOString().slice(0,10)},0.25,${width}`);await page.getByRole('button',{name:'Import volunteer CSV',exact:true}).click();await page.getByText(/Tour guide/).first().waitFor();await page.getByLabel('Calendar year',{exact:true}).fill(new Date().getUTCFullYear().toString());await page.getByRole('button',{name:'View hours',exact:true}).click()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${directory}/DONOR-010-report-${width}.png`,fullPage:true})
   await page.getByRole('link',{name:'Volunteers who have never given',exact:true}).click();await page.getByRole('link',{name:'Ada Volunteer',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Ben Volunteer Giver',exact:true}).count(),0)
   await page.screenshot({path:`${directory}/DONOR-010-segment-${width}.png`})
   await page.goto(origin+'/app/engagement');await page.getByLabel('Volunteering weight',{exact:true}).fill('20');await page.getByRole('button',{name:'Save score weights',exact:true}).click();await page.getByRole('heading',{name:/Current weights/}).waitFor();await page.screenshot({path:`${directory}/DONOR-010-weights-${width}.png`,fullPage:true})
   await page.goto(origin+'/app/retention?volunteer=all');await page.getByRole('button',{name:'View year',exact:true}).click();await page.locator('#all-donors').getByRole('link',{name:'Ben Volunteer Giver',exact:true}).waitFor();await page.screenshot({path:`${directory}/DONOR-010-retention-${width}.png`,fullPage:true})
   await page.goto(origin+'/app/volunteering?year=1900');await page.getByText('No volunteer hours in this period.',{exact:true}).waitFor();await page.screenshot({path:`${directory}/DONOR-010-empty-${width}.png`})
  }
 })
}
