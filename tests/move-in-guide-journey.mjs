import assert from 'node:assert/strict'
import {archive,restore,run} from './harness.mjs'
import {moveInGuideBrowser} from './move-in-guide-browser.mjs'

const base='/api/coffer/move-in'
const source='bloomerang'
const file=(name,rows)=>({name,base64:Buffer.from(rows.map(r=>r.join(',')).join('\r\n')+'\r\n').toString('base64')})
const get=h=>h.get(base+'/checklist?source='+source)
const done=c=>c.steps.filter(s=>s.done).map(s=>s.id)
const approve=(h,c,step,options)=>h.api(base+'/checklist/review',{source,id:c.jobId,step,version:c.version,fingerprint:c.fingerprint},options)

export async function moveInGuideJourney(){
 await run(async h=>{
  const empty=await get(h);assert.deepEqual(done(empty),[])
  await h.get(base+'/checklist?source='+source,{as:'',status:401})
  await h.api(base+'/checklist/review',{source,done:true},{status:400})
  await h.api(base+'/checklist/review',{source,id:'synthetic-coffer-8100',step:'names',version:0,fingerprint:empty.fingerprint},{status:404})
  await h.command('custom.define',{key:'guide_membership',label:'Source membership',kind:'constituent',type:'text',entry:'pick-one',choices:['Board','Volunteer']})
  const input={source,customFields:[{source,column:'Custom membership',key:'guide_membership',label:'Source membership',kind:'constituent',type:'text',entry:'pick-one',choices:['Board','Volunteer'],version:1}],files:[
   file('constituents.csv',[
    ['Account Number','First Name','Middle Name','Last Name','Formal Salutation','Envelope Name','Custom membership'],
    ['synthetic-coffer-8101','Ava','Lee','Reed','Dr Reed','Dr Ava Reed','Board'],
   ]),
   file('transactions.csv',[
    ['Transaction Number','Account Number','Type','Date','Amount','Fund','Method','Non-deductible Amount'],
    ['synthetic-coffer-8102','synthetic-coffer-8101','Donation','2026-09-01','50','Library','Check','0'],
   ]),
  ]}
  const preview=await h.api(base+'/preview',input)
  assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics));assert.equal(preview.needsAcceptance,false,JSON.stringify(preview.unmapped))
  assert.deepEqual(done(await get(h)),[],'A preview never completes the history import')
  await approve(h,{...await get(h),jobId:preview.id},'names',{status:409})
  await moveInGuideBrowser(h,input,preview)
  const complete=await get(h)
  assert.deepEqual(done(complete),['exports','names','fields','reconciliation'],'The native import and explicit reviews complete only supported evidence')
  const people=(await h.get('/api/coffer/donors')).donors
  assert.equal(people.length,1)
  let history=await h.get('/api/coffer/donors/'+people[0].id)
  assert.equal(history.donor.first_name,'Ava');assert.equal(history.donor.middle_name,'Lee');assert.equal(history.donor.last_name,'Reed')
  assert.equal(history.donor.formal_salutation,'Dr Reed');assert.equal(history.donor.envelope_name,'Dr Ava Reed')
  assert.equal(history.gifts[0].amount_cents,5000)
  assert.equal(history.customValues.find(v=>v.field_key==='guide_membership').value,'"Board"')
  for(const step of ['transfer','payment-mapping','source-stop','cutover','email']) {
   await approve(h,complete,step,{status:400})
   assert.equal((await get(h)).steps.find(s=>s.id===step).done,false,'Unsupported work never completes')
  }
  await h.api(base+'/checklist/review',{source,id:complete.jobId,step:'names',version:complete.version,fingerprint:complete.fingerprint,done:true},{status:400})
  const audit=(await h.get('/api/coffer/audit?action=move-in.checklist.review')).rows
  assert.deepEqual(audit.map(row=>JSON.parse(row.detail).step).sort(),['fields','names','reconciliation'])
  assert.ok(audit.every(row=>row.actor_role==='owner'&&JSON.parse(row.detail).evidenceHash===complete.fingerprint))
  // The native checklist persists separately from reloads and archive restores.
  assert.deepEqual(done(await get(h)),done(complete))
  const saved=await archive(h)
  assert.ok(saved.some(l=>JSON.stringify(l).includes('cf_move_in_checklists')),'Reviews are portable installation evidence')
  await run(async fresh=>{
   await restore(fresh,saved)
   const restored=await get(fresh)
   assert.deepEqual(done(restored),done(complete),'Restored records are checked against the archived evidence digests')
   await fresh.api(base+'/undo',{id:preview.id})
   assert.deepEqual(done(await get(fresh)),[],'Undo invalidates every supported completion after restore')
  })
  // A definition edit clears the earlier review and refuses its stale approval.
  const definition=(await h.get('/api/coffer/custom-fields')).fields.find(f=>f.key==='guide_membership')
  await h.command('custom.define',{...definition,label:'Reviewed membership',choices:['Board','Volunteer'],version:definition.version})
  const changed=await get(h)
  assert.deepEqual(done(changed),['exports'])
  await approve(h,complete,'fields',{status:409})
  for(const step of ['names','fields','reconciliation'])await approve(h,await get(h),step)
  assert.deepEqual(done(await get(h)),done(complete))
  history=await h.get('/api/coffer/donors/'+people[0].id)
  await h.command('donor.update',{donorId:people[0].id,version:history.donor.version,name:'Ava Lee Reed Updated'})
  const renamed=await get(h)
  assert.deepEqual(done(renamed),['exports'],'Changed native names invalidate the previous evidence reviews')
  assert.equal(renamed.names[0].original.name,'Ava Lee Reed')
  assert.equal(renamed.names[0].current.name,'Ava Lee Reed Updated')
  for(const step of ['names','fields','reconciliation'])await approve(h,await get(h),step)
  // A real ledger correction makes the old reconciliation false, even if the
  // journal still contains its historical green check.
  history=await h.get('/api/coffer/donors/'+people[0].id)
  await h.command('gift.reverse',{giftId:history.gifts[0].id,version:history.gifts[0].version,reason:'synthetic-coffer-8103',reversedOn:'2026-09-02'})
  const reversed=await get(h)
  assert.equal(reversed.reconciliation.matches,false)
  assert.equal(reversed.steps.find(s=>s.id==='reconciliation').done,false)
  await approve(h,reversed,'reconciliation',{status:409})
  // Freshly issued admin authority is checked again after demotion.
  const address=n=>'synthetic-coffer-'+n+String.fromCharCode(64)+'example.test'
  const admin=await h.person(address(8104),'admin'),member=await h.person(address(8105),'member')
  await h.get(base+'/checklist?source='+source,{as:admin.cookie})
  const adminReview=await approve(h,await get(h),'names',{as:admin.cookie})
  assert.equal(adminReview.steps.find(s=>s.id==='names').done,true)
  const adminAudit=(await h.get('/api/coffer/audit?action=move-in.checklist.review')).rows
  assert.ok(adminAudit.some(row=>row.actor_id===admin.id&&JSON.parse(row.detail).step==='names'))
  await h.get(base+'/checklist?source='+source,{as:member.cookie,status:403})
  await approve(h,await get(h),'names',{as:member.cookie,status:403})
  await h.api('/auth/operator/role',{operatorId:admin.id,role:'member'})
  await h.api(base+'/checklist/review',{source,id:preview.id,step:'names',version:adminReview.version,fingerprint:adminReview.fingerprint},{as:admin.cookie,status:401})
  await h.get(base+'/checklist?source='+source,{as:admin.cookie,status:401})
  await h.command('donor.erase',{donorId:people[0].id,confirm:'ERASE'})
  const erased=await get(h)
  assert.deepEqual(done(erased),[]);assert.equal(erased.names.length,0);assert.equal(erased.mappings.length,0)
  assert.equal((await h.api(base+'/preview',input)).canApply,false,'A replay cannot resurrect erased import data or completion')
  assert.deepEqual(done(await get(h)),[])
 })
 await reusedGuideEvidenceJourney()
}

