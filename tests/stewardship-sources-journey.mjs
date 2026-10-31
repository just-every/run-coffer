import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {run,installation,donor,reviewed,archive,restore} from './harness.mjs'
import {fixedNow} from './fixed-clock.mjs'
import {stewardshipSourcesBrowser} from './stewardship-sources-browser.mjs'

const address=n=>['synthetic-coffer-'+n,'example.test'].join(String.fromCharCode(64))
const route=action=>'/api/coffer/agent/stewardship/'+action

// All source records are created and read through the shipped HTTP doors. Only
// the model, payment processor, mail submission and inbound mail edges are faked.
export async function stewardshipSourcesJourney(){
 const calls=[],sessions=new Map(),payments=new Map()
 let mode='good',foreignCitation
 const bindings={STRIPE_SECRET_KEY:'synthetic-coffer-9001',COFFER_REPLY_ADDRESS:address('replies'),COFFER_TEST_NOW:fixedNow}
 const outbound=async request=>{
  const u=new URL(request.url)
  if(u.hostname==='api.stripe.com'){
   const p=new URLSearchParams(await request.text())
   if(u.pathname==='/v1/customers')return Response.json({id:'synthetic-coffer-customer-'+randomUUID()})
   if(u.pathname==='/v1/checkout/sessions'){
    const id='synthetic-coffer-session-'+sessions.size,pi='synthetic-coffer-payment-'+sessions.size
    const value={id,metadata:{coffer_intent:p.get('metadata[coffer_intent]')},customer:p.get('customer'),currency:'usd',amount_total:15000,status:'complete',payment_status:'paid',payment_intent:pi,url:'https://checkout.stripe.com/c/pay/'+id}
    sessions.set(id,value);payments.set(pi,{id:pi,status:'succeeded',currency:'usd',amount_received:15000,created:Date.parse(fixedNow)/1000})
    return Response.json(value)
   }
   const value=u.pathname.startsWith('/v1/checkout/sessions/')?sessions.get(u.pathname.split('/').at(-1)):payments.get(u.pathname.split('/').at(-1))
   assert.ok(value,'Unexpected payment request '+u.pathname);return Response.json(value)
  }
  assert.equal(u.hostname,'api.anthropic.com')
  assert.equal(request.headers.get('x-api-key'),'synthetic-coffer-9002')
  const call=await request.json(),input=JSON.parse(call.messages[0].content);calls.push(input)
  const attendance=input.sources?.find(s=>s.kind==='attendance'),reply=input.sources?.find(s=>s.kind==='reply'),gift=input.sources?.find(s=>s.kind==='gift')
  let output
  if(input.subject){
   const invented=/500 children|millionaire|private intent/.test(input.body),isAsk=/Please give/.test(input.body)
   output={assessment:invented?'The claim has no recorded source.':'Only the recorded attendance and reply are stated.',supported:!invented,isAsk,sourceIds:[gift?.id,attendance?.id,reply?.id].filter(Boolean)}
  }else{
   const body=mode==='invented'?'Your gift taught 500 children to read.':mode==='ask'?'Please give another $500.':`Thank you for joining ${attendance.facts.event_name} on ${attendance.facts.starts_on}. You wrote: ${reply.facts.excerpt.slice(0,80)}`
   output={subject:'Thank you for joining us',body,citations:[{sourceId:mode==='foreign'?foreignCitation:mode==='missing'?'attendance:synthetic-coffer-missing':attendance.id},{sourceId:reply.id}]}
  }
  return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(output)}]})
 }
 await run(async h=>{
  await reviewed(h)
  const people=[]
  for(const [i,name] of ['Ana Sources','Ben Sources','Cora Sources'].entries())people.push({...await donor(h,name,{email:address(i)}),name,email:address(i)})
  const state=(person=people[0])=>h.get('/api/coffer/agent/stewardship?donorId='+person.id)
  const draftFor=async person=>{const value=await h.api(route('draft'),{donorId:person.id,kind:'thank_you'});return {...value,row:(await state(person)).drafts.find(r=>r.id===value.id)}}
  const save=d=>h.api(route('save'),{id:d.id,version:d.version,subject:d.row.subject,body:d.row.body})
  const setup=await h.get('/api/coffer/agent/stewardship')
  await h.api(route('setup'),{version:setup.setup.version,key:'synthetic-coffer-9002'})
  const campaign=await h.api('/api/coffer/giving/campaigns',{name:'Source reading program',slug:'source-reading',description:'Community reading.',fund:'Reading',goal:'10000'})
  await h.command('appealCode.define',{code:'SOURCES',name:'Source gala'})
  const event=await h.command('event.create',{name:'Community reading gala',slug:'source-gala',campaignId:campaign.id,appeal:'SOURCES',startsOn:'2026-10-17'})
  const ticket=await h.command('event.ticket',{eventId:event.id,name:'Dinner',price:'150',benefit:'60',benefitDescription:'Dinner'})
  const registrations=[]
  for(const p of people){
   const response=await h.request('/giving/events/source-gala/checkout',{method:'POST',as:'',headers:{'content-type':['application','x-www-form-urlencoded'].join('/')},raw:new URLSearchParams({requestId:randomUUID(),ticketId:ticket.id,name:p.name,email:p.email,'cf-turnstile-response':'synthetic-coffer-security-token'}).toString()})
   assert.equal(response.status,303,await response.text())
   const session=[...sessions.keys()].at(-1)
   assert.equal((await h.request('/giving/thanks?session_id='+session,{as:''})).status,200)
   const r=(await h.get('/api/coffer/events?eventId='+event.id)).find(r=>r.donor_id===p.id);assert.ok(r)
   registrations.push(r)
   assert.equal((await state(p)).sources.filter(s=>s.kind==='attendance').length,0,'A paid ticket alone is not attendance')
   await h.command('event.checkIn',{registrationId:r.id})
   await h.command('consent.record',{donorIds:[p.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic stewardship permission.',capturedOn:'2026-10-17'})
  }
  const receive=async(p,text,{key='synthetic-coffer-reply-'+p.id,automatic=false,target=h}={})=>{
   if(!p.replySubject){
    const detail=await h.get('/api/coffer/donors/'+p.id),batch=await h.get('/api/coffer/letters/'+detail.letters[0].batch_id)
    p.replySubject=batch.letters.find(l=>l.donor_id===p.id).subject
   }
   const response=await target.request('/test-email',{method:'POST',body:{from:p.email,to:address('replies'),headers:{subject:'Re: '+p.replySubject,'message-id':key,...(automatic?{'auto-submitted':'auto-replied'}:{})},raw:'Content-Type: '+['text','plain'].join('/')+'; charset=utf-8\r\n\r\n'+text}})
   assert.equal(response.status,200);return response.json()
  }
  for(const [i,p] of people.entries()){
   p.reply=`I enjoyed reading circle ${i+1}. `+'Recorded private words. '.repeat(70)+'PRIVATE TAIL MUST NOT BE SHARED'
   assert.equal((await receive(p,p.reply)).rejected,null)
   const count=(await h.get('/api/coffer/replies')).length
   assert.deepEqual((await receive(p,p.reply)).forwarded,[],'Replayed receipt does not forward twice')
   assert.equal((await h.get('/api/coffer/replies')).length,count)
   assert.equal((await receive(p,'Automatic private message',{key:'synthetic-coffer-auto-'+i,automatic:true})).rejected,null)
  }
  const replies=await h.get('/api/coffer/replies')
  for(const [i,p] of people.entries()){
   const sources=(await state(p)).sources,a=sources.filter(s=>s.kind==='attendance'),r=sources.filter(s=>s.kind==='reply')
   assert.equal(a.length,1);assert.equal(a[0].id,'attendance:'+registrations[i].id)
   assert.equal(a[0].facts.event_name,'Community reading gala');assert.equal(a[0].facts.starts_on,'2026-10-17');assert.equal(a[0].facts.checked_in_at,fixedNow)
   const received=replies.find(r=>r.donor_id===p.id&&!r.automatic)
   assert.equal(r.length,1);assert.equal(r[0].id,'reply:'+received.id);assert.equal(r[0].facts.excerpt,p.reply.slice(0,1000))
   assert.equal(sources.some(s=>s.kind==='conversation'&&s.facts.notes.includes('PRIVATE TAIL')),false,'Reply timeline copies cannot bypass the excerpt bound')
   const draft=await draftFor(p)
   assert.match(draft.row.body,new RegExp(`reading circle ${i+1}`))
   const citations=JSON.parse(draft.row.citations)
   assert.ok(citations.some(c=>c.sourceId===a[0].id&&c.quote===JSON.stringify(a[0].facts)))
   assert.ok(citations.some(c=>c.sourceId===r[0].id&&c.quote===JSON.stringify(r[0].facts)))
   assert.ok(citations.every(c=>sources.some(s=>s.id===c.sourceId)))
   assert.ok(!JSON.stringify(calls).includes('PRIVATE TAIL MUST NOT BE SHARED'))
   for(const person of people)assert.ok(!JSON.stringify(calls).includes(person.email))
   p.draft=draft
  }
  const member=await h.person(address('member')),admin=await h.person(address('admin'),'admin')
  const agent=await h.command('agent.create',{label:'Synthetic source authority'}),authorityCalls=calls.length,authorityMail=h.messages.length,authorityDrafts=(await state()).drafts.length
  for(const options of [{as:member.cookie,status:403},{as:'',headers:{authorization:'Bearer '+agent.token},status:403},{as:'',status:401}]){
   await h.get('/api/coffer/agent/stewardship?donorId='+people[0].id,options)
   await h.api(route('draft'),{donorId:people[0].id,kind:'impact'},options)
   await h.api(route('save'),{...people[0].draft,subject:'Refused',body:'Refused'},options)
   await h.api(route('send'),{...people[0].draft,confirm:'SEND'},options)
  }
  assert.equal(calls.length,authorityCalls,'Refused roles cannot disclose sources to the model')
  assert.equal(h.messages.length,authorityMail,'Refused roles submit no email')
  assert.equal((await state()).drafts.length,authorityDrafts,'Refused roles create no draft')
  await h.command('agent.revoke',{id:agent.id})
  await h.get('/api/coffer/agent/stewardship',{as:'',headers:{authorization:'Bearer '+agent.token},status:401})
  assert.equal((await h.get('/api/coffer/agent/stewardship?donorId='+people[0].id,{as:admin.cookie})).sources.filter(s=>s.kind==='reply').length,1)
  const mailCount=h.messages.length
  await h.api(route('send'),{...people[0].draft,confirm:'SEND'},{status:409});assert.equal(h.messages.length,mailCount)
  foreignCitation='attendance:'+registrations[1].id
  for(const invalid of ['foreign','missing','invented','ask']){
   mode=invalid
   if(invalid==='ask')await h.command('solicitation.set',{donorId:people[0].id,version:0,type:'stop',startsOn:'2026-10-01',sourceOn:'2026-10-01'})
   const before=(await state()).drafts.length
   const refused=await h.api(route('draft'),{donorId:people[0].id,kind:'impact'},{status:['foreign','missing'].includes(invalid)?502:409})
   assert.equal(refused.error,invalid==='ask'?'STEWARDSHIP_ASK':'UNGROUNDED')
   assert.equal((await state()).drafts.length,before);assert.equal(h.messages.length,mailCount)
  }
  mode='good'
  const safe=await draftFor(people[0])
  await h.api(route('save'),{...safe,subject:safe.row.subject,body:'Please give another $500.'},{status:409})
  await h.api(route('save'),{...safe,subject:safe.row.subject,body:'You are a millionaire with private intent.'},{status:409})
  const approved=await save(safe)
  await h.api(route('send'),approved,{status:400});assert.equal(h.messages.length,mailCount)
  await stewardshipSourcesBrowser(h,{person:people[0],draft:safe,directory:process.env.COFFER_STEWARDSHIP_BROWSER??'.cache/stewardship-sources',calls})
  const sentNote=await h.api(route('send'),{...approved,confirm:'SEND'});assert.equal(sentNote.status,'submitted')
  assert.equal(h.messages.length,mailCount+1)
  assert.equal(h.messages.at(-1).text,safe.row.body)
  await h.api(route('send'),{...approved,confirm:'SEND'},{status:409});assert.equal(h.messages.length,mailCount+1)
  const pending=await draftFor(people[1]),pendingReview=await save(pending),callsBefore=calls.length
  await receive(people[1],'A new recorded reply changes the reviewed evidence.',{key:'synthetic-coffer-new-reply'})
  const stale=await h.api(route('send'),{...pendingReview,confirm:'SEND'},{status:409});assert.equal(stale.error,'SOURCES_CHANGED')
  await h.api(route('save'),{...pendingReview,subject:pending.row.subject,body:pending.row.body},{status:409})
  assert.equal(calls.length,callsBefore,'Stale evidence is refused before another model disclosure')
  // Change attendance after review, independently of payment or reply changes.
  const extraGuest=await h.request('/giving/events/source-gala/checkout',{method:'POST',as:'',headers:{'content-type':['application','x-www-form-urlencoded'].join('/')},raw:new URLSearchParams({requestId:randomUUID(),ticketId:ticket.id,name:people[1].name,email:people[1].email,'cf-turnstile-response':'synthetic-coffer-security-token'}).toString()})
  assert.equal(extraGuest.status,303)
  assert.equal((await h.request('/giving/thanks?session_id='+[...sessions.keys()].at(-1),{as:''})).status,200)
  const nextRegistration=(await h.get('/api/coffer/events?eventId='+event.id)).find(r=>r.donor_id===people[1].id&&r.id!==registrations[1].id)
  assert.ok(nextRegistration)
  assert.equal((await state(people[1])).sources.filter(s=>s.kind==='attendance').length,1)
  const attendanceDraft=await draftFor(people[1]),attendanceReview=await save(attendanceDraft),attendanceMail=h.messages.length
  await h.command('event.checkIn',{registrationId:nextRegistration.id})
  assert.equal((await h.api(route('send'),{...attendanceReview,confirm:'SEND'},{status:409})).error,'SOURCES_CHANGED')
  const discardedAttendance=await h.api(route('discard'),attendanceReview)
  assert.equal((await h.api(route('restore'),discardedAttendance,{status:409})).error,'SOURCES_CHANGED')
  assert.equal(h.messages.length,attendanceMail,'New attendance invalidates review and sends nothing')
  const identityDraft=await draftFor(people[2]),identityReview=await save(identityDraft)
  const original=(await h.get('/api/coffer/donors/'+people[2].id)).donor
  await h.command('donor.update',{donorId:original.id,version:original.version,name:'Cora Corrected',email:address('corrected')})
  assert.equal((await h.api(route('send'),{...identityReview,confirm:'SEND'},{status:409})).error,'SOURCES_CHANGED')
  const discarded=await h.api(route('discard'),people[0].draft)
  const restoredDraft=await h.api(route('restore'),discarded)
  assert.equal((await state()).drafts.find(d=>d.id===restoredDraft.id).reviewed_version,null)
  const snapshot=await archive(h)
  await run(async restored=>{
   await restore(restored,snapshot)
   const restoredState=await restored.get('/api/coffer/agent/stewardship?donorId='+people[0].id)
   assert.deepEqual(restoredState.sources,(await state()).sources)
   assert.equal(restoredState.drafts.find(d=>d.id===safe.id).body,safe.row.body)
   const replay=await receive(people[0],people[0].reply,{target:restored})
   assert.deepEqual(replay.forwarded,[],'Restored replay receipts cannot forward an old capture again')
   assert.equal((await restored.get('/api/coffer/replies')).filter(r=>r.donor_id===people[0].id&&!r.automatic).length,1)
   assert.equal(restoredState.setup.configured,false,'Archive restoration never restores model authority')
   await restored.api(route('draft'),{donorId:people[0].id,kind:'thank_you'},{status:409})
  },{entry:'tests/engagement-worker.ts',bindings,outbound,givingProtection:false})
  const comparison=await h.get('/api/coffer/duplicates/compare?source='+people[0].id+'&target='+people[1].id)
  const merged=await h.command('donor.merge',{sourceDonorId:people[0].id,donorId:people[1].id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  await h.get('/api/coffer/agent/stewardship?donorId='+people[0].id,{status:404})
  const combined=(await state(people[1])).sources
  assert.equal(combined.filter(s=>s.kind==='attendance').length,3);assert.equal(combined.filter(s=>s.kind==='reply').length,3)
  await h.api(route('send'),{...restoredDraft,confirm:'SEND'},{status:409})
  await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
  assert.equal((await state()).sources.filter(s=>s.kind==='attendance').length,1)
  // Shared current identities cannot import a new reply or remain model sources.
  const first=(await h.get('/api/coffer/donors/'+people[0].id)).donor
  await h.command('donor.update',{donorId:first.id,version:first.version,name:first.name,email:first.email,household:'Source family'})
  const other=(await h.get('/api/coffer/donors/'+people[2].id)).donor
  await h.command('donor.update',{donorId:other.id,version:other.version,name:other.name,email:people[0].email,household:'Source family'})
  assert.ok((await receive(people[0],'This sender is ambiguous.',{key:'synthetic-coffer-ambiguous'})).rejected)
  assert.equal((await state()).sources.filter(s=>s.kind==='reply').length,0)
  await h.command('donor.erase',{donorId:people[0].id,confirm:'ERASE'})
  await h.get('/api/coffer/agent/stewardship?donorId='+people[0].id,{status:404})
  const after=await archive(h),serialized=JSON.stringify(after)
  assert.ok(!serialized.includes(people[0].reply.slice(0,80)),'Erasure removes private source copies, citations and versions')
  assert.ok(!serialized.includes(safe.row.body))
  assert.ok((await receive(people[0],people[0].reply)).rejected,'A replay after erasure cannot recreate a reply')
  assert.ok((await receive(people[0],people[0].reply,{key:'synthetic-coffer-legacy-capture'})).rejected,'An unseen legacy capture from an erased identity cannot attach to a remaining shared-address donor')
  assert.ok(!(await h.get('/api/coffer/replies')).some(r=>r.body.includes('reading circle 1')),'Erased private words cannot return under another donor')
  const fresh=await installation({entry:'tests/engagement-worker.ts',bindings,outbound,givingProtection:false})
  try{await restore(fresh,snapshot,{status:400,laterJournal:{sourceIdentity:after[0].sourceIdentity,epoch:after[0].epoch,journal:after[0].journal}});assert.equal((await fresh.get('/api/coffer/agent/stewardship')).drafts.length,0)}finally{await fresh.close()}
 },{entry:'tests/engagement-worker.ts',bindings,outbound})
}
