import assert from 'node:assert/strict'
import {run,archive,restore} from './harness.mjs'
import {sourceCaptureBrowser,sourceCustomBrowser} from './custom-import-browser.mjs'
const endpoint='/api/coffer/move-in/'
const post=(h,action,input,options)=>h.api(endpoint+action,input,options)
const file=(name,rows)=>({name,base64:Buffer.from(rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')).toString('base64')})
export const sourceFiles=(offset=0)=>({source:'bloomerang',files:[
 file('constituents.csv',[['Account Number','Name'],[101+offset,'Synthetic Source Fields'],[102+offset,'Synthetic Waiting Values']]),
 file('gifts.csv',[['Transaction Number','Account Number','Gift Type','Gift Date','Amount','Payment Method','Non-Deductible Amount'],[201+offset,101+offset,'Gift','2026-10-01','50','Check','0'],[202+offset,102+offset,'Gift','2026-10-01','25','Check','0']]),
 file('conversations.csv',[['Note ID','Account Number','Note','Note Date','Note Type'],[301+offset,101+offset,'Source meeting','2026-10-01','meeting']]),
 file('notes.csv',[['Note ID','Account Number','Note','Note Date','Note Type'],[401+offset,101+offset,'Source note','2026-10-01','general']]),
]})
function bloomerangEdge({large=false}={}){
 let offset=0,revoked=false
 const definitions={Constituent:[{Id:1,Name:'Membership',DataType:'Text',PickType:'PickOne'},{Id:2,Name:'Interests',DataType:'Text',PickType:'PickMultiple'},{Id:6,Name:'Source groups',DataType:'Text',PickType:'PickMultiple'},{Id:7,Name:'Private source field',DataType:'Text',PickType:'Freeform'}],Transaction:[{Id:3,Name:'Budget',DataType:'Currency',PickType:'Freeform'}],Interaction:[{Id:4,Name:'Topic',DataType:'Text',PickType:'Freeform'}],Note:[{Id:5,Name:'Note detail',DataType:'Text',PickType:'Freeform'},{Id:8,Name:'Note circle',DataType:'Text',PickType:'PickOne'}]}
 const choices={1:['Board','Volunteer'],2:['Books','Music'],6:['Alumni','Legacy'],8:['Source note circle']},choice=(id,value)=>({Id:id*10+(choices[id]?.indexOf(value)??0)+1,FieldId:id,Value:value})
 if(large){
  definitions.Constituent.push(...Array.from({length:90},(_,i)=>({Id:100+i,Name:'Retained source detail '+i,DataType:'Text',PickType:'Freeform'})))
  definitions.Transaction.push(...Array.from({length:10},(_,i)=>({Id:200+i,Name:'Source designation '+i,DataType:'Text',PickType:'PickOne'})))
  for(let i=0;i<10;i++)choices[200+i]=Array.from({length:100},(_,n)=>'synthetic-coffer-'+i+'-'+n+' '+('complete source choice '.repeat(85)).slice(0,1850))
 }
 const longValue=i=>'synthetic-coffer-'+i+' '+('retained source content '.repeat(85)).slice(0,1950)
 const scalar=(FieldId,Value)=>({FieldId,Value:{Value}}),pick=(FieldId,Value)=>({FieldId,Value:choice(FieldId,Value)}),many=(FieldId,values)=>({FieldId,Values:values.map(v=>choice(FieldId,v))})
 const page=rows=>({Start:0,ResultCount:rows.length,TotalFiltered:rows.length,Results:rows})
 return {setOffset(n){offset=n},revoke(){revoked=true},async outbound(request){
  const u=new URL(request.url);assert.equal(u.origin,'https://api.bloomerang.co');assert.equal(request.method,'GET');assert.equal(request.headers.get('X-API-KEY'),'synthetic-coffer-1600')
  if(revoked)return Response.json({error:'revoked'},{status:401})
  const path=u.pathname.slice(3)
  let m=/^\/customFields\/(\w+)\/$/.exec(path)
  if(m)return Response.json(u.searchParams.get('isActive')==='false'?[]:definitions[m[1]])
  m=/^\/customValues\/\w+\/(\d+)$/.exec(path)
  if(m)return Response.json(u.searchParams.get('isActive')==='false'?[]:choices[m[1]].map(v=>choice(Number(m[1]),v)))
  if(path==='/constituents')return Response.json(page([{Id:1001+offset,AccountNumber:101+offset,CustomValues:[pick(1,'Board'),many(2,['Books','Music']),many(6,['Alumni','Legacy']),scalar(7,'Private retained source'),...(large?Array.from({length:90},(_,i)=>scalar(100+i,longValue(i))):[])]},{Id:1002+offset,AccountNumber:102+offset,CustomValues:[pick(1,'Unlisted'),...(large?Array.from({length:90},(_,i)=>scalar(100+i,longValue(i))):[])]}]))
  if(path==='/transactions/designations')return Response.json(page([{Id:2001+offset,DesignationNumber:201+offset,Type:'Donation',CustomValues:[scalar(3,'123.45'),...(large?Array.from({length:10},(_,i)=>pick(200+i,choices[200+i][0])):[])]},{Id:2002+offset,DesignationNumber:202+offset,Type:'Donation',CustomValues:[scalar(3,'not a number'),...(large?Array.from({length:10},(_,i)=>pick(200+i,choices[200+i][1])):[])]}]))
  if(path==='/interactions')return Response.json(page([{Id:301+offset,CustomValues:[scalar(4,'Library visit')]}]))
  if(path==='/notes')return Response.json(page([{Id:401+offset,CustomValues:[scalar(5,offset?'Other source note '+offset:'Preserve original note'),pick(8,'Source note circle')]}]))
  assert.fail('Unexpected Bloomerang request '+u.pathname)
 }}
}
async function imported(h,input){const p=await post(h,'preview',input);assert.equal(p.canApply,true,JSON.stringify(p.diagnostics));let job=await post(h,'apply',{id:p.id,fingerprint:p.fingerprint});while(job.state==='applying')job=await post(h,'continue',{id:p.id});return p.id}
async function readReview(h,id){return (await h.get(endpoint+'custom-review?id='+id)).review}
export async function sourceCustomJourney(){
 const edge=bloomerangEdge()
 await run(async h=>{
  await h.command('custom.define',{key:'existing_membership',label:'Membership',kind:'constituent',type:'text',entry:'pick-one',choices:['Board','Volunteer','Advisor']})
  const olderFiles=sourceFiles();olderFiles.files=olderFiles.files.map(f=>({...f,base64:Buffer.from(Buffer.from(f.base64,'base64').toString()+'\r\n').toString('base64')}))
  const older=await post(h,'preview',olderFiles)
  const id=await imported(h,sourceFiles()),capture={id,apiKey:'synthetic-coffer-1600'}
  await post(h,'custom-capture',capture,{as:'',status:401})
  const member=await h.person('synthetic-coffer-1601'+String.fromCharCode(64)+'example.test')
  await post(h,'custom-capture',capture,{as:member.cookie,status:403})
  await sourceCaptureBrowser(h,id,'.cache/custom-source')
  const result=await post(h,'custom-capture',capture),review=result.review
  assert.equal(review.definitions.length,8);assert.deepEqual(review.counts.find(c=>c.id==='gift:3'),{id:'gift:3',name:'Budget',defined:1,source:2,carried:1,waiting:1,skipped:0})
  assert.match(review.values.find(v=>v.state==='waiting'&&v.fieldId==='gift:3').reason,/number/)
  const mappings=review.mappings.map(m=>m.id==='constituent:1'?{...m,field:{...m.field,key:'existing_membership',version:1,choices:['Board','Volunteer','Advisor']}}:m.id==='interaction:4'?{...m,field:{...m.field,label:'Imported visit topic'}}:m.id==='constituent:6'?{...m,action:'tags'}:m.id==='constituent:7'?{...m,action:'skip'}:m)
  const invalidChoice=review.values.find(v=>v.fieldId==='constituent:1'&&v.state==='waiting');assert.equal(invalidChoice.original,'Unlisted');assert.match(invalidChoice.reason,/source choice/);const mappedChoice={id:invalidChoice.id,action:'map',value:'Volunteer'}
  let updated=await post(h,'custom-review',{id,version:review.version,mappings,resolutions:[mappedChoice]})
  await post(h,'custom-review',{id,version:review.version,mappings,resolutions:[]},{status:409})
  await post(h,'custom-apply',{id,version:review.version},{status:409})
  await sourceCustomBrowser(h,id,'.cache/custom-source',{noteTags:true})
  updated.review=await readReview(h,id)
  const applied=await post(h,'custom-apply',{id,version:updated.review.version});assert.equal(applied.carried,6);assert.equal(applied.waiting,1);await sourceCustomBrowser(h,id,'.cache/custom-source',{applied:true})
  const people=(await h.get('/api/coffer/donors')).donors,person=people.find(p=>p.name==='Synthetic Source Fields'),waitingPerson=people.find(p=>p.name==='Synthetic Waiting Values'),details=await h.get('/api/coffer/donors/'+person.id)
  const values=Object.fromEntries(details.customValues.map(v=>[v.field_key,JSON.parse(v.value)]))
  assert.deepEqual(values,{existing_membership:'Board',import_bloomerang_constituent_2:['Books','Music'],import_bloomerang_gift_3:'12345',import_bloomerang_interaction_4:'Library visit',import_bloomerang_note_5:'Preserve original note'})
  assert.deepEqual(details.ruleTags.map(t=>t.tag).sort(),['Alumni','Legacy','Source note circle'])
  const fields=(await h.get('/api/coffer/custom-fields')).fields
  assert.deepEqual(fields.filter(f=>f.key.startsWith('import_bloomerang_')).map(f=>[f.key,f.type,f.entry,JSON.parse(f.choices)]),[['import_bloomerang_constituent_2','text','pick-many',['Books','Music']],['import_bloomerang_gift_3','currency','free-form',[]],['import_bloomerang_interaction_4','text','free-form',[]],['import_bloomerang_note_5','text','free-form',[]]])
  assert.equal(fields.find(f=>f.key==='import_bloomerang_interaction_4').label,'Imported visit topic')
  const saved=await archive(h,{maxParts:100})
  await run(async fresh=>{await restore(fresh,saved);assert.deepEqual((await fresh.get('/api/coffer/donors/'+person.id)).customValues,details.customValues);assert.equal((await readReview(fresh,id)).values.filter(v=>v.state==='waiting').length,1);await post(fresh,'undo',{id});assert.deepEqual((await fresh.get('/api/coffer/custom-fields')).fields.map(f=>f.key),['existing_membership']);assert.equal((await fresh.get('/api/coffer/donors')).total,0)})
  const list=await h.command('list.save',{name:'Imported board',filters:{customKey:'existing_membership',customValue:'Board'}})
  assert.deepEqual((await h.get('/api/coffer/lists/'+list.id+'/members')).donorIds,[person.id])
  const built=await h.command('report.save',{name:'Imported gift budget',definition:{recordType:'gifts',columns:['id','custom.import_bloomerang_gift_3','amount_cents'],groupBy:['custom.import_bloomerang_gift_3'],totals:['amount_cents'],filters:[]}})
  const builtReport=await h.get('/api/coffer/reports/builder?id='+built.id);assert.equal(builtReport.totals.amount_cents,7500);assert.ok(builtReport.groups.some(g=>g['custom.import_bloomerang_gift_3']==='12345'))
  const grouped=await h.get('/api/coffer/reports/custom-fields?field=import_bloomerang_gift_3')
  assert.deepEqual(grouped.groups.map(g=>[g.value,g.amountCents,g.giftCount]),[['12345',5000,1],[null,2500,1]])
  const replay=await post(h,'custom-apply',{id,version:updated.review.version});assert.equal(replay.carried,0);assert.equal(replay.tagAssignments,0,'Replaying a reviewed note tag creates no duplicate')
  let current=await readReview(h,id),waiting=current.values.find(v=>v.state==='waiting')
  await post(h,'custom-review',{id,version:current.version,mappings:current.mappings,resolutions:[{...mappedChoice,value:'Board'}]},{status:409})
  let fixed=await post(h,'custom-review',{id,version:current.version,mappings:current.mappings,resolutions:[...current.resolutions,{id:waiting.id,action:'fix',value:'75.25'}]})
  const corrected=await post(h,'custom-review',{id,version:fixed.review.version,mappings:current.mappings,resolutions:[...current.resolutions,{id:waiting.id,action:'fix',value:'75.26'}]})
  fixed=await post(h,'custom-review',{id,version:corrected.review.version,mappings:current.mappings,resolutions:[...current.resolutions,{id:waiting.id,action:'fix',value:'75.25'}]})
  assert.ok(!(await h.get('/api/coffer/donors/'+waitingPerson.id)).customValues.some(v=>v.field_key==='import_bloomerang_gift_3'),'Pending corrections do not write native values before approval')
  await post(h,'custom-apply',{id,version:fixed.review.version})
  assert.equal(JSON.parse((await h.get('/api/coffer/donors/'+waitingPerson.id)).customValues.find(v=>v.field_key==='import_bloomerang_gift_3').value),'7525')
  await h.command('custom.define',{...fields.find(f=>f.key==='import_bloomerang_note_5'),label:'Edited later',choices:[]})
  await post(h,'undo',{id},{status:409})
  edge.setOffset(1000)
  const next=await imported(h,sourceFiles(1000)),reuse=await post(h,'custom-capture',{id:next,apiKey:capture.apiKey})
  assert.equal(reuse.review.mappings.find(m=>m.id==='constituent:1').field.key,'existing_membership');assert.equal(reuse.review.mappings.find(m=>m.id==='constituent:6').action,'tags');assert.equal(reuse.review.mappings.find(m=>m.id==='constituent:7').action,'skip')
  const changed=await h.command('custom.define',{...fields.find(f=>f.key==='import_bloomerang_interaction_4'),label:'Changed after source review',choices:[]})
  assert.ok(changed.version>1)
  await post(h,'custom-apply',{id:next,version:reuse.review.version},{status:409})
  edge.setOffset(0)
  const shared=await imported(h,{...sourceFiles(),noGoodsOrServices:true});await post(h,'custom-capture',{id:shared,apiKey:capture.apiKey})
  const survivor=await h.command('donor.create',{name:'Synthetic Source Survivor'})
  const comparison=await h.get('/api/coffer/duplicates/compare?source='+person.id+'&target='+survivor.id)
  await h.command('donor.merge',{sourceDonorId:person.id,donorId:survivor.id,sourceVersion:comparison.source.version,version:comparison.target.version,fields:{},reason:'duplicate_record'})
  const pendingReview=await readReview(h,shared),mergeMappings=pendingReview.mappings.map(m=>m.id==='constituent:7'?{...m,action:'field',field:{...m.field,key:'merge_source_detail'}}:{...m,action:'skip'})
  const mergedReview=await post(h,'custom-review',{id:shared,version:pendingReview.version,mappings:mergeMappings,resolutions:[]})
  await post(h,'custom-apply',{id:shared,version:mergedReview.review.version})
  assert.equal((await h.get('/api/coffer/donors/'+survivor.id)).customValues.find(v=>v.field_key==='merge_source_detail').record_id,survivor.id,'Source constituent values resolve to the current merged constituent')
  await h.command('donor.erase',{donorId:survivor.id,confirm:'ERASE'})
  assert.equal((await h.get(endpoint+'journal?id='+id)).job.redacted,1)
  await post(h,'custom-capture',capture,{status:409});await post(h,'custom-apply',{id,version:fixed.review.version},{status:409})
  const sharedJournal=(await h.get(endpoint+'journal?id='+shared)).job;assert.equal(sharedJournal.redacted,1);assert.deepEqual(sharedJournal.report,{},'Erasure redacts a capture of previously imported records before any custom apply')
  assert.equal((await h.get(endpoint+'journal?id='+older.id)).job.redacted,1,'Erasure also retires a preview made before the source donor existed')
  const retiredPreview=await h.request('/app/move-in/crm/review?id='+older.id);assert.equal(retiredPreview.status,409);assert.ok(!(await retiredPreview.text()).includes('Synthetic Source Fields'))
  await post(h,'apply',{id:older.id,fingerprint:older.fingerprint},{status:409})
  const after=await archive(h,{maxParts:100});assert.ok(!JSON.stringify(after).includes('Preserve original note'),'Erasure removes source review values and provenance')
  const admin=await h.person('synthetic-coffer-1602'+String.fromCharCode(64)+'example.test','admin')
  await h.get(endpoint+'custom-review?id='+next,{as:admin.cookie})
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  await post(h,'custom-apply',{id:next,version:reuse.review.version},{as:admin.cookie,status:401})
  edge.setOffset(2000)
  const refused=await imported(h,sourceFiles(2000));edge.revoke()
  await post(h,'custom-capture',{id:refused,apiKey:capture.apiKey},{status:502})
  assert.equal((await h.get(endpoint+'journal?id='+refused)).job.report.customReview,undefined,'Revoked source authority writes no custom capture')
  await post(h,'custom-capture',{id:next,apiKey:capture.apiKey}) // Existing capture is a native retained review, with no provider submission.
 },{outbound:edge.outbound})
 await largeCustomReviewJourney()
}

/** A normal complete source account whose retained originals exceed one database value. */
async function largeCustomReviewJourney(){
 const edge=bloomerangEdge({large:true})
 await run(async h=>{
  const id=await imported(h,sourceFiles()),capture={id,apiKey:'synthetic-coffer-1600'}
  const {review}=await post(h,'custom-capture',capture)
  assert.ok(Buffer.byteLength(JSON.stringify(review))>1000000,'The public source read retains a review larger than a single database value')
  assert.ok(Buffer.byteLength(JSON.stringify(review.definitions))>2000000,'Complete source definitions exceed a single database parameter')
  const original=review.definitions.find(d=>d.id==='constituent:189').values[1].value
  assert.equal((await readReview(h,id)).definitions.find(d=>d.id==='constituent:189').values[1].value,original)
  const mappings=review.mappings.map(m=>m.id==='note:8'?{...m,action:'tags'}:m)
  const updated=await post(h,'custom-review',{id,version:review.version,mappings,resolutions:[]})
  await post(h,'custom-apply',{id,version:updated.review.version})
  const people=(await h.get('/api/coffer/donors')).donors
  for(const person of people){
   const detail=await h.get('/api/coffer/donors/'+person.id)
   assert.equal(detail.customValues.filter(v=>/^import_bloomerang_constituent_1[0-9][0-9]$/.test(v.field_key)).length,90)
   assert.equal(JSON.parse(detail.customValues.find(v=>v.field_key==='import_bloomerang_constituent_189').value),original)
  }
  const definitions=(await h.get('/api/coffer/custom-fields')).fields
  assert.deepEqual(JSON.parse(definitions.find(f=>f.key==='import_bloomerang_gift_209').choices),review.definitions.find(d=>d.id==='gift:209').choices,'Every unused source choice survives definition creation')
  const beforeSkip=await readReview(h,id),waitingChoice=beforeSkip.values.find(v=>v.fieldId==='constituent:1'&&v.state==='waiting')
  const skipped=await post(h,'custom-review',{id,version:beforeSkip.version,mappings:beforeSkip.mappings,resolutions:[{id:waitingChoice.id,action:'skip'}]})
  assert.deepEqual(skipped.review.counts.find(c=>c.id==='constituent:1'),{id:'constituent:1',name:'Membership',defined:1,source:2,carried:1,waiting:0,skipped:1},'An explicit skip reconciles the invalid source choice without inventing a value')
  assert.equal(skipped.review.values.find(v=>v.id===waitingChoice.id).original,'Unlisted','Skipped source values remain available in the review')
  assert.equal((await post(h,'custom-apply',{id,version:skipped.review.version})).unchanged,true,'Skipping a waiting value never changes carried records')
  const waitingPerson=people.find(p=>p.name==='Synthetic Waiting Values')
  assert.ok(!(await h.get('/api/coffer/donors/'+waitingPerson.id)).customValues.some(v=>v.field_key==='import_bloomerang_constituent_1'),'The skipped source choice creates no native value')
  const applied=(await readReview(h,id)),saved=await archive(h,{maxParts:100})
  const savedReviewRows=saved.flatMap(part=>part.items??[]).filter(item=>item.table==='cf_move_in_custom_reviews')
  assert.ok(savedReviewRows.length>1,'The archive carries all bounded custom review rows')
  await run(async fresh=>{
   await restore(fresh,saved)
   assert.deepEqual(await readReview(fresh,id),applied,'Restore retains every review original, resolution and applied value')
   assert.equal((await post(fresh,'custom-apply',{id,version:applied.version})).unchanged,true)
   await post(fresh,'undo',{id})
   assert.deepEqual((await fresh.get('/api/coffer/custom-fields')).fields,[],'Undo removes all untouched definitions from a large custom review')
   assert.equal((await fresh.get('/api/coffer/donors')).total,0)
  })
  await h.command('donor.erase',{donorId:people[0].id,confirm:'ERASE'})
  await post(h,'custom-apply',{id,version:applied.version},{status:409})
  const erased=await archive(h,{maxParts:100})
  assert.deepEqual(erased.flatMap(part=>part.items??[]).filter(item=>item.table==='cf_move_in_custom_reviews'),[],'Erasure deletes every durable review original, including a shared capture')
 },{outbound:edge.outbound})
}
