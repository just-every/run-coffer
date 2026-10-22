import assert from 'node:assert/strict'
import {run,donor,reviewed,settings,archive,restore} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'
import {mkdir} from 'node:fs/promises'

export async function savedListsJourney(){await run(async h=>{
 await reviewed(h)
 const a=await donor(h,'Avery List'),b=await donor(h,'Blair List'),no=await donor(h,'Casey List')
 const give=(d,amount,day)=>h.command('gift.record',{donorId:d.id,amount,receivedOn:day,method:'check',goods:'none',fund:'Library'})
 const consent=d=>h.command('consent.record',{donorId:d.id,channel:'email',status:'granted',method:'paper form',evidence:'synthetic-coffer-701',capturedOn:'2025-01-01'})
 await consent(a);await consent(b)
 const ag=await give(a,'500','2025-08-01');await give(b,'400','2025-08-01');await give(no,'900','2025-08-01')
 await give(a,'300','2024-08-01');await give(b,'600','2024-08-01')
 const list=await h.command('list.save',{name:'Prior-year email supporters',filters:{givingFrom:'2025-01-01',givingThrough:'2025-12-31',minGiven:'500',emailConsent:'granted'}})
 const ids=async id=>(await h.get('/api/coffer/lists/'+id+'/members')).donorIds.sort()
 assert.deepEqual(await ids(list.id),[a.id])
 await give(b,'100','2025-12-01');assert.deepEqual(await ids(list.id),[a.id,b.id].sort(),'A new qualifying gift changes saved membership without editing its definition')
 const appeal=await h.command('appeal.prepare',{name:'Saved list email',channel:'email',listId:list.id})
 assert.deepEqual((await h.get('/api/coffer/appeals/'+appeal.id)).recipients.map(r=>r.donor_id).sort(),[a.id,b.id].sort())
 const manager=await h.person('synthetic-coffer-702@example.test'),portfolio=await h.command('portfolio.save',{name:'List portfolio',managerId:manager.id,untouchedDays:30})
 await h.command('list.bulk',{listId:list.id,version:1,reason:'synthetic-coffer-703',actions:[{type:'tag.add',tag:'Board'},{type:'manager',portfolioId:portfolio.id}]},{as:manager.cookie,status:403})
 const bulk=await h.command('list.bulk',{listId:list.id,version:1,reason:'synthetic-coffer-703',actions:[{type:'tag.add',tag:'Board'},{type:'manager',portfolioId:portfolio.id}]})
 assert.equal(bulk.changed,2)
 for(const d of [a,b])assert.ok((await h.get('/api/coffer/donors/'+d.id)).ruleTags.some(t=>t.tag==='Board'))
 const assigned=await h.command('list.save',{name:'Assigned board',filters:{tag:'Board',managerId:manager.id}})
 assert.deepEqual(await ids(assigned.id),[a.id,b.id].sort())
 await h.command('list.undo',{jobId:bulk.id,version:1})
 assert.deepEqual(await ids(assigned.id),[])
 for(const d of [a,b])assert.equal((await h.get('/api/coffer/donors/'+d.id)).ruleTags.length,0)
 await h.command('list.undo',{jobId:bulk.id,version:1},{status:409})
 // Any later direct edit prevents an undo overwriting it.
 const again=await h.command('list.bulk',{listId:list.id,version:1,reason:'synthetic-coffer-704',actions:[{type:'tag.add',tag:'Board'}]})
 const current=(await h.get('/api/coffer/donors/'+a.id)).donor
 await h.command('donor.update',{donorId:a.id,version:current.version,name:current.name,email:current.email,addressLine1:current.address_line1,city:current.city,region:current.region,postalCode:current.postal_code})
 await h.command('list.undo',{jobId:again.id,version:1},{status:409})
 assert.equal((await h.get('/api/coffer/donors/'+b.id)).ruleTags.length,1,'Failed undo is atomic across every member')
 await h.command('list.solicitation',{listId:list.id,version:1,type:'stop',reason:'synthetic-coffer-705'})
 const restricted=await h.command('list.save',{name:'Restricted saved supporters',filters:{solicitation:'stop'}})
 assert.deepEqual(await ids(restricted.id),[a.id,b.id].sort())
 const audit=await h.get('/api/coffer/audit?action=list.solicitation')
 assert.ok(audit.rows.some(r=>r.actor_role==='owner'&&r.subject_id===list.id))
 assert.equal((await h.command('appeal.prepare',{name:'Restricted ask',channel:'email',listId:list.id},{status:409})).error,'NO_RECIPIENTS')
 await h.command('list.solicitation',{listId:list.id,version:1,type:'none',reason:'synthetic-coffer-706'})
 const report=await h.get('/api/coffer/retention?year=2025&list=saved:'+list.id)
 assert.deepEqual([report.totals.priorCents,report.totals.currentCents],[90000,100000])
 assert.deepEqual(report.movements.upgraded.rows.map(r=>r.donorId),[a.id]);assert.deepEqual(report.movements.downgraded.rows.map(r=>r.donorId),[b.id])
 const s=await h.get('/api/coffer/settings');await h.command('settings.update',{...settings,version:s.version,fiscalYearStart:'07-01'})
 const fiscal=await h.get('/api/coffer/retention?basis=fiscal&year=2025&fund=Library&list=saved:'+list.id)
 assert.deepEqual([fiscal.totals.priorCents,fiscal.totals.currentCents],[90000,100000])
 const empty=await h.get('/api/coffer/retention?year=2025&fund=Absent&list=saved:'+list.id);assert.equal(empty.totals.count,0)
 const unack=await h.command('list.save',{name:'Unacknowledged',filters:{q:'Avery List',ackStatus:'not acknowledged'}})
 assert.deepEqual(await ids(unack.id),[a.id])
 // Both of Avery's gifts are explicitly acknowledged before testing the filter's exclusion.
 for(const g of (await h.get('/api/coffer/donors/'+a.id)).gifts.filter(g=>g.kind==='gift'))await h.command('gift.acknowledge',{giftId:g.id,version:0,acknowledgedOn:'2026-01-01',method:'phone call',notes:'synthetic-coffer-707'})
 assert.deepEqual(await ids(unack.id),[])
 const ack=await h.command('list.save',{name:'Acknowledged',filters:{ackStatus:'acknowledged'}});assert.deepEqual(await ids(ack.id),[a.id])
 for(const type of ['constituents','gifts','pledges','plans','consent','interactions','tasks','opportunities']){
  const preview=await h.get('/api/coffer/exports/preview?type='+type+'&list=saved:'+list.id);assert.equal(preview.memberCount,2)
  const csv=await h.request('/api/coffer/exports/'+type+'.csv?list=saved:'+list.id);assert.equal(csv.status,200);assert.ok((await csv.text()).length>0)
 }
 if(process.env.COFFER_LIST_BROWSER){
  const directory=process.env.COFFER_LIST_BROWSER;await mkdir(directory,{recursive:true})
  await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   for(const [name,path] of [['filters','/app/exports?list=search&minGiven=500&givingFrom=2025-01-01&givingThrough=2025-12-31&emailConsent=granted'],['bulk','/app/exports?list=saved:'+list.id],['appeal','/app/appeals/'+appeal.id],['retention','/app/retention?year=2025&list=saved:'+list.id],['tags','/app/donors/'+a.id]]){
    await page.goto(origin+path);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' fits '+width)
    await page.screenshot({path:directory+'/DONOR-007-'+name+'-'+width+'.png',fullPage:true})
   }
  }await page.close()})
 }
 const saved=await archive(h);await run(async fresh=>{await restore(fresh,saved);assert.deepEqual((await fresh.get('/api/coffer/lists/'+list.id+'/members')).donorIds.sort(),[a.id,b.id].sort());await fresh.command('donor.erase',{donorId:a.id,confirm:'ERASE'});assert.deepEqual((await fresh.get('/api/coffer/lists/'+list.id+'/members')).donorIds,[b.id])})
})}
