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
  await h.command('tag.define',{name:'Reading circle'})
  const constituents=[['LGL Constituent ID','Prefix','First Name','Middle Name','Last Name','Suffix','Short Salutation','Long Salutation','Addressee','Email','Email Type','Email 2','Email 2 Type','Email 2 Primary','Email 3','Email 3 Type','Address','City','State','ZIP','Address Type','Address 2 Street','Address 2 City','Address 2 State','Address 2 Postal Code','Address 2 Type','Email Preference','Mail Preference','SMS Preference','Phone Preference','Preference Date','Communication Tags','Phone'],
   [key(2701),'Dr.','Avery','June','Reed','Jr.',' Avery & friends ',' Dr. Avery  Reed ',' The Avery Reed household ',email(2701),'personal',email(2702),'work','Yes',email(2703),'other','1 Main Street','Springfield','IL','62701','home','2 Lake Street','Madison','WI','53703','vacation','yes','yes','unknown','no','2026-09-01','Do not solicit;Reading supporter',''],
   [key(2702),'','Blake','','Rain','','Blake','Blake Rain','Blake Rain',email(2704),'personal','','','','','','3 Main Street','Springfield','IL','62701','home','','','','','','unknown','no','unknown','no','2026-09-01','','+12025552702'],
   [key(2703),'','Cleo','','Chen','','Cleo','Cleo Chen','Cleo Chen',email(2705),'personal','','','','','','4 Main Street','Springfield','IL','62701','home','','','','','','yes','yes','unknown','unknown','2026-09-01','','']]
  constituents[0].push('Email 4','Email 4 Type','Address 3 Street','Address 3 City','Address 3 State','Address 3 Postal Code','Address 3 Type','Phone 4','Phone 4 Type','Phone 4 Primary')
  constituents[1].push(email(2717),'other','5 Office Street','Springfield','IL','62701','work','+12025552704','work','Yes')
  constituents[0].push('Communication Restriction Date');constituents[1].push('2026-09-01')
  const plans=[['LGL Recurring Gift ID','LGL Constituent ID','Amount','Frequency','Plan Status','Payment Method','Campaign','Next Charge Date','Processor Customer Reference','Processor Payment Method Reference'],[key(2711),key(2701),'12','monthly','active','card','Library','2026-11-01',key(2712),key(2713)],[key(2714),key(2702),'24','annual','paused','bank transfer','Lessons','',key(2715),key(2716)]]
  const gifts=[['LGL Gift ID','LGL Constituent ID','Gift Type','Gift Date','Amount','Fund','Payment Method','Deductible Amount','Acknowledgment Template','Do Not Acknowledge via LGL','Acknowledgment Date','Tribute Hon./Mem. Name','Tribute Dedication','Tribute Recipient Name','Tribute Name'],[key(2721),key(2701),'Gift','2026-09-01','500','Library','check','500','Spring thank-you','','2026-09-02','Jordan Reed','In Memory Of','River Reed',key(2729)],[key(2722),key(2701),'Gift','2026-09-03','500','Lessons','check','440','','Yes','','','','',''],[key(2723),key(2703),'Gift','2026-09-04','500','Library','cash','500','','','','','','','']]
  // LGL records a split donation as distinct gifts, with a shared check number.
  gifts[0].push('Check No.');gifts[1][4]='300';gifts[1][7]='300';gifts[1].push('synthetic-coffer-2740')
  const otherPart=[...gifts[1]];otherPart[0]=key(2724);otherPart[4]='200';otherPart[5]='Lessons';otherPart[7]='200';gifts.push(otherPart)
  const giftWidth=gifts[0].length,historyIds=['LGL Membership ID','LGL Mailing ID','LGL Volunteer ID','LGL Recurring Gift ID']
  for(const row of gifts.slice(1)){while(row.length<giftWidth)row.push('');row.push(...historyIds.map(()=>''))}gifts[0].push(...historyIds)
  const credits=[['Soft Credit ID','LGL Constituent ID','Related Gift ID','Soft Credit Amount','Acknowledgment Status','Acknowledgment Date','Acknowledgment Method','Acknowledgment Interaction ID'],[key(2731),key(2702),key(2721),'100','acknowledged','2026-09-06','phone call',key(2732)]]
  const notes=[['Contact Report ID','LGL Constituent ID','Contact Report Date','Contact Report Type','Note'],[key(2732),key(2702),'2026-09-06','call','Independent source credit thank-you']]
  const memberships=[['LGL Membership ID','LGL Constituent ID','Membership Level','Membership Start Date','Membership End Date','Membership Status','Membership Notes'],[key(2801),key(2701),'Library friend','2025-09-01','2026-09-01','expired','Historical membership record'],[key(2802),key(2702),'Volunteer supporter','2026-09-01','','','Source end date unknown'],[key(2803),key(2703),'Library friend','2026-11-01','2027-11-01','future','Reviewed future membership'],[key(2804),key(2701),'Library friend','2026-10-01','2026-10-17','active','Source period ends today']]
  const mailings=[['LGL Mailing ID','LGL Constituent ID','Mailing Name','Mailing Date','Mailing Channel','Mailing Status','Mailing Notes'],[key(2811),key(2701),'Summer letter','2026-08-01','mail','sent','Private source mailing note'],[key(2812),key(2702),'Program update','2026-08-03','email','opened','Source-reported open only'],[key(2811),key(2702),'Summer letter','2026-08-01','mail','sent','Same mailing to a second constituent']]
  mailings[0].push('Mailing Subject','Mailing Template','Mailing Content','Mailing Sent Date','Mailing Recipient Name','Mailing Recipient Email','Mailing Recipient Address')
  mailings[1].push('Your summer library update','Summer letter template',' Dear source friend,\nPrivate historical content. ','2026-08-02',' Original recipient name ',email(2830),' Original source postal address ')
  const controls=[['Year','Fund','Gift Count','Total Gift Amount'],['2026','','4','1500'],['','Library','2','800'],['','Lessons','2','700']]
  const tables=[['controls',controls],['memberships',memberships],['mailings',mailings],['constituents',constituents],['recurring',plans],['gifts',gifts],['soft-credits',credits],['contacts',notes]]
  const input={source:'lgl',solicitCodes:{'Reading supporter':{type:'tag',tag:'Reading circle'}},files:await reportFiles(tables,format)}
  for(const [index,column] of historyIds.entries()){
   const mixed=structuredClone(gifts);mixed[1][mixed[0].indexOf(column)]=key(2850+index)
   const rejected=await post(h,'preview',{...input,files:await reportFiles(tables.filter(([name])=>name!=='controls').map(([name,rows])=>[name,name==='gifts'?mixed:rows]),format)})
   assert.equal(rejected.canApply,false,'A gift carrying another record identity cannot become history instead of cash')
   assert.ok(rejected.diagnostics.some(d=>d.code==='AMBIGUOUS_RECORD'&&d.row===2),JSON.stringify(rejected.diagnostics))
   await post(h,'apply',{id:rejected.id,fingerprint:rejected.fingerprint,acceptedReason:'Cannot waive mixed financial identity'},{status:409})
   assert.equal((await h.get('/api/coffer/donors')).total,0)
  }
  const mixedHistory=[...memberships.map(r=>[...r])]
  mixedHistory[0].push('LGL Mailing ID');mixedHistory[1].push(key(2891))
  const mixedReview=await post(h,'preview',{...input,files:await reportFiles(tables.map(([name,rows])=>[name,name==='memberships'?mixedHistory:rows]),format)})
  assert.equal(mixedReview.canApply,false);assert.ok(mixedReview.diagnostics.some(d=>d.code==='AMBIGUOUS_RECORD'&&d.row===2))
  await post(h,'apply',{id:mixedReview.id,fingerprint:mixedReview.fingerprint},{status:409});assert.equal((await h.get('/api/coffer/donors')).total,0)
  for(const [column,value,code] of [['Mailing Sent Date','2026-02-30','DATE'],['Mailing Recipient Email','not an address','MAILING_RECIPIENT']]){
   const changed=structuredClone(mailings);changed[1][changed[0].indexOf(column)]=value
   const bad=await post(h,'preview',{...input,files:await reportFiles(tables.map(([name,rows])=>[name,name==='mailings'?changed:rows]),format)})
   assert.equal(bad.canApply,false);assert.ok(bad.diagnostics.some(d=>d.code===code));await post(h,'apply',{id:bad.id,fingerprint:bad.fingerprint},{status:409})
  }
  for(const [index,value,code] of [[7,'sometime','DATE'],[8,'1234567890123456','PLAN_REFERENCE']]){
   const broken=structuredClone(plans);broken[1][index]=value
   const bad=await post(h,'preview',{...input,files:await reportFiles(tables.map(([name,rows])=>[name,name==='recurring'?broken:rows]),format)})
   assert.equal(bad.canApply,false);assert.ok(bad.diagnostics.some(d=>d.code===code),JSON.stringify(bad.diagnostics));await post(h,'apply',{id:bad.id,fingerprint:bad.fingerprint,acceptedReason:'No waiver for invalid history'},{status:409})
  }
  const duplicate=await post(h,'preview',{...input,files:await reportFiles([...tables.filter(([name])=>name!=='recurring'),['recurring',[...plans,plans[1]]]],format)})
  assert.equal(duplicate.canApply,false);assert.ok(duplicate.diagnostics.some(d=>d.code==='DUPLICATE_ID'))
  for(const [name,rows,code] of [['memberships',[memberships[0],[...memberships[1].slice(0,4),'2024-09-01',...memberships[1].slice(5)]],'MEMBERSHIP_DATES'],['mailings',[mailings[0],[...mailings[1].slice(0,4),'sms',...mailings[1].slice(5)]],'MAILING_CHANNEL'],['mailings',[mailings[0],['',...mailings[1].slice(1)]],'REQUIRED']]){
   const invalid=await post(h,'preview',{...input,files:await reportFiles(tables.map(([n,r])=>[n,n===name?rows:r]),format)})
   assert.equal(invalid.canApply,false);assert.ok(invalid.diagnostics.some(d=>d.code===code),JSON.stringify(invalid.diagnostics));await post(h,'apply',{id:invalid.id,fingerprint:invalid.fingerprint},{status:409});assert.equal((await h.get('/api/coffer/donors')).total,0)
  }
  const p=await post(h,'preview',input)
  assert.equal(p.canApply,true,JSON.stringify(p.diagnostics));assert.equal(p.needsAcceptance,false,JSON.stringify(p.unmapped));assert.equal(p.counts.sourceTags,1);assert.equal(p.counts.sourceHistory,7);assert.equal(p.counts.recurringReferences,2);assert.equal(p.counts.channelPreferences,12)
  assert.equal(p.sourceTotals.amountCents,150000);assert.equal(p.sourceTotals.giftCount,4);assert.ok(p.controlTotals.every(c=>c.matches));assert.deepEqual(p.sourceTotals.byFund,{Library:{giftCount:2,amountCents:80000},Lessons:{giftCount:2,amountCents:70000}})
  assert.equal((await h.get('/api/coffer/donors')).total,0,'Review creates no constituent, permission or billing record')
  const member=await h.person(email(2791)),admin=await h.person(email(2792),'admin')
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  await post(h,'preview',input,{as:admin.cookie,status:401});await post(h,'apply',{id:p.id,fingerprint:p.fingerprint},{as:member.cookie,status:403})
  await post(h,'apply',{id:p.id,fingerprint:'stale-review'},{status:409});assert.equal((await h.get('/api/coffer/donors')).total,0)
  if(format==='csv')await historyBrowser(h,p,null,'review',input)
  await apply(h,p)
  const people=await Promise.all((await h.get('/api/coffer/donors')).donors.map(d=>h.get('/api/coffer/donors/'+d.id))),find=n=>people.find(d=>d.donor.source_ref==='lgl:'+key(n))
  const a=find(2701),b=find(2702),c=find(2703)
  assert.deepEqual([a.donor.prefix,a.donor.first_name,a.donor.middle_name,a.donor.last_name,a.donor.suffix],['Dr.','Avery','June','Reed','Jr.'])
  assert.deepEqual([a.donor.informal_salutation,a.donor.formal_salutation,a.donor.envelope_name],[' Avery & friends ',' Dr. Avery  Reed ',' The Avery Reed household '],'Source greetings remain verbatim')
  assert.equal(a.contactPoints.length,8);assert.deepEqual(a.contactPoints.filter(p=>p.kind==='email').map(p=>[p.value,p.type,p.is_primary]).sort(),[[email(2701),'personal',0],[email(2702),'work',1],[email(2703),'other',0],[email(2717),'other',0]].sort());assert.deepEqual(a.contactPoints.filter(p=>p.kind==='address').map(p=>[p.type,p.is_primary]).sort(),[['home',1],['vacation',0],['work',0]].sort())
  assert.deepEqual(a.contactPoints.filter(p=>p.kind==='phone').map(p=>[p.value,p.type,p.is_primary]),[['+12025552704','work',1]])
  assert.equal((await h.get('/api/coffer/donors?q='+encodeURIComponent(email(2717)))).donors[0].id,a.donor.id)
  assert.deepEqual(Object.fromEntries(b.consents.map(p=>[p.channel,p.status])),{email:'unknown',mail:'withdrawn',sms:'unknown',phone:'withdrawn'});assert.ok(b.consents.every(p=>p.captured_on==='2026-09-01'&&p.recorded_at&&p.method==='lgl export'))
  assert.deepEqual(a.ruleTags.map(t=>t.tag),['Reading circle'])
  const state=await sourceHistory(h,a.donor.id),bank=await sourceHistory(h,b.donor.id)
  assert.deepEqual(state.plans.map(p=>[p.source_id,p.amount_cents,p.frequency,p.customer_reference,p.payment_method_reference,p.next_on]),[[key(2711),1200,'monthly',key(2712),key(2713),'2026-11-01']]);assert.equal(bank.plans[0].method,'bank transfer');assert.equal(bank.plans[0].next_on,null)
  assert.deepEqual(state.tags.map(t=>[t.tag,t.source,t.source_on,t.owns_assignment,t.native_changed]),[['Reading circle','lgl','2026-09-01',1,0]])
  assert.deepEqual(state.history.map(r=>[r.source_id,r.kind,r.label,r.occurred_on]).sort(),[[key(2801),'membership','Library friend','2025-09-01'],[key(2811),'mailing','Summer letter','2026-08-01'],[key(2804),'membership','Library friend','2026-10-01']].sort())
  assert.deepEqual(JSON.parse(state.history.find(r=>r.kind==='membership').payload),{level:'Library friend',status:'expired',startsOn:'2025-09-01',expiresOn:'2026-09-01',notes:'Historical membership record'})
  const mailing=JSON.parse(state.history.find(r=>r.kind==='mailing').payload)
  assert.deepEqual(mailing,{channel:'mail',status:'sent',notes:'Private source mailing note',subject:'Your summer library update',content:' Dear source friend,\nPrivate historical content. ',template:'Summer letter template',sentOn:'2026-08-02',recipientName:' Original recipient name ',recipientEmail:email(2830),recipientAddress:' Original source postal address '})
  assert.ok(!a.contactPoints.some(p=>p.value===email(2830)),'A historical mailing recipient does not become a contact or grant consent')
  const ordinary=await (await h.request('/app/donors/'+a.donor.id,{as:member.cookie})).text();assert.ok(!ordinary.includes('Private historical content')&&!ordinary.includes(email(2830)),'Private source mailing snapshots stay outside ordinary staff timelines')
  assert.equal(JSON.parse(bank.history.find(r=>r.kind==='membership').payload).expiresOn,null);assert.equal(JSON.parse(bank.history.find(r=>r.kind==='membership').payload).status,'unknown');assert.equal(bank.history.filter(r=>r.kind==='mailing').length,2,'A shared mailing ID retains each separate source recipient')
  assert.match(await (await h.request('/app/donors/'+a.donor.id+'?timelineKind=note')).text(),/Imported Little Green Light membership · Library friend/)
  assert.match(await (await h.request('/app/donors/'+a.donor.id+'?timelineKind=note')).text(),/Private source mailing note/)
  const membership=await h.get('/api/coffer/memberships');assert.equal(membership.memberships.length,0,'Source membership history does not create an active billing entitlement')
  assert.deepEqual(membership.sourceMemberships.map(m=>[m.sourceId,m.state]).sort(),[[key(2801),'ended'],[key(2802),'no-end-recorded'],[key(2803),'not-started'],[key(2804),'ends-today']].sort())
  assert.deepEqual(membership.sourceCounts.map(c=>[c.level,c.people,c.states.ended,c.states['not-started'],c.states['no-end-recorded'],c.states['ends-today']]),[['Library friend',2,0,1,0,1],['Volunteer supporter',1,0,0,1,0]])
  await h.get('/api/coffer/memberships',{as:member.cookie,status:403});await h.get('/api/coffer/memberships',{as:admin.cookie,status:401})
  assert.equal(a.subscriptions.length,0);assert.equal(b.subscriptions.length,0,'Opaque source references authorize no replacement billing')
  await sourceHistory(h,a.donor.id,{as:member.cookie,status:403});await sourceHistory(h,a.donor.id,{as:admin.cookie,status:401})
  const gift=n=>[...a.gifts,...c.gifts].find(g=>g.reference.split(' / ')[0]==='lgl:'+key(n))
  assert.deepEqual([gift(2721),gift(2724)].map(g=>[g.amount_cents,g.fund,g.reference.split(' / ')[1]]),[[30000,'Library','synthetic-coffer-2740'],[20000,'Lessons','synthetic-coffer-2740']])
  assert.notEqual(gift(2721).id,gift(2724).id,'A shared check number cannot combine distinct LGL gift IDs')
  const funds=(await h.get('/api/coffer/reports/funds')).funds;assert.deepEqual(funds.map(f=>[f.fund,f.amount_cents]).sort(),[['Library',80000],['Lessons',70000]].sort())
  assert.equal([...a.gifts,...c.gifts].length,4);assert.equal([...a.gifts,...c.gifts].reduce((n,g)=>n+g.amount_cents,0),150000)
  assert.equal(gift(2721).acknowledgment.status,'acknowledged');assert.equal(gift(2721).acknowledgment.source_reference,'Spring thank-you');assert.equal(gift(2722).acknowledgment.status,'do not acknowledge');assert.equal(gift(2722).goods_cents,6000);assert.equal(gift(2723).acknowledgment.status,'not acknowledged')
  assert.deepEqual((await h.get('/api/coffer/letters')).due.map(g=>g.reference),['lgl:'+key(2723)])
  const soft=b.giftDepth.creditedGifts[0];assert.equal(soft.amount_cents,10000);assert.equal(soft.acknowledgment.link.id,b.depth.interactions.find(i=>i.notes==='Independent source credit thank-you').id)
  const tribute=(await h.get('/api/coffer/tributes')).groups.find(g=>g.honoree==='Jordan Reed');assert.equal(tribute.totalCents,50000);assert.equal(a.giftDepth.tributes[0].amount_permission,0)
  assert.equal((await sourceHistory(h,a.donor.id)).outreach.email.excluded['do not solicit'],1);assert.equal(bank.outreach.email.excluded['no consent recorded'],1);assert.equal(bank.outreach.mail.excluded['consent withdrawn'],1)
  const historyReuse=await post(h,'preview',{...input,solicitCodes:undefined,files:await reportFiles([...tables,['extra-note',[['LGL Constituent ID','Note ID','Note'],[key(2703),key(2821),'Additional source note']]]],format)})
  assert.equal(historyReuse.canApply,true,JSON.stringify(historyReuse.diagnostics));await apply(h,historyReuse);assert.equal((await sourceHistory(h,a.donor.id)).history.length,3);assert.equal((await h.get('/api/coffer/donors/'+a.donor.id)).ruleTags.filter(t=>t.tag==='Reading circle').length,1)
  await post(h,'undo',{id:p.id},{status:409});await post(h,'undo',{id:historyReuse.id})
  const saved=await archive(h)
  const appeal=await h.command('appeal.prepare',{name:'First LGL appeal',channel:'email'});assert.equal(appeal.recipients,1);assert.equal(appeal.excluded['do not solicit'],1);assert.equal(appeal.excluded['no consent recorded'],1);await h.command('appeal.discard',{appealId:appeal.id,version:1})
  assert.equal((await h.command('appeal.prepare',{name:'Postal history still needs processing',channel:'mail'},{status:409})).error,'NCOA_NOT_CONNECTED')
  const sms=await h.command('sms.prepare',{name:'Source unknown SMS',purpose:'appeal',donorIds:[b.donor.id],body:'Support the reading room.'});assert.equal(sms.recipients,0);assert.deepEqual(sms.excluded.map(r=>r.reason),['no SMS consent recorded'])
  const journal=await h.get('/api/coffer/move-in/journal?id='+p.id);assert.equal(journal.job.check_report.matches,true,JSON.stringify(journal.job.check_report));assert.equal(journal.records.find(r=>r.kind==='recurringReference').n,2);assert.equal(journal.records.find(r=>r.kind==='sourceHistory').n,7);assert.equal(journal.job.check_report.rows.filter(r=>r.scope==='source history'&&r.matches).length,2)
  if(format==='csv')await historyBrowser(h,p,a.donor.id,'native')
  await run(async fresh=>{await restore(fresh,saved);assert.deepEqual((await fresh.get('/api/coffer/memberships')).sourceMemberships,membership.sourceMemberships);assert.deepEqual((await sourceHistory(fresh,a.donor.id)).tags,state.tags);assert.deepEqual((await sourceHistory(fresh,a.donor.id)).history,state.history);assert.deepEqual((await sourceHistory(fresh,a.donor.id)).plans,state.plans);assert.deepEqual((await fresh.get('/api/coffer/donors/'+a.donor.id)).gifts,a.gifts);assert.deepEqual((await fresh.get('/api/coffer/donors/'+b.donor.id)).consents,b.consents);await post(fresh,'undo',{id:p.id});assert.equal((await fresh.get('/api/coffer/donors')).total,0);assert.equal((await sourceHistory(fresh,a.donor.id)).plans.length,0);assert.equal((await sourceHistory(fresh,a.donor.id)).history.length,0)},{entry:'tests/fixed-clock-worker.ts'})
  assert.equal((await apply(h,await post(h,'preview',input))).unchanged,true);assert.deepEqual((await sourceHistory(h,a.donor.id)).plans,state.plans)
  await h.command('consent.record',{donorIds:[b.donor.id],channel:'email',status:'withdrawn',method:'paper form',evidence:key(2790),capturedOn:'2026-09-02'})
  const changed=structuredClone(constituents);changed[2][26]='yes'
  const stale=await post(h,'preview',{...input,files:await reportFiles(tables.map(([name,rows])=>[name,name==='constituents'?changed:rows]),format)})
  assert.equal(stale.canApply,false,'Later source files cannot overwrite a native choice');await post(h,'apply',{id:stale.id,fingerprint:stale.fingerprint},{status:409});await post(h,'undo',{id:p.id},{status:409})
  const target=await donor(h,'Synthetic LGL survivor',{email:email(2793)})
  const comparison=await h.get('/api/coffer/duplicates/compare?source='+a.donor.id+'&target='+target.id)
  const merge=await h.command('donor.merge',{sourceDonorId:a.donor.id,donorId:target.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  assert.deepEqual((await sourceHistory(h,target.id)).tags,state.tags.map(t=>({...t,donor_id:target.id})));assert.deepEqual((await sourceHistory(h,target.id)).history,state.history.map(r=>({...r,donor_id:target.id})));assert.deepEqual((await sourceHistory(h,target.id)).plans,state.plans.map(p=>({...p,donor_id:target.id})));await post(h,'undo',{id:p.id},{status:409})
  assert.equal((await h.get('/api/coffer/memberships')).sourceMemberships.find(m=>m.sourceId===key(2801)).donorId,target.id)
  await h.command('donor.unmerge',{mergeId:merge.mergeId,reason:'incorrect_match'});assert.deepEqual((await sourceHistory(h,a.donor.id)).plans,state.plans);assert.deepEqual((await sourceHistory(h,a.donor.id)).history,state.history)
  await h.command('donor.erase',{donorId:a.donor.id,confirm:'ERASE'});assert.equal((await sourceHistory(h,a.donor.id)).plans.length,0);assert.equal((await sourceHistory(h,a.donor.id)).history.length,0);assert.equal((await sourceHistory(h,a.donor.id)).tags.length,0)
  assert.equal((await h.get('/api/coffer/memberships')).sourceMemberships.some(m=>m.donorId===a.donor.id),false)
  const erased=JSON.stringify(await archive(h));assert.ok(!erased.includes('Private source mailing note')&&!erased.includes('Historical membership record')&&!erased.includes('Private historical content')&&!erased.includes(email(2830)));assert.ok(!erased.includes(key(2712))&&!erased.includes(key(2713)),'Erasure removes source instrument references from private archive and review custody')
  const replay=await post(h,'preview',input);assert.equal(replay.canApply,false);await post(h,'apply',{id:replay.id,fingerprint:replay.fingerprint},{status:409})
 },{entry:'tests/fixed-clock-worker.ts'})
 for(const group of [[contactEnrichmentJourney,lglAddressJourney],[tagCustodyJourney,tagPartsJourney]]){
  const finished=await Promise.allSettled(group.map(journey=>journey(reportFiles)))
  const failed=finished.filter(result=>result.status==='rejected')
  if(failed.length)throw new AggregateError(failed.map(result=>result.reason),'LGL source custody journeys failed')
 }
}

