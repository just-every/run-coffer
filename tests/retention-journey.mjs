import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {run,donor,reviewed,settings,archive,restore,installation} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

export async function retentionJourney(){
 await run(async h=>{
  await reviewed(h)
  const up=await donor(h,'Ada Rivera'),down=await donor(h,'Ben Wells'),same=await donor(h,'Carmen Diaz'),fresh=await donor(h,'Drew Park'),lapsed=await donor(h,'Elena Moss'),back=await donor(h,'Farah Noor'),adjust=await donor(h,'George Cho')
  const campaign=await h.api('/api/coffer/giving/campaigns',{name:'Library renewal',slug:'library-renewal',description:'Books for the community',fund:'Library',goal:'10000'})
  const mealsCampaign=await h.api('/api/coffer/giving/campaigns',{name:'Meals support',slug:'meals-support',description:'Meals for neighbors',fund:'Meals',goal:'10000'})
  const gift=(d,amount,receivedOn,extra={})=>h.command('gift.record',{donorId:d.id,amount,receivedOn,method:'check',goods:'none',...(extra.allocations?{}:{fund:'Library'}),...extra})
  await gift(up,'40','2023-04-02');await gift(back,'90','2023-04-02')
  await gift(up,'100','2024-04-02');await gift(up,'150','2025-04-02')
  await gift(down,'200','2024-04-02');await gift(down,'125','2025-04-02')
  await gift(same,'80','2024-04-02');await gift(same,'80','2025-04-02')
  await gift(fresh,'60','2025-04-02');await gift(lapsed,'110','2024-04-02');await gift(back,'95','2025-04-02')
  const offset=await gift(adjust,'35','2025-04-02');await h.command('gift.reverse',{giftId:offset.id,reason:'Returned check',reversedOn:'2025-05-01'})
  const path='/api/coffer/retention?year=2025',report=await h.get(path)
  const expect={retained:[[up.id,down.id,same.id],38000,35500],new:[[fresh.id],0,6000],lapsed:[[lapsed.id],11000,0],recaptured:[[back.id],0,9500]}
  for(const [kind,[ids,prior,current]] of Object.entries(expect)){
   const group=report.groups[kind];assert.deepEqual(group.rows.map(r=>r.donorId).sort(),ids.sort());assert.deepEqual([group.count,group.priorCents,group.currentCents],[ids.length,prior,current])
   const page=await h.request('/app/retention?year=2025');assert.equal(page.status,200);const html=await page.text();assert.ok(html.includes(`id="${kind}"`));for(const id of ids)assert.ok(html.includes(`/app/donors/${id}`))
  }
  assert.deepEqual([report.totals.priorCents,report.totals.currentCents,report.totals.priorDonors,report.totals.currentDonors,report.totals.retentionRate],[49000,51000,4,5,.75])
  assert.deepEqual(report.movements.upgraded.rows.map(r=>r.donorId),[up.id]);assert.equal(report.movements.upgraded.changeCents,5000)
  assert.deepEqual(report.movements.downgraded.rows.map(r=>r.donorId),[down.id]);assert.equal(report.movements.downgraded.changeCents,-7500)
  assert.deepEqual(report.movements.unchanged.rows.map(r=>r.donorId),[same.id]);assert.equal(report.movements.unchanged.changeCents,0)
  assert.equal(report.adjustments.count,1);assert.equal(report.adjustments.currentCents,0)
  const known=await h.get('/api/coffer/settings');await h.command('settings.update',{...settings,version:known.version,fiscalYearStart:'07-01'})
  await gift(up,'7','2024-06-30');await gift(up,'9','2024-07-01');await gift(up,'11','2025-06-30');await gift(up,'13','2025-07-01')
  const fiscal=await h.get('/api/coffer/retention?basis=fiscal&year=2024&q=Ada')
  assert.deepEqual([fiscal.prior.from,fiscal.prior.through,fiscal.current.from,fiscal.current.through],['2023-07-01','2024-06-30','2024-07-01','2025-06-30'])
  assert.deepEqual([fiscal.totals.priorCents,fiscal.totals.currentCents],[10700,17000]);assert.deepEqual(fiscal.movements.upgraded.rows.map(r=>r.donorId),[up.id])
  // Same donor and payment, different allocation scopes: recognition is not cash.
  const split=await gift(up,'100','2025-09-01',{allocations:[{campaignId:campaign.id,amount:'60'},{campaignId:mealsCampaign.id,amount:'40'}]})
  await h.command('gift.reverse',{giftId:split.id,reason:'Split check returned',reversedOn:'2025-09-02'})
  await gift(up,'10','2025-09-03',{allocations:[{campaignId:campaign.id,amount:'6'},{campaignId:mealsCampaign.id,amount:'4'}]})
  const scoped=await h.get(path+'&campaignId='+campaign.id);assert.equal(scoped.totals.currentCents,600);assert.equal(scoped.ledgerTotals.currentCents,600);assert.deepEqual(scoped.groups.new.rows.map(r=>r.donorId),[up.id])
  const meals=await h.get(path+'&fund=Meals');assert.equal(meals.totals.currentCents,400);assert.equal(meals.totals.priorCents,0)
  const currentYear=new Date().getUTCFullYear()
  const cohort=await h.get('/api/coffer/reports/annual-lapses?year='+currentYear)
  for(const list of ['lybunt','sybunt']){
   const filtered=await h.get(path+'&list='+list),ids=cohort.groups.find(g=>g.kind===list).rows.map(r=>r.donorId)
   assert.deepEqual(Object.values(filtered.groups).flatMap(g=>g.rows).map(r=>r.donorId).sort(),Object.values((await h.get(path)).groups).flatMap(g=>g.rows).filter(r=>ids.includes(r.donorId)).map(r=>r.donorId).sort())
  }
  await h.command('relationship.create',{donorId:up.id,relatedDonorId:down.id,type:'spouse'})
  const linked=await h.get(path+'&relationship=spouse&relatedTo='+down.id);assert.deepEqual(linked.groups.retained.rows.map(r=>r.donorId),[up.id])
  await h.get('/api/coffer/retention?basis=unknown',{status:400});await h.get('/api/coffer/retention?year=2025oops',{status:400});await h.get('/api/coffer/retention?list=unknown',{status:400});await h.get(path,{as:'',status:401})
  const saved=await archive(h),freshInstall=await installation()
  try{await restore(freshInstall,saved);assert.deepEqual((await freshInstall.get(path)).groups,(await h.get(path)).groups)}finally{await freshInstall.close()}
  if(process.env.COFFER_RETENTION_BROWSER)await retentionBrowser(h,process.env.COFFER_RETENTION_BROWSER)
  await h.command('donor.erase',{donorId:down.id,confirm:'ERASE'})
  const erased=await h.get(path);assert.equal(erased.groups.retained.rows.some(r=>r.donorId===down.id),false);assert.equal(erased.excluded.currentCents,12500);assert.equal(erased.ledgerTotals.currentCents,erased.totals.currentCents+12500)
 })
}

