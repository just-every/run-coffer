import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {run,donor,reviewed} from './harness.mjs'
import {journeyMailEdge} from './journey-mail-edge.mjs'
import {prepareVerifiedMail} from './verified-mail-edge.mjs'
import {organizationCalendarJourney} from './communication-frequency-journey.mjs'

/** Approval freezes an audience; each actual claim must still honor today's answer. */
export async function communicationClaimsJourney(){
 const at='2026-10-15T16:00:00Z',edge=journeyMailEdge(),texts=[],account='synthetic-coffer-9501',token='synthetic-coffer-9502'
 let duringLookup
 const outbound=async request=>{
  const u=new URL(request.url)
  if(u.hostname==='api.twilio.com'){texts.push(new URLSearchParams(await request.text()));return Response.json({sid:'synthetic-coffer-'+(9510+texts.length),status:'queued'},{status:201})}
  if(duringLookup&&request.method==='GET'&&u.pathname.endsWith('/contacts')){const change=duringLookup;duringLookup=null;await change()}
  return edge.outbound(request)
 }
 await run(async h=>{
  await reviewed(h)
  const headers={'x-test-now':at},options={headers},command=(name,input,extra={})=>h.command(name,input,{...options,...extra})
  const owner=(await h.get('/auth/session')).operator.id
  let fixture=9520
  const create=async(name,channels)=>{
   const d=await donor(h,name,{email:'synthetic-coffer-'+(++fixture)+'@example.test',phone:'+1202555'+String(++fixture).padStart(4,'0')})
   for(const channel of channels.filter(channel=>channel!=='sms'))await command('consent.record',{donorIds:[d.id],channel,status:'granted',method:'paper form',evidence:'Synthetic recorded channel permission',capturedOn:'2026-10-01'})
   if(channels.includes('sms'))await command('sms.preference',{donorId:d.id,status:'granted',phone:(await h.get('/api/coffer/donors/'+d.id)).donor.phone,timezone:'America/New_York',evidence:'Synthetic recorded SMS permission',capturedOn:'2026-10-01'})
   return d
  }
  const prefs=async(d,channel,topics=['newsletter','appeals','events'],frequency='unlimited')=>{
   const current=(await h.get('/api/coffer/donors/'+d.id+'/preferences')).channels.find(p=>p.channel===channel)
   return command('communication.preferences',{donorId:d.id,channel,version:current.version,topics,frequency,confirm:'yes'})
  }
  const list=async(name)=>command('list.save',{name,filters:{q:name}})
  const prepare=async(channel,listId,name='Synthetic approved ask')=>command('appeal.prepare',{name,channel,listId,...(channel==='email'?{subject:'Support the reading room',body:'Please support another reader.'}:{})})
  const approve=async r=>command('appeal.approve',{appealId:r.id,version:r.version})
  const detail=id=>h.get('/api/coffer/appeals/'+id)
  await command('marketing.connectMango',{origin:'https://mango.example.test',credential:'synthetic-coffer-9503'})
  const target=await create('Claim Topic Target',['email','mail','sms','phone']),control=await create('Claim Topic Control',['email','mail'])
  const selection=await list('Claim Topic')
  for(const channel of ['email','mail']){
   if(channel==='mail')await prepareVerifiedMail(h,options)
   const r=await prepare(channel,selection.id);assert.deepEqual((await detail(r.id)).recipients.map(r=>r.donor_id).sort(),[target.id,control.id].sort())
   await approve(r);await prefs(target,channel,['newsletter','events'])
   const denied=await command('appeal.export',{appealId:r.id,version:2},{status:409})
   assert.equal(denied.error,'CONSENT_CHANGED','Preference history invalidates the approved consent snapshot')
   assert.equal((await detail(r.id)).appeal.status,'approved','A topic hold never creates an export')
   if(channel==='mail')await prepareVerifiedMail(h,options)
   const next=await prepare(channel,selection.id)
   assert.equal(next.excluded.topic,1);assert.deepEqual((await detail(next.id)).recipients.map(r=>r.donor_id),[control.id])
   await prefs(target,channel)
  }
  const targetList=await list('Claim Topic Target'),email=await prepare('email',targetList.id);await approve(email);await prefs(target,'email',['newsletter'])
  const emailBefore=edge.handoffs.length
  assert.equal((await command('appeal.send',{appealId:email.id,version:2},{status:409})).error,'CONSENT_CHANGED')
  assert.equal(edge.handoffs.length,emailBefore,'Withdrawal after approval prevents every provider handoff')
  await prefs(target,'email')
  const raced=await prepare('email',targetList.id)
  await approve(raced);duringLookup=()=>prefs(target,'email',['newsletter'])
  assert.equal((await command('appeal.send',{appealId:raced.id,version:2},{status:409})).error,'COMMUNICATION_RESTRICTED')
  assert.equal(duringLookup,null);assert.equal(edge.handoffs.length,emailBefore,'Withdrawal while provider checks are awaited still produces no handoff')
  await prefs(target,'email')
  const sms=await command('sms.prepare',{name:'Synthetic approved topic text',purpose:'appeal',donorIds:[target.id],body:'Please support the reading room.'})
  await command('sms.approve',{runId:sms.id,version:1});await prefs(target,'sms',['newsletter'])
  assert.equal((await command('sms.send',{runId:sms.id,version:2},{status:409})).error,'COMMUNICATION_RESTRICTED')
  assert.equal(texts.length,0);assert.equal((await h.get('/api/coffer/texts?runId='+sms.id)).recipients[0].state,'pending')
  const call=await command('task.create',{donorId:target.id,ownerId:owner,dueOn:'2026-10-16',kind:'call',title:'Synthetic approved topic call',isAsk:true})
  await prefs(target,'phone',['newsletter'])
  const blockedCall=await command('task.complete',{taskId:call.id,version:call.version,outcome:'connected',notes:'Synthetic call completion attempt.'},{status:409})
  assert.equal(blockedCall.message,'topic');assert.equal((await h.get('/api/coffer/tasks')).tasks.find(t=>t.id===call.id).status,'open')
  const phoneDonor=await create('Claim Phone Withdrawal',['phone'])
  const phoneCall=await command('task.create',{donorId:phoneDonor.id,ownerId:owner,dueOn:'2026-10-16',kind:'call',title:'Synthetic phone permission call',isAsk:true})
  await command('consent.record',{donorIds:[phoneDonor.id],channel:'phone',status:'withdrawn',method:'verbal',evidence:'Synthetic donor withdrew phone permission',capturedOn:'2026-10-15'})
  const withdrawnCall=await command('task.complete',{taskId:phoneCall.id,version:phoneCall.version,outcome:'connected',notes:'Synthetic withdrawn permission completion attempt.'},{status:409})
  assert.equal(withdrawnCall.error,'PHONE_CONSENT');assert.equal((await h.get('/api/coffer/tasks')).tasks.find(t=>t.id===phoneCall.id).status,'open')

  // Signed STOP must fence the next appeal, even when another rule also holds it.
  const stopFields=new URLSearchParams({AccountSid:account,MessageSid:'synthetic-coffer-9504',From:(await h.get('/api/coffer/donors/'+target.id)).donor.phone,To:'+12025550101',Body:'STOP'})
  const hook='/api/coffer/sms/webhook',signature=createHmac('sha1',token).update(h.origin+hook+[...stopFields.keys()].sort().map(k=>k+stopFields.get(k)).join('')).digest('base64')
  assert.equal((await h.request(hook,{method:'POST',as:'',raw:stopFields.toString(),headers:{...headers,'content-type':'application/x-www-form-urlencoded','x-twilio-signature':signature}})).status,200)
  const afterStop=await command('sms.prepare',{name:'Synthetic appeal following STOP',purpose:'appeal',donorIds:[target.id],body:'Please support another reader.'})
  assert.equal(afterStop.recipients,0);assert.deepEqual(afterStop.excluded,[{donorId:target.id,reason:'SMS consent withdrawn'}]);assert.equal(texts.length,0)

  // Two independent approved claims race for one slot through public commands.
  const compete=async(name,inputs)=>{
   const responses=await Promise.all(inputs.map(input=>h.request('/api/coffer/commands',{method:'POST',body:{command:name,input},headers})))
   const values=await Promise.all(responses.map(async response=>({status:response.status,value:await response.json()})))
   assert.deepEqual(values.map(r=>r.status).sort(),[200,409],name+' must award exactly one same-channel claim')
   const denied=values.find(r=>r.status===409).value
   assert.ok(denied.error==='COMMUNICATION_RESTRICTED'||denied.error==='SOLICITATION_RESTRICTED'&&denied.message==='frequency',JSON.stringify(denied))
  }
  const racers=[]
  for(const channel of ['email','mail','sms','phone']){
   const d=await create('Concurrent Claim '+channel,[channel]);await prefs(d,channel,undefined,'monthly');racers.push({d,channel,list:await list('Concurrent Claim '+channel)})
  }
  for(const {d,channel,list:selection} of racers){
   if(channel==='email'||channel==='mail'){
    // Complete both passes before freezing either run: a later pass updates
    // address-check versions and would otherwise invalidate the first run.
    if(channel==='mail'){await prepareVerifiedMail(h,options);await prepareVerifiedMail(h,options)}
    const runs=[await prepare(channel,selection.id),await prepare(channel,selection.id)]
    for(const r of runs)await approve(r)
    await compete('appeal.export',runs.map(r=>({appealId:r.id,version:2})))
    assert.deepEqual((await Promise.all(runs.map(r=>detail(r.id)))).map(d=>d.appeal.status).sort(),['approved','exported'])
   }else if(channel==='sms'){
    const before=texts.length,runs=[]
    for(let i=0;i<2;i++){const r=await command('sms.prepare',{name:'Synthetic concurrent text '+i,purpose:'appeal',donorIds:[d.id],body:'Please support another reader.'});await command('sms.approve',{runId:r.id,version:1});runs.push(r)}
    await compete('sms.send',runs.map(r=>({runId:r.id,version:2})));assert.equal(texts.length,before+1)
    assert.deepEqual((await Promise.all(runs.map(r=>h.get('/api/coffer/texts?runId='+r.id)))).map(r=>r.recipients[0].state).sort(),['pending','submitted'])
   }else{
    const tasks=[]
    for(let i=0;i<2;i++)tasks.push(await command('task.create',{donorId:d.id,ownerId:owner,dueOn:'2026-10-16',kind:'call',title:'Synthetic concurrent call '+i,isAsk:true}))
    await compete('task.complete',tasks.map(t=>({taskId:t.id,version:t.version,outcome:'connected',notes:'Discussed reading room support.'})))
    assert.deepEqual((await h.get('/api/coffer/tasks')).tasks.filter(t=>tasks.some(r=>r.id===t.id)).map(t=>t.status).sort(),['done','open'])
   }
  }
  await journeyTopicClaims(h,{create,prefs,command,headers,edge})
 },{entry:'tests/engagement-worker.ts',verifiedMail:true,bindings:{COFFER_TEST_NOW:at,TWILIO_ACCOUNT_SID:account,TWILIO_AUTH_TOKEN:token,TWILIO_FROM:'+12025550101'},outbound})
 await organizationCalendarJourney()
}