async function historyBrowser(h,p,donorId,phase,input){
 const directory=process.env.COFFER_LGL_HISTORY_PROOF
 if(directory)await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  for(const width of directory?[1440,390]:[1440]){
   await page.setViewportSize({width,height:1000})
   if(phase==='review'){
    await page.goto(origin+'/app/move-in/crm')
    const form=page.locator('form').filter({has:page.locator('select[name=source]')})
    await form.locator('select[name=source]').selectOption('lgl')
    await form.getByText('Map organization-specific communication codes',{exact:true}).click()
    await form.getByLabel('Code meanings',{exact:true}).fill('Reading supporter = tag Reading circle')
    await form.locator('input[name=exports]').setInputFiles(input.files.map(f=>({name:f.name,mimeType:'text/csv',buffer:Buffer.from(f.base64,'base64')})))
    await form.getByRole('button',{name:'Preview exports',exact:true}).click()
    await page.getByText('Membership and mailing history · 7',{exact:true}).click();await page.getByText(/Historical membership only/).first().waitFor()
    await page.getByText('Source mailing snapshot',{exact:true}).click();await page.getByText(/Private historical content/).waitFor()
    await page.getByText('Reviewed source tags · 1',{exact:true}).click();await page.getByText(/Reading circle/).first().waitFor()
    await page.getByText('Channel preferences · 12',{exact:true}).click();await page.getByText(/email: unknown/).first().waitFor()
    await page.getByText('Recurring source evidence · 2',{exact:true}).click();await page.getByText(/Evidence only; no replacement schedule is active/).first().waitFor()
   }else{
    await page.goto(origin+'/app/move-in/crm/journal?id='+p.id);await page.getByText(/Source plans are evidence only/).waitFor()
    await page.goto(origin+'/app/giving/memberships');await page.locator('#imported-membership-history').getByText('Library friend',{exact:false}).first().waitFor();if(directory)await page.locator('#imported-membership-history').screenshot({path:`${directory}/MOVE-001-memberships-${width}.png`})
    await page.goto(origin+'/app/donors/'+donorId);await page.getByText('Name parts and household eligibility',{exact:true}).click();assert.equal(await page.getByLabel('Informal salutation',{exact:true}).inputValue(),' Avery & friends ');assert.equal(await page.locator('#timeline').getByText('Imported Little Green Light membership · Library friend',{exact:true}).count(),2)
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'LGL history fits '+width)
   if(directory)await page.screenshot({path:`${directory}/MOVE-001-history-${phase}-${width}.png`,fullPage:true})
  }
  await page.close()
 })
}


