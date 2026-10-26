import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {run,donor,settings,archive,restore} from './harness.mjs'

export async function callPrioritiesJourney(){
 const chimp=JSON.parse(await readFile('tests/fixtures/mailchimp/responses.json','utf8'))
 let recipientEmail='',sent=false
 const member=()=>({id:'fixture-contact',email_address:recipientEmail,status:'subscribed'})
 const outbound=async request=>{
  const key=request.method+' '+new URL(request.url).pathname
  if(key==='GET /3.0/lists')return Response.json({lists:[{id:'fixture-list',name:'Reading partners',stats:{member_count:1}}]})
  if(key==='GET /3.0/lists/fixture-list/merge-fields')return Response.json({merge_fields:['CF_INFORM','CF_FORMAL','CF_ENVELOP','CF_PREFIX','CF_FIRST','CF_MIDDLE','CF_LAST','CF_SUFFIX','CF_NICK'].map(tag=>({tag,type:'text'})),total_items:9})
  if(/^PATCH \/3.0\/lists\/fixture-list\/members\//.test(key))return Response.json({...member(),merge_fields:(await request.json()).merge_fields})
  if(/^GET \/3.0\/lists\/fixture-list\/members\//.test(key))return Response.json(member())
  if(key==='POST /3.0/lists/fixture-list/segments')return Response.json(chimp.static_segment)
  if(key==='GET /3.0/lists/fixture-list/segments/101/members')return Response.json({total_items:1,members:[member()]})
  if(key==='POST /3.0/campaigns')return Response.json(chimp.campaign_saved)
  if(key==='GET /3.0/campaigns/fixture-campaign')return Response.json(sent?chimp.campaign_sent:chimp.campaign_saved)
  if(key==='PATCH /3.0/campaigns/fixture-campaign'||key==='PUT /3.0/campaigns/fixture-campaign/content')return Response.json({})
  if(key==='POST /3.0/campaigns/fixture-campaign/actions/send'){sent=true;return new Response(null,{status:204})}
  assert.fail('Unexpected provider request '+key)
 }
 await run(async h=>{
  let now='2026-10-26T12:00:00Z'
  const headers=()=>({'x-test-now':now})
  let cookie=h.owner
  const get=(path,options={})=>h.get(path,{as:cookie,...options,headers:headers()})
  const command=(name,input,options={})=>h.command(name,input,{as:cookie,...options,headers:headers()})
  const signIn=async()=>{
   const requested=await h.request('/auth/magic-link',{method:'POST',as:'',headers:headers(),body:{email:'owner@example.test'}})
   assert.equal(requested.status,202)
   const message=h.messages.findLast(m=>m.subject.startsWith('Your sign-in link'))
   const link=message.text.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0]
   const confirmed=await h.request('/auth/confirm',{method:'POST',as:'',headers:headers(),body:{token:new URL(link).searchParams.get('token')}})
   assert.equal(confirmed.status,303);cookie=confirmed.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
  }
  const tick=async()=>{const response=await h.mf.dispatchFetch(h.origin+'/cdn-cgi/local/scheduled?time='+Date.parse(now.replace('12:','13:'))+'&format=json');assert.equal(response.status,200,await response.text())}
  const s=await get('/api/coffer/settings');await command('settings.update',{...settings,version:s.version,fiscalYearStart:'10-28'})
  const owner=(await get('/auth/session')).operator,manager=await h.person('jordan@example.test')
  const portfolio=await command('portfolio.save',{name:'Reading room partners',managerId:manager.id,untouchedDays:30})
  const protectedDonor=await donor(h,'Rosa Morgan',{phone:'202-555-0110'}),upgrade=await donor(h,'Sam Okafor',{phone:'202-555-0111'})
  const lapses=[]
  for(const name of ['Amelia Chen','Ben Rivera','Cora Lee','Dalia Brooks','Eli Patel','Fern Jones'])lapses.push(await donor(h,name,{phone:'202-555-0120'}))
  const inactive=await donor(h,'Inactive Partner'),deceased=await donor(h,'Deceased Partner'),withdrawn=await donor(h,'Phone Permission Withdrawn')
  const gift=(d,amount,receivedOn)=>command('gift.record',{donorId:d.id,amount,receivedOn,method:'check',goods:'none',fund:'Library'})
  for(const d of [protectedDonor,upgrade,...lapses,inactive,deceased,withdrawn]){
   await command('portfolio.assign',{donorId:d.id,portfolioId:portfolio.id})
   await gift(d,'100','2025-10-01')
  }
  await gift(lapses[0],'25','2024-10-26')
  for(const d of [protectedDonor,upgrade])await gift(d,'300','2026-09-01')
  await command('donor.profile',{donorId:inactive.id,version:(await get('/api/coffer/donors/'+inactive.id)).donor.version,constituentStatus:'inactive',statusReason:'Requested a pause'})
  await command('donor.profile',{donorId:deceased.id,version:(await get('/api/coffer/donors/'+deceased.id)).donor.version,constituentStatus:'deceased',deceasedOn:'2026-10-01'})
  await command('consent.record',{donorIds:[withdrawn.id],channel:'phone',status:'withdrawn',method:'verbal',evidence:'synthetic-coffer-9201',capturedOn:'2026-10-20'})
  await command('solicitation.set',{donorId:protectedDonor.id,version:0,type:'stop',startsOn:'2026-10-20',source:'person',sourceRef:'synthetic-coffer-9202'})
  await command('pledge.create',{donorId:protectedDonor.id,amount:'50',pledgedOn:'2026-10-20',fund:'Library',installments:[{dueOn:'2026-10-25',amount:'50'}]})
  // A real sent communication and inbound email edge supply the unanswered reply.
  recipientEmail=(await get('/api/coffer/donors/'+lapses[0].id)).donor.email
  await command('consent.record',{donorIds:[lapses[0].id],channel:'email',status:'granted',method:'paper form',evidence:'synthetic-coffer-9203',capturedOn:'2026-10-20'})
  await command('marketing.connectMailchimp',{apiKey:'synthetic-coffer-9200'.replaceAll('-','')+'-us21'})
  await command('marketing.chooseAudience',{listId:'fixture-list',fromName:'Riverbend team',fromEmail:'replies@example.test'})
  const appeal=await command('appeal.prepare',{name:'Reading room update',channel:'email',subject:'Reading room update',body:'Dear {{donor_name}}, thank you for supporting the reading room.'})
  await command('appeal.approve',{appealId:appeal.id,version:appeal.version})
  assert.equal((await command('appeal.send',{appealId:appeal.id,version:2})).submitted,1)
  const reply=await h.request('/test-email',{method:'POST',headers:headers(),body:{from:recipientEmail,to:'replies@example.test',headers:{subject:'Re: Reading room update','message-id':'<synthetic-coffer-9204@example.test>'},raw:'Content-Type: text/plain; charset=utf-8\r\n\r\nPlease call me about the reading room.'}})
  assert.equal(reply.status,200);assert.equal((await reply.json()).forwarded.length,1)
  await command('calls.rank',{managerId:manager.id},{as:manager.cookie,status:403})
  await command('task.teamSave',{operatorId:manager.id,managerId:owner.id,weeklyCallCapacity:5,version:0},{as:manager.cookie,status:403})
  await command('calls.policy',{version:1,windowDays:1},{as:manager.cookie,status:403})
  await get('/api/coffer/agent/calls',{as:'',status:401})
  if(!process.env.COFFER_CALLS_BROWSER){
   await command('task.teamSave',{operatorId:manager.id,managerId:owner.id,weeklyCallCapacity:5,version:0})
   await command('calls.policy',{version:1,windowDays:1})
  }
  const data={manager,owner,protectedDonor,now,setNow:value=>{now=value}}
  let ranked
  if(process.env.COFFER_CALLS_BROWSER){const {callPrioritiesBrowser}=await import('./call-priorities-browser.mjs');ranked=await callPrioritiesBrowser(h,{...data,stage:'rank'},process.env.COFFER_CALLS_BROWSER)}
  else ranked=await command('calls.rank',{managerId:manager.id})
  const runId=ranked.run.id
  assert.equal(ranked.entries.length,5);assert.equal(ranked.overflow.length,3)
  assert.deepEqual(new Set([...ranked.entries,...ranked.overflow].map(r=>r.donor_id)),new Set([protectedDonor,upgrade,...lapses].map(d=>d.id)))
  const thankful=ranked.entries.find(r=>r.donor_id===protectedDonor.id)
  assert.ok(thankful);assert.equal(thankful.is_ask,0);assert.match(thankful.reason,/Thank-you/)
  assert.ok(thankful.facts.signals.upgrade&&thankful.facts.signals.pledge)
  const anniversary=ranked.entries.find(r=>r.donor_id===lapses[0].id)
  assert.ok(anniversary.facts.signals.anniversary&&anniversary.facts.signals.reply)
  assert.ok([...ranked.entries,...ranked.overflow].some(r=>r.facts.signals.lapse&&r.facts.signals.silent))
  const tasks=(await get('/api/coffer/tasks?owner='+manager.id)).tasks.filter(t=>t.source_kind==='ranked')
  assert.equal(tasks.length,5);assert.ok(tasks.every(t=>t.owner_id===manager.id&&t.reason.length>0))
  assert.equal(tasks.find(t=>t.donor_id===protectedDonor.id).is_ask,0)
  assert.equal((await command('calls.rank',{managerId:manager.id})).run.id,runId)
  const called=ranked.entries.filter(r=>r.donor_id!==protectedDonor.id).slice(0,3)
  if(process.env.COFFER_CALLS_BROWSER){const {callPrioritiesBrowser}=await import('./call-priorities-browser.mjs');await callPrioritiesBrowser(h,{...data,stage:'complete',called,runId},process.env.COFFER_CALLS_BROWSER)}
  else for(const row of called){const task=tasks.find(t=>t.id===row.task_id);await command('task.complete',{taskId:task.id,version:task.version,outcome:'connected',notes:'Discussed the reading-room renewal and answered questions.'},{as:manager.cookie})}
  const outcome=()=>get('/api/coffer/agent/calls/outcomes?runId='+runId)
  let measured=await outcome();assert.equal(measured.called.count,3);assert.equal(measured.called.rate,null)
  assert.ok(measured.rows.filter(r=>r.called).every(r=>r.gaveWithinWindow===null&&r.retained===null))
  now='2026-10-27T12:00:00Z'
  for(const row of called.slice(0,2))await gift({id:row.donor_id},'75','2026-10-27')
  now='2026-10-29T12:00:00Z'
  measured=await outcome()
  assert.equal(measured.fiscalClosed,true)
  assert.deepEqual([measured.called.count,measured.called.priorDonors,measured.called.retained,measured.called.rate],[3,3,2,2/3])
  assert.deepEqual([measured.uncalled.count,measured.uncalled.priorDonors,measured.uncalled.retained,measured.uncalled.rate],[5,5,2,2/5])
  for(const row of called){const value=measured.rows.find(r=>r.donorId===row.donor_id),gave=called.slice(0,2).some(r=>r.id===row.id);assert.equal(value.called,true);assert.equal(value.gaveWithinWindow,gave);assert.equal(value.retained,gave)}
  for(const row of measured.rows.filter(r=>!r.called)){assert.equal(row.gaveWithinWindow,null);assert.equal(row.retained,[protectedDonor.id,upgrade.id].includes(row.donorId))}
  await get('/api/coffer/agent/calls/outcomes?runId='+runId,{as:manager.cookie,status:403})
  if(process.env.COFFER_CALLS_BROWSER){const {callPrioritiesBrowser}=await import('./call-priorities-browser.mjs');await callPrioritiesBrowser(h,{...data,now,stage:'outcomes',runId},process.env.COFFER_CALLS_BROWSER)}
  const saved=await archive(h)
  await run(async fresh=>{await restore(fresh,saved);const copied=await fresh.get('/api/coffer/agent/calls?runId='+runId,{headers:headers()});assert.equal(copied.entries.length,5);assert.equal(copied.overflow.length,3)},{entry:'tests/advancing-clock-worker.ts',bindings:{COFFER_TEST_NOW:now}})
  // Background ranking starts stopped, obeys selected scope, current limits and shared kill.
  now='2026-11-02T12:00:00Z';await signIn();await tick()
  assert.equal((await get('/api/coffer/agent/calls?managerId='+manager.id)).runs.length,1)
  const grant=()=>get('/api/coffer/agent/grants').then(rows=>rows.find(r=>r.id==='calls'))
  let g=await grant()
  const saveGrant=p=>h.api('/api/coffer/agent/grants',{id:'calls',version:g.version,scope:'selected',donorIds:called.map(r=>r.donor_id).join(','),enabled:true,dailyLimit:2,...p},{as:cookie,headers:headers()})
  await saveGrant({});await tick()
  assert.equal((await get('/api/coffer/agent/calls?managerId='+manager.id)).runs.length,1,'three tasks cannot exceed a two-action grant')
  g=await grant();await saveGrant({dailyLimit:3});await tick();await tick()
  const weekly=await get('/api/coffer/agent/calls?managerId='+manager.id)
  assert.equal(weekly.runs.length,2);assert.deepEqual(new Set(weekly.entries.map(r=>r.donor_id)),new Set(called.map(r=>r.donor_id)))
  const control=(await get('/api/coffer/agent-grants')).control
  await command('agentGrant.kill',{version:control.version,enabled:false});now='2026-11-09T12:00:00Z';await signIn();await tick()
  assert.equal((await get('/api/coffer/agent/calls?managerId='+manager.id)).runs.length,2)
  await command('donor.erase',{donorId:lapses[0].id,confirm:'ERASE'})
  assert.ok(!JSON.stringify(await outcome()).includes('Amelia Chen'))
 },{entry:'tests/engagement-worker.ts',triggerHandlers:true,outbound,bindings:{COFFER_TEST_NOW:'2026-10-26T12:00:00Z',COFFER_REPLY_ADDRESS:'replies@example.test'}})
}
