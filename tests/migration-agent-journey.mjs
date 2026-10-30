import assert from 'node:assert/strict'
import {run,reviewed,donor,archive,restore,stripe} from './harness.mjs'
import {migrationAgentBrowser} from './migration-agent-browser.mjs'
const root='/api/coffer/agent/move-in'
const key=n=>'synthetic-coffer-'+n
const email=n=>[key(n),'example.test'].join('@')
const post=(h,action,input,options)=>h.api('/api/coffer/move-in/'+action,input,options)
const analyze=async(h,jobId,kind='crm')=>h.api(root+'/run',{jobId,kind,version:(await h.get(root)).version})
const state=(h,id)=>h.get(root+'?analysisId='+id)
const csv=(name,rows)=>({name,base64:Buffer.from(rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')).toString('base64')})
const fixture=()=>({source:'spreadsheet',spreadsheet:{name:'Migration evidence',recordType:'gift',columns:Object.entries({PersonKey:'donorId',Person:'name',Email:'email',EmailChoice:'emailPreference',MailChoice:'mailPreference',PhoneChoice:'phonePreference',TextChoice:'smsPreference',GiftKey:'giftId',Received:'date',Dollars:'amount',PaidBy:'method',Thanked:'acknowledgmentStatus',ThankedOn:'acknowledgmentDate',ThankedBy:'acknowledgmentMethod',Benefit:'goodsAmount',CreditPerson:'softDonor',CreditKey:'softId',CreditAmount:'softAmount',CreditThanked:'softAcknowledgmentStatus',CreditOn:'softAcknowledgmentDate',CreditBy:'softAcknowledgmentMethod'}).map(([column,field])=>({column,field}))},files:[
 csv('people.csv',[
 ['PersonKey','Person','Email','EmailChoice','MailChoice','PhoneChoice','TextChoice'],
 [key(9201),'Synthetic Migration One',email(9200),'unknown','no','no','no'],
 [key(9202),'Synthetic Migration Two',email(9200),'no','','',''],
 ]),
 csv('gifts.csv',[
 ['GiftKey','PersonKey','Received','Dollars','PaidBy','Thanked','ThankedOn','ThankedBy','Benefit','CreditPerson','CreditKey','CreditAmount','CreditThanked','CreditOn','CreditBy'],
 [key(9211),key(9201),'2020-01-03','300','check','not acknowledged','','','0'],
 [key(9212),key(9201),'2026-10-01','400','check','acknowledged','2026-10-02','email','0',key(9202),key(9221),'100','acknowledged','2026-10-02','email'],
 [key(9213),key(9202),'2026-10-03','500','check','','','','0'],
 ])]})
const apply=async(h,p)=>{let j=await post(h,'apply',{id:p.id,fingerprint:p.fingerprint,acknowledged:'no'});while(j.state==='applying')j=await post(h,'continue',{id:p.id});assert.equal(j.state,'completed')}
const native=async h=>({messages:[...h.messages],people:await h.get('/api/coffer/donors'),letters:await h.get('/api/coffer/letters'),donors:await Promise.all((await h.get('/api/coffer/donors')).donors.map(d=>h.get('/api/coffer/donors/'+d.id)))})
const pointer=(v,p)=>p.split('/').slice(1).reduce((v,k)=>v[k.replaceAll('~1','/').replaceAll('~0','~')],v)

export async function migrationAgentJourney(){
 await run(async h=>{
  await reviewed(h)
  // This existing public Settings door owns the installation's historical cutoff.
  const policy=await h.get('/api/coffer/agent/receipts/settings')
  await h.api('/api/coffer/agent/receipts/settings',{version:policy.version,maxStandardAmount:"1000.00",acknowledgeFrom:'2026-09-01'})
  const existing=await donor(h,'Synthetic Native Preserved',{email:email(9200)})
  const input=fixture()
  input.spreadsheet.donorMatches={[key(9201)]:{id:existing.id,version:existing.version}}
  const preview=await post(h,'preview',input)
  assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics))
  await h.api(root+'/run',{kind:'crm',jobId:preview.id,version:(await h.get(root)).version},{status:409})
  if(process.env.CI||process.env.COFFER_MIGRATION_BROWSER)await migrationAgentBrowser(h,null,process.env.COFFER_MIGRATION_BROWSER,'incomplete')
  await apply(h,preview)
  const people=(await h.get('/api/coffer/donors')).donors,first=people.find(d=>d.id===existing.id),second=people.find(d=>d.name==='Synthetic Migration Two')
  const detail=await h.get('/api/coffer/donors/'+first.id),old=detail.gifts.find(g=>g.reference.endsWith(key(9211))),thanked=detail.gifts.find(g=>g.reference.endsWith(key(9212)))
  assert.ok(old&&thanked)
  assert.equal((await h.get('/api/coffer/letters')).due.some(g=>g.id===old.id),false)
  assert.equal((await h.get('/api/coffer/agent')).missingReceipts.some(g=>g.id===old.id),false,'Historical source facts cannot enter receipt recovery')
  const before=await native(h),current=await analyze(h,preview.id)
  assert.deepEqual(await native(h),before,'Preparation changes no donor, consent, acknowledgment, letter or ledger record')
  assert.equal(current.money.rows.find(r=>r.scope==='all').sourceCents,120000)
  assert.equal(current.money.rows.find(r=>r.scope==='all').cofferCents,120000)
  assert.equal(current.findings.filter(f=>f.kind==='duplicate_identity').length,1)
  assert.equal(current.findings.filter(f=>f.kind==='historical_acknowledgment').length,1)
  assert.ok(current.findings.find(f=>f.kind==='historical_acknowledgment').excludedFromRecovery)
  assert.ok(current.findings.some(f=>f.kind==='acknowledgment_unknown'))
  assert.ok(current.findings.some(f=>f.kind==='preference_unknown'&&f.source.channel==='email'))
  assert.equal((await analyze(h,preview.id)).id,current.id,'Replay reuses the exact comparison receipt')
  assert.equal((await state(h,current.id)).analysis.status,'current')
  const source=await h.get(root+'/source?kind=crm&jobId='+preview.id)
  assert.equal(source.records.find(r=>r.kind==='donor'&&r.nativeId===first.id).fact.name,'Synthetic Migration One','Explicit matching preserves the reviewed source name')
  assert.equal((await h.get('/api/coffer/donors/'+first.id)).donor.name,'Synthetic Native Preserved','Matching keeps the native name separate')
  for(const finding of current.findings)for(const citation of finding.citations){const value=await h.get(citation.href);assert.notEqual(pointer(value,citation.pointer),undefined,'Every source citation resolves')}
  if(process.env.CI||process.env.COFFER_MIGRATION_BROWSER)await migrationAgentBrowser(h,current.id,process.env.COFFER_MIGRATION_BROWSER)
  const repeated=structuredClone(input)
  repeated.files[1].base64=Buffer.from(Buffer.from(repeated.files[1].base64,'base64').toString()+'\r\n'+[key(9214),key(9201),'2026-10-04','25','check','not acknowledged','','','0'].map(v=>'"'+v+'"').join(',')).toString('base64')
  const later=await post(h,'preview',repeated)
  assert.equal(later.canApply,true,JSON.stringify(later.diagnostics))
  await apply(h,later)
  const repeatedComparison=await analyze(h,later.id)
  assert.deepEqual(repeatedComparison.money.rows.find(r=>r.scope==='all'),{scope:'all',key:'All gifts',sourceCount:4,sourceCents:122500,cofferCount:4,cofferCents:122500,matches:true})
  assert.equal(repeatedComparison.findings.some(f=>f.kind==='preference_missing'&&f.native.fact?.donor_id===second.id&&f.source.channel==='email'),false)
  assert.equal(repeatedComparison.findings.filter(f=>f.kind==='historical_acknowledgment').length,1,'Repeated old gifts retain source acknowledgment evidence')
  for(const finding of repeatedComparison.findings)for(const citation of finding.citations){const value=await h.get(citation.href);assert.notEqual(pointer(value,citation.pointer),undefined)}
  const saved=await archive(h)
  await run(async fresh=>{
   await restore(fresh,saved)
   // Restore may change the native revision while restoring sources. It must
   // either recompute matching facts or visibly require new preparation.
   const restored=await state(fresh,current.id)
   assert.ok(['stale','current'].includes(restored.analysis.status))
   const check=await analyze(fresh,preview.id)
   assert.equal(check.findings.filter(f=>f.kind==='duplicate_identity').length,1)
   assert.equal(check.money.rows.find(r=>r.scope==='all').cofferCents,120000)
   const restoredLater=await analyze(fresh,later.id)
   assert.equal(restoredLater.money.rows.find(r=>r.scope==='all').cofferCents,122500)
   assert.equal(restoredLater.findings.some(f=>f.kind==='preference_missing'&&f.source.channel==='email'),false,'Restored repeated imports retain source preferences')
   const restoredSource=await fresh.get(root+'/source?kind=crm&jobId='+later.id)
   assert.equal(restoredSource.records.find(r=>r.kind==='donor'&&r.nativeId===first.id).fact.name,'Synthetic Migration One')
   await post(fresh,'undo',{id:later.id})
   await post(fresh,'undo',{id:preview.id})
   const stale=await state(fresh,check.id);assert.equal(stale.analysis.status,'stale');assert.deepEqual(stale.analysis.findings,[])
   await fresh.api(root+'/run',{kind:'crm',jobId:preview.id,version:(await fresh.get(root)).version},{status:409})
  },{entry:'tests/fixed-clock-worker.ts'})
  const oldVersion=(await h.get(root)).version
  await h.command('consent.record',{donorIds:[first.id],channel:'email',status:'withdrawn',method:'paper form',evidence:key(9230),capturedOn:'2026-10-04'})
  assert.equal((await state(h,current.id)).analysis.status,'stale')
  await h.get(current.findings[0].citations[0].href,{status:409})
  if(process.env.CI||process.env.COFFER_MIGRATION_BROWSER)await migrationAgentBrowser(h,current.id,process.env.COFFER_MIGRATION_BROWSER,'stale')
  await h.api(root+'/run',{kind:'crm',jobId:preview.id,version:oldVersion},{status:409})
  const after=await analyze(h,preview.id),unknown=after.findings.find(f=>f.kind==='preference_unknown'&&f.source.channel==='email'&&f.native.fact?.donor_id===first.id)
  assert.equal(unknown.source.status,'unknown');assert.equal(unknown.native.status,'withdrawn');assert.equal(unknown.native.newerChoice,true)
  await h.command('consent.record',{donorIds:[second.id],channel:'email',status:'withdrawn',method:'paper form',evidence:key(9231),capturedOn:'2026-10-04'})
  const preference=await analyze(h,preview.id)
  assert.ok(preference.findings.some(f=>f.kind==='current_preference'&&f.native.donor_id===second.id),'A known newer native choice is kept separate from source facts')
  await h.command('gift.resetAcknowledgment',{giftId:thanked.id,version:thanked.acknowledgment.version})
  const reset=await analyze(h,preview.id),ack=reset.findings.find(f=>f.kind==='acknowledgment_discrepancy')
  assert.equal(ack.source.status,'acknowledged');assert.equal(ack.native.status,'not acknowledged')
  const credit=(await h.get('/api/coffer/donors/'+second.id)).giftDepth.creditedGifts[0]
  await h.command('softCredit.resetAcknowledgment',{softCreditId:credit.id,version:credit.acknowledgment.version})
  const softCheck=await analyze(h,preview.id),soft=softCheck.findings.find(f=>f.kind==='acknowledgment_discrepancy'&&f.source.soft_credit_id===credit.id)
  assert.equal(soft.source.status,'acknowledged');assert.equal(soft.native.status,'not acknowledged')
  const laterCheck=await analyze(h,later.id)
  const repeatedAck=laterCheck.findings.find(f=>f.kind==='acknowledgment_discrepancy'&&f.source.gift_id===thanked.id)
  assert.equal(repeatedAck.source.status,'acknowledged');assert.equal(repeatedAck.native.status,'not acknowledged')
  const repeatedCredit=laterCheck.findings.find(f=>f.kind==='acknowledgment_discrepancy'&&f.source.soft_credit_id===credit.id)
  assert.equal(repeatedCredit.source.status,'acknowledged');assert.equal(repeatedCredit.native.status,'not acknowledged')
  assert.ok(laterCheck.findings.some(f=>f.kind==='current_preference'&&f.native.donor_id===second.id&&f.source.status==='withdrawn'),'Repeated imports retain the known source withdrawal and distinguish the newer native choice')
  assert.equal(laterCheck.findings.some(f=>f.kind==='preference_missing'&&f.source.channel==='email'),false,'A reused source preference is never called missing')
  for(const finding of laterCheck.findings)for(const citation of finding.citations){const value=await h.get(citation.href);assert.notEqual(pointer(value,citation.pointer),undefined)}
  await h.command('gift.reverse',{giftId:thanked.id,reason:key(9232)})
  const reversed=await analyze(h,preview.id),difference=reversed.findings.find(f=>f.kind==='money'&&f.summary.startsWith('All gifts'))
  assert.deepEqual(difference.source,{count:3,cents:120000});assert.deepEqual(difference.native,{count:2,cents:80000})
  const member=await h.person(email(9240),'member'),admin=await h.person(email(9241),'admin')
  await h.get(root,{as:member.cookie,status:403});await h.get(root+'/source?kind=crm&jobId='+preview.id,{as:member.cookie,status:403})
  await h.api(root+'/run',{kind:'crm',jobId:preview.id,version:(await h.get(root)).version},{as:member.cookie,status:403})
  await h.api(root+'/run',{kind:'crm',jobId:preview.id,version:(await h.get(root)).version},{as:admin.cookie})
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  await h.get(root,{as:admin.cookie,status:401})
  const keyResult=await h.command('agent.create',{label:'Synthetic migration agent'})
  await h.api(root+'/run',{kind:'crm',jobId:preview.id,version:(await h.get(root)).version},{as:'',headers:{authorization:'Bearer '+keyResult.token},status:403})
  await h.get(root,{as:'',status:401})
  const merge=await h.command('donor.merge',{sourceDonorId:second.id,donorId:first.id,sourceVersion:(await h.get('/api/coffer/donors/'+second.id)).donor.version,version:(await h.get('/api/coffer/donors/'+first.id)).donor.version,fields:{},reason:'duplicate_record'})
  assert.ok(merge)
  assert.equal((await state(h,reversed.id)).analysis.status,'stale')
  const merged=await analyze(h,preview.id)
  assert.equal(merged.findings.some(f=>f.kind==='duplicate_identity'),false,'Merged identities no longer produce a duplicate finding')
  await h.command('donor.erase',{donorId:first.id,confirm:'ERASE'})
  const erased=await state(h,reversed.id);assert.equal(erased.analysis.status,'stale');assert.deepEqual(erased.analysis.findings,[])
  await h.get(root+'/source?kind=crm&jobId='+preview.id,{status:409})
  await h.get(root+'/source?kind=crm&jobId='+later.id,{status:409})
  assert.equal((await post(h,'preview',repeated)).canApply,false,'Replaying a repeated import cannot restore erased source facts')
  assert.equal((await post(h,'preview',input)).canApply,false,'Replaying the original source cannot resurrect erased people')
 },{entry:'tests/fixed-clock-worker.ts'})
 await run(async h=>{
  await reviewed(h)
  const pages=await stripe(),customer=pages.customers[0].data[0]
  const subscription={id:'sub_syntheticcoffer9251',customer:customer.id,created:Date.UTC(2026,0,2)/1000,status:'active',currency:'usd',cancel_at_period_end:false,items:{data:[{quantity:1,price:{type:'recurring',currency:'usd',unit_amount:2500,billing_scheme:'per_unit',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}}]}}
  const input={...pages,subscriptions:[{object:'list',data:[subscription],has_more:false}],noGoodsOrServices:true},preview=await h.api('/api/coffer/imports/preview',input)
  assert.equal(preview.subscriptions.length,1)
  let job=await h.api('/api/coffer/imports/apply',{...input,fingerprint:preview.fingerprint})
  while(job.state!=='completed')job=await h.api('/api/coffer/imports/resume',{id:job.id})
  const before=await native(h),comparison=await analyze(h,job.id,'stripe')
  assert.deepEqual(await native(h),before)
  assert.equal(comparison.money.matches,true)
  assert.equal(comparison.money.rows[0].sourceCents,comparison.money.rows[0].cofferCents)
  assert.ok(comparison.findings.some(f=>f.kind==='preference_missing'))
  const source=await h.get(root+'/source?kind=stripe&jobId='+job.id);assert.ok(source.records.some(r=>r.kind==='subscription'),'Plans stay source evidence, never a missing-instrument conclusion')
  assert.equal(comparison.findings.some(f=>/instrument|reauthor/.test(f.kind)),false)
  await h.api('/api/coffer/imports/undo',{id:job.id})
  assert.equal((await state(h,comparison.id)).analysis.status,'stale')
 },{entry:'tests/fixed-clock-worker.ts'})
}