async function tagCustodyJourney(reportFiles){
 await run(async h=>{
  const constituents=[['LGL Constituent ID','Name'],[key(2901),'Synthetic existing tagged donor']]
  const input={source:'lgl',files:await reportFiles([['constituents',constituents]],'csv')}
  await apply(h,await post(h,'preview',input))
  const person=(await h.get('/api/coffer/donors')).donors[0]
  const list=await h.command('list.save',{name:'Existing tag review',filters:{q:'Synthetic existing tagged donor'}})
  await h.command('list.bulk',{listId:list.id,version:1,actions:[{type:'tag.add',tag:'Existing native tag'}],reason:key(2902)})
  const source={...input,solicitCodes:{'Source supporter':{type:'tag',tag:'Existing native tag'}},files:await reportFiles([['constituents',[['LGL Constituent ID','Name','Communication Tags','Communication Restriction Date'],[key(2901),'Synthetic existing tagged donor','Source supporter','2026-09-01']]]],'csv')}
  const p=await post(h,'preview',source);assert.equal(p.canApply,true,JSON.stringify(p.diagnostics));await apply(h,p)
  assert.equal((await sourceHistory(h,person.id)).tags[0].owns_assignment,0)
  await post(h,'undo',{id:p.id});assert.deepEqual((await h.get('/api/coffer/donors/'+person.id)).ruleTags.map(t=>t.tag),['Existing native tag'],'Undo preserves the original native assignment')
  const missing=await post(h,'preview',{...source,solicitCodes:{'Source supporter':{type:'tag',tag:'Not yet defined'}}})
  assert.equal(missing.canApply,false);assert.ok(missing.diagnostics.some(d=>d.code==='SOURCE_TAG'));await post(h,'apply',{id:missing.id,fingerprint:missing.fingerprint},{status:409})
  await h.command('tag.define',{name:'Imported native tag'})
  const freshSource={...source,solicitCodes:{'Source supporter':{type:'tag',tag:'Imported native tag'}}}
  const stale=await post(h,'preview',freshSource);assert.equal(stale.canApply,true,JSON.stringify(stale.diagnostics))
  await h.command('tag.category',{name:'New classification'})
  await h.command('tag.define',{name:'Imported native tag',version:1,category:'New classification'})
  await post(h,'apply',{id:stale.id,fingerprint:stale.fingerprint},{status:409});assert.equal((await h.get('/api/coffer/donors/'+person.id)).ruleTags.some(t=>t.tag==='Imported native tag'),false)
  await post(h,'undo',{id:stale.id})
  const current=await post(h,'preview',freshSource);assert.equal(current.canApply,true,JSON.stringify(current.diagnostics));await apply(h,current)
  assert.equal((await sourceHistory(h,person.id)).tags[0].owns_assignment,1)
  await h.command('list.bulk',{listId:list.id,version:1,actions:[{type:'tag.remove',tag:'Imported native tag'}],reason:key(2903)})
  const changed=await post(h,'check',{id:current.id});assert.equal(changed.matches,false);assert.deepEqual(changed.rows.filter(r=>r.scope==='tags').map(r=>[r.sourceCount,r.cofferCount]),[[1,0]])
  await post(h,'undo',{id:current.id},{status:409})
  const later=await post(h,'preview',{...freshSource,files:await reportFiles([['constituents',[['LGL Constituent ID','Name','Communication Tags'],[key(2901),'Synthetic existing tagged donor','Source supporter']]],['note',[['LGL Constituent ID','Note ID','Note'],[key(2901),key(2904),'Later reviewed source note']]]],'csv')})
  assert.equal(later.canApply,false);assert.ok(later.diagnostics.some(d=>d.code==='SOURCE_TAG'));await post(h,'apply',{id:later.id,fingerprint:later.fingerprint},{status:409});assert.equal((await h.get('/api/coffer/donors/'+person.id)).ruleTags.some(t=>t.tag==='Imported native tag'),false,'Replay cannot resurrect a removed native tag')
  await h.command('donor.erase',{donorId:person.id,confirm:'ERASE'})
  assert.equal((await sourceHistory(h,person.id)).tags.length,0)
 },{entry:'tests/fixed-clock-worker.ts'})
}


