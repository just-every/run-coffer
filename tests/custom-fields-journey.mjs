import assert from 'node:assert/strict'
import {run,donor,reviewed,archive,restore} from './harness.mjs'
import {parseCsv as csv} from './exports-journey.mjs'

export async function customFieldsJourney(){
 await run(async h=>{
  await reviewed(h)
  const a=await donor(h,'Avery Custom'),b=await donor(h,'Blair Custom'),other=await donor(h,'Casey Custom')
  const member=await h.person('synthetic-coffer-1400@example.test')
  for(const [key,kind,type,entry,choices] of [['membership','constituent','text','pick-one',['Board','Volunteer']],['interests','constituent','text','pick-many',['Books','Music']],['budget','gift','currency','free-form',[]],['topic','interaction','text','free-form',[]],['pledge_year','pledge','year','free-form',[]],['prospect_ready','opportunity','checkbox','free-form',[]],['note_date','note','date','free-form',[]]])await h.command('custom.define',{key,label:key,kind,type,entry,choices})
  await h.command('tag.category',{name:'Engagement'})
  for(const name of ['board','alumni'])await h.command('tag.define',{name,category:'Engagement'})
  await h.command('custom.set',{key:'membership',recordId:a.id,value:'Unlisted'},{status:400})
  for(const d of [a,b]){
   await h.command('custom.set',{key:'membership',recordId:d.id,value:'Board'})
   await h.command('custom.set',{key:'interests',recordId:d.id,value:['Books','Music']})
   await h.command('consent.record',{donorIds:[d.id],channel:'email',status:'granted',method:'written',evidence:'synthetic-coffer-1401',capturedOn:'2025-01-01'})
  }
  const list=await h.command('list.save',{name:'Board custom list',filters:{customKey:'membership',customValue:'Board'}})
  for(const tag of ['board','alumni'])await h.command('list.bulk',{listId:list.id,version:1,actions:[{type:'tag.add',tag}],reason:'synthetic-coffer-1402'})
  const combined=await h.command('list.save',{name:'Tagged board list',filters:{customKey:'membership',customValue:'Board',tag:'board'}})
  const appeal=await h.command('appeal.prepare',{name:'Custom board appeal',channel:'email',listId:combined.id})
  assert.deepEqual((await h.get('/api/coffer/appeals/'+appeal.id)).recipients.map(r=>r.donor_id).sort(),[a.id,b.id].sort())
  const give=(d,amount,customFields)=>h.command('gift.record',{donorId:d.id,amount,receivedOn:'2025-03-01',method:'check',goods:'none',customFields})
  await h.command('gift.record',{donorId:a.id,amount:'1',receivedOn:'2025-03-01',method:'check',goods:'none',customFields:{budget:'not a number'}},{status:400})
  const g1=await give(a,'100.25',{budget:'250.50'}),g2=await give(b,'50.10',{budget:'250.50'});await give(other,'30',{})
  const call=await h.command('interaction.record',{donorId:a.id,kind:'call',occurredOn:'2025-03-02',notes:'synthetic-coffer-1403'})
  await h.command('custom.set',{key:'topic',recordId:call.id,value:'Library visit'})
  await h.command('gift.reverse',{giftId:g2.id,reason:'synthetic-coffer-1404'})
  const before=await h.get('/api/coffer/reports/custom-fields?field=budget')
  assert.deepEqual(before.groups.map(g=>[g.value,g.amountCents,g.giftCount]),[['25050',10025,2],[null,3000,1]])
  assert.equal(before.totalCents,13025);assert.equal(before.giftCount,3)
  const reportCsv=await h.request('/api/coffer/reports/custom-fields.csv?field=budget');assert.equal(reportCsv.status,200);assert.match(await reportCsv.text(),/250\.50/)
  await h.get('/api/coffer/reports/custom-fields?field=budget',{as:member.cookie,status:403})
  const rows=async type=>csv(await (await h.request('/api/coffer/exports/'+type+'.csv?q=Custom')).text())
  assert.equal(JSON.parse((await rows('gifts')).find(g=>g.id===g1.id).custom_fields).budget,'25050')
  assert.equal(JSON.parse((await rows('interactions')).find(g=>g.id===call.id).custom_fields).topic,'Library visit')
  const renamed=await h.command('custom.renameChoice',{key:'membership',version:1,from:'Board',to:'Trustee'})
  assert.equal(renamed.changed,2)
  await h.command('custom.renameChoice',{key:'membership',version:1,from:'Trustee',to:'Leader'},{status:409})
  await h.command('custom.renameChoice',{key:'interests',version:1,from:'Music',to:'Arts'})
  const constituents=await rows('constituents')
  for(const d of [a,b]){const r=constituents.find(r=>r.id===d.id);assert.equal(JSON.parse(r.custom_fields).membership,'Trustee');assert.deepEqual(JSON.parse(r.custom_fields).interests,['Books','Arts']);assert.deepEqual(JSON.parse(r.tags).sort(),['alumni','board'])}
  const followed=await h.command('appeal.prepare',{name:'Renamed current board',channel:'email',listId:combined.id})
  assert.deepEqual((await h.get('/api/coffer/appeals/'+followed.id)).recipients.map(r=>r.donor_id).sort(),[a.id,b.id].sort())
  const session=await h.get('/auth/session'),stages=await h.get('/api/coffer/prospect-stages')
  const pledge=await h.command('pledge.create',{donorId:a.id,amount:'60',pledgedOn:'2025-03-01',fund:'Library',installments:[{amount:'60',dueOn:'2025-12-01'}]})
  const prospect=await h.command('prospect.save',{donorId:a.id,ownerId:session.operator.id,label:'Library next year',stage:stages.stages.find(s=>s.outcome==='open').id,askAmount:'60',expectedCloseOn:'2025-12-01',nextStep:'Discuss the library'})
  const note=await h.command('interaction.record',{donorId:a.id,kind:'note',occurredOn:'2025-03-02',notes:'synthetic-coffer-1405'})
  await h.command('custom.set',{key:'pledge_year',recordId:pledge.id,value:2027})
  await h.command('custom.set',{key:'prospect_ready',recordId:prospect.id,value:true})
  await h.command('custom.set',{key:'note_date',recordId:note.id,value:'2025-03-02'})
  assert.equal(JSON.parse((await rows('pledges')).find(r=>r.id===pledge.id).custom_fields).pledge_year,'2027')
  assert.equal(JSON.parse((await rows('opportunities')).find(r=>r.id===prospect.id).custom_fields).prospect_ready,'true')
  assert.equal(JSON.parse((await rows('interactions')).find(r=>r.id===note.id).custom_fields).note_date,'2025-03-02')
  if(process.env.COFFER_CUSTOM_BROWSER){const {customFieldsBrowser}=await import('./custom-fields-browser.mjs');await customFieldsBrowser(h,{donorId:a.id,giftId:g1.id,directory:process.env.COFFER_CUSTOM_BROWSER})}
  const secretNote=await h.command('interaction.record',{donorId:a.id,kind:'note',occurredOn:'2025-03-03',notes:'synthetic-coffer-1406 confidential',confidential:true})
  await h.command('custom.set',{key:'note_date',recordId:secretNote.id,value:'2039-05-17'})
  const ownFile=await h.api('/api/coffer/donors/'+a.id+'/data-request',{requestedOn:'2026-10-01',method:'email'})
  assert.ok(!JSON.stringify(ownFile).includes('2039-05-17'),'Confidential-note custom values stay out of the subject file')
  const finalGroups=(await h.get('/api/coffer/reports/custom-fields?field=budget')).groups
  const lines=await archive(h);await run(async fresh=>{await restore(fresh,lines);assert.deepEqual((await fresh.get('/api/coffer/reports/custom-fields?field=budget')).groups,finalGroups)})
 })
}