async function retentionBrowser(h,directory){
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/retention?year=2025')
   await page.screenshot({path:`${directory}/REPORT-001-summary-${width}.png`})
   await page.getByRole('link',{name:'Lapsed',exact:true}).click();assert.equal(new URL(page.url()).hash,'#lapsed')
   assert.ok(await page.locator('#lapsed').getByRole('link',{name:'Elena Moss'}).isVisible())
   await page.screenshot({path:`${directory}/REPORT-001-lapsed-${width}.png`})
   await page.getByLabel('Calendar year',{exact:true}).fill('2024');await page.locator('select[name="basis"]').selectOption('fiscal');await page.getByLabel('Donor search',{exact:true}).fill('Ada')
   await page.getByRole('button',{name:'View year',exact:true}).click();await page.locator('#upgraded').getByRole('link',{name:'Ada Rivera'}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/REPORT-001-filter-${width}.png`});await page.locator('#upgraded').screenshot({path:`${directory}/REPORT-001-upgraded-${width}.png`})
   await page.getByLabel('Donor search',{exact:true}).fill('Nobody matches');await page.getByRole('button',{name:'View year',exact:true}).click();assert.ok(await page.locator('#all-donors').getByText('No donors in this group.').isVisible())
   await page.screenshot({path:`${directory}/REPORT-001-empty-${width}.png`});await page.locator('#all-donors').screenshot({path:`${directory}/REPORT-001-empty-result-${width}.png`})
  }
 })
}