async function tagPartsJourney(reportFiles){
 await run(async h=>{
  const codes={}
  for(let n=1;n<=8;n++){const tag='Imported group '+n;await h.command('tag.define',{name:tag});codes['Source group '+n]={type:'tag',tag}}
  const rows=[['LGL Constituent ID','Name','Communication Tags','Communication Restriction Date'],...Array.from({length:400},(_,i)=>[key(30000+i),'Synthetic grouped constituent '+i,Object.keys(codes).join(';'),'2026-09-01'])]
  const input={source:'lgl',solicitCodes:codes,files:await reportFiles([['constituents',rows]],'csv')},p=await post(h,'preview',input)
  assert.equal(p.canApply,true,JSON.stringify(p.diagnostics));assert.equal(p.counts.donors,400);assert.equal(p.counts.sourceTags,3200);assert.equal(p.sourceTotals.amountCents,0);assert.equal((await h.get('/api/coffer/donors')).total,0)
  await apply(h,p)
  assert.equal((await h.get('/api/coffer/donors')).total,400)
  for(let n=1;n<=8;n++)assert.equal((await h.get('/api/coffer/donors?tag='+encodeURIComponent('Imported group '+n))).total,400,'Every source assignment reaches the native tag filter')
  const journal=await h.get('/api/coffer/move-in/journal?id='+p.id);assert.equal(journal.records.find(r=>r.kind==='tagAssignment').n,3200);assert.equal(journal.job.check_report.matches,true)
  await post(h,'undo',{id:p.id});assert.equal((await h.get('/api/coffer/donors')).total,0)
 },{entry:'tests/fixed-clock-worker.ts'})
}


