import assert from 'node:assert/strict'
import {run,donor,reviewed,settings,archive,restore,installation} from './harness.mjs'
import {dashboardStripe} from './dashboard-stripe-journey.mjs'
import {dashboardBrowser} from './dashboard-browser.mjs'

const base='/api/coffer/reports/dashboard',query='?year=2024'
const goal=(dimension,key,amount='1000')=>({year:2024,fiscalStart:'07-01',dimension,key,amount,version:0})
export async function dashboardJourney(){
 const edge=dashboardStripe()
 await run(async h=>{
  await reviewed(h);const known=await h.get('/api/coffer/settings');await h.command('settings.update',{...settings,version:known.version,fiscalYearStart:'07-01'})
  const owner=(await h.get('/auth/session')).operator,member=await h.person('dashboard-member@example.test'),admin=await h.person('dashboard-admin@example.test','admin')
  const ada=await donor(h,'Ada Dashboard'),ben=await donor(h,'Ben Dashboard'),chen=await donor(h,'Chen Dashboard')
  const campaign=async(name,slug,fund)=>h.api('/api/coffer/giving/campaigns',{name,slug,fund,description:'Community support',goal:'10000'})
  const reading=await campaign('Dashboard reading','dashboard-reading','Library'),meals=await campaign('Dashboard meals','dashboard-meals','Meals')
  await h.command('appealCode.define',{code:'SPRING',name:'Spring appeal'})
  const gift=(d,amount,receivedOn,extra={})=>h.command('gift.record',{donorId:d.id,amount,receivedOn,method:'check',goods:'none',...(extra.allocations?{}:{fund:'Library'}),...extra})
  await gift(ada,'7','2023-06-30');await gift(ada,'100','2023-07-01');await gift(ada,'20','2024-06-30')
  await gift(ada,'50','2024-07-01');await gift(ada,'30','2025-06-30');await gift(ada,'9','2025-07-01')
  const split=await gift(ben,'100','2024-09-01',{allocations:[{campaignId:reading.id,amount:'60'},{campaignId:meals.id,amount:'40'}],channel:'mail',appeal:'SPRING'})
  await h.command('gift.reverse',{giftId:split.id,reason:'Returned split gift',reversedOn:'2024-10-01'})
  await gift(chen,'25','2024-09-02',{fund:'Meals',campaignId:meals.id,channel:'email',appeal:'SPRING'})
  await edge.give(h,'dashboard-reading')
  await h.command('prospect.save',{donorId:ada.id,ownerId:owner.id,campaignId:reading.id,label:'Leadership commitment',stage:'identify',askAmount:'1000',expectedAmount:'900.01',probability:50,fund:'Library',expectedCloseOn:'2026-12-15',nextStep:'Meet the donor'})
  for(const [dimension,key]of [['organization',''],['fund','Library'],['campaign',reading.id],['appeal','SPRING'],['form',reading.id],['channel','form'],['month','09']])await h.command('dashboard.goal',goal(dimension,key))
  await h.command('dashboard.goal',goal('fund','Meals'),{as:member.cookie,status:403})
  const adminGoal=await h.command('dashboard.goal',goal('fund','Meals','50'),{as:admin.cookie});assert.equal(adminGoal.version,1)
  await h.command('dashboard.goal',goal('fund','Meals','51'),{status:409})
  await h.command('dashboard.goal',{...goal('fund','Meals','55'),version:1},{as:admin.cookie})
  await h.command('dashboard.goal',{...goal('month','99')},{status:400})
  await h.command('dashboard.goal',{...goal('fund','Another'),fiscalStart:'01-01'},{status:409})
  await h.command('dashboard.goal',goal('organization',''),{as:'',status:401})
  const agent=await h.command('agent.create',{label:'Dashboard read'})
  await h.command('dashboard.goal',goal('fund','Agent'),{as:'',headers:{authorization:'Bearer '+agent.token},status:403})
  const r=await h.get(base+query,{as:member.cookie})
  assert.deepEqual([r.current.from,r.current.through,r.prior.from,r.prior.through],['2024-07-01','2025-06-30','2023-07-01','2024-06-30'])
  assert.deepEqual([r.summary.currentCents,r.summary.priorCents,r.summary.goal.amount_cents],[14500,12000,100000])
  assert.equal(r.pipeline.totals.forecastCents,45001)
  assert.deepEqual([r.cohorts.groups.new.count,r.cohorts.groups.new.currentCents,r.cohorts.groups.retained.count,r.cohorts.totals.retentionRate],[2,6500,1,1])
  assert.equal(r.dimensions.fund.find(x=>x.key==='Library').currentCents,12000)
  assert.equal(r.dimensions.campaign.find(x=>x.key===reading.id).currentCents,4000)
  assert.equal(r.dimensions.month.find(x=>x.key==='09').currentCents,16500)
  assert.equal(r.dimensions.month.find(x=>x.key==='10').currentCents,-10000)
  assert.equal(r.dimensions.month.length,12);assert.equal(r.dimensions.month[0].key,'07')
  assert.equal(r.dimensions.form.find(x=>x.key===reading.id).currentCents,4000,'Only actual checkout is a giving form; manual campaign attribution stays separate')
  for(const [dimension,rows]of Object.entries(r.dimensions)){
   assert.equal(rows.reduce((n,x)=>n+x.currentCents,0),14500,dimension);assert.equal(rows.reduce((n,x)=>n+x.priorCents,0),12000,dimension)
   for(const row of rows)for(const period of ['current','prior']){
    const detail=await h.get(base+'/entries?'+new URLSearchParams({year:'2024',dimension,key:row.key,period}))
    assert.equal(detail.totalCents,row[period+'Cents']);assert.equal(detail.entries.reduce((n,e)=>n+e.amount_cents,0),detail.totalCents)
   }
  }
  const retained=await h.get(base+'/entries?year=2024&cohort=retained');assert.equal(retained.totalCents,8000)
  await h.get(base+query,{as:'',status:401});await h.get(base+'?year=2024oops',{status:400});await h.get(base+'/entries?year=2024&dimension=invalid',{status:400})
  assert.equal((await h.get(base+query,{as:'',headers:{authorization:'Bearer '+agent.token}})).summary.currentCents,14500)
  const audit=await h.get('/api/coffer/audit?action=dashboard.goal');assert.ok(JSON.stringify(audit).includes('dashboard.goal'))
  const empty=await h.get(base+'?year=2021');assert.equal(empty.summary.currentCents,0);assert.equal(empty.summary.goal,null)
  for(const path of ['/app/reports/dashboard?year=2024','/app/reports/dashboard?year=2024&view=entries&dimension=fund&key=Library','/app'])assert.equal((await h.request(path)).status,200)
  if(process.env.COFFER_DASHBOARD_BROWSER)await dashboardBrowser(h,process.env.COFFER_DASHBOARD_BROWSER)
  await edge.give(h,'dashboard-reading','monthly','Recurring Dashboard Donor','10')
  const now=await h.get(base);assert.equal(now.recurring.rows.at(-1).mrrCents,1000);assert.equal(now.recurringSources.at(-1).plans[0].amount_cents,1000)
  const saved=await archive(h),copy=await installation()
  try{await restore(copy,saved);const restored=await copy.get(base+query);assert.deepEqual(restored.dimensions,(await h.get(base+query)).dimensions);assert.deepEqual(restored.goals,(await h.get(base+query)).goals)}finally{await copy.close()}
  await h.command('donor.erase',{donorId:ada.id,confirm:'ERASE'})
  const erased=await h.get(base+query);assert.equal(erased.summary.currentCents,15500,'the additional $10 recurring installment remains received after erasure');assert.equal(erased.cohorts.groups.retained.count,0)
  const details=await h.get(base+'/entries?year=2024');assert.equal(details.entries.some(e=>e.donor_id===ada.id),false);assert.equal(details.entries.filter(e=>e.donor_id===null).reduce((n,e)=>n+e.amount_cents,0),8000)
 },{bindings:{STRIPE_SECRET_KEY:'sk_test_dashboard_edge'},outbound:edge.outbound})
}
