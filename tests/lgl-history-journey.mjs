import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {run,donor,reviewed,archive,restore} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

const key=n=>'synthetic-coffer-'+n
const email=n=>[key(n),'example.test'].join('@')
const post=(h,action,input,options)=>h.api('/api/coffer/move-in/'+action,input,options)
const sourceHistory=(h,id,options)=>h.get('/api/coffer/move-in/source-history?donorId='+id,options)
async function apply(h,p){let job=await post(h,'apply',{id:p.id,fingerprint:p.fingerprint,acknowledged:'no'});while(job.state==='applying')job=await post(h,'continue',{id:p.id});return job}

// Configured LGL report labels are described in ./docs/MOVE-IN-SOURCES.md.
export async function lglHistoryJourney(reportFiles){
 for(const format of ['csv','xlsx'])await run(async h=>{
  await reviewed(h)
  const constituents=[['LGL Constituent ID','Prefix','First Name','Middle Name','Last Name','Suffix','Short Salutation','Long Salutation','Addressee','Email','Email Type','Email 2','Email 2 Type','Email 2 Primary','Email 3','Email 3 Type','Address','City','State','ZIP','Address Type','Address 2 Street','Address 2 City','Address 2 State','Address 2 Postal Code','Address 2 Type','Email Preference','Mail Preference','SMS Preference','Phone Preference','Preference Date','Communication Tags','Phone'],
   [key(2701),'Dr.','Avery','June','Reed','Jr.',' Avery & friends ',' Dr. Avery  Reed ',' The Avery Reed household ',email(2701),'personal',email(2702),'work','Yes',email(2703),'other','1 Main Street','Springfield','IL','62701','home','2 Lake Street','Madison','WI','53703','vacation','yes','yes','unknown','no','2026-09-01','Do not solicit',''],
   [key(2702),'','Blake','','Rain','','Blake','Blake Rain','Blake Rain',email(2704),'personal','','','','','','3 Main Street','Springfield','IL','62701','home','','','','','','unknown','no','unknown','no','2026-09-01','','+12025552702'],
   [key(2703),'','Cleo','','Chen','','Cleo','Cleo Chen','Cleo Chen',email(2705),'personal','','','','','','4 Main Street','Springfield','IL','62701','home','','','','','','yes','yes','unknown','unknown','2026-09-01','','']]
  const plans=[['LGL Recurring Gift ID','LGL Constituent ID','Amount','Frequency','Plan Status','Payment Method','Campaign','Next Charge Date','Processor Customer Reference','Processor Payment Method Reference'],[key(2711),key(2701),'12','monthly','active','card','Library','2026-11-01',key(2712),key(2713)],[key(2714),key(2702),'24','annual','paused','bank transfer','Lessons','',key(2715),key(2716)]]
  const gifts=[['LGL Gift ID','LGL Constituent ID','Gift Type','Gift Date','Amount','Fund','Payment Method','Deductible Amount','Acknowledgment Template','Do Not Acknowledge via LGL','Acknowledgment Date','Tribute Hon./Mem. Name','Tribute Dedication','Tribute Recipient Name','Tribute Name'],[key(2721),key(2701),'Gift','2026-09-01','500','Library','check','500','Spring thank-you','','2026-09-02','Jordan Reed','In Memory Of','River Reed',key(2729)],[key(2722),key(2701),'Gift','2026-09-03','500','Lessons','check','440','','Yes','','','','',''],[key(2723),key(2703),'Gift','2026-09-04','500','Library','cash','500','','','','','','','']]
  const credits=[['Soft Credit ID','LGL Constituent ID','Related Gift ID','Soft Credit Amount','Acknowledgment Status','Acknowledgment Date','Acknowledgment Method','Acknowledgment Interaction ID'],[key(2731),key(2702),key(2721),'100','acknowledged','2026-09-06','phone call',key(2732)]]
  const notes=[['Contact Report ID','LGL Constituent ID','Contact Report Date','Contact Report Type','Note'],[key(2732),key(2702),'2026-09-06','call','Independent source credit thank-you']]
  const tables=[['constituents',constituents],['recurring',plans],['gifts',gifts],['soft-credits',credits],['contacts',notes]]
  const input={source:'lgl',files:await reportFiles(tables,format)}
  for(const [index,value,code] of [[7,'sometime','DATE'],[8,'1234567890123456','PLAN_REFERENCE']]){
   const broken=structuredClone(plans);broken[1][index]=value
   const bad=await post(h,'preview',{...input,files:await reportFiles(tables.map(([name,rows])=>[name,name==='recurring'?broken:rows]),format)})
   assert.equal(bad.canApply,false);assert.ok(bad.diagnostics.some(d=>d.code===code),JSON.stringify(bad.diagnostics));await post(h,'apply',{id:bad.id,fingerprint:bad.fingerprint,acceptedReason:'No waiver for invalid history'},{status:409})
  }
  const duplicate=await post(h,'preview',{...input,files:await reportFiles([...tables.filter(([name])=>name!=='recurring'),['recurring',[...plans,plans[1]]]],format)})
  assert.equal(duplicate.canApply,false);assert.ok(duplicate.diagnostics.some(d=>d.code==='DUPLICATE_ID'))
  const p=await post(h,'preview',input)
  assert.equal(p.canApply,true,JSON.stringify(p.diagnostics));assert.equal(p.needsAcceptance,false,JSON.stringify(p.unmapped));assert.equal(p.counts.recurringReferences,2);assert.equal(p.counts.channelPreferences,12)
  assert.equal(p.sourceTotals.amountCents,150000);assert.equal(p.sourceTotals.giftCount,3);assert.deepEqual(p.sourceTotals.byFund,{Library:{giftCount:2,amountCents:100000},Lessons:{giftCount:1,amountCents:50000}})
  assert.equal((await h.get('/api/coffer/donors')).total,0,'Review creates no constituent, permission or billing record')
  const member=await h.person(email(2791)),admin=await h.person(email(2792),'admin')
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  await post(h,'preview',input,{as:admin.cookie,status:401});await post(h,'apply',{id:p.id,fingerprint:p.fingerprint},{as:member.cookie,status:403})
  await post(h,'apply',{id:p.id,fingerprint:'stale-review'},{status:409});assert.equal((await h.get('/api/coffer/donors')).total,0)
  if(format==='csv')await historyBrowser(h,p,null,'review')
  await apply(h,p)
  const people=await Promise.all((await h.get('/api/coffer/donors')).donors.map(d=>h.get('/api/coffer/donors/'+d.id))),find=n=>people.find(d=>d.donor.source_ref==='lgl:'+key(n))
  const a=find(2701),b=find(2702),c=find(2703)
  assert.deepEqual([a.donor.prefix,a.donor.first_name,a.donor.middle_name,a.donor.last_name,a.donor.suffix],['Dr.','Avery','June','Reed','Jr.'])
  assert.deepEqual([a.donor.informal_salutation,a.donor.formal_salutation,a.donor.envelope_name],[' Avery & friends ',' Dr. Avery  Reed ',' The Avery Reed household '],'Source greetings remain verbatim')
  assert.equal(a.contactPoints.length,5);assert.deepEqual(a.contactPoints.filter(p=>p.kind==='email').map(p=>[p.value,p.type,p.is_primary]).sort(),[[email(2701),'personal',0],[email(2702),'work',1],[email(2703),'other',0]].sort());assert.deepEqual(a.contactPoints.filter(p=>p.kind==='address').map(p=>[p.type,p.is_primary]).sort(),[['home',1],['vacation',0]].sort())
  assert.deepEqual(Object.fromEntries(b.consents.map(p=>[p.channel,p.status])),{email:'unknown',mail:'withdrawn',sms:'unknown',phone:'withdrawn'});assert.ok(b.consents.every(p=>p.captured_on==='2026-09-01'&&p.recorded_at&&p.method==='lgl export'))
  const state=await sourceHistory(h,a.donor.id),bank=await sourceHistory(h,b.donor.id)
  assert.deepEqual(state.plans.map(p=>[p.source_id,p.amount_cents,p.frequency,p.customer_reference,p.payment_method_reference,p.next_on]),[[key(2711),1200,'monthly',key(2712),key(2713),'2026-11-01']]);assert.equal(bank.plans[0].method,'bank transfer');assert.equal(bank.plans[0].next_on,null)
  assert.equal(a.subscriptions.length,0);assert.equal(b.subscriptions.length,0,'Opaque source references authorize no replacement billing')
  await sourceHistory(h,a.donor.id,{as:member.cookie,status:403});await sourceHistory(h,a.donor.id,{as:admin.cookie,status:401})
  const gift=n=>[...a.gifts,...c.gifts].find(g=>g.reference==='lgl:'+key(n))
  assert.equal(gift(2721).acknowledgment.status,'acknowledged');assert.equal(gift(2721).acknowledgment.source_reference,'Spring thank-you');assert.equal(gift(2722).acknowledgment.status,'do not acknowledge');assert.equal(gift(2722).goods_cents,6000);assert.equal(gift(2723).acknowledgment.status,'not acknowledged')
  assert.deepEqual((await h.get('/api/coffer/letters')).due.map(g=>g.reference),['lgl:'+key(2723)])
  const soft=b.giftDepth.creditedGifts[0];assert.equal(soft.amount_cents,10000);assert.equal(soft.acknowledgment.link.id,b.depth.interactions.find(i=>i.notes==='Independent source credit thank-you').id)
  const tribute=(await h.get('/api/coffer/tributes')).groups.find(g=>g.honoree==='Jordan Reed');assert.equal(tribute.totalCents,50000);assert.equal(a.giftDepth.tributes[0].amount_permission,0)
  assert.equal((await sourceHistory(h,a.donor.id)).outreach.email.excluded['do not solicit'],1);assert.equal(bank.outreach.email.excluded['no consent recorded'],1);assert.equal(bank.outreach.mail.excluded['consent withdrawn'],1)
  const saved=await archive(h)
  const appeal=await h.command('appeal.prepare',{name:'First LGL appeal',channel:'email'});assert.equal(appeal.recipients,1);assert.equal(appeal.excluded['do not solicit'],1);assert.equal(appeal.excluded['no consent recorded'],1);await h.command('appeal.discard',{appealId:appeal.id,version:1})
  assert.equal((await h.command('appeal.prepare',{name:'Postal history still needs processing',channel:'mail'},{status:409})).error,'NCOA_NOT_CONNECTED')
  const sms=await h.command('sms.prepare',{name:'Source unknown SMS',purpose:'appeal',donorIds:[b.donor.id],body:'Support the reading room.'});assert.equal(sms.recipients,0);assert.deepEqual(sms.excluded.map(r=>r.reason),['no SMS consent recorded'])
  const journal=await h.get('/api/coffer/move-in/journal?id='+p.id);assert.equal(journal.job.check_report.matches,true,JSON.stringify(journal.job.check_report));assert.equal(journal.records.find(r=>r.kind==='recurringReference').n,2)
  if(format==='csv')await historyBrowser(h,p,a.donor.id,'native')
  await run(async fresh=>{await restore(fresh,saved);assert.deepEqual((await sourceHistory(fresh,a.donor.id)).plans,state.plans);assert.deepEqual((await fresh.get('/api/coffer/donors/'+a.donor.id)).gifts,a.gifts);assert.deepEqual((await fresh.get('/api/coffer/donors/'+b.donor.id)).consents,b.consents);await post(fresh,'undo',{id:p.id});assert.equal((await fresh.get('/api/coffer/donors')).total,0);assert.equal((await sourceHistory(fresh,a.donor.id)).plans.length,0)},{entry:'tests/fixed-clock-worker.ts'})
  assert.equal((await apply(h,await post(h,'preview',input))).unchanged,true);assert.deepEqual((await sourceHistory(h,a.donor.id)).plans,state.plans)
  await h.command('consent.record',{donorIds:[b.donor.id],channel:'email',status:'withdrawn',method:'paper form',evidence:key(2790),capturedOn:'2026-09-02'})
  const changed=structuredClone(constituents);changed[2][26]='yes'
  const stale=await post(h,'preview',{...input,files:await reportFiles(tables.map(([name,rows])=>[name,name==='constituents'?changed:rows]),format)})
  assert.equal(stale.canApply,false,'Later source files cannot overwrite a native choice');await post(h,'apply',{id:stale.id,fingerprint:stale.fingerprint},{status:409});await post(h,'undo',{id:p.id},{status:409})
  const target=await donor(h,'Synthetic LGL survivor',{email:email(2793)})
  const comparison=await h.get('/api/coffer/duplicates/compare?source='+a.donor.id+'&target='+target.id)
  const merge=await h.command('donor.merge',{sourceDonorId:a.donor.id,donorId:target.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  assert.deepEqual((await sourceHistory(h,target.id)).plans,state.plans.map(p=>({...p,donor_id:target.id})));await post(h,'undo',{id:p.id},{status:409})
  await h.command('donor.unmerge',{mergeId:merge.mergeId,reason:'incorrect_match'});assert.deepEqual((await sourceHistory(h,a.donor.id)).plans,state.plans)
  await h.command('donor.erase',{donorId:a.donor.id,confirm:'ERASE'});assert.equal((await sourceHistory(h,a.donor.id)).plans.length,0)
  const erased=JSON.stringify(await archive(h));assert.ok(!erased.includes(key(2712))&&!erased.includes(key(2713)),'Erasure removes source instrument references from private archive and review custody')
  const replay=await post(h,'preview',input);assert.equal(replay.canApply,false);await post(h,'apply',{id:replay.id,fingerprint:replay.fingerprint},{status:409})
 },{entry:'tests/fixed-clock-worker.ts'})
}

async function historyBrowser(h,p,donorId,phase){
 const directory=process.env.COFFER_LGL_HISTORY_PROOF
 if(directory)await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  for(const width of directory?[1440,390]:[1440]){
   await page.setViewportSize({width,height:1000})
   if(phase==='review'){
    await page.goto(origin+'/app/move-in/crm/review?id='+p.id)
    await page.getByText('Channel preferences · 12',{exact:true}).click();await page.getByText(/email: unknown/).first().waitFor()
    await page.getByText('Recurring source evidence · 2',{exact:true}).click();await page.getByText(/Evidence only; no replacement schedule is active/).first().waitFor()
   }else{
    await page.goto(origin+'/app/move-in/crm/journal?id='+p.id);await page.getByText(/Source plans are evidence only/).waitFor()
    await page.goto(origin+'/app/donors/'+donorId);await page.getByText('Name parts and household eligibility',{exact:true}).click();assert.equal(await page.getByLabel('Informal salutation',{exact:true}).inputValue(),' Avery & friends ')
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'LGL history fits '+width)
   if(directory)await page.screenshot({path:`${directory}/MOVE-001-history-${phase}-${width}.png`,fullPage:true})
  }
  await page.close()
 })
}
