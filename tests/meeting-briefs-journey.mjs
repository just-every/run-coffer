import assert from 'node:assert/strict'
import {run,donor,archive,restore,reviewed} from './harness.mjs'

export async function meetingBriefJourney() {
 await run(async h=>{
  await reviewed(h)
  const d=await donor(h,'Ada Mercer'),related=await donor(h,'Sam Mercer')
  const member=await h.person('meeting-entry@example.test')
  const owner=(await h.get('/auth/session')).operator
  const route=id=>`/api/coffer/meetings/${id}/brief`
  const start='2030-02-02T12:00:00.000Z', due='2030-02-01T12:00:00.000Z'
  const tick=async at=>{const response=await h.mf.dispatchFetch(h.origin+'/cdn-cgi/local/scheduled?time='+Date.parse(at)+'&format=json');assert.equal(response.status,200,await response.text())}
  const gift=await h.command('gift.record',{donorId:d.id,amount:'125',receivedOn:'2026-01-01',method:'check',goods:'none',fund:'Library'})
  await h.command('gift.reverse',{giftId:gift.id,reason:'entry_error'})
  await h.command('gift.record',{donorId:d.id,amount:'75',receivedOn:'2026-01-02',method:'check',goods:'none',fund:'Library'})
  const conversation=await h.command('interaction.record',{donorId:d.id,kind:'meeting',occurredOn:'2026-01-03',who:'Morgan',notes:'Discussed the library proposal.',nextStep:'Ask about a follow-up visit.'})
  const relationship=await h.command('relationship.create',{donorId:d.id,relatedDonorId:related.id,type:'spouse'})
  const pledge=await h.command('pledge.create',{donorId:d.id,amount:'90',pledgedOn:'2026-01-03',fund:'Library',installments:[{dueOn:'2030-03-01',amount:'90'}]})
  const opportunity=await h.command('prospect.save',{donorId:d.id,ownerId:owner.id,stage:'cultivate',askAmount:'500',expectedCloseOn:'2030-03-01',nextStep:'Review the proposal.'})
  await h.command('research.connect',{provider:'wealthengine',apiKey:'synthetic-meeting-research-edge'})
  await h.command('research.screen',{donorIds:[d.id]})
  const schedule={donorId:d.id,startsAt:start}
  await h.command('meeting.schedule',schedule,{as:'',status:401})
  await h.get('/api/coffer/meetings',{as:'',status:401})
  const agent=await h.command('agent.create',{label:'Meeting refusal'})
  const asAgent={as:'',headers:{authorization:'Bearer '+agent.token},status:403}
  await h.command('meeting.schedule',schedule,asAgent)
  await h.get('/api/coffer/meetings',asAgent)
  for(const bad of ['2030-02-31T12:00:00.000Z','2030-02-02T12:00:00','2020-01-01T00:00:00.000Z'])await h.command('meeting.schedule',{...schedule,startsAt:bad},{status:400})
  await h.command('meeting.schedule',{...schedule,donorId:'unknown'},{status:409})
  const meeting=await h.command('meeting.schedule',schedule,{as:member.cookie})
  assert.equal(meeting.prepareAt,due)
  await h.get(route(meeting.id),{status:409})
  await tick('2030-02-01T11:59:59.999Z')
  await h.get(route(meeting.id),{status:409})
  await tick(due)
  const brief=await h.get(route(meeting.id))
  assert.equal(brief.meeting.ready_at,due)
  assert.equal(brief.lines.find(l=>l.kind==='giving_summary').facts.lifetimeCents,7500)
  assert.ok(brief.lines.some(l=>l.kind==='interaction'&&l.facts.id===conversation.id))
  assert.ok(brief.lines.some(l=>l.kind==='relationship'&&l.facts.id===relationship.id))
  assert.ok(brief.lines.some(l=>l.kind==='pledge'&&l.facts.id===pledge.id))
  assert.ok(brief.lines.some(l=>l.kind==='opportunity'&&l.facts.id===opportunity.id))
  assert.equal(brief.lines.find(l=>l.kind==='stored_research').facts.capacity_range,'$100K-$200K')
  // Every line resolves to the exact existing record, never a model inference.
  for(const line of brief.lines){
   let source=await h.get(line.source.href)
   for(const part of line.source.pointer.split('/').filter(Boolean))source=source[part]
   if(line.source.id)source=source.find(row=>row.id===line.source.id)
   assert.deepEqual(line.facts,source)
  }
  const entryBrief=await h.get(route(meeting.id),{as:member.cookie})
  assert.ok(entryBrief.lines.some(l=>l.kind==='giving_summary'))
  assert.ok(entryBrief.lines.every(l=>l.kind!=='stored_research'))
  assert.doesNotMatch(JSON.stringify(entryBrief),/100K|200K|wealthengine|synthetic-meeting-research-edge/)
  await h.get(route(meeting.id),asAgent)
  await tick('2030-02-01T12:01:00.000Z')
  assert.equal((await h.get(route(meeting.id))).meeting.ready_at,due)
  // Source changes are reflected immediately: no stale research or giving copy.
  await h.command('gift.record',{donorId:d.id,amount:'25',receivedOn:'2026-01-04',method:'check',goods:'none',fund:'Library'})
  assert.equal((await h.get(route(meeting.id))).lines[0].facts.lifetimeCents,10000)
  const soon=await h.command('meeting.schedule',{donorId:d.id,startsAt:new Date(Date.now()+3600000).toISOString()})
  await tick(new Date().toISOString())
  assert.equal((await h.get(route(soon.id))).meeting.id,soon.id)
  const cancelled=await h.command('meeting.schedule',schedule)
  await h.command('meeting.cancel',{id:cancelled.id,version:99},{status:409})
  await h.command('meeting.cancel',cancelled,{as:member.cookie})
  await tick(due)
  await h.get(route(cancelled.id),{status:409})
  assert.equal((await h.get('/api/coffer/meetings')).find(m=>m.id===cancelled.id).ready_at,null)
  const dataFile=await h.api(`/api/coffer/donors/${d.id}/data-request`,{requestedOn:new Date().toISOString().slice(0,10),method:'email'})
  assert.ok(dataFile.records.donor_meetings.some(m=>m.id===meeting.id))
  const backup=await archive(h)
  await run(async fresh=>{
   await restore(fresh,backup)
   assert.equal((await fresh.get(route(meeting.id))).lines[0].facts.lifetimeCents,10000)
   assert.equal((await fresh.get(route(meeting.id))).meeting.ready_at,due)
  })
  let target=(await h.get(`/api/coffer/donors/${related.id}`)).donor
  let source=(await h.get(`/api/coffer/donors/${d.id}`)).donor
  const merge=await h.command('donor.merge',{sourceDonorId:d.id,donorId:related.id,sourceVersion:source.version,version:target.version,reason:'duplicate_record'})
  assert.equal((await h.get(route(meeting.id))).meeting.donor_id,related.id)
  await h.command('meeting.cancel',meeting,{status:409})
  await h.command('donor.unmerge',{mergeId:merge.mergeId,reason:'incorrect_match'})
  assert.equal((await h.get(route(meeting.id))).meeting.donor_id,d.id)
  source=(await h.get(`/api/coffer/donors/${d.id}`)).donor
  target=(await h.get(`/api/coffer/donors/${related.id}`)).donor
  const merged=await h.command('donor.merge',{sourceDonorId:d.id,donorId:related.id,sourceVersion:source.version,version:target.version,reason:'duplicate_record'})
  await h.command('meeting.schedule',{donorId:related.id,startsAt:'2030-03-01T12:00:00.000Z'})
  await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'},{status:409})
  await h.command('donor.erase',{donorId:related.id,confirm:'ERASE'})
  await h.get(route(meeting.id),{status:404})
  assert.deepEqual(await h.get('/api/coffer/meetings'),[])
  const erased=await archive(h)
  await run(async fresh=>{await restore(fresh,erased);assert.deepEqual(await fresh.get('/api/coffer/meetings'),[])})
 },{triggerHandlers:true,outbound:async request=>{
  assert.equal(new URL(request.url).origin,'https://api.wealthengine.com')
  if(new URL(request.url).pathname==='/v1/session/create')return Response.json({_id:'meeting-session'})
  assert.equal(new URL(request.url).pathname,'/v1/profile/summary/basic')
  const body=await request.json()
  return Response.json({id:12345,client_id:body.client_id,identity:{first_name:'Ada',last_name:'Mercer'},locations:[],giving:{gift_capacity:{text:'$100K-$200K',text_low:'$100K',text_high:'$200K',value:15,min:1,max:20}}})
 }})
}