async function journeyTopicClaims(h,{create,prefs,command,headers,edge}){
 const content={thankSubject:'Synthetic thanks',thankBody:'Thank you for helping readers.',impactSubject:'Synthetic impact',impactBody:'Readers are learning.',askSubject:'Synthetic next gift',askBody:'Please support another reader.',impactDays:1,askDays:2}
 const publication=await command('journey.publish',{...content,name:'Synthetic topic journey',trigger:'gift_amount',amount:'1000',thankKind:'wait',impactKind:'wait',confirm:'yes'})
 const d=await create('Journey Topic Claim',['email'])
 const later=(at,extra={})=>({headers:{...headers,'x-test-now':at},...extra})
 await h.command('gift.record',{donorId:d.id,amount:'1500',receivedOn:'2026-10-15',method:'check',goods:'none'},later('2026-10-15T16:01:00Z'))
 await h.command('journey.run',{},later('2026-10-15T16:02:00Z'))
 const enrollment=(await h.get('/api/coffer/journeys')).enrollments.find(e=>e.journey_id===publication.id&&e.donor_id===d.id)
 assert.ok(enrollment);assert.equal(enrollment.steps.find(s=>s.step==='ask').status,'pending')
 await prefs(d,'email',['newsletter'])
 const before=edge.handoffs.length
 await h.command('journey.run',{},later('2026-10-18T16:00:00Z'))
 const saved=(await h.get('/api/coffer/journeys')).enrollments.find(e=>e.id===enrollment.id).steps.find(s=>s.step==='ask')
 assert.equal(saved.status,'skipped');assert.equal(saved.note,'topic');assert.equal(edge.handoffs.length,before)
 // The welcome series is a separate current ask receiver with its own publication.
 await command('welcome.publish',content)
 const welcome=await create('Welcome Topic Claim',['email'])
 await h.command('gift.record',{donorId:welcome.id,amount:'25',receivedOn:'2026-10-15',method:'check',goods:'none'},later('2026-10-15T16:03:00Z'))
 await h.command('welcome.run',{},later('2026-10-15T16:04:00Z'))
 const initial=(await h.get('/api/coffer/welcome')).enrollments.find(e=>e.donor_id===welcome.id)
 assert.ok(initial);assert.equal(initial.steps.find(s=>s.step==='ask').status,'pending')
 await prefs(welcome,'email',['newsletter'])
 await h.command('welcome.run',{},later('2026-10-16T16:05:00Z'))
 const welcomeBefore=edge.handoffs.length
 await h.command('welcome.run',{},later('2026-10-18T16:05:00Z'))
 const final=(await h.get('/api/coffer/welcome')).enrollments.find(e=>e.donor_id===welcome.id).steps.find(s=>s.step==='ask')
 assert.equal(final.status,'cancelled');assert.equal(final.note,'topic');assert.equal(edge.handoffs.length,welcomeBefore)
}