// Importing another year reuses the first year's donor and custom-value custody.
// Reviews must still show those names and fields through the installation door.
async function reusedGuideEvidenceJourney(){
 await run(async h=>{
  await h.command('custom.define',{key:'guide_membership',label:'Source membership',kind:'constituent',type:'text',entry:'pick-one',choices:['Board','Volunteer']})
  const input=year=>({source,customFields:[{source,column:'Custom membership',key:'guide_membership',label:'Source membership',kind:'constituent',type:'text',entry:'pick-one',choices:['Board','Volunteer'],version:1}],files:[
   file('constituents.csv',[
    ['Account Number','First Name','Middle Name','Last Name','Custom membership'],
    ['synthetic-coffer-8111','Ava','Lee','Reed','Board'],
   ]),
   file('transactions.csv',[
    ['Transaction Number','Account Number','Type','Date','Amount','Fund','Method','Non-deductible Amount'],
    ['synthetic-coffer-'+year,'synthetic-coffer-8111','Donation',year+'-09-01','50','Library','Check','0'],
   ]),
  ]})
  const first=await h.api(base+'/preview',input(2025))
  assert.equal(first.canApply,true,JSON.stringify(first.diagnostics))
  await h.api(base+'/apply',{id:first.id,fingerprint:first.fingerprint,acknowledged:'no'})
  for(const step of ['names','fields','reconciliation'])await approve(h,await get(h),step)
  const prior=await get(h)
  assert.deepEqual(done(prior),['exports','names','fields','reconciliation'])
  const next=await h.api(base+'/preview',input(2026))
  assert.equal(next.canApply,true,JSON.stringify(next.diagnostics))
  // Preview is not a completed installation; review cannot forge that state.
  assert.deepEqual(done(await h.get(base+'/checklist?source='+source+'&id='+next.id)),[])
  await approve(h,{...prior,jobId:next.id},'names',{status:409})
  await h.api(base+'/apply',{id:next.id,fingerprint:next.fingerprint,acknowledged:'no'})
  const current=await h.get(base+'/checklist?source='+source+'&id='+next.id)
  assert.equal(current.imports.length,2)
  assert.equal(current.nameCount,1,'The reused donor remains visible without a duplicate record')
  assert.equal(current.names[0].original.name,'Ava Lee Reed')
  assert.equal(current.mappings.length,1,'The earlier typed mapping is present once')
  assert.equal(current.definitions[0].key,'guide_membership')
  assert.equal(current.reconciliation.matches,true)
  assert.ok(current.steps.find(s=>s.id==='names').available)
  assert.ok(current.steps.find(s=>s.id==='fields').available,'Earlier imported values support current field review')
  await approve(h,{...prior,jobId:next.id},'fields',{status:409})
  for(const step of ['names','fields','reconciliation'])await approve(h,await h.get(base+'/checklist?source='+source+'&id='+next.id),step)
  const reviewed=await h.get(base+'/checklist?source='+source+'&id='+next.id)
  assert.deepEqual(done(reviewed),done(prior))
  const people=(await h.get('/api/coffer/donors')).donors
  assert.equal(people.length,1)
  assert.equal((await h.get('/api/coffer/donors/'+people[0].id)).gifts.length,2)
  const saved=await archive(h)
  await run(async fresh=>{
   await restore(fresh,saved)
   const restored=await fresh.get(base+'/checklist?source='+source+'&id='+next.id)
   assert.deepEqual(done(restored),done(reviewed))
   assert.equal(restored.nameCount,1)
   assert.equal(restored.mappings.length,1)
   await fresh.api(base+'/undo',{id:next.id})
   assert.deepEqual(done(await fresh.get(base+'/checklist?source='+source+'&id='+next.id)),[])
   const remaining=await fresh.get(base+'/checklist?source='+source+'&id='+first.id)
   assert.equal(remaining.imports.length,1)
   assert.equal(remaining.nameCount,1)
   assert.ok(remaining.steps.find(s=>s.id==='fields').available)
   assert.equal(remaining.steps.find(s=>s.id==='fields').done,false,'Undo requires fresh review of the remaining installation')
  })
  await h.command('donor.erase',{donorId:people[0].id,confirm:'ERASE'})
  const erased=await h.get(base+'/checklist?source='+source+'&id='+next.id)
  assert.deepEqual(done(erased),[])
  assert.deepEqual(erased.names,[])
  assert.deepEqual(erased.mappings,[])
  assert.equal((await h.api(base+'/preview',input(2026))).canApply,false)
 })
}