export async function contactEnrichmentJourney(reportFiles){
 for(const format of ['csv','xlsx'])await run(async h=>{
  await reviewed(h)
  const initial=[['LGL Constituent ID','Name','Email','Email Type','LGL Volunteer ID','Volunteer Date','Volunteer Role'],[key(3101),'Synthetic LGL contact history',email(3101),'personal','','','']]
  const source=async (rows,withGift=false)=>({source:'lgl',files:await reportFiles([['constituents',rows],...(withGift?[['gifts',[['LGL Gift ID','LGL Constituent ID','Gift Type','Gift Date','Amount','Fund','Payment Method','Deductible Amount'],[key(3110),key(3101),'Gift','2026-09-01','12.34','Library','check','12.34']]]]:[])],format)})
  const first=await post(h,'preview',await source(initial,true));await apply(h,first)
  const person=(await h.get('/api/coffer/donors')).donors[0]
  const original=await h.get('/api/coffer/donors/'+person.id)
  const enriched=[['LGL Constituent ID','Name','Email','Email Type','Email 2','Email 2 Type','Phone','Phone Type','Short Salutation','Long Salutation','Addressee'],[key(3101),'Synthetic LGL contact history',email(3101),'personal',email(3102),'work','+12025553101','work',' Source friend ',' Source formal greeting ',' Source envelope name ']]
  const input=await source(enriched),preview=await post(h,'preview',input)
  assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics));assert.equal(preview.needsAcceptance,false)
  assert.deepEqual((await h.get('/api/coffer/donors/'+person.id)).contactPoints,original.contactPoints,'Preview writes no native contacts')
  if(format==='csv')await contactEnrichmentBrowser(h,preview.id,person.id,'review')
  await apply(h,preview)
  const detail=await h.get('/api/coffer/donors/'+person.id)
  assert.deepEqual(detail.contactPoints.map(p=>[p.kind,p.type,p.value,p.is_primary]).sort(),[['email','personal',email(3101),1],['email','work',email(3102),0],['phone','work','+12025553101',1]].sort())
  assert.equal(detail.donor.phone,'+12025553101');assert.equal(detail.donor.informal_salutation,' Source friend ');assert.equal(detail.donor.formal_salutation,' Source formal greeting ');assert.equal(detail.donor.envelope_name,' Source envelope name ')
  assert.equal(detail.donor.name,original.donor.name)
  assert.equal((await h.get('/api/coffer/donors?q='+encodeURIComponent(email(3102)))).donors[0].id,person.id)
  assert.equal(detail.totals.lifetimeCents,1234);assert.deepEqual(detail.gifts,original.gifts);assert.deepEqual(detail.totals,original.totals)
  assert.equal((await post(h,'apply',{id:preview.id,fingerprint:preview.fingerprint})).unchanged,true)
  const journal=await h.get('/api/coffer/move-in/journal?id='+preview.id)
  assert.equal(journal.records.find(r=>r.kind==='contact').added,2,'Only the new email and phone belong to the enrichment')
  assert.ok(journal.job.report.profileCheckpoints[person.id]);assert.equal(journal.job.check_report.matches,true)
  if(format==='csv')await contactEnrichmentBrowser(h,preview.id,person.id,'native')
  const saved=await archive(h)
  await run(async fresh=>{
   await restore(fresh,saved)
   assert.deepEqual((await fresh.get('/api/coffer/donors/'+person.id)).contactPoints,detail.contactPoints)
   await post(fresh,'undo',{id:preview.id})
   const undone=await fresh.get('/api/coffer/donors/'+person.id)
   assert.deepEqual(undone.contactPoints,original.contactPoints);assert.equal(undone.donor.phone,null);assert.equal(undone.donor.informal_salutation,null)
   await post(fresh,'undo',{id:first.id});assert.equal((await fresh.get('/api/coffer/donors')).total,0)
  },{entry:'tests/fixed-clock-worker.ts'})
  if(format==='csv')await run(async edited=>{
   await restore(edited,saved);await post(edited,'undo',{id:preview.id})
   const previous=await edited.get('/api/coffer/donors/'+person.id)
   await edited.command('donor.update',{donorId:person.id,version:previous.donor.version,name:'Staff chosen source identity',email:previous.donor.email})
   const next=await post(edited,'preview',input);assert.equal(next.canApply,true,JSON.stringify(next.diagnostics));await apply(edited,next)
   assert.equal((await edited.get('/api/coffer/donors/'+person.id)).donor.name,'Staff chosen source identity')
   await post(edited,'undo',{id:next.id})
   assert.equal((await edited.get('/api/coffer/donors/'+person.id)).donor.name,'Staff chosen source identity')
   await post(edited,'undo',{id:first.id},{status:409})
   assert.equal((await edited.get('/api/coffer/donors/'+person.id)).donor.name,'Staff chosen source identity','Enrichment cannot adopt a staff edit into the earlier import ownership')
  },{entry:'tests/fixed-clock-worker.ts'})
  if(format==='csv')await run(async used=>{
   await restore(used,saved)
   await used.command('consent.record',{donorIds:[person.id],channel:'email',status:'granted',method:'paper form',evidence:key(3120),capturedOn:'2026-09-01'})
   const appeal=await used.command('appeal.prepare',{name:'Reviewed work contact appeal',channel:'email',emailType:'work'})
   assert.equal(appeal.recipients,1)
   await post(used,'undo',{id:preview.id},{status:409})
   assert.deepEqual((await used.get('/api/coffer/donors/'+person.id)).contactPoints,detail.contactPoints,'A prepared native use retains every imported contact')
   await used.command('appeal.discard',{appealId:appeal.id,version:1})
  },{entry:'tests/fixed-clock-worker.ts'})
  await post(h,'undo',{id:first.id},{status:409})
  const changed=structuredClone(enriched);changed[1][2]=email(3103)
  const conflicting=await post(h,'preview',await source(changed));assert.equal(conflicting.canApply,false);assert.ok(conflicting.diagnostics.some(d=>d.code==='CONTACT_NATIVE'||d.code==='MOVE_IN_MAPPING'))
  await post(h,'apply',{id:conflicting.id,fingerprint:conflicting.fingerprint},{status:409});assert.deepEqual((await h.get('/api/coffer/donors/'+person.id)).contactPoints,detail.contactPoints)
  const target=await donor(h,'Synthetic contact survivor',{email:email(3104)})
  const comparison=await h.get('/api/coffer/duplicates/compare?source='+person.id+'&target='+target.id)
  const merge=await h.command('donor.merge',{sourceDonorId:person.id,donorId:target.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  await post(h,'undo',{id:preview.id},{status:409})
  await h.command('donor.unmerge',{mergeId:merge.mergeId,reason:'incorrect_match'})
  const current=await h.get('/api/coffer/donors/'+person.id),work=current.contactPoints.find(p=>p.value===email(3102))
  await h.command('contact.save',{donorId:person.id,donorVersion:current.donor.version,contactId:work.id,version:work.version,kind:'email',type:'work',value:email(3105),source:'staff',sourceOn:'2026-10-17'})
  await post(h,'undo',{id:preview.id},{status:409})
  assert.ok((await h.get('/api/coffer/donors/'+person.id)).contactPoints.some(p=>p.value===email(3105)))
  await h.command('donor.erase',{donorId:person.id,confirm:'ERASE'})
  const replay=await post(h,'preview',input);assert.equal(replay.canApply,false);await post(h,'apply',{id:replay.id,fingerprint:replay.fingerprint},{status:409})
  const erased=JSON.stringify(await archive(h));assert.ok(!erased.includes(' Source friend ')&&!erased.includes(email(3102))&&!erased.includes('+12025553101'),'Erasure removes enrichment checkpoints and retained source contacts')
 },{entry:'tests/fixed-clock-worker.ts'})
}


