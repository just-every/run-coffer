import {journeyChimpEdge} from './journey-chimp-edge.mjs'
import assert from 'node:assert/strict'
import {run,donor,reviewed} from './harness.mjs'
import {journeyMailEdge} from './journey-mail-edge.mjs'

export const journeyInput={name:'Reading room follow-up',trigger:'gift_amount',amount:'1000',thankSubject:'Thank you {{donor_name}}',thankBody:'Your support helps readers.',impactSubject:'Ask about reading',impactBody:'Discuss the reading room visit.',askSubject:'Reading visit follow-up',askBody:'We would love to hear from you.',impactDays:1,askDays:2,confirm:'yes'}
export async function welcomeClockJourney(){
 const edge=journeyMailEdge()
 await run(async h=>{
  await reviewed(h)
  let at='2026-03-01T12:00:00Z';const options=()=>({headers:{'x-test-now':at}}),command=(name,p)=>h.command(name,p,options())
  await command('marketing.connectMango',{origin:'https://mango.example.test',credential:'synthetic-coffer-2400'})
  await command('welcome.publish',{...journeyInput,impactDays:1,askDays:2})
  const d=await donor(h,'Jordan Welcome',{email:'synthetic-coffer-2401@example.test'},options()),stops=await donor(h,'Alex Welcome',{email:'synthetic-coffer-2402@example.test'},options())
  for(const row of [d,stops])await command('consent.record',{donorId:row.id,channel:'email',status:'granted',method:'paper form',evidence:'Synthetic welcome consent',capturedOn:'2026-03-01'})
  at='2026-03-01T13:00:00Z';for(const row of [d,stops])await command('gift.record',{donorId:row.id,amount:'25',receivedOn:'2026-03-01',method:'check',goods:'none'})
  const tick=async()=>{const r=await h.request('/cdn-cgi/local/scheduled?time='+Date.parse(at)+'&format=json');assert.equal(r.status,200,await r.text())}
  await tick();assert.equal(edge.handoffs.length,2)
  at='2026-03-02T13:00:00Z';await tick();assert.equal(edge.handoffs.length,4)
  await command('gift.record',{donorId:stops.id,amount:'20',receivedOn:'2026-03-02',method:'check',goods:'none'})
  at='2026-03-03T13:00:00Z';await tick();await tick()
  const rows=(await h.get('/api/coffer/welcome',options())).enrollments
  assert.deepEqual(rows.find(e=>e.donor_id===d.id).steps.map(s=>[s.step,s.status]),[['thank','submitted'],['impact','submitted'],['ask','submitted']])
  assert.equal(rows.find(e=>e.donor_id===stops.id).status,'gave');assert.equal(rows.find(e=>e.donor_id===stops.id).steps.find(s=>s.step==='ask').status,'cancelled')
  assert.equal(edge.handoffs.length,5,'Scheduler replay never repeats a submitted step')
 },{entry:'tests/journeys-worker.ts',triggerHandlers:true,outbound:edge.outbound})
}
export async function journeyActions(){
 const edge=journeyChimpEdge(['synthetic-coffer-2411@example.test','synthetic-coffer-2412@example.test'])
 await run(async h=>{
  await reviewed(h)
  let at='2026-05-01T12:00:00Z';const options=(extra={})=>({headers:{'x-test-now':at},...extra}),command=(name,p={},extra={})=>h.command(name,p,options(extra)),get=path=>h.get(path,options())
  await command('marketing.connectMailchimp',{apiKey:'synthetic-coffer-2410'.replaceAll('-','')+'-us21'})
  await command('marketing.chooseAudience',{listId:'synthetic-coffer-2451',fromName:'Reading room',fromEmail:'replies@example.test'})
  const owner=(await get('/auth/session')).operator
  const series=await command('journey.publish',{...journeyInput,impactKind:'task',impactCondition:'replied',askKind:'wait',askIsAsk:'no',ownerId:owner.id})
  at='2026-05-01T13:00:00Z'
  const yes=await donor(h,'Blair Reply',{email:'synthetic-coffer-2411@example.test'},options()),no=await donor(h,'Lane Quiet',{email:'synthetic-coffer-2412@example.test'},options())
  for(const d of [yes,no]){await command('consent.record',{donorId:d.id,channel:'email',status:'granted',method:'paper form',evidence:'Synthetic branch consent',capturedOn:'2026-05-01'});await command('gift.record',{donorId:d.id,amount:'1500',receivedOn:'2026-05-01',method:'check',goods:'none'})}
  await command('journey.run');assert.equal(edge.handoffs.length,2)
  const yesHistory=await get('/api/coffer/donors/'+yes.id),message=yesHistory.communications[0]
  assert.equal(yesHistory.gifts[0].acknowledgment.status,'acknowledged');assert.equal(yesHistory.gifts[0].acknowledgment.communication_id,message.id)
  const results=(await get('/api/coffer/agent/appeals')).journey.find(s=>s.id===message.source_id);assert.equal(results.responses.recipients,2);assert.equal(results.responses.gifts,0)
  const response=await h.request('/test-email',{method:'POST',...options(),body:{from:'synthetic-coffer-2411@example.test',to:'replies@example.test',headers:{subject:'Re: '+message.subject,'message-id':'<synthetic-coffer-2413@example.test>'},raw:'Content-Type: text/plain; charset=utf-8\r\n\r\nI would like a visit.'}})
  assert.equal(response.status,200);assert.equal((await response.json()).rejected,null)
  at='2026-05-02T13:00:00Z';const ran=await command('journey.run');assert.equal(ran.tasks,1)
  let state=await get('/api/coffer/journeys');assert.equal(state.enrollments.find(e=>e.donor_id===no.id).steps.find(s=>s.step==='impact').status,'skipped')
  const tasks=(await get('/api/coffer/tasks')).tasks.filter(t=>t.source_kind==='journey')
  assert.deepEqual(tasks.map(t=>[t.donor_id,t.owner_id,t.reason]),[[yes.id,owner.id,'Ask about reading\n\nDiscuss the reading room visit.']])
  await command('journey.run');assert.equal((await get('/api/coffer/tasks')).tasks.filter(t=>t.source_kind==='journey').length,1)
  at='2026-05-03T13:00:00Z';assert.equal((await command('journey.run')).waited,2);assert.equal(edge.handoffs.length,2)
  state=await get('/api/coffer/journeys');assert.deepEqual(state.enrollments.filter(e=>e.journey_id===series.id).map(e=>e.status),['completed','completed'])
  // A saved list is a native live selection, and status undo does not resume work.
  const list=await command('list.save',{name:'Reading visitors',filters:{q:'Blair Reply'}})
  const saved=await command('journey.publish',{...journeyInput,name:'Visitor check-in',trigger:'saved_list',listId:list.id,thankKind:'wait',impactKind:'wait',askKind:'wait',askIsAsk:'no'})
  await command('journey.run');state=await get('/api/coffer/journeys');assert.deepEqual(state.enrollments.filter(e=>e.journey_id===saved.id).map(e=>e.donor_id),[yes.id])
  const bulk=await command('list.profile',{listId:list.id,version:1,kind:'status',status:'inactive',statusReason:'Donor pause',reason:'Synthetic requested pause'})
  state=await get('/api/coffer/journeys');assert.equal(state.enrollments.find(e=>e.journey_id===saved.id).status,'inactive')
  await command('list.profileUndo',{jobId:bulk.id,version:1});state=await get('/api/coffer/journeys');assert.equal(state.enrollments.find(e=>e.journey_id===saved.id).status,'inactive')
  await command('list.restorePending',{jobId:bulk.id,version:2,confirm:'yes'});state=await get('/api/coffer/journeys');assert.equal(state.enrollments.find(e=>e.journey_id===saved.id).status,'active')
  const changed=(await get('/api/coffer/donors/'+yes.id)).donor
  await command('donor.update',{donorId:yes.id,version:changed.version,name:'Blair Elsewhere',email:changed.email});await command('journey.run');state=await get('/api/coffer/journeys');assert.equal(state.enrollments.find(e=>e.journey_id===saved.id).status,'left list')
 },{entry:'tests/journeys-worker.ts',outbound:edge.outbound,bindings:{COFFER_REPLY_ADDRESS:'replies@example.test'}})
}
