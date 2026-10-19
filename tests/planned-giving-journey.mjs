import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {run,donor,archive,restore,installation} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

export async function plannedGivingJourney(){
 await run(async h=>{
  const ada=await donor(h,'Ada Rivera'),ben=await donor(h,'Ben Wells'),history=()=>h.get('/api/coffer/donors/'+ada.id)
  const input={donorId:ada.id,label:'Rivera estate',vehicle:'Bequest',estimatedValue:'50000',documentation:'requested',recordedOn:'2026-09-01'}
  await h.command('planned.save',input,{as:'',status:401})
  const agent=await h.command('agent.create',{label:'Read planned giving'})
  await h.command('planned.save',input,{as:'',headers:{authorization:'Bearer '+agent.token},status:403})
  await h.command('planned.save',{...input,estimatedValue:'100.001'},{status:400})
  const intention=await h.command('planned.save',input)
  assert.equal((await history()).totals.lifetimeCents,0,'An estimate is never received money')
  await h.command('legacy.set',{donorId:ada.id,membership:'member',on:'2026-09-01'})
  const updated=await h.command('planned.save',{...input,plannedGiftId:intention.id,version:1,documentation:'received'})
  assert.equal(updated.version,2)
  await h.command('planned.save',{...input,plannedGiftId:intention.id,version:1},{status:409})
  const gift=await h.command('gift.record',{donorId:ada.id,amount:'5000',receivedOn:'2026-09-20',method:'check',reference:'ESTATE-001',fund:'Unrestricted',goods:'none'})
  const wrong=await h.command('gift.record',{donorId:ben.id,amount:'20',receivedOn:'2026-09-20',method:'check',goods:'none'})
  await h.command('planned.realize',{donorId:ada.id,plannedGiftId:intention.id,giftId:wrong.id},{status:409})
  await h.command('planned.realize',{donorId:ada.id,plannedGiftId:intention.id,giftId:gift.id})
  await h.command('planned.realize',{donorId:ada.id,plannedGiftId:intention.id,giftId:gift.id},{status:409})
  const state=(await history()).plannedGiving
  assert.equal(state.legacyMember,true)
  assert.deepEqual(state.intentions.map(p=>[p.vehicle,p.estimated_cents,p.documentation,p.realized_cents]),[['Bequest',5000000,'received',500000]])
  assert.deepEqual(state.distributions.map(d=>[d.gift_id,d.intention_id,d.net_cents]),[[gift.id,intention.id,500000]])
  assert.equal((await history()).totals.lifetimeCents,500000)
  await h.command('planned.save',{...input,donorId:ben.id,label:'Beneficiary intention',vehicle:'Beneficiary designation',estimatedValue:''})
  assert.equal((await h.get('/api/coffer/donors/'+ben.id)).plannedGiving.intentions[0].estimated_cents,null)
  const saved=await archive(h),fresh=await installation()
  try{await restore(fresh,saved);assert.deepEqual((await fresh.get('/api/coffer/donors/'+ada.id)).plannedGiving,state)}finally{await fresh.close()}
  if(process.env.COFFER_PLANNED_BROWSER)await plannedGivingBrowser(h,ada.id,process.env.COFFER_PLANNED_BROWSER)
  await h.command('legacy.set',{donorId:ben.id,membership:'member',on:'2026-09-02'})
  const source=await history(),target=await h.get('/api/coffer/donors/'+ben.id)
  const merged=await h.command('donor.merge',{sourceDonorId:ada.id,sourceVersion:source.donor.version,donorId:ben.id,version:target.donor.version,reason:'duplicate_record'})
  const combined=(await h.get('/api/coffer/donors/'+ben.id)).plannedGiving
  assert.ok(combined.intentions.some(i=>i.id===intention.id));assert.equal(combined.memberships.length,2)
  await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
  assert.equal((await history()).plannedGiving.intentions.find(i=>i.id===intention.id).realized_cents,500000)
  await h.command('gift.reverse',{giftId:gift.id,reason:'Estate check returned',reversedOn:'2026-09-21'})
  assert.equal((await history()).plannedGiving.intentions.find(i=>i.id===intention.id).realized_cents,0)
  await h.command('donor.erase',{donorId:ada.id,confirm:'ERASE'})
  const erased=(await h.get('/api/coffer/donors')).donors.find(d=>d.erased_at)
  const after=await h.get('/api/coffer/donors/'+erased.id)
  assert.equal(after.plannedGiving.intentions.length,0);assert.equal(after.plannedGiving.memberships.length,0)
  assert.equal(after.gifts.length,2,'Erasure keeps the anonymous gift and reversal')
  assert.doesNotMatch(JSON.stringify(await archive(h)),/Rivera estate|Trust remainder|Retirement account/,'Erasure also removes planned-giving merge snapshots')
 })
}

async function plannedGivingBrowser(h,donorId,directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(10000)
  for(const [width,label]of [[1440,'Trust remainder'],[390,'Retirement account']]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/donors/'+donorId+'#planned-giving')
   const panel=page.locator('#planned-giving')
   await panel.getByText('Record a planned intention',{exact:true}).click()
   const entry=panel.locator('form').filter({has:page.getByRole('button',{name:'Record intention',exact:true})})
   await entry.getByLabel('Intention name',{exact:true}).fill(label)
   await entry.getByLabel('Planned gift vehicle',{exact:true}).fill(width===1440?'Charitable remainder trust':'Beneficiary designation')
   await entry.getByLabel('Estimated value (USD, optional)',{exact:true}).fill('25000')
   await entry.locator('select[name="documentation"]').selectOption('reviewed')
   await entry.getByLabel('Intention recorded on',{exact:true}).fill('2026-09-01')
   await entry.getByRole('button',{name:'Record intention',exact:true}).click()
   await page.locator('#planned-giving').getByText(label,{exact:true}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/MAJOR-007-donor-${width}.png`})
   await page.locator('#planned-giving').screenshot({path:`${directory}/MAJOR-007-planned-${width}.png`})
  }
 })
}