async function contactEnrichmentBrowser(h,reviewId,donorId,phase){
 const directory=process.env.COFFER_LGL_HISTORY_PROOF
 if(directory)await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage();page.setDefaultTimeout(15000)
  for(const width of directory?[1440,390]:[1440]){
   await page.setViewportSize({width,height:1000})
   if(phase==='review'){
    await page.goto(origin+'/app/move-in/crm/review?id='+reviewId)
    await page.getByText('Donors · 1',{exact:true}).click()
    await page.getByText('email · work: '+email(3102),{exact:true}).waitFor()
   }else{
    await page.goto(origin+'/app/donors/'+donorId+'#contact-points')
    await page.locator('#contact-points').getByText(email(3102),{exact:true}).waitFor()
    await page.locator('#contact-points').getByText('+12025553101',{exact:true}).waitFor()
    await page.getByText('Name parts and household eligibility',{exact:true}).click()
    assert.equal(await page.getByLabel('Informal salutation',{exact:true}).inputValue(),' Source friend ')
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Contact enrichment fits '+width)
   if(directory)await page.screenshot({path:`${directory}/MOVE-001-enrichment-${phase}-${width}.png`,fullPage:true})
  }
  await page.close()
 })
}


export async function lglAddressJourney(reportFiles){
 const {verifiedMailBindings}=await import('./verified-mail-edge.mjs')
 let provider='ok',calls=0
 await run(async h=>{
  await reviewed(h)
  const people=[['LGL Constituent ID','Name','Email','Email Type'],[key(3201),'Synthetic postal history',email(3201),'personal']]
  const input=async rows=>({source:'lgl',files:await reportFiles([['constituents',rows]],'csv')})
  const initial=await post(h,'preview',await input(people));await apply(h,initial)
  const person=(await h.get('/api/coffer/donors')).donors[0],before=await h.get('/api/coffer/donors/'+person.id)
  const state=await h.get('/api/coffer/addresses')
  await h.command('address.processing',{version:state.connection.version,enabled:'yes',pafSigner:'Synthetic signer',pafSignedOn:'2026-01-01',pafLicensee:'Melissa',pafReference:key(3202),reviewed:'yes'})
  const rows=structuredClone(people);rows[0].push('Address','City','State','ZIP','Address Type','Address 2 Street','Address 2 City','Address 2 State','Address 2 Postal Code','Address 2 Type');rows[1].push('12 reading st','Madison','WI','53703','home','14 library st','Madison','WI','53703','work')
  const source=await input(rows),review=await post(h,'preview',source);assert.equal(review.canApply,true,JSON.stringify(review.diagnostics));assert.equal(calls,0,'Preview never submits source addresses')
  await post(h,'apply',{id:review.id,fingerprint:review.fingerprint},{as:'',status:401});assert.equal(calls,0,'An unauthenticated apply submits no address')
  provider='error';await post(h,'apply',{id:review.id,fingerprint:review.fingerprint,acknowledged:'no'},{status:502})
  assert.deepEqual((await h.get('/api/coffer/donors/'+person.id)).contactPoints,before.contactPoints,'A provider error saves no contacts or profile changes')
  assert.equal(calls,1,'A provider error is not retried automatically')
  provider='ok';const completed=await post(h,'continue',{id:review.id});assert.equal(completed.state,'completed')
  const current=await h.get('/api/coffer/donors/'+person.id),address=await h.get('/api/coffer/donors/'+person.id+'/addresses')
  assert.equal(current.donor.address_line1,'12 READING ST');assert.equal(current.donor.country,'US');assert.ok(address.check,'The native address read must show the verified current primary');assert.equal(address.check.status,'verified')
  assert.deepEqual(current.contactPoints.filter(p=>p.kind==='address').map(p=>[JSON.parse(p.value).line1,p.is_primary]).sort(),[['12 READING ST',1],['14 LIBRARY ST',0]].sort())
  assert.deepEqual(address.history.map(p=>p.address_line1).sort(),['12 reading st','14 library st'].sort(),'Each standardized address retains the original source spelling')
  await h.command('appeal.prepare',{name:'Source addresses need a licensed pass',channel:'mail'},{status:409})
  assert.equal((await post(h,'check',{id:review.id})).matches,true)
  const saved=await archive(h)
  await run(async fresh=>{
   await restore(fresh,saved)
   await post(fresh,'undo',{id:review.id})
   const undone=await fresh.get('/api/coffer/donors/'+person.id),state=await fresh.get('/api/coffer/donors/'+person.id+'/addresses')
   assert.deepEqual(undone.contactPoints,before.contactPoints);assert.equal(undone.donor.address_line1,null);assert.equal(state.check,null);assert.equal(state.history.length,0)
  },{entry:'tests/fixed-clock-worker.ts'})
  await h.command('address.verify',{donorId:person.id,version:current.donor.version})
  await post(h,'undo',{id:review.id},{status:409})
  await h.command('donor.erase',{donorId:person.id,confirm:'ERASE'})
  const erased=JSON.stringify(await archive(h));assert.ok(!erased.includes('12 reading st')&&!erased.includes('14 library st'))
  const replay=await post(h,'preview',source);assert.equal(replay.canApply,false);await post(h,'apply',{id:replay.id,fingerprint:replay.fingerprint},{status:409})
  const newRows=structuredClone(rows);newRows[1][0]=key(3203);newRows[1][1]='Synthetic new verified source donor';newRows[1][2]=email(3203)
  const newReview=await post(h,'preview',await input(newRows));assert.equal(newReview.canApply,true,JSON.stringify(newReview.diagnostics));await apply(h,newReview)
  const newPerson=(await h.get('/api/coffer/donors')).donors.find(p=>p.name==='Synthetic new verified source donor')
  assert.equal((await h.get('/api/coffer/donors/'+newPerson.id+'/addresses')).check.status,'verified')
  await post(h,'undo',{id:newReview.id});assert.equal((await h.get('/api/coffer/donors')).donors.some(p=>p.id===newPerson.id),false)
 },{entry:'tests/fixed-clock-worker.ts',bindings:verifiedMailBindings,outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'us-street.api.smarty.com');calls++
  if(provider==='error')return new Response('Unavailable',{status:503})
  const [r]=await request.json();return Response.json([{input_id:r.input_id,input_index:0,delivery_line_1:r.street.toUpperCase(),delivery_line_2:'',components:{city_name:'Madison',state_abbreviation:'WI',zipcode:'53703'},analysis:{dpv_match_code:'Y',dpv_vacant:'N',dpv_no_stat:'N',dpv_footnotes:'AABB'}}])
 }})
}
