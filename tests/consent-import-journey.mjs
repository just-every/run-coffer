import assert from 'node:assert/strict'
import {run,archive,restore} from './harness.mjs'
import {csv,xlsx} from './solicitation-import-journey.mjs'
import {prepareVerifiedMail} from './verified-mail-edge.mjs'
import {consentImportBrowser} from './consent-import-browser.mjs'

const endpoint='/api/coffer/move-in'
const post=(h,action,data,options)=>h.api(endpoint+'/'+action,data,options)
const apply=async(h,p)=>{
 let j=await post(h,'apply',{id:p.id,fingerprint:p.fingerprint,acknowledged:'no'})
 while(j.state==='applying')j=await post(h,'continue',{id:p.id})
 assert.equal(j.state,'completed')
 return j
}
const sourceNames={lgl:'Little Green Light',bloomerang:'Bloomerang','re-nxt':"Raiser's Edge NXT"}

/** Existing exports, the first appeal and later owner choices share the real
 * import, consent, postal-processing, archive and undo HTTP doors. */
export async function consentImportJourney(h,source) {
 console.log('Consent journey: '+source+' preview and authority')
 const base={lgl:900,bloomerang:920,'re-nxt':940}[source]
 const ids=Array.from({length:5},(_,i)=>'synthetic-coffer-'+(base+i))
 const idColumn={lgl:'LGL Constituent ID',bloomerang:'Account Number','re-nxt':'Constituent ID'}[source]
 const codeColumn={lgl:'Communication Tags',bloomerang:'Communication Restrictions','re-nxt':'Solicit Codes'}[source]
 const headers=[idColumn,'Name','Email','Address','City','State','ZIP','Country','Email Consent','Mail Consent','SMS Consent','Phone Consent','Consent Date',codeColumn,'Communication Restriction Date']
 const contact=(id,i)=>[id,id,id+String.fromCharCode(64)+'example.test',(i+1)+' Main Street','Springfield','IL','62701','US']
 const rows=[headers,[...contact(ids[0],0),'no','yes','unknown','no','2025-09-10','synthetic-coffer-960;synthetic-coffer-961','2025-09-10'],[...contact(ids[1],1),'unknown','no','no','unknown','','synthetic-coffer-965',''],[...contact(ids[2],2),'yes','yes','yes','yes','2025-09-12','synthetic-coffer-962;synthetic-coffer-963','2025-09-12'],[...contact(ids[3],3),'yes','yes','yes','yes','2025-09-13','Do Not Solicit','2025-09-13'],[...contact(ids[4],4),'yes','yes','yes','yes','2025-09-14','Do Not Mail;Do Not Call','2025-09-14']]
 const rules={'synthetic-coffer-960':{type:'withdraw',channels:['phone']},'synthetic-coffer-961':{type:'limit',maxAsks:1},'synthetic-coffer-962':{type:'tag',tag:'Reading supporters'},'synthetic-coffer-963':{type:'ignore'},'synthetic-coffer-965':{type:'channels',channels:['sms']},'Do Not Solicit':{type:'stop'},'Do Not Mail':{type:'withdraw',channels:['mail']},'Do Not Call':{type:'withdraw',channels:['phone']}}
 const input={source,files:[csv('constituents.csv',rows)],solicitCodes:rules}
 await post(h,'preview',input,{as:'',status:401})
 const p=await post(h,'preview',input)
 assert.equal(p.canApply,true,JSON.stringify(p.diagnostics));assert.equal(p.needsAcceptance,false)
 const member=await h.person('synthetic-coffer-966'+String.fromCharCode(64)+'example.test')
 await post(h,'preview',input,{as:member.cookie,status:403})
 await post(h,'apply',{id:p.id,fingerprint:p.fingerprint},{as:member.cookie,status:403})
 const agent=await h.command('agent.create',{label:'synthetic-coffer-967'})
 const credential={as:'',headers:{authorization:'Bearer '+agent.token}}
 await post(h,'preview',input,{...credential,status:403})
 await h.command('agent.revoke',{id:agent.id})
 await post(h,'apply',{id:p.id,fingerprint:p.fingerprint},{...credential,status:401})
 assert.equal(p.consents.length,20)
 assert.equal(p.counts.channelWithdrawals,6)
 assert.deepEqual(p.reconciliation.filter(r=>r.scope==='restriction'&&r.key.endsWith(' withdrawals')).map(r=>[r.key,r.sourceCount]),[['email withdrawals',1],['mail withdrawals',2],['phone withdrawals',2],['sms withdrawals',1]])
 assert.deepEqual(p.solicitCodes,rules,'Preview exposes all reviewed meanings, including tags and skip')
 console.log('Consent journey: '+source+' reviewed apply')
 if(source==='bloomerang')await consentImportBrowser(h,input,p,process.env.COFFER_CONSENT_IMPORT_BROWSER)
 else await apply(h,p)
 await post(h,'undo',{id:p.id},{as:member.cookie,status:403})
 const donors=(await h.get('/api/coffer/donors')).donors
 const native=ids.map(id=>donors.find(d=>d.name===id))
 const history=async i=>h.get('/api/coffer/donors/'+native[i].id)
 const original=await Promise.all(native.map((_,i)=>history(i)))
 for(let i=0;i<native.length;i++){
  assert.equal(original[i].consents.length,4)
  for(const row of original[i].consents){
   assert.equal(row.method,sourceNames[source]+' export')
   assert.equal(row.captured_on,i===1?'':'2025-09-'+String(10+i))
   assert.ok(row.recorded_at,'Import date is distinct from the source date')
   assert.ok(row.evidence.includes(ids[i])&&row.evidence.includes('Imported: '+row.recorded_at),'Source identity and import date remain attached to the answer')
  }
 }
 assert.deepEqual(original.map(h=>Object.fromEntries(h.consents.map(c=>[c.channel,c.status]))),[
  {phone:'withdrawn',sms:'unknown',mail:'granted',email:'withdrawn'},
  {phone:'unknown',sms:'withdrawn',mail:'withdrawn',email:'unknown'},
  {phone:'granted',sms:'granted',mail:'granted',email:'granted'},
  {phone:'granted',sms:'granted',mail:'granted',email:'granted'},
  {phone:'withdrawn',sms:'granted',mail:'withdrawn',email:'granted'},
 ])
 assert.deepEqual([original[0].solicitation.type,original[0].solicitation.max_asks,original[0].solicitation.period],['limit',1,'rolling-12-months'])
 assert.equal(original[1].solicitation.type,'channels');assert.deepEqual(original[1].solicitation.channels,['sms']);assert.equal(original[1].solicitation.source_on,'')
 assert.equal(original[3].solicitation.type,'stop');assert.equal(original[3].solicitation.source_ref,source+':'+ids[3]);assert.equal(original[3].solicitation.source_on,'2025-09-13');assert.ok(original[3].solicitation.recorded_at)
 assert.deepEqual(original[2].ruleTags.map(t=>t.tag),['Reading supporters'],'Mapped tags land as normal donor tags; skipped codes add nothing')
 console.log('Consent journey: '+source+' archive and replay')
 const saved=await archive(h)
 await run(async fresh=>{
  await restore(fresh,saved)
  for(let i=0;i<native.length;i++)assert.deepEqual((await fresh.get('/api/coffer/donors/'+native[i].id)).consents,original[i].consents,'Restore keeps every source answer and its provenance')
  await post(fresh,'undo',{id:p.id})
  assert.equal((await fresh.get('/api/coffer/donors')).total,0,'Unused consent imports and mapped tags undo after restoration')
 })
 // A different file format reaches the same source identities and answers.
 const workbook={source,files:[xlsx('constituents.xlsx',rows)]}
 const second=await post(h,'preview',workbook)
 assert.equal(second.canApply,true,JSON.stringify(second.diagnostics));assert.deepEqual(second.solicitCodes,rules,'The next import reuses the completed mapping')
 await apply(h,second)
 for(let i=0;i<native.length;i++)assert.deepEqual((await history(i)).consents,original[i].consents,'CSV and XLSX replay never duplicate or mutate consent history')
 await post(h,'undo',{id:second.id})
 console.log('Consent journey: '+source+' first asks and custody')
 const list=await h.command('list.save',{name:'Imported phone preferences',filters:{}})
 const owner=(await h.get('/auth/session')).operator
 const calls=await h.command('list.tasks',{listId:list.id,version:list.version,ownerId:owner.id,dueOn:'2026-10-21',reason:'First imported ask calls',isAsk:true})
 assert.deepEqual(calls.tasks.map(t=>t.donorId),[native[2].id],'Only an explicit phone grant permits the imported ask call')
 assert.equal(calls.excluded['phone consent withdrawn'],2);assert.equal(calls.excluded['phone consent unknown'],1);assert.equal(calls.excluded['do not solicit'],1)
 const email=await h.command('appeal.prepare',{name:'First imported email appeal',channel:'email'})
 assert.equal(email.excluded['consent withdrawn'],1);assert.equal(email.excluded['no consent recorded'],1);assert.equal(email.excluded['do not solicit'],1)
 assert.deepEqual((await h.get('/api/coffer/appeals/'+email.id)).recipients.map(r=>r.donor_id).sort(),[native[2].id,native[4].id].sort(),'Only the explicitly opted-in donor enters the first email appeal')
 await prepareVerifiedMail(h,{headers:{'x-test-now':'2026-10-20T15:00:00.000Z'}})
 const mail=await h.command('appeal.prepare',{name:'First imported mail appeal',channel:'mail'})
 assert.equal(mail.excluded['consent withdrawn'],2);assert.equal(mail.excluded['do not solicit'],1)
 assert.deepEqual((await h.get('/api/coffer/appeals/'+mail.id)).recipients.map(r=>r.donor_id).sort(),[native[0].id,native[2].id].sort(),'Mail withdrawal excludes only its own channel')
 await post(h,'undo',{id:p.id},{status:409})
 assert.deepEqual((await history(2)).consents,original[2].consents,'A prepared appeal fences undo without losing any history')
 await h.command('consent.record',{donorIds:[native[0].id],channel:'email',status:'granted',method:'paper form',capturedOn:'2026-10-01',evidence:'synthetic-coffer-964'})
 const changed=await history(0)
 assert.equal(changed.consents.length,5);assert.equal(changed.consents[0].status,'granted')
 assert.deepEqual(changed.consents.slice(1),original[0].consents,'New native choice appends without editing source answers')
 await apply(h,p)
 assert.deepEqual((await history(0)).consents,changed.consents,'Exact replay cannot replace a newer native choice')
 const stale=await post(h,'preview',{...input,files:[csv('changed.csv',rows.map((r,i)=>i===1?r.map((v,j)=>j===12?'2025-09-11':v):r))]})
 assert.equal(stale.canApply,false);assert.ok(stale.diagnostics.some(d=>d.code==='CONSENT_CHANGED'))
 await post(h,'apply',{id:stale.id,fingerprint:stale.fingerprint,acceptedReason:'Cannot bypass a newer native answer'},{status:409})
 assert.deepEqual((await history(0)).consents,changed.consents)
 const malformed=await post(h,'preview',{source,solicitCodes:rules,files:[csv('bad.csv',rows.map((r,i)=>i===2?r.map((v,j)=>j===8?'perhaps':v):r))]})
 assert.equal(malformed.canApply,false);assert.ok(malformed.diagnostics.some(d=>d.code==='CONSENT_STATUS'))
 await post(h,'apply',{id:malformed.id,fingerprint:malformed.fingerprint,acceptedReason:'Never guess permission'},{status:409})
 await h.command('donor.erase',{donorId:native[1].id,confirm:'ERASE'})
 await h.get('/api/coffer/donors/'+native[1].id,{status:404})
 const erasedArchive=await archive(h)
 assert.ok(!erasedArchive.filter(p=>p.kind==='part').flatMap(p=>p.items).some(r=>r.kind==='row'&&r.table==='cf_consents'&&r.row.donor_id===native[1].id),'Erasure removes source consent and its evidence from portable data')
 const replay=await post(h,'preview',input)
 assert.equal(replay.canApply,false);assert.ok(replay.diagnostics.some(d=>d.code==='MOVE_IN_ERASED'))
 await post(h,'undo',{id:p.id},{status:409})
 await h.get('/api/coffer/donors/'+native[1].id,{status:404})
}
