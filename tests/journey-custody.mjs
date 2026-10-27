import assert from 'node:assert/strict'
import {run,donor,reviewed} from './harness.mjs'
import {journeyMailEdge} from './journey-mail-edge.mjs'
import {journeyInput} from './journey-actions.mjs'

export async function journeyCapCustody(){
 const edge=journeyMailEdge()
 await run(async h=>{
  await reviewed(h);let at='2026-06-01T12:00:00Z'
  const opts=(extra={})=>({headers:{'x-test-now':at},...extra}),command=(name,p={},extra={})=>h.command(name,p,opts(extra)),get=path=>h.get(path,opts())
  await command('marketing.connectMango',{origin:'https://mango.example.test',credential:'synthetic-coffer-2500'})
  await command('welcome.publish',journeyInput)
  const series=await command('journey.publish',journeyInput)
  at='2026-06-01T13:00:00Z'
  const create=async(name,email)=>{const d=await donor(h,name,{email},opts());await command('consent.record',{donorId:d.id,channel:'email',status:'granted',method:'paper form',evidence:'Synthetic journey consent',capturedOn:at.slice(0,10)});await command('gift.record',{donorId:d.id,amount:'1500',receivedOn:at.slice(0,10),method:'check',goods:'none'});return d}
  const first=await create('Dara Shared','synthetic-coffer-2501@example.test')
  assert.equal((await command('welcome.run')).submitted,1)
  assert.equal((await command('journey.run')).submitted,0)
  let state=await get('/api/coffer/journeys'),e=state.enrollments.find(e=>e.donor_id===first.id)
  assert.equal(e.steps.find(s=>s.step==='thank').status,'pending');assert.match(e.steps.find(s=>s.step==='thank').note,/frequency cap/);assert.equal(edge.handoffs.length,1)
  await command('journey.cap',{capDays:2,confirm:'yes'})
  at='2026-06-02T13:00:00Z';assert.equal((await command('journey.run')).submitted,0)
  at='2026-06-03T13:00:00Z';assert.equal((await command('journey.run')).submitted,1)
  await command('journey.stop',{journeyId:series.id,confirm:'yes'})
  await command('journey.cap',{capDays:1,confirm:'yes'})
  const unknown=await command('journey.publish',{...journeyInput,name:'Recorded uncertain care'})
  const other=await command('journey.publish',{...journeyInput,name:'Second uncertain care'})
  at='2026-06-03T14:00:00Z';const unsure=await create('Terry Uncertain','synthetic-coffer-2502@example.test')
  const before=edge.handoffs.length;edge.state.fail=true
  await command('journey.run',{}, {status:502});edge.state.fail=false
  assert.equal(edge.handoffs.length,before+1)
  const replay=await command('journey.run');assert.equal(replay.submitted,0);assert.equal(replay.held,1)
  state=await get('/api/coffer/journeys');const rows=state.enrollments.filter(e=>e.donor_id===unsure.id)
  assert.deepEqual(rows.map(e=>e.journey_id).sort(),[unknown.id,other.id].sort())
  assert.deepEqual(rows.map(e=>e.steps.find(s=>s.step==='thank').status).sort(),['pending','uncertain'])
  assert.equal(edge.handoffs.length,before+1,'A lost provider answer never causes an automatic retry')
  const history=await get('/api/coffer/donors/'+unsure.id);assert.equal(history.gifts[0].acknowledgment.status,'not acknowledged');assert.equal(history.gifts[0].acknowledgment.outcome_unknown,1)
  const duplicate=await donor(h,'Terry Duplicate',{email:'synthetic-coffer-2503@example.test'},opts()),compare=await get('/api/coffer/duplicates/compare?source='+unsure.id+'&target='+duplicate.id)
  await command('donor.merge',{sourceDonorId:unsure.id,donorId:duplicate.id,sourceVersion:compare.source.version,version:compare.target.version,reason:'duplicate_record'})
  state=await get('/api/coffer/journeys');assert.ok(!state.enrollments.some(e=>e.donor_id===unsure.id));assert.equal((await command('journey.run')).submitted,0)
 },{entry:'tests/journeys-worker.ts',outbound:edge.outbound})
}
export async function anniversaryJourney(){
 await run(async h=>{
  await reviewed(h);let at='2026-02-27T12:00:00Z';const opts=()=>({headers:{'x-test-now':at}}),command=(name,p={})=>h.command(name,p,opts())
  const yes=await donor(h,'Ren Anniversary',{email:'synthetic-coffer-2511@example.test'},opts()),no=await donor(h,'Mara Tomorrow',{email:'synthetic-coffer-2512@example.test'},opts())
  for(const [d,on] of [[yes,'2024-02-28'],[no,'2024-03-01']]){await command('consent.record',{donorId:d.id,channel:'email',status:'granted',method:'paper form',evidence:'Synthetic anniversary consent',capturedOn:'2026-02-27'});await command('gift.record',{donorId:d.id,amount:'20',receivedOn:on,method:'check',goods:'none'})}
  const series=await command('journey.publish',{...journeyInput,trigger:'anniversary',thankKind:'wait',impactKind:'wait',askKind:'wait',askIsAsk:'no'})
  await command('journey.run');assert.deepEqual((await h.get('/api/coffer/journeys')).enrollments,[])
  at='2026-02-28T12:00:00Z';await command('journey.run');let rows=(await h.get('/api/coffer/journeys')).enrollments.filter(e=>e.journey_id===series.id);assert.deepEqual(rows.map(e=>e.donor_id),[yes.id])
  at='2026-03-01T12:00:00Z';await command('journey.run');rows=(await h.get('/api/coffer/journeys')).enrollments.filter(e=>e.journey_id===series.id);assert.deepEqual(rows.map(e=>e.donor_id).sort(),[yes.id,no.id].sort());assert.equal(rows.find(e=>e.donor_id===yes.id).steps.find(s=>s.step==='impact').status,'completed')
 },{entry:'tests/journeys-worker.ts'})
}
